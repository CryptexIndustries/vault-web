package relay

import (
	"context"
	"crypto/rand"
	"errors"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

const (
	// Subprotocol is required on both WebSocket endpoints.
	Subprotocol = "cryptex-agent.v1"

	// connectReadLimit fits a Send of the largest envelope with room for
	// the frame around it, so an oversized envelope gets Result TOO_LARGE
	// instead of a dropped socket.
	connectReadLimit = agentproto.MaxEnvelopeSize + 4<<10
	// preAuthReadLimit applies until Auth succeeds and on /v1/pair. Auth
	// with a relay pass is about 5 KiB, an offer at most 4 KiB.
	preAuthReadLimit = 8 << 10
	outboundBuffer   = 256
	writeTimeout     = 10 * time.Second
)

var errBadFrame = errors.New("not a binary ClientFrame")

// accept upgrades the request. Any Origin is allowed: the web approver runs
// in a browser on another origin, and nothing here relies on cookies, so a
// cross-site page gains nothing it couldn't do from its own socket.
func (s *Server) accept(w http.ResponseWriter, r *http.Request, readLimit int64) *websocket.Conn {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		Subprotocols:       []string{Subprotocol},
		InsecureSkipVerify: true,
	})
	if err != nil {
		return nil
	}
	if ws.Subprotocol() != Subprotocol {
		ws.Close(websocket.StatusPolicyViolation, "subprotocol "+Subprotocol+" required")
		return nil
	}
	ws.SetReadLimit(readLimit)
	return ws
}

type outbound struct {
	frame *agentpb.ServerFrame
	// backlog is delivered one envelope at a time; see deliverAllLocked.
	backlog []*entry
	close   bool
	reason  string
}

// peer is one WebSocket. Its handler goroutine reads; a writer goroutine
// drains out, so code holding s.mu can queue frames without waiting on a
// slow client.
type peer struct {
	s          *Server
	ws         *websocket.Conn
	ip         string
	out        chan outbound
	done       chan struct{}
	writerDone chan struct{}
	ending     atomic.Bool

	// Set by the handler goroutine; read under s.mu by others.
	key   string
	role  agentpb.Role
	label string
	slot  *slot
}

func (s *Server) newPeer(ws *websocket.Conn, ip, label string) *peer {
	p := &peer{
		s: s, ws: ws, ip: ip, label: label,
		out:        make(chan outbound, s.outboundSize),
		done:       make(chan struct{}),
		writerDone: make(chan struct{}),
	}
	s.metrics.opened(label)
	go p.writeLoop()
	return p
}

// setRole records who p authenticated as.
func (p *peer) setRole(key string, role agentpb.Role) {
	label := labelAgent
	if role == agentpb.Role_ROLE_APPROVER {
		label = labelApprover
	}
	p.s.metrics.relabel(p.label, label)
	p.key, p.role, p.label = key, role, label
}

func (p *peer) writeLoop() {
	defer close(p.writerDone)
	for {
		select {
		case o := <-p.out:
			if o.frame != nil && !p.write(o.frame) {
				p.s.release(o.backlog...)
				return
			}
			for i := range o.backlog {
				// Clear each slot as it is taken: once released, the entry
				// must not stay reachable through the backlog while a later
				// write blocks.
				e := o.backlog[i]
				o.backlog[i] = nil
				// Acked or expired ones may still be in the copy; skipping
				// expired ones saves the recipient a refusal.
				if !p.s.now().Before(e.dropAt) {
					p.s.release(e)
					continue
				}
				raw, err := proto.Marshal(deliverFrame(e.env))
				// The marshalled frame is all this writer holds from here,
				// like any frame in flight.
				p.s.release(e)
				if err != nil || !p.writeRaw(raw) {
					p.s.release(o.backlog[i+1:]...)
					return
				}
				p.s.metrics.delivered()
			}
			if o.close {
				p.ws.Close(websocket.StatusNormalClosure, o.reason)
				return
			}
		case <-p.done:
			return
		}
	}
}

// write sends one frame, waiting up to writeTimeout for the client to take
// it. On failure the connection is closed and the writer stops.
func (p *peer) write(f *agentpb.ServerFrame) bool {
	raw, err := proto.Marshal(f)
	if err != nil {
		p.ws.CloseNow()
		return false
	}
	return p.writeRaw(raw)
}

func (p *peer) writeRaw(raw []byte) bool {
	ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
	err := p.ws.Write(ctx, websocket.MessageBinary, raw)
	cancel()
	if err != nil {
		p.ws.CloseNow()
		return false
	}
	return true
}

// deliverLocked queues entries for the writer. Until it takes each one, the
// entry keeps counting against the queue budget even if its mailbox lets
// go of it.
func (p *peer) deliverLocked(entries []*entry) {
	for _, e := range entries {
		e.outRefs++
	}
	if !p.push(outbound{backlog: entries}) {
		p.s.releaseLocked(entries...)
	}
}

// releaseLocked drops one outbound reference to each entry.
func (s *Server) releaseLocked(entries ...*entry) {
	for _, e := range entries {
		e.outRefs--
		s.budget.unhold(e)
	}
}

func (s *Server) release(entries ...*entry) {
	if len(entries) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.releaseLocked(entries...)
}

// push queues a frame without blocking and reports whether it did. A
// client that falls this far behind is dropped; whatever it hasn't acked is
// redelivered when it reconnects.
func (p *peer) push(o outbound) bool {
	if p.ending.Load() {
		return false
	}
	if o.close {
		p.ending.Store(true)
	}
	select {
	case p.out <- o:
		return true
	default:
		p.ending.Store(true)
		// CloseNow can wait for a close handshake in progress; callers may
		// hold s.mu.
		go p.ws.CloseNow()
		return false
	}
}

func (p *peer) send(f *agentpb.ServerFrame) { p.push(outbound{frame: f}) }

// end sends a last frame and closes the connection after it.
func (p *peer) end(f *agentpb.ServerFrame, reason string) {
	p.push(outbound{frame: f, close: true, reason: reason})
}

// fail sends a fatal Error and closes the connection.
func (p *peer) fail(status agentpb.Status, message string) {
	p.end(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Error{Error: &agentpb.Error{
		Status: status, Message: message,
	}}}, statusLabel(status))
}

func (p *peer) result(id uint32, status agentpb.Status, message string) {
	p.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Result{Result: &agentpb.Result{
		Id: id, Status: status, Message: message,
	}}})
}

func (p *peer) pong() {
	p.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Pong{Pong: &agentpb.Pong{}}})
}

// sendChallenge opens every socket, as the protocol says, and returns the
// nonce Auth must sign.
func (p *peer) sendChallenge() []byte {
	nonce := randomBytes(32)
	p.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Challenge{Challenge: &agentpb.Challenge{
		ProtocolVersion:  agentproto.Version,
		Nonce:            nonce,
		KeepaliveSeconds: uint32(p.s.cfg.Keepalive / time.Second),
		ServerTime:       p.s.now().UnixMilli(),
	}}})
	return nonce
}

func (p *peer) read(timeout time.Duration) (*agentpb.ClientFrame, error) {
	ctx, cancel := context.WithTimeout(p.s.ctx, timeout)
	defer cancel()
	typ, data, err := p.ws.Read(ctx)
	if err != nil {
		return nil, err
	}
	if typ != websocket.MessageBinary {
		return nil, errBadFrame
	}
	var f agentpb.ClientFrame
	if err := proto.Unmarshal(data, &f); err != nil {
		return nil, errBadFrame
	}
	p.s.metrics.received(&f)
	return &f, nil
}

// idleTimeout is how long an established socket may stay silent: two missed
// keep-alives plus some grace for the network.
func (s *Server) idleTimeout() time.Duration { return 2*s.cfg.Keepalive + s.idleGrace }

// finish runs when the handler stops reading. A connection that is ending
// gets to flush its last frames and close cleanly first.
func (p *peer) finish() {
	if p.ending.Load() {
		select {
		case <-p.writerDone:
		case <-p.s.ctx.Done():
		case <-time.After(2 * writeTimeout):
		}
	}
	close(p.done)
	p.ws.CloseNow()
	<-p.writerDone
	p.drain()
	p.s.metrics.closed(p.label)
}

// drain releases the envelopes still queued for the stopped writer. Entries
// are only queued under s.mu while ending is clear, so after this nothing
// can add more.
func (p *peer) drain() {
	p.s.mu.Lock()
	defer p.s.mu.Unlock()
	p.ending.Store(true)
	for {
		select {
		case o := <-p.out:
			p.s.releaseLocked(o.backlog...)
		default:
			return
		}
	}
}

func deliverFrame(env *agentpb.Envelope) *agentpb.ServerFrame {
	return &agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Deliver{Deliver: &agentpb.Deliver{Envelope: env}}}
}

func randomBytes(n int) []byte {
	b := make([]byte, n)
	rand.Read(b)
	return b
}
