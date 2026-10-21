package relay

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
	"github.com/coder/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

const (
	testOrigin = "https://relay.example.com"
	testToken  = "self-hosted-relay-token-0123456789abcdef"
	frameWait  = 5 * time.Second
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

type harness struct {
	t       *testing.T
	s       *Server
	ts      *httptest.Server
	clock   *clock
	passKey *mldsa65.PrivateKey
	cfg     Config
	// tune, if set, adjusts internals of each new Server before it serves.
	tune func(*Server)
}

// newHarness starts a relay in ticket or token mode with an in-memory
// database, a fake clock and a short auth timeout.
func newHarness(t *testing.T, auth string, mutate func(*Config)) *harness {
	t.Helper()
	pk, sk, err := mldsa65.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{t: t, clock: &clock{t: time.Unix(1_800_000_000, 0)}, passKey: sk}
	h.cfg = Config{
		PublicURL: testOrigin + "/",
		Auth:      auth,
		DBPath:    ":memory:",
		Logger:    slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:       h.clock.now,
	}
	switch auth {
	case AuthTicket:
		h.cfg.PassKeys = map[string]*mldsa65.PublicKey{"test": pk}
	case AuthToken:
		h.cfg.AccessToken = testToken
	}
	if mutate != nil {
		mutate(&h.cfg)
	}
	h.start()
	return h
}

func (h *harness) start() {
	h.t.Helper()
	s, err := New(h.cfg)
	if err != nil {
		h.t.Fatal(err)
	}
	s.authTimeout = 500 * time.Millisecond
	if h.tune != nil {
		h.tune(s)
	}
	h.s = s
	h.ts = httptest.NewServer(s.Handler())
	h.t.Cleanup(h.stop)
}

// stop shuts the relay down; restarting with the same DBPath simulates a
// relay restart.
func (h *harness) stop() {
	if h.ts == nil {
		return
	}
	h.ts.CloseClientConnections()
	h.ts.Close()
	if err := h.s.Close(); err != nil {
		h.t.Errorf("close: %v", err)
	}
	h.ts = nil
}

type passOptions struct {
	sub, dev, aud, kid string
	iat, exp           time.Time
	agents             int
	// key is the encoded approver key the pass is bound to.
	key string
}

// pass mints a relay pass for id the way the backend does. Each key gets its
// own device by default, since the relay keeps one approver per device.
func (h *harness) pass(id *agentproto.Identity, mutate func(*passOptions)) string {
	h.t.Helper()
	now := h.clock.now()
	o := passOptions{sub: "account-1", dev: "device-" + hex.EncodeToString(id.ID()[:4]), aud: testOrigin, kid: "test",
		iat: now, exp: now.Add(7 * 24 * time.Hour), agents: 5, key: base64.RawURLEncoding.EncodeToString(id.ID())}
	if mutate != nil {
		mutate(&o)
	}
	return signPass(h.t, h.passKey, Pass{
		Version: 1, KeyID: o.kid, Audience: o.aud, Subject: o.sub, Device: o.dev,
		IssuedAt: o.iat.Unix(), Expiry: o.exp.Unix(), ID: "jti-" + o.dev + o.iat.String(),
		Limits: PassLimits{Agents: o.agents}, Key: o.key,
	})
}

func signPass(t *testing.T, sk *mldsa65.PrivateKey, p Pass) string {
	t.Helper()
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	part := base64.RawURLEncoding.EncodeToString(raw)
	sig := make([]byte, mldsa65.SignatureSize)
	if err := mldsa65.SignTo(sk, []byte(PassSigningPrefix+part), nil, true, sig); err != nil {
		t.Fatal(err)
	}
	return part + "." + base64.RawURLEncoding.EncodeToString(sig)
}

// client is a minimal relay client that speaks frames directly.
type client struct {
	t      *testing.T
	ws     *websocket.Conn
	frames chan *agentpb.ServerFrame
	nextID uint32
	// stalled is held to stop the reader between frames; see stall.
	stalled sync.Mutex
}

func (h *harness) dial(path string, header http.Header) *client {
	h.t.Helper()
	c, status := h.tryDial(path, header)
	if c == nil {
		h.t.Fatalf("dial %s: HTTP %d", path, status)
	}
	return c
}

// tryDial is dial for upgrades the relay may refuse: it returns nil and the
// HTTP status instead of failing the test.
func (h *harness) tryDial(path string, header http.Header) (*client, int) {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), frameWait)
	defer cancel()
	url := "ws" + strings.TrimPrefix(h.ts.URL, "http") + path
	ws, resp, err := websocket.Dial(ctx, url, &websocket.DialOptions{
		Subprotocols: []string{Subprotocol},
		HTTPHeader:   header,
	})
	if err != nil {
		if resp == nil {
			h.t.Fatalf("dial %s: %v", path, err)
		}
		return nil, resp.StatusCode
	}
	ws.SetReadLimit(1 << 20)
	c := &client{t: h.t, ws: ws, frames: make(chan *agentpb.ServerFrame, 512)}
	go func() {
		defer close(c.frames)
		for {
			_, data, err := ws.Read(context.Background())
			if err != nil {
				return
			}
			var f agentpb.ServerFrame
			if err := proto.Unmarshal(data, &f); err != nil {
				// Surfaces as an unexpected close in the test.
				return
			}
			c.frames <- &f
			c.stalled.Lock()
			c.stalled.Unlock()
		}
	}()
	h.t.Cleanup(func() { ws.CloseNow() })
	return c, http.StatusSwitchingProtocols
}

func (c *client) write(f *agentpb.ClientFrame) {
	c.t.Helper()
	raw, err := proto.Marshal(f)
	if err != nil {
		c.t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), frameWait)
	defer cancel()
	if err := c.ws.Write(ctx, websocket.MessageBinary, raw); err != nil {
		c.t.Fatalf("write: %v", err)
	}
}

// next returns the next frame, or nil once the relay closed the connection.
// stall stops reading after the frame in progress, like a client that
// hangs, until the returned function resumes it.
func (c *client) stall() (resume func()) {
	c.stalled.Lock()
	return c.stalled.Unlock
}

func (c *client) next() *agentpb.ServerFrame {
	c.t.Helper()
	select {
	case f := <-c.frames:
		return f
	case <-time.After(frameWait):
		c.t.Fatal("no frame from the relay")
		return nil
	}
}

func (c *client) expectClosed() {
	c.t.Helper()
	if f := c.next(); f != nil {
		c.t.Fatalf("expected the relay to close, got %v", f)
	}
}

// expectQuiet checks that nothing arrives for a moment.
func (c *client) expectQuiet() {
	c.t.Helper()
	select {
	case f := <-c.frames:
		c.t.Fatalf("unexpected frame %v", f)
	case <-time.After(100 * time.Millisecond):
	}
}

func (c *client) expectChallenge() *agentpb.Challenge {
	c.t.Helper()
	f := c.next()
	if f.GetChallenge() == nil {
		c.t.Fatalf("got %v, want Challenge", f)
	}
	return f.GetChallenge()
}

func (c *client) expectError(status agentpb.Status) *agentpb.Error {
	c.t.Helper()
	f := c.next()
	if f.GetError() == nil || f.GetError().Status != status {
		c.t.Fatalf("got %v, want Error %v", f, status)
	}
	return f.GetError()
}

func (c *client) expectDeliver() *agentpb.Envelope {
	c.t.Helper()
	f := c.next()
	if f.GetDeliver() == nil {
		c.t.Fatalf("got %v, want Deliver", f)
	}
	return f.GetDeliver().GetEnvelope()
}

func (c *client) expectRevoked(agentKey []byte) {
	c.t.Helper()
	f := c.next()
	if f.GetRevoked() == nil || string(f.GetRevoked().AgentKey) != string(agentKey) {
		c.t.Fatalf("got %v, want Revoked", f)
	}
}

// call sends a frame with a fresh id and returns the next frame, checking
// that a Result echoes the id.
func (c *client) call(f *agentpb.ClientFrame) *agentpb.ServerFrame {
	c.t.Helper()
	c.nextID++
	f.Id = c.nextID
	c.write(f)
	reply := c.next()
	if r := reply.GetResult(); r != nil && r.Id != f.Id {
		c.t.Fatalf("result id %d, want %d", r.Id, f.Id)
	}
	if o := reply.GetSlotOffer(); o != nil && o.Id != f.Id {
		c.t.Fatalf("slot offer id %d, want %d", o.Id, f.Id)
	}
	return reply
}

// status sends a frame and returns the Result status.
func (c *client) status(f *agentpb.ClientFrame) agentpb.Status {
	c.t.Helper()
	reply := c.call(f)
	if reply.GetResult() == nil {
		c.t.Fatalf("got %v, want Result", reply)
	}
	return reply.GetResult().Status
}

func (c *client) ping() {
	c.t.Helper()
	c.write(&agentpb.ClientFrame{Frame: &agentpb.ClientFrame_Ping{Ping: &agentpb.Ping{}}})
	if f := c.next(); f.GetPong() == nil {
		c.t.Fatalf("got %v, want Pong", f)
	}
}

func (c *client) ack(env *agentpb.Envelope) {
	c.t.Helper()
	h, err := agentproto.ParseHeader(env)
	if err != nil {
		c.t.Fatal(err)
	}
	c.write(&agentpb.ClientFrame{Frame: &agentpb.ClientFrame_Ack{Ack: &agentpb.Ack{MessageId: h.MessageId}}})
}

func newIdentity(t *testing.T) *agentproto.Identity {
	t.Helper()
	id, err := agentproto.NewIdentity()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func peerOf(id *agentproto.Identity) agentproto.Peer {
	return agentproto.Peer{SignPublicKey: id.ID(), KEMPublicKey: id.KEMPublicKey()}
}

type authOptions struct {
	role                agentpb.Role
	pass, token, origin string
	key                 []byte
}

// open dials /v1/connect, answers the Challenge and returns the client with
// the relay's answer (Ready or Error).
func (h *harness) open(id *agentproto.Identity, o authOptions) (*client, *agentpb.ServerFrame) {
	h.t.Helper()
	c := h.dial("/v1/connect", nil)
	return c, h.auth(c, id, o)
}

// auth answers the Challenge on a /v1/connect socket and returns the reply.
func (h *harness) auth(c *client, id *agentproto.Identity, o authOptions) *agentpb.ServerFrame {
	h.t.Helper()
	ch := c.next().GetChallenge()
	if ch == nil || len(ch.Nonce) != 32 || ch.ProtocolVersion != 1 {
		h.t.Fatalf("bad challenge %v", ch)
	}
	if o.origin == "" {
		o.origin = testOrigin
	}
	if o.key == nil {
		o.key = id.ID()
	}
	c.write(&agentpb.ClientFrame{Frame: &agentpb.ClientFrame_Auth{Auth: &agentpb.Auth{
		PublicKey: o.key,
		Signature: agentproto.SignAuth(id, o.origin, ch.Nonce),
		Pass:      o.pass,
		Token:     o.token,
		Role:      o.role,
	}}})
	return c.next()
}

// connect opens a connection that must succeed with the given role. Approvers
// in ticket mode get a fresh default pass unless o.pass is set.
func (h *harness) connect(id *agentproto.Identity, role agentpb.Role, o authOptions) (*client, *agentpb.Ready) {
	h.t.Helper()
	o.role = role
	if h.cfg.Auth == AuthToken && o.token == "" {
		o.token = testToken
	}
	if h.cfg.Auth == AuthTicket && role == agentpb.Role_ROLE_APPROVER && o.pass == "" {
		o.pass = h.pass(id, nil)
	}
	c, reply := h.open(id, o)
	ready := reply.GetReady()
	if ready == nil || ready.Role != role {
		h.t.Fatalf("got %v, want Ready as %v", reply, role)
	}
	return c, ready
}

func registerFrame(agent *agentproto.Identity, revocationKey []byte) *agentpb.ClientFrame {
	return &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_RegisterAgent{RegisterAgent: &agentpb.RegisterAgent{
		AgentKey: agent.ID(), RevocationKey: revocationKey,
	}}}
}

func (c *client) register(agent *agentproto.Identity) {
	c.t.Helper()
	if st := c.status(registerFrame(agent, make([]byte, 32))); st != agentpb.Status_STATUS_OK {
		c.t.Fatalf("register agent: %v", st)
	}
}

func renewFrame(pass string) *agentpb.ClientFrame {
	return &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_RenewPass{RenewPass: &agentpb.RenewPass{Pass: pass}}}
}

func unregisterFrame(agentKey []byte) *agentpb.ClientFrame {
	return &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_UnregisterAgent{UnregisterAgent: &agentpb.UnregisterAgent{AgentKey: agentKey}}}
}

func sendFrame(env *agentpb.Envelope) *agentpb.ClientFrame {
	return &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_Send{Send: &agentpb.Send{Envelope: env}}}
}

// seal builds an envelope from one party to another on the harness clock.
func (h *harness) seal(from, to *agentproto.Identity, retain bool, lifetime time.Duration) *agentpb.Envelope {
	h.t.Helper()
	msg := &agentpb.Message{Body: &agentpb.Message_SignRequest{SignRequest: &agentpb.SignRequest{Data: []byte("data")}}}
	if retain {
		msg = &agentpb.Message{Body: &agentpb.Message_KeysUpdate{KeysUpdate: &agentpb.KeysUpdate{Revision: 1}}}
	}
	env, err := agentproto.Seal(from, peerOf(to), msg, agentproto.SealOptions{
		ExpiresAt: h.clock.now().Add(lifetime), Retain: retain,
	})
	if err != nil {
		h.t.Fatal(err)
	}
	return env
}

func messageID(t *testing.T, env *agentpb.Envelope) string {
	t.Helper()
	hdr, err := agentproto.ParseHeader(env)
	if err != nil {
		t.Fatal(err)
	}
	return string(hdr.MessageId)
}

// waitFor polls a condition on the server state, for effects of a client
// closing its socket, which the relay sees a moment later.
func (h *harness) waitFor(what string, cond func() bool) {
	h.t.Helper()
	deadline := time.Now().Add(frameWait)
	for !cond() {
		if time.Now().After(deadline) {
			h.t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (h *harness) waitOffline(id *agentproto.Identity) {
	h.t.Helper()
	h.waitFor("connection gone", func() (gone bool) {
		h.locked(func() { gone = h.s.conns[string(id.ID())] == nil })
		return gone
	})
}

func (h *harness) locked(f func()) {
	h.s.mu.Lock()
	defer h.s.mu.Unlock()
	f()
}

func scrape(t *testing.T, h *harness) string {
	t.Helper()
	rec := httptest.NewRecorder()
	h.s.MetricsHandler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	if rec.Code != 200 {
		t.Fatalf("metrics: %d", rec.Code)
	}
	return rec.Body.String()
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
