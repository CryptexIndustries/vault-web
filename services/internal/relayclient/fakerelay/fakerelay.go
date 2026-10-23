// Package fakerelay is a small in-memory stand-in for the agent relay, for
// unit tests of relayclient, the agent and approvertest. It follows the relay
// spec for the happy paths and the checks those tests rely on; it is not the
// relay (services/internal/relay), and integration tests should use the real
// one.
package fakerelay

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"sync"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
	"github.com/CryptexIndustries/vault-web/services/internal/serverkit"
)

const (
	// slotLifetime is how long a pairing slot and its claim last.
	slotLifetime = 3 * time.Minute
	// keepaliveSeconds is announced in Challenge.
	keepaliveSeconds = 30
)

// Relay is a running fake relay.
type Relay struct {
	URL    string
	origin string
	srv    *httptest.Server

	// Token, if set, is required in Auth (token mode).
	Token string

	mu        sync.Mutex
	conns     map[string]*conn
	agents    map[string][]byte // agent key to its approver's key
	queues    map[string][]*agentpb.Envelope
	slots     map[string]*slot
	sendCount int
	sendHook  SendHook
	// claimRevoked holds agents the relay says are revoked while their
	// registration stays (see ClaimRevoked).
	claimRevoked map[string]bool
	// auths counts Auth frames per key (see Auths).
	auths map[string]int
}

// SendHook sees each Send before the relay handles it. A status other than
// OK (or unspecified) is the answer instead; drop closes the sender's socket
// without an answer, like a relay that fell over mid-request.
type SendHook func(sender []byte, env *agentpb.Envelope) (status agentpb.Status, drop bool)

type slot struct {
	offer   []byte
	sock    *conn
	claimer []byte
	expired chan struct{}
}

type conn struct {
	ws   *websocket.Conn
	key  []byte
	role agentpb.Role
	ctx  context.Context
	stop context.CancelFunc
}

// Start runs a fake relay on a local port until the test ends.
func Start(t interface {
	Cleanup(func())
}) *Relay {
	r := &Relay{
		conns:        map[string]*conn{},
		agents:       map[string][]byte{},
		queues:       map[string][]*agentpb.Envelope{},
		slots:        map[string]*slot{},
		claimRevoked: map[string]bool{},
		auths:        map[string]int{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc(relayclient.ConnectPath, r.handleConnect)
	mux.HandleFunc(relayclient.PairPath, r.handlePair)
	r.srv = httptest.NewServer(mux)
	r.URL = r.srv.URL
	r.origin, _ = serverkit.NormalizeOrigin(r.URL)
	t.Cleanup(r.Close)
	return r
}

// Close stops the server and drops every connection.
func (r *Relay) Close() {
	r.DropConnections()
	r.srv.Close()
}

// DropConnections closes every live socket, as a relay restart would.
func (r *Relay) DropConnections() {
	r.mu.Lock()
	var all []*conn
	for _, c := range r.conns {
		all = append(all, c)
	}
	for _, s := range r.slots {
		all = append(all, s.sock)
	}
	r.mu.Unlock()
	for _, c := range all {
		c.ws.CloseNow()
		c.stop()
	}
}

// ExpireSlots ends every open pairing slot with STATUS_EXPIRED.
func (r *Relay) ExpireSlots() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, s := range r.slots {
		close(s.expired)
		delete(r.slots, id)
	}
}

// IsAgent reports whether key is registered as an agent.
func (r *Relay) IsAgent(key []byte) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.agents[string(key)]
	return ok
}

// ClaimRevoked makes the relay tell agentKey it was revoked (a Revoked
// frame now, STATUS_REVOKED on every Auth) without removing it, as a lying
// relay could; false goes back to normal.
func (r *Relay) ClaimRevoked(agentKey []byte, revoked bool) {
	r.mu.Lock()
	if revoked {
		r.claimRevoked[string(agentKey)] = true
	} else {
		delete(r.claimRevoked, string(agentKey))
	}
	c := r.conns[string(agentKey)]
	r.mu.Unlock()
	if revoked && c != nil {
		c.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Revoked{Revoked: &agentpb.Revoked{AgentKey: agentKey}}})
		c.ws.Close(websocket.StatusNormalClosure, "")
	}
}

// Forget drops agentKey's registration without a revocation record, as a
// relay that lost its data would, and closes its connection.
func (r *Relay) Forget(agentKey []byte) {
	r.mu.Lock()
	delete(r.agents, string(agentKey))
	c := r.conns[string(agentKey)]
	r.mu.Unlock()
	if c != nil {
		c.ws.Close(websocket.StatusNormalClosure, "")
	}
}

// Auths reports how many times key has signed in, accepted or not.
func (r *Relay) Auths(key []byte) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.auths[string(key)]
}

// SetSendHook installs h for later Sends; nil removes it.
func (r *Relay) SetSendHook(h SendHook) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sendHook = h
}

// Deliver pushes env to recipient's live socket without any checks, as a
// misbehaving relay could. It reports whether recipient was online.
func (r *Relay) Deliver(recipient []byte, env *agentpb.Envelope) bool {
	r.mu.Lock()
	to := r.conns[string(recipient)]
	r.mu.Unlock()
	if to == nil {
		return false
	}
	to.send(deliverFrame(env))
	return true
}

// Sends counts accepted Send frames.
func (r *Relay) Sends() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sendCount
}

func (r *Relay) accept(w http.ResponseWriter, req *http.Request) *conn {
	ws, err := websocket.Accept(w, req, &websocket.AcceptOptions{Subprotocols: []string{relayclient.Subprotocol}, InsecureSkipVerify: true})
	if err != nil {
		return nil
	}
	if ws.Subprotocol() != relayclient.Subprotocol {
		ws.Close(websocket.StatusPolicyViolation, "subprotocol required")
		return nil
	}
	// Like the relay: room for the largest envelope, so a larger one gets
	// STATUS_TOO_LARGE rather than a dropped socket.
	ws.SetReadLimit(agentproto.MaxEnvelopeSize + 4<<10)
	ctx, stop := context.WithCancel(req.Context())
	return &conn{ws: ws, ctx: ctx, stop: stop}
}

func (c *conn) send(frame *agentpb.ServerFrame) {
	data, _ := proto.Marshal(frame)
	ctx, cancel := context.WithTimeout(c.ctx, 5*time.Second)
	defer cancel()
	_ = c.ws.Write(ctx, websocket.MessageBinary, data)
}

func (c *conn) read() (*agentpb.ClientFrame, error) {
	_, data, err := c.ws.Read(c.ctx)
	if err != nil {
		return nil, err
	}
	var f agentpb.ClientFrame
	if err := proto.Unmarshal(data, &f); err != nil {
		return nil, err
	}
	return &f, nil
}

func (c *conn) fail(status agentpb.Status, msg string) {
	c.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Error{Error: &agentpb.Error{Status: status, Message: msg}}})
	c.ws.Close(websocket.StatusPolicyViolation, "")
}

func deliverFrame(env *agentpb.Envelope) *agentpb.ServerFrame {
	return &agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Deliver{Deliver: &agentpb.Deliver{Envelope: env}}}
}

func result(id uint32, status agentpb.Status, msg string) *agentpb.ServerFrame {
	return &agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Result{Result: &agentpb.Result{Id: id, Status: status, Message: msg}}}
}

func (r *Relay) challenge(c *conn) []byte {
	nonce := make([]byte, 32)
	rand.Read(nonce)
	c.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Challenge{Challenge: &agentpb.Challenge{
		ProtocolVersion: agentproto.Version, Nonce: nonce, KeepaliveSeconds: keepaliveSeconds, ServerTime: time.Now().UnixMilli(),
	}}})
	return nonce
}

func (r *Relay) handleConnect(w http.ResponseWriter, req *http.Request) {
	c := r.accept(w, req)
	if c == nil {
		return
	}
	defer c.stop()
	nonce := r.challenge(c)
	f, err := c.read()
	if err != nil || f.GetAuth() == nil {
		c.fail(agentpb.Status_STATUS_BAD_REQUEST, "auth expected")
		return
	}
	auth := f.GetAuth()
	if !agentproto.VerifyAuth(auth.PublicKey, r.origin, nonce, auth.Signature) {
		c.fail(agentpb.Status_STATUS_UNAUTHORIZED, "bad signature")
		return
	}
	if r.Token != "" && auth.Token != r.Token {
		c.fail(agentpb.Status_STATUS_UNAUTHORIZED, "wrong token")
		return
	}
	c.key = auth.PublicKey
	r.mu.Lock()
	r.auths[string(c.key)]++
	if r.claimRevoked[string(c.key)] {
		r.mu.Unlock()
		c.fail(agentpb.Status_STATUS_REVOKED, "revoked")
		return
	}
	_, registered := r.agents[string(c.key)]
	if registered != (auth.Role == agentpb.Role_ROLE_AGENT) {
		r.mu.Unlock()
		if auth.Role == agentpb.Role_ROLE_AGENT {
			c.fail(agentpb.Status_STATUS_NOT_FOUND, "unknown agent")
		} else {
			c.fail(agentpb.Status_STATUS_UNAUTHORIZED, "registered as an agent")
		}
		return
	}
	ready := &agentpb.Ready{Role: agentpb.Role_ROLE_APPROVER}
	if registered {
		ready.Role = agentpb.Role_ROLE_AGENT
	} else {
		for k, a := range r.agents {
			if bytes.Equal(a, c.key) {
				ready.Agents = append(ready.Agents, []byte(k))
			}
		}
	}
	c.role = ready.Role
	old := r.conns[string(c.key)]
	r.conns[string(c.key)] = c
	queued := append([]*agentpb.Envelope(nil), r.queues[string(c.key)]...)
	r.mu.Unlock()
	if old != nil {
		old.fail(agentpb.Status_STATUS_UNAVAILABLE, "connected elsewhere")
		old.stop()
	}
	c.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Ready{Ready: ready}})
	for _, env := range queued {
		c.send(deliverFrame(env))
	}
	defer func() {
		r.mu.Lock()
		if r.conns[string(c.key)] == c {
			delete(r.conns, string(c.key))
		}
		r.mu.Unlock()
	}()
	for {
		f, err := c.read()
		if err != nil {
			return
		}
		if reply := r.handleFrame(c, f); reply != nil {
			c.send(reply)
		}
	}
}

func (r *Relay) handleFrame(c *conn, f *agentpb.ClientFrame) *agentpb.ServerFrame {
	ok := result(f.Id, agentpb.Status_STATUS_OK, "")
	switch fr := f.GetFrame().(type) {
	case *agentpb.ClientFrame_Ping:
		return &agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Pong{Pong: &agentpb.Pong{}}}
	case *agentpb.ClientFrame_Ack:
		r.mu.Lock()
		q := r.queues[string(c.key)]
		for i, env := range q {
			if h, _ := agentproto.ParseHeader(env); h != nil && bytes.Equal(h.MessageId, fr.Ack.MessageId) {
				r.queues[string(c.key)] = append(q[:i:i], q[i+1:]...)
				break
			}
		}
		r.mu.Unlock()
		return nil
	case *agentpb.ClientFrame_Send:
		return r.handleSend(c, f.Id, fr.Send.Envelope)
	case *agentpb.ClientFrame_RegisterAgent:
		r.mu.Lock()
		defer r.mu.Unlock()
		if c.role != agentpb.Role_ROLE_APPROVER || len(fr.RegisterAgent.AgentKey) != ed25519.PublicKeySize || len(fr.RegisterAgent.RevocationKey) != ed25519.PublicKeySize {
			return result(f.Id, agentpb.Status_STATUS_BAD_REQUEST, "")
		}
		if a, exists := r.agents[string(fr.RegisterAgent.AgentKey)]; exists && !bytes.Equal(a, c.key) {
			return result(f.Id, agentpb.Status_STATUS_ALREADY_CLAIMED, "")
		}
		r.agents[string(fr.RegisterAgent.AgentKey)] = c.key
		return ok
	case *agentpb.ClientFrame_UnregisterAgent:
		key := fr.UnregisterAgent.AgentKey
		if c.role == agentpb.Role_ROLE_AGENT && len(key) == 0 {
			key = c.key
		}
		r.mu.Lock()
		a, exists := r.agents[string(key)]
		if !exists || (c.role == agentpb.Role_ROLE_APPROVER && !bytes.Equal(a, c.key)) ||
			(c.role == agentpb.Role_ROLE_AGENT && !bytes.Equal(key, c.key)) {
			r.mu.Unlock()
			return result(f.Id, agentpb.Status_STATUS_NOT_FOUND, "")
		}
		r.mu.Unlock()
		c.send(ok)
		r.unregister(key)
		return nil
	case *agentpb.ClientFrame_ClaimSlot:
		r.mu.Lock()
		defer r.mu.Unlock()
		s := r.slots[string(fr.ClaimSlot.SlotId)]
		if s == nil {
			return result(f.Id, agentpb.Status_STATUS_NOT_FOUND, "")
		}
		if s.claimer != nil && !bytes.Equal(s.claimer, c.key) {
			return result(f.Id, agentpb.Status_STATUS_ALREADY_CLAIMED, "")
		}
		expires := time.Now().Add(slotLifetime).UnixMilli()
		if s.claimer == nil {
			s.claimer = c.key
			go s.sock.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_SlotClaimed{SlotClaimed: &agentpb.SlotClaimed{ExpiresAt: expires}}})
		}
		return &agentpb.ServerFrame{Frame: &agentpb.ServerFrame_SlotOffer{SlotOffer: &agentpb.SlotOffer{Id: f.Id, Offer: s.offer, ExpiresAt: expires}}}
	case *agentpb.ClientFrame_AnswerSlot:
		r.mu.Lock()
		defer r.mu.Unlock()
		s := r.slots[string(fr.AnswerSlot.SlotId)]
		if s == nil || !bytes.Equal(s.claimer, c.key) {
			return result(f.Id, agentpb.Status_STATUS_BAD_REQUEST, "")
		}
		var offer agentpb.PairingOffer
		_ = proto.Unmarshal(s.offer, &offer)
		env := fr.AnswerSlot.Envelope
		h, err := agentproto.ParseHeader(env)
		if err != nil || !bytes.Equal(h.Sender, c.key) || !bytes.Equal(h.Recipient, offer.SignPublicKey) ||
			len(env.PairingMac) != 32 || !agentproto.VerifySignature(env, h) {
			return result(f.Id, agentpb.Status_STATUS_BAD_REQUEST, "")
		}
		if a, ok := r.agents[string(offer.SignPublicKey)]; !ok || !bytes.Equal(a, c.key) {
			return result(f.Id, agentpb.Status_STATUS_BAD_REQUEST, "register the agent first")
		}
		delete(r.slots, string(fr.AnswerSlot.SlotId))
		sock := s.sock
		go func() {
			sock.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_SlotAnswer{SlotAnswer: &agentpb.SlotAnswer{Envelope: env}}})
			sock.ws.Close(websocket.StatusNormalClosure, "")
		}()
		return ok
	}
	return result(f.Id, agentpb.Status_STATUS_BAD_REQUEST, "unexpected frame")
}

func (r *Relay) handleSend(c *conn, id uint32, env *agentpb.Envelope) *agentpb.ServerFrame {
	r.mu.Lock()
	hook := r.sendHook
	r.mu.Unlock()
	if hook != nil {
		status, drop := hook(c.key, env)
		if drop {
			c.ws.CloseNow()
			c.stop()
			return nil
		}
		if status != agentpb.Status_STATUS_UNSPECIFIED && status != agentpb.Status_STATUS_OK {
			return result(id, status, "refused by the test")
		}
	}
	if proto.Size(env) > agentproto.MaxEnvelopeSize {
		return result(id, agentpb.Status_STATUS_TOO_LARGE, "")
	}
	h, err := agentproto.ParseHeader(env)
	if err != nil || !bytes.Equal(h.Sender, c.key) || !agentproto.VerifySignature(env, h) || len(env.PairingMac) != 0 {
		return result(id, agentpb.Status_STATUS_BAD_REQUEST, "")
	}
	if agentproto.CheckExpiry(h, time.Now()) != nil {
		return result(id, agentpb.Status_STATUS_EXPIRED, "")
	}
	r.mu.Lock()
	routable := false
	if a, ok := r.agents[string(c.key)]; ok {
		routable = bytes.Equal(a, h.Recipient)
	} else if a, ok := r.agents[string(h.Recipient)]; ok {
		routable = bytes.Equal(a, c.key)
	}
	if !routable {
		r.mu.Unlock()
		return result(id, agentpb.Status_STATUS_NOT_FOUND, "")
	}
	q := r.queues[string(h.Recipient)]
	for i := 0; i < len(q); i++ {
		qh, _ := agentproto.ParseHeader(q[i])
		if bytes.Equal(qh.MessageId, h.MessageId) {
			r.mu.Unlock()
			return result(id, agentpb.Status_STATUS_BAD_REQUEST, "duplicate message id")
		}
		if h.Retain && qh.Retain && bytes.Equal(qh.Sender, h.Sender) {
			q = append(q[:i:i], q[i+1:]...)
			i--
		}
	}
	r.queues[string(h.Recipient)] = append(q, env)
	r.sendCount++
	to := r.conns[string(h.Recipient)]
	r.mu.Unlock()
	if to != nil {
		to.send(deliverFrame(env))
	}
	return result(id, agentpb.Status_STATUS_OK, "")
}

// unregister removes an agent the way UnregisterAgent and /v1/revoke do.
func (r *Relay) unregister(agentKey []byte) {
	r.mu.Lock()
	a, ok := r.agents[string(agentKey)]
	delete(r.agents, string(agentKey))
	delete(r.queues, string(agentKey))
	agentConn := r.conns[string(agentKey)]
	approverConn := r.conns[string(a)]
	r.mu.Unlock()
	if !ok {
		return
	}
	revoked := &agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Revoked{Revoked: &agentpb.Revoked{AgentKey: agentKey}}}
	if agentConn != nil {
		agentConn.send(revoked)
		agentConn.ws.Close(websocket.StatusNormalClosure, "")
	}
	if approverConn != nil {
		approverConn.send(revoked)
	}
}

func (r *Relay) handlePair(w http.ResponseWriter, req *http.Request) {
	c := r.accept(w, req)
	if c == nil {
		return
	}
	defer c.stop()
	r.challenge(c)
	f, err := c.read()
	if err != nil || f.GetOpenSlot() == nil {
		c.fail(agentpb.Status_STATUS_BAD_REQUEST, "open a slot first")
		return
	}
	offer := f.GetOpenSlot().Offer
	if len(offer) > agentproto.MaxOfferSize {
		c.fail(agentpb.Status_STATUS_TOO_LARGE, "")
		return
	}
	if _, err := agentproto.ParseOffer(offer, agentproto.OfferHash(offer)); err != nil {
		c.fail(agentpb.Status_STATUS_BAD_REQUEST, "bad offer")
		return
	}
	id := make([]byte, 16)
	rand.Read(id)
	s := &slot{offer: offer, sock: c, expired: make(chan struct{})}
	r.mu.Lock()
	r.slots[string(id)] = s
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		if r.slots[string(id)] == s {
			delete(r.slots, string(id))
		}
		r.mu.Unlock()
	}()
	c.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_SlotOpened{SlotOpened: &agentpb.SlotOpened{
		SlotId: id, ExpiresAt: time.Now().Add(slotLifetime).UnixMilli(),
	}}})
	frames := make(chan *agentpb.ClientFrame)
	go func() {
		defer close(frames)
		for {
			f, err := c.read()
			if err != nil {
				return
			}
			frames <- f
		}
	}()
	for {
		select {
		case f, ok := <-frames:
			if !ok {
				return
			}
			if f.GetPing() != nil {
				c.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Pong{Pong: &agentpb.Pong{}}})
			}
		case <-s.expired:
			c.fail(agentpb.Status_STATUS_EXPIRED, "the pairing code expired")
			return
		case <-c.ctx.Done():
			return
		}
	}
}
