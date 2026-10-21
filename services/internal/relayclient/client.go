// Package relayclient speaks the agent relay protocol (agent.proto) from the
// client side: /v1/connect for agents and approvers, /v1/pair for agents that
// aren't paired yet. cryptex-agent and the test approver both use it.
package relayclient

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

const (
	// Subprotocol is required by the relay on both endpoints.
	Subprotocol = "cryptex-agent.v1"

	// handshakeTimeout bounds each step before the connection is usable. The
	// relay gives clients 10 s to authenticate.
	handshakeTimeout = 10 * time.Second
	writeTimeout     = 10 * time.Second
	// readLimit fits the largest envelope the relay accepts plus the frame
	// around it.
	readLimit = agentproto.MaxEnvelopeSize + 4<<10
	// defaultKeepalive applies if a relay announces no interval.
	defaultKeepalive = 240 * time.Second
	// MaxQueuedFrames caps the frames waiting for Next. A relay that sends
	// faster than the client takes them gets the connection closed, rather
	// than growing the client's memory without bound.
	MaxQueuedFrames = 256
)

// Credentials go into Auth on /v1/connect.
type Credentials struct {
	// Role says whether this key connects as an agent or an approver, so the
	// relay refuses an agent it doesn't know instead of taking it for a new
	// approver.
	Role agentpb.Role
	// Pass is a relay pass (approvers on the hosted relay).
	Pass string
	// Token is the access token of a self-hosted relay in token mode.
	Token string
}

// Options tune a dial. The zero value works.
type Options struct {
	// HTTPClient makes the WebSocket handshake. Its redirect policy is
	// replaced; see NoRedirects.
	HTTPClient *http.Client
	UserAgent  string
}

// NoRedirects returns a copy of client (http.DefaultClient when nil) that
// doesn't follow redirects, leaving client itself as it was. A relay that
// redirects could otherwise send Auth, with the access token, somewhere
// CheckRelayURL never saw, such as a remote http:// URL. Relay URLs name
// the endpoint itself, so a redirect is never needed.
func NoRedirects(client *http.Client) *http.Client {
	if client == nil {
		client = http.DefaultClient
	}
	c := *client
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &c
}

// Conn is one WebSocket to the relay. Frames that answer a request (Result,
// SlotOffer) go to the waiting caller; everything else (Deliver, Revoked,
// SlotClaimed, SlotAnswer) is queued for Next.
type Conn struct {
	ws        *websocket.Conn
	challenge *agentpb.Challenge
	ready     *agentpb.Ready
	keepalive time.Duration

	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
	err    error // set before done closes

	mu      sync.Mutex
	nextID  uint32
	pending map[uint32]chan *agentpb.ServerFrame
	queue   []*agentpb.ServerFrame
	queued  uint64        // frames ever queued; see Queued
	notify  chan struct{} // signalled when queue grows

	lastSent atomic.Int64
	lastRecv atomic.Int64
}

// Connect dials /v1/connect and authenticates as id. The connection is ready
// for frames when it returns.
func Connect(ctx context.Context, relayURL string, id *agentproto.Identity, creds Credentials, opts Options) (*Conn, error) {
	origin, err := Origin(relayURL)
	if err != nil {
		return nil, err
	}
	c, err := dial(ctx, relayURL, ConnectPath, opts)
	if err != nil {
		return nil, err
	}
	auth := &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_Auth{Auth: &agentpb.Auth{
		PublicKey: id.ID(),
		Signature: agentproto.SignAuth(id, origin, c.challenge.GetNonce()),
		Pass:      creds.Pass,
		Token:     creds.Token,
		Role:      creds.Role,
	}}}
	frame, err := c.handshakeStep(ctx, auth)
	if err != nil {
		return nil, err
	}
	ready := frame.GetReady()
	if ready == nil {
		c.ws.CloseNow()
		return nil, fmt.Errorf("relay answered Auth with %T", frame.GetFrame())
	}
	c.ready = ready
	c.start()
	return c, nil
}

// OpenSlot dials /v1/pair and uploads a serialized PairingOffer. Next then
// yields SlotClaimed and SlotAnswer; an expired slot ends the connection
// with a STATUS_EXPIRED StatusError.
func OpenSlot(ctx context.Context, relayURL string, offer []byte, opts Options) (*Conn, *agentpb.SlotOpened, error) {
	c, err := dial(ctx, relayURL, PairPath, opts)
	if err != nil {
		return nil, nil, err
	}
	frame, err := c.handshakeStep(ctx, &agentpb.ClientFrame{
		Frame: &agentpb.ClientFrame_OpenSlot{OpenSlot: &agentpb.OpenSlot{Offer: offer}},
	})
	if err != nil {
		return nil, nil, err
	}
	opened := frame.GetSlotOpened()
	if opened == nil || len(opened.SlotId) == 0 {
		c.ws.CloseNow()
		return nil, nil, fmt.Errorf("relay answered OpenSlot with %T", frame.GetFrame())
	}
	c.start()
	return c, opened, nil
}

func dial(ctx context.Context, relayURL, path string, opts Options) (*Conn, error) {
	wsURL, err := WebSocketURL(relayURL, path)
	if err != nil {
		return nil, err
	}
	header := http.Header{}
	if opts.UserAgent != "" {
		header.Set("User-Agent", opts.UserAgent)
	}
	dialCtx, cancel := context.WithTimeout(ctx, handshakeTimeout)
	defer cancel()
	ws, resp, err := websocket.Dial(dialCtx, wsURL, &websocket.DialOptions{
		HTTPClient:   NoRedirects(opts.HTTPClient),
		HTTPHeader:   header,
		Subprotocols: []string{Subprotocol},
	})
	if err != nil {
		if resp != nil && resp.StatusCode >= 300 && resp.StatusCode < 400 {
			return nil, fmt.Errorf("connect to %s: the relay answered with a redirect (HTTP %d); give the relay's own URL", wsURL, resp.StatusCode)
		}
		if resp != nil {
			return nil, fmt.Errorf("connect to %s: HTTP %d", wsURL, resp.StatusCode)
		}
		return nil, fmt.Errorf("connect to %s: %w", wsURL, err)
	}
	if ws.Subprotocol() != Subprotocol {
		ws.Close(websocket.StatusProtocolError, "subprotocol required")
		return nil, fmt.Errorf("%s doesn't speak %s", wsURL, Subprotocol)
	}
	ws.SetReadLimit(readLimit)
	c := &Conn{
		ws:      ws,
		done:    make(chan struct{}),
		pending: map[uint32]chan *agentpb.ServerFrame{},
		notify:  make(chan struct{}, 1),
	}
	frame, err := c.readDirect(dialCtx)
	if err != nil {
		ws.CloseNow()
		return nil, err
	}
	ch := frame.GetChallenge()
	if ch == nil {
		ws.CloseNow()
		return nil, fmt.Errorf("relay sent %T before Challenge", frame.GetFrame())
	}
	if ch.ProtocolVersion != agentproto.Version {
		ws.CloseNow()
		return nil, fmt.Errorf("relay speaks protocol version %d, this client %d", ch.ProtocolVersion, agentproto.Version)
	}
	c.challenge = ch
	c.keepalive = defaultKeepalive
	if ch.KeepaliveSeconds > 0 {
		c.keepalive = time.Duration(ch.KeepaliveSeconds) * time.Second
	}
	return c, nil
}

// handshakeStep writes one frame and reads the answer before the reader
// goroutine exists. An Error frame becomes a fatal StatusError.
func (c *Conn) handshakeStep(ctx context.Context, frame *agentpb.ClientFrame) (*agentpb.ServerFrame, error) {
	stepCtx, cancel := context.WithTimeout(ctx, handshakeTimeout)
	defer cancel()
	if err := c.write(stepCtx, frame); err != nil {
		c.ws.CloseNow()
		return nil, err
	}
	reply, err := c.readDirect(stepCtx)
	if err != nil {
		c.ws.CloseNow()
		return nil, err
	}
	if e := reply.GetError(); e != nil {
		c.ws.CloseNow()
		return nil, &StatusError{Status: e.Status, Message: e.Message, Fatal: true}
	}
	return reply, nil
}

func (c *Conn) readDirect(ctx context.Context) (*agentpb.ServerFrame, error) {
	typ, data, err := c.ws.Read(ctx)
	if err != nil {
		return nil, closeErr(err)
	}
	if typ != websocket.MessageBinary {
		return nil, errors.New("relay sent a text message")
	}
	var frame agentpb.ServerFrame
	if err := proto.Unmarshal(data, &frame); err != nil {
		return nil, fmt.Errorf("relay sent a malformed frame: %w", err)
	}
	c.lastRecv.Store(time.Now().UnixNano())
	return &frame, nil
}

func closeErr(err error) error {
	if websocket.CloseStatus(err) == websocket.StatusNormalClosure {
		return ErrClosed
	}
	return err
}

func (c *Conn) start() {
	c.ctx, c.cancel = context.WithCancel(context.Background())
	go c.readLoop()
	go c.keepaliveLoop()
}

func (c *Conn) finish(err error) {
	c.mu.Lock()
	select {
	case <-c.done:
		c.mu.Unlock()
		return
	default:
	}
	c.err = err
	close(c.done)
	c.mu.Unlock()
	c.cancel()
}

// fail ends the connection with err without a close handshake.
func (c *Conn) fail(err error) {
	c.finish(err)
	c.ws.CloseNow()
}

func (c *Conn) readLoop() {
	for {
		frame, err := c.readDirect(c.ctx)
		if err != nil {
			// A reader stopped by Close reports the close, not the context.
			if c.ctx.Err() != nil {
				err = ErrClosed
			}
			c.fail(err)
			return
		}
		switch f := frame.GetFrame().(type) {
		case *agentpb.ServerFrame_Error:
			c.fail(&StatusError{Status: f.Error.Status, Message: f.Error.Message, Fatal: true})
			return
		case *agentpb.ServerFrame_Pong:
		case *agentpb.ServerFrame_Result:
			c.answer(f.Result.Id, frame)
		case *agentpb.ServerFrame_SlotOffer:
			c.answer(f.SlotOffer.Id, frame)
		default:
			c.mu.Lock()
			flooded := len(c.queue) >= MaxQueuedFrames
			if !flooded {
				c.queue = append(c.queue, frame)
				c.queued++
			}
			c.mu.Unlock()
			if flooded {
				c.fail(ErrFlooded)
				return
			}
			select {
			case c.notify <- struct{}{}:
			default:
			}
		}
	}
}

func (c *Conn) answer(id uint32, frame *agentpb.ServerFrame) {
	c.mu.Lock()
	ch := c.pending[id]
	delete(c.pending, id)
	c.mu.Unlock()
	if ch != nil {
		ch <- frame
	}
}

// keepaliveLoop sends Ping when nothing else went out for the announced
// interval, and gives up on a relay that has gone quiet for longer than it
// would tolerate from us.
func (c *Conn) keepaliveLoop() {
	tick := max(c.keepalive/4, 50*time.Millisecond)
	staleAfter := 2*c.keepalive + 10*time.Second
	t := time.NewTicker(tick)
	defer t.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-t.C:
		}
		now := time.Now()
		if now.Sub(time.Unix(0, c.lastRecv.Load())) > staleAfter {
			c.fail(ErrStale)
			return
		}
		if now.Sub(time.Unix(0, c.lastSent.Load())) >= c.keepalive {
			ctx, cancel := context.WithTimeout(c.ctx, writeTimeout)
			_ = c.write(ctx, &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_Ping{Ping: &agentpb.Ping{}}})
			cancel()
		}
	}
}

func (c *Conn) write(ctx context.Context, frame *agentpb.ClientFrame) error {
	data, err := proto.Marshal(frame)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	if err := c.ws.Write(ctx, websocket.MessageBinary, data); err != nil {
		return closeErr(err)
	}
	c.lastSent.Store(time.Now().UnixNano())
	return nil
}

// Challenge is the relay's first frame; KeepaliveSeconds and ServerTime are
// the useful parts after the handshake.
func (c *Conn) Challenge() *agentpb.Challenge { return c.challenge }

// Ready is the relay's answer to Auth (nil on /v1/pair).
func (c *Conn) Ready() *agentpb.Ready { return c.ready }

// Done is closed when the connection has ended; Err says why.
func (c *Conn) Done() <-chan struct{} { return c.done }

// Err is nil while the connection is open.
func (c *Conn) Err() error {
	select {
	case <-c.done:
		return c.err
	default:
		return nil
	}
}

// Close ends the connection normally.
func (c *Conn) Close() error {
	// The close handshake needs the reader running, so the connection is
	// marked done only afterwards.
	err := c.ws.Close(websocket.StatusNormalClosure, "")
	c.finish(ErrClosed)
	return err
}

// Queued counts the frames queued for Next since the connection opened.
// Frames are read in order, so when a call returns, every frame the relay
// sent before its Result is counted.
func (c *Conn) Queued() uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.queued
}

// Next returns the next queued frame (Deliver, Revoked, SlotClaimed,
// SlotAnswer). Frames that arrived before the connection ended are still
// returned; after that it returns the connection's error.
func (c *Conn) Next(ctx context.Context) (*agentpb.ServerFrame, error) {
	for {
		c.mu.Lock()
		if len(c.queue) > 0 {
			frame := c.queue[0]
			c.queue[0] = nil
			c.queue = c.queue[1:]
			c.mu.Unlock()
			return frame, nil
		}
		c.mu.Unlock()
		select {
		case <-c.notify:
		case <-c.done:
			// Drain anything queued just before the end.
			c.mu.Lock()
			empty := len(c.queue) == 0
			c.mu.Unlock()
			if empty {
				return nil, c.err
			}
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

// call sends a frame with a fresh id and waits for the Result or SlotOffer
// carrying it. A Result other than OK is returned as a *StatusError.
func (c *Conn) call(ctx context.Context, frame *agentpb.ClientFrame) (*agentpb.ServerFrame, error) {
	ch := make(chan *agentpb.ServerFrame, 1)
	c.mu.Lock()
	select {
	case <-c.done:
		c.mu.Unlock()
		return nil, c.err
	default:
	}
	c.nextID++
	if c.nextID == 0 {
		c.nextID = 1
	}
	frame.Id = c.nextID
	c.pending[frame.Id] = ch
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.pending, frame.Id)
		c.mu.Unlock()
	}()
	if err := c.write(ctx, frame); err != nil {
		return nil, err
	}
	select {
	case reply := <-ch:
		if r := reply.GetResult(); r != nil && r.Status != agentpb.Status_STATUS_OK {
			return reply, &StatusError{Status: r.Status, Message: r.Message}
		}
		return reply, nil
	case <-c.done:
		return nil, c.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
