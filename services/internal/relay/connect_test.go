package relay

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

func TestAuthRejections(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	other := newIdentity(t)
	// A recorded approver for the "different account" and "no pass" cases.
	known := newIdentity(t)

	// A registered agent for the "agent key as approver" case.
	agent := newIdentity(t)
	a, _ := h.connect(known, agentpb.Role_ROLE_APPROVER, authOptions{})
	a.register(agent)

	approverRole := agentpb.Role_ROLE_APPROVER
	cases := []struct {
		name   string
		id     *agentproto.Identity
		opts   func(id *agentproto.Identity) authOptions
		status agentpb.Status
	}{
		{"no role", newIdentity(t), func(id *agentproto.Identity) authOptions {
			return authOptions{pass: h.pass(id, nil)}
		}, agentpb.Status_STATUS_BAD_REQUEST},
		{"bad signature", newIdentity(t), func(id *agentproto.Identity) authOptions {
			return authOptions{role: approverRole, pass: h.pass(id, nil), key: other.ID()}
		}, agentpb.Status_STATUS_UNAUTHORIZED},
		{"wrong origin", newIdentity(t), func(id *agentproto.Identity) authOptions {
			return authOptions{role: approverRole, pass: h.pass(id, nil), origin: "https://other-relay.example.com"}
		}, agentpb.Status_STATUS_UNAUTHORIZED},
		{"expired pass", newIdentity(t), func(id *agentproto.Identity) authOptions {
			return authOptions{role: approverRole, pass: h.pass(id, func(o *passOptions) {
				o.iat = o.iat.Add(-8 * 24 * time.Hour)
				o.exp = o.iat.Add(7 * 24 * time.Hour)
			})}
		}, agentpb.Status_STATUS_UNAUTHORIZED},
		{"pass for another relay", newIdentity(t), func(id *agentproto.Identity) authOptions {
			return authOptions{role: approverRole, pass: h.pass(id, func(o *passOptions) { o.aud = "https://relay.other.example" })}
		}, agentpb.Status_STATUS_UNAUTHORIZED},
		{"unknown key ID", newIdentity(t), func(id *agentproto.Identity) authOptions {
			return authOptions{role: approverRole, pass: h.pass(id, func(o *passOptions) { o.kid = "retired" })}
		}, agentpb.Status_STATUS_UNAUTHORIZED},
		{"no agent limit", newIdentity(t), func(id *agentproto.Identity) authOptions {
			return authOptions{role: approverRole, pass: h.pass(id, func(o *passOptions) { o.agents = 0 })}
		}, agentpb.Status_STATUS_UNAUTHORIZED},
		{"garbage pass", newIdentity(t), func(id *agentproto.Identity) authOptions {
			return authOptions{role: approverRole, pass: "a.b"}
		}, agentpb.Status_STATUS_UNAUTHORIZED},
		{"new approver without a pass", newIdentity(t), func(id *agentproto.Identity) authOptions {
			return authOptions{role: approverRole}
		}, agentpb.Status_STATUS_UNAUTHORIZED},
		{"known approver without a pass", known, func(id *agentproto.Identity) authOptions {
			return authOptions{role: approverRole}
		}, agentpb.Status_STATUS_UNAUTHORIZED},
		{"key of another account", known, func(id *agentproto.Identity) authOptions {
			return authOptions{role: approverRole, pass: h.pass(id, func(o *passOptions) { o.sub = "account-2" })}
		}, agentpb.Status_STATUS_UNAUTHORIZED},
		{"agent key as approver", agent, func(id *agentproto.Identity) authOptions {
			return authOptions{role: approverRole, pass: h.pass(id, nil)}
		}, agentpb.Status_STATUS_UNAUTHORIZED},
		{"unknown agent", newIdentity(t), func(id *agentproto.Identity) authOptions {
			return authOptions{role: agentpb.Role_ROLE_AGENT}
		}, agentpb.Status_STATUS_NOT_FOUND},
		{"approver key as agent", known, func(id *agentproto.Identity) authOptions {
			return authOptions{role: agentpb.Role_ROLE_AGENT}
		}, agentpb.Status_STATUS_NOT_FOUND},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, reply := h.open(tc.id, tc.opts(tc.id))
			if reply.GetError() == nil || reply.GetError().Status != tc.status {
				t.Fatalf("got %v, want Error %v", reply, tc.status)
			}
			c.expectClosed()
		})
	}
}

func TestTokenMode(t *testing.T) {
	h := newHarness(t, AuthToken, nil)
	approver, agent := newIdentity(t), newIdentity(t)

	for _, token := range []string{"", "wrong-token-0123456789abcdef0123456789"} {
		c, reply := h.open(approver, authOptions{role: agentpb.Role_ROLE_APPROVER, token: token})
		if reply.GetError().GetStatus() != agentpb.Status_STATUS_UNAUTHORIZED {
			t.Fatalf("token %q: got %v", token, reply)
		}
		c.expectClosed()
	}
	a, ready := h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	if ready.PassExpiresAt != 0 || len(ready.Agents) != 0 {
		t.Fatalf("ready = %v", ready)
	}
	a.register(agent)

	// Agents need the token too.
	c, reply := h.open(agent, authOptions{role: agentpb.Role_ROLE_AGENT})
	if reply.GetError().GetStatus() != agentpb.Status_STATUS_UNAUTHORIZED {
		t.Fatalf("agent without token: %v", reply)
	}
	c.expectClosed()
	h.connect(agent, agentpb.Role_ROLE_AGENT, authOptions{})

	if st := a.status(renewFrame("x")); st != agentpb.Status_STATUS_BAD_REQUEST {
		t.Fatalf("RenewPass in token mode: %v", st)
	}
}

func TestHandshakeRules(t *testing.T) {
	h := newHarness(t, AuthToken, nil)

	t.Run("no subprotocol", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), frameWait)
		defer cancel()
		ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(h.ts.URL, "http")+"/v1/connect", nil)
		if err != nil {
			t.Fatal(err)
		}
		defer ws.CloseNow()
		_, _, err = ws.Read(ctx)
		if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
			t.Fatalf("read: %v", err)
		}
	})
	t.Run("Auth timeout", func(t *testing.T) {
		c := h.dial("/v1/connect", nil)
		if c.next().GetChallenge() == nil {
			t.Fatal("no challenge")
		}
		c.expectClosed()
	})
	t.Run("text message", func(t *testing.T) {
		c := h.dial("/v1/connect", nil)
		c.next()
		ctx, cancel := context.WithTimeout(context.Background(), frameWait)
		defer cancel()
		c.ws.Write(ctx, websocket.MessageText, []byte("hello"))
		c.expectError(agentpb.Status_STATUS_BAD_REQUEST)
		c.expectClosed()
	})
	t.Run("Ping before Auth", func(t *testing.T) {
		c := h.dial("/v1/connect", nil)
		c.next()
		c.write(&agentpb.ClientFrame{Id: 1, Frame: &agentpb.ClientFrame_Ping{Ping: &agentpb.Ping{}}})
		c.expectError(agentpb.Status_STATUS_BAD_REQUEST)
		c.expectClosed()
	})
	t.Run("challenge announces keep-alive", func(t *testing.T) {
		c := h.dial("/v1/connect", nil)
		ch := c.next().GetChallenge()
		if ch.KeepaliveSeconds != 240 || ch.ServerTime != h.clock.now().UnixMilli() {
			t.Fatalf("challenge = %v", ch)
		}
	})
}

func TestReadyListsAgentsAndPassExpiry(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	approver, agent1, agent2 := newIdentity(t), newIdentity(t), newIdentity(t)
	exp := h.clock.now().Add(48 * time.Hour)
	pass := h.pass(approver, func(o *passOptions) { o.exp = exp })
	a, ready := h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{pass: pass})
	if ready.PassExpiresAt != exp.UnixMilli() {
		t.Fatalf("pass_expires_at = %d, want %d", ready.PassExpiresAt, exp.UnixMilli())
	}
	a.register(agent1)
	a.register(agent2)
	a.ws.CloseNow()

	_, ready = h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{pass: pass})
	if len(ready.Agents) != 2 {
		t.Fatalf("agents = %d", len(ready.Agents))
	}
	// An agent never needs a pass.
	_, ready = h.connect(agent1, agentpb.Role_ROLE_AGENT, authOptions{})
	if ready.PassExpiresAt != 0 || len(ready.Agents) != 0 {
		t.Fatalf("agent ready = %v", ready)
	}
}

// fixture is an approver with one connected agent.
type fixture struct {
	approver, agent *agentproto.Identity
	a, g            *client
}

func (h *harness) fixture() *fixture {
	h.t.Helper()
	return h.fixtureIn("account-1", 5)
}

// fixtureIn is a fixture whose approver belongs to account sub (ticket mode)
// and may register up to agents agents.
func (h *harness) fixtureIn(sub string, agents int) *fixture {
	h.t.Helper()
	f := &fixture{approver: newIdentity(h.t), agent: newIdentity(h.t)}
	var o authOptions
	if h.cfg.Auth == AuthTicket {
		o.pass = h.pass(f.approver, func(p *passOptions) { p.sub, p.agents = sub, agents })
	}
	f.a, _ = h.connect(f.approver, agentpb.Role_ROLE_APPROVER, o)
	f.a.register(f.agent)
	f.g, _ = h.connect(f.agent, agentpb.Role_ROLE_AGENT, authOptions{})
	return f
}

func TestRouting(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	f := h.fixture()
	other := h.fixture()
	stranger := newIdentity(t)

	// Agent to its approver and back, delivered at once.
	env := h.seal(f.agent, f.approver, false, time.Minute)
	if st := f.g.status(sendFrame(env)); st != agentpb.Status_STATUS_OK {
		t.Fatalf("agent to approver: %v", st)
	}
	if got := f.a.expectDeliver(); messageID(t, got) != messageID(t, env) {
		t.Fatal("delivered another envelope")
	}
	if st := f.a.status(sendFrame(h.seal(f.approver, f.agent, false, time.Minute))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("approver to agent: %v", st)
	}
	f.g.expectDeliver()

	tampered := h.seal(f.agent, f.approver, false, time.Minute)
	tampered.Ciphertext[0] ^= 1
	withMAC := h.seal(f.agent, f.approver, false, time.Minute)
	withMAC.PairingMac = make([]byte, 32)
	dup := h.seal(f.agent, f.approver, false, time.Minute)
	if st := f.g.status(sendFrame(dup)); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	f.a.expectDeliver()

	cases := []struct {
		name   string
		from   *client
		env    *agentpb.Envelope
		status agentpb.Status
	}{
		{"agent to another approver", f.g, h.seal(f.agent, other.approver, false, time.Minute), agentpb.Status_STATUS_NOT_FOUND},
		{"agent to another agent", f.g, h.seal(f.agent, other.agent, false, time.Minute), agentpb.Status_STATUS_NOT_FOUND},
		{"approver to another approver's agent", f.a, h.seal(f.approver, other.agent, false, time.Minute), agentpb.Status_STATUS_NOT_FOUND},
		{"approver to a stranger", f.a, h.seal(f.approver, stranger, false, time.Minute), agentpb.Status_STATUS_NOT_FOUND},
		{"sender is not the connection", f.g, h.seal(stranger, f.approver, false, time.Minute), agentpb.Status_STATUS_BAD_REQUEST},
		{"bad signature", f.g, tampered, agentpb.Status_STATUS_BAD_REQUEST},
		{"pairing MAC on Send", f.g, withMAC, agentpb.Status_STATUS_BAD_REQUEST},
		{"duplicate message ID", f.g, dup, agentpb.Status_STATUS_BAD_REQUEST},
		{"expired", f.g, h.seal(f.agent, f.approver, false, -time.Minute), agentpb.Status_STATUS_EXPIRED},
		{"expiry too far out", f.g, h.seal(f.agent, f.approver, false, 10*time.Minute), agentpb.Status_STATUS_BAD_REQUEST},
		{"retained expiry too far out", f.g, h.seal(f.agent, f.approver, true, 31*24*time.Hour), agentpb.Status_STATUS_BAD_REQUEST},
		{"no envelope", f.g, nil, agentpb.Status_STATUS_BAD_REQUEST},
		{"garbage header", f.g, &agentpb.Envelope{Header: []byte{0xff}}, agentpb.Status_STATUS_BAD_REQUEST},
	}
	for _, tc := range cases {
		if st := tc.from.status(sendFrame(tc.env)); st != tc.status {
			t.Errorf("%s: %v, want %v", tc.name, st, tc.status)
		}
	}
	f.a.expectQuiet()
	other.a.expectQuiet()
	other.g.expectQuiet()
}

func TestRoleRules(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	f := h.fixture()
	extra := newIdentity(t)
	bad := agentpb.Status_STATUS_BAD_REQUEST
	for name, frame := range map[string]*agentpb.ClientFrame{
		"agent registers":  registerFrame(extra, make([]byte, 32)),
		"agent renews":     renewFrame(h.pass(f.agent, nil)),
		"agent claims":     {Frame: &agentpb.ClientFrame_ClaimSlot{ClaimSlot: &agentpb.ClaimSlot{SlotId: make([]byte, 16)}}},
		"agent answers":    {Frame: &agentpb.ClientFrame_AnswerSlot{AnswerSlot: &agentpb.AnswerSlot{}}},
		"OpenSlot":         {Frame: &agentpb.ClientFrame_OpenSlot{OpenSlot: &agentpb.OpenSlot{}}},
		"Auth again":       {Frame: &agentpb.ClientFrame_Auth{Auth: &agentpb.Auth{}}},
		"unregister other": unregisterFrame(extra.ID()),
	} {
		if st := f.g.status(frame); st != bad {
			t.Errorf("%s: %v", name, st)
		}
	}
	if st := f.a.status(registerFrame(extra, make([]byte, 31))); st != bad {
		t.Errorf("short revocation key: %v", st)
	}
	if st := f.a.status(registerFrame(f.approver, make([]byte, 32))); st != bad {
		t.Errorf("approver registers itself: %v", st)
	}
	// A frame that needs an answer but has no id is fatal.
	f.a.write(&agentpb.ClientFrame{Frame: &agentpb.ClientFrame_OpenSlot{OpenSlot: &agentpb.OpenSlot{}}})
	f.a.expectError(bad)
	f.a.expectClosed()
}

func TestQueueAckAndRedelivery(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	f := h.fixture()
	f.a.ws.CloseNow()
	h.waitOffline(f.approver)

	first := h.seal(f.agent, f.approver, false, time.Minute)
	retained := h.seal(f.agent, f.approver, true, time.Hour)
	second := h.seal(f.agent, f.approver, false, time.Minute)
	for _, env := range []*agentpb.Envelope{first, retained, second} {
		if st := f.g.status(sendFrame(env)); st != agentpb.Status_STATUS_OK {
			t.Fatal(st)
		}
	}

	// Retained first, then by arrival.
	a, _ := h.connect(f.approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	want := []*agentpb.Envelope{retained, first, second}
	for i, env := range want {
		if got := a.expectDeliver(); messageID(t, got) != messageID(t, env) {
			t.Fatalf("delivery %d out of order", i)
		}
	}
	a.ack(first)
	a.ack(retained)
	a.ping() // the acks are processed before the Pong
	a.ws.CloseNow()

	a, _ = h.connect(f.approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	if got := a.expectDeliver(); messageID(t, got) != messageID(t, second) {
		t.Fatal("redelivered an acked envelope")
	}
	a.expectQuiet()
	// An unknown ID is ignored; acking the last one empties the queue.
	a.ack(h.seal(f.agent, f.approver, false, time.Minute))
	a.ack(second)
	a.ping()
	a.ws.CloseNow()
	a, _ = h.connect(f.approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	a.expectQuiet()
}

func TestRetainedReplacementSurvivesRestart(t *testing.T) {
	h := newHarness(t, AuthToken, func(cfg *Config) {
		cfg.DBPath = filepath.Join(t.TempDir(), "relay.db")
	})
	approver, agent := newIdentity(t), newIdentity(t)
	a, _ := h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	a.register(agent)

	older := h.seal(approver, agent, true, 24*time.Hour)
	newer := h.seal(approver, agent, true, 24*time.Hour)
	request := h.seal(approver, agent, false, time.Minute)
	for _, env := range []*agentpb.Envelope{older, newer, request} {
		if st := a.status(sendFrame(env)); st != agentpb.Status_STATUS_OK {
			t.Fatal(st)
		}
	}
	// Replaying the replaced one is not a duplicate any more, but replaying
	// the current one is.
	if st := a.status(sendFrame(newer)); st != agentpb.Status_STATUS_BAD_REQUEST {
		t.Fatalf("duplicate retained: %v", st)
	}

	// Before the restart the agent gets the newer retained envelope and the
	// request.
	g, _ := h.connect(agent, agentpb.Role_ROLE_AGENT, authOptions{})
	if got := g.expectDeliver(); messageID(t, got) != messageID(t, newer) {
		t.Fatal("the older retained envelope was delivered")
	}
	if got := g.expectDeliver(); messageID(t, got) != messageID(t, request) {
		t.Fatal("request not delivered")
	}
	g.expectQuiet()

	h.stop()
	h.start()

	// Registrations and the newest retained envelope survive; the request
	// lived in memory only.
	g, _ = h.connect(agent, agentpb.Role_ROLE_AGENT, authOptions{})
	if got := g.expectDeliver(); messageID(t, got) != messageID(t, newer) {
		t.Fatal("the older retained envelope survived")
	}
	g.expectQuiet()
	g.ack(newer)
	g.ping()
	h.stop()
	h.start()
	g, _ = h.connect(agent, agentpb.Role_ROLE_AGENT, authOptions{})
	g.expectQuiet()
	_, ready := h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	if len(ready.Agents) != 1 || string(ready.Agents[0]) != string(agent.ID()) {
		t.Fatalf("agents after restart = %v", ready.Agents)
	}
}

func TestExpiry(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	f := h.fixture()
	f.g.ws.CloseNow()
	h.waitOffline(f.agent)
	short := h.seal(f.approver, f.agent, false, 30*time.Second)
	long := h.seal(f.approver, f.agent, true, time.Hour)
	for _, env := range []*agentpb.Envelope{short, long} {
		if st := f.a.status(sendFrame(env)); st != agentpb.Status_STATUS_OK {
			t.Fatal(st)
		}
	}
	// Past the deadline plus the tolerated skew, before the sweeper ran: not
	// delivered.
	h.clock.advance(30*time.Second + agentproto.ClockSkew)
	g, _ := h.connect(f.agent, agentpb.Role_ROLE_AGENT, authOptions{})
	if got := g.expectDeliver(); messageID(t, got) != messageID(t, long) {
		t.Fatal("delivered an expired envelope")
	}
	g.expectQuiet()
	g.ws.CloseNow()

	h.s.sweepMemory()
	h.clock.advance(time.Hour)
	h.s.sweepMemory()
	if err := h.s.sweepStore(); err != nil {
		t.Fatal(err)
	}
	h.locked(func() {
		if len(h.s.mailboxes) != 0 {
			t.Errorf("mailboxes left after expiry: %d", len(h.s.mailboxes))
		}
	})
	g, _ = h.connect(f.agent, agentpb.Role_ROLE_AGENT, authOptions{})
	g.expectQuiet()
	if !strings.Contains(scrape(t, h), "cryptex_relay_expired_envelopes_total 2") {
		t.Error("expired envelopes not counted")
	}
}

func TestPassExpiryStopsRouting(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	approver, agent := newIdentity(t), newIdentity(t)
	day := h.pass(approver, func(o *passOptions) { o.exp = o.iat.Add(24 * time.Hour) })
	a, _ := h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{pass: day})
	a.register(agent)
	g, _ := h.connect(agent, agentpb.Role_ROLE_AGENT, authOptions{})

	h.clock.advance(25 * time.Hour)
	if st := g.status(sendFrame(h.seal(agent, approver, false, time.Minute))); st != agentpb.Status_STATUS_UNAVAILABLE {
		t.Fatalf("agent send after pass expiry: %v", st)
	}
	if st := a.status(sendFrame(h.seal(approver, agent, false, time.Minute))); st != agentpb.Status_STATUS_UNAVAILABLE {
		t.Fatalf("approver send after pass expiry: %v", st)
	}
	if st := a.status(registerFrame(newIdentity(t), make([]byte, 32))); st != agentpb.Status_STATUS_UNAVAILABLE {
		t.Fatalf("register after pass expiry: %v", st)
	}

	renew := func(pass string) agentpb.Status { return a.status(renewFrame(pass)) }
	if st := renew(h.pass(approver, func(o *passOptions) { o.sub = "account-2" })); st != agentpb.Status_STATUS_UNAUTHORIZED {
		t.Fatalf("renew with another account's pass: %v", st)
	}
	if st := renew("not-a-pass"); st != agentpb.Status_STATUS_UNAUTHORIZED {
		t.Fatalf("renew with garbage: %v", st)
	}
	if st := renew(h.pass(approver, nil)); st != agentpb.Status_STATUS_OK {
		t.Fatalf("renew: %v", st)
	}
	if st := g.status(sendFrame(h.seal(agent, approver, false, time.Minute))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("agent send after renewal: %v", st)
	}
	a.expectDeliver()
}

func TestRegistrationGrace(t *testing.T) {
	h := newHarness(t, AuthTicket, func(cfg *Config) { cfg.RegistrationGrace = 30 * 24 * time.Hour })
	f := h.fixture()
	keep := h.fixture() // renews in time
	h.clock.advance(7*24*time.Hour + 29*24*time.Hour)
	if st := keep.a.status(renewFrame(h.pass(keep.approver, nil))); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	if err := h.s.sweepStore(); err != nil {
		t.Fatal(err)
	}
	f.g.expectQuiet()

	h.clock.advance(2 * 24 * time.Hour)
	if err := h.s.sweepStore(); err != nil {
		t.Fatal(err)
	}
	f.g.expectRevoked(f.agent.ID())
	f.g.expectClosed()
	f.a.expectRevoked(f.agent.ID())
	f.a.expectError(agentpb.Status_STATUS_UNAUTHORIZED)
	keep.g.expectQuiet()

	h.locked(func() {
		if len(h.s.agents) != 1 || len(h.s.approvers) != 1 {
			t.Errorf("agents %d, approvers %d after the sweep", len(h.s.agents), len(h.s.approvers))
		}
	})
	// The approver can come back with a fresh pass, but its agents are gone.
	_, ready := h.connect(f.approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	if len(ready.Agents) != 0 {
		t.Fatalf("agents = %v", ready.Agents)
	}
	c, reply := h.open(f.agent, authOptions{role: agentpb.Role_ROLE_AGENT})
	if reply.GetError().GetStatus() != agentpb.Status_STATUS_REVOKED {
		t.Fatalf("swept agent connect: %v", reply)
	}
	c.expectClosed()
}

func TestAgentLimitPerAccount(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	phone, laptop := newIdentity(t), newIdentity(t)
	limit2 := func(id *agentproto.Identity, dev string) string {
		return h.pass(id, func(o *passOptions) { o.dev, o.agents = dev, 2 })
	}
	p, _ := h.connect(phone, agentpb.Role_ROLE_APPROVER, authOptions{pass: limit2(phone, "phone")})
	l, _ := h.connect(laptop, agentpb.Role_ROLE_APPROVER, authOptions{pass: limit2(laptop, "laptop")})
	first, second := newIdentity(t), newIdentity(t)
	p.register(first)
	l.register(second)
	third := newIdentity(t)
	if st := p.status(registerFrame(third, make([]byte, 32))); st != agentpb.Status_STATUS_LIMIT_REACHED {
		t.Fatalf("third agent on the account: %v", st)
	}
	// Registering again is idempotent and doesn't count twice.
	if st := p.status(registerFrame(first, make([]byte, 32))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("register again: %v", st)
	}
	if st := l.status(registerFrame(first, make([]byte, 32))); st != agentpb.Status_STATUS_ALREADY_CLAIMED {
		t.Fatalf("register another approver's agent: %v", st)
	}
	// Another account has its own limit.
	otherID := newIdentity(t)
	other, _ := h.connect(otherID, agentpb.Role_ROLE_APPROVER, authOptions{
		pass: h.pass(otherID, func(o *passOptions) { o.sub, o.agents = "account-2", 1 }),
	})
	other.register(third)

	// The newest pass of the account sets the limit.
	h.clock.advance(time.Minute)
	if st := l.status(renewFrame(h.pass(laptop, func(o *passOptions) { o.dev, o.agents = "laptop", 3 }))); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	p.register(newIdentity(t))
	if st := p.status(registerFrame(newIdentity(t), make([]byte, 32))); st != agentpb.Status_STATUS_LIMIT_REACHED {
		t.Fatalf("fourth agent: %v", st)
	}
}

func TestAgentLimitTokenMode(t *testing.T) {
	h := newHarness(t, AuthToken, func(cfg *Config) { cfg.MaxAgents = 2 })
	a, _ := h.connect(newIdentity(t), agentpb.Role_ROLE_APPROVER, authOptions{})
	b, _ := h.connect(newIdentity(t), agentpb.Role_ROLE_APPROVER, authOptions{})
	a.register(newIdentity(t))
	b.register(newIdentity(t))
	// The limit is for the whole relay, whichever approver asks.
	for _, c := range []*client{a, b} {
		if st := c.status(registerFrame(newIdentity(t), make([]byte, 32))); st != agentpb.Status_STATUS_LIMIT_REACHED {
			t.Fatalf("third agent: %v", st)
		}
	}
}

func TestUnregister(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	f := h.fixture()
	other := h.fixture()
	if st := f.a.status(unregisterFrame(other.agent.ID())); st != agentpb.Status_STATUS_NOT_FOUND {
		t.Fatalf("unregister another approver's agent: %v", st)
	}
	// Queued envelopes to and from the agent go with it.
	f.g.ws.CloseNow()
	f.a.ws.CloseNow()
	g, _ := h.connect(f.agent, agentpb.Role_ROLE_AGENT, authOptions{})
	if st := g.status(sendFrame(h.seal(f.agent, f.approver, true, time.Hour))); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	g.ws.CloseNow()
	a, _ := h.connect(f.approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	a.expectDeliver()
	if st := a.status(sendFrame(h.seal(f.approver, f.agent, true, time.Hour))); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	g, _ = h.connect(f.agent, agentpb.Role_ROLE_AGENT, authOptions{})
	g.expectDeliver()

	if st := a.status(unregisterFrame(f.agent.ID())); st != agentpb.Status_STATUS_OK {
		t.Fatalf("unregister: %v", st)
	}
	a.expectRevoked(f.agent.ID())
	g.expectRevoked(f.agent.ID())
	g.expectClosed()
	a.ws.CloseNow()
	a, ready := h.connect(f.approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	if len(ready.Agents) != 0 {
		t.Fatal("agent still listed")
	}
	a.expectQuiet()
	h.locked(func() {
		if mb := h.s.mailboxes[string(f.agent.ID())]; mb != nil {
			t.Error("agent mailbox kept")
		}
	})

	// An agent unregisters itself: Result, then Revoked, then the close.
	og := other.g
	if reply := og.call(unregisterFrame(nil)); reply.GetResult().GetStatus() != agentpb.Status_STATUS_OK {
		t.Fatalf("self unregister: %v", reply)
	}
	og.expectRevoked(other.agent.ID())
	og.expectClosed()
	other.a.expectRevoked(other.agent.ID())
}

func TestReplacedConnection(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	f := h.fixture()
	second, _ := h.connect(f.agent, agentpb.Role_ROLE_AGENT, authOptions{})
	if e := f.g.expectError(agentpb.Status_STATUS_UNAVAILABLE); e.Message != "connected elsewhere" {
		t.Fatalf("message = %q", e.Message)
	}
	f.g.expectClosed()
	if st := f.a.status(sendFrame(h.seal(f.approver, f.agent, false, time.Minute))); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	second.expectDeliver()
	second.ping()
	// The old socket closing later must not unregister the new one.
	h.locked(func() {
		if h.s.conns[string(f.agent.ID())] == nil {
			t.Error("live connection dropped")
		}
	})
}

func TestKeepaliveTimeout(t *testing.T) {
	t.Parallel()
	h := newHarness(t, AuthToken, func(cfg *Config) { cfg.Keepalive = time.Second })
	h.s.idleGrace = 0
	a, _ := h.connect(newIdentity(t), agentpb.Role_ROLE_APPROVER, authOptions{})
	// Pings within the interval keep the connection open past the timeout.
	for range 6 {
		time.Sleep(500 * time.Millisecond)
		a.ping()
	}
	start := time.Now()
	a.expectClosed()
	if took := time.Since(start); took < 1500*time.Millisecond || took > 4*time.Second {
		t.Fatalf("closed after %v of silence, want about 2s", took)
	}
}

func TestConnectRateLimit(t *testing.T) {
	h := newHarness(t, AuthToken, nil)
	url := h.ts.URL + "/v1/connect"
	for i := range connectsPerMinute {
		resp, err := http.Get(url)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			t.Fatalf("limited after %d", i)
		}
	}
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("status %d over the limit", resp.StatusCode)
	}
}

// cmd/relay-server sets HTTP read and write timeouts; upgraded connections
// must not inherit them.
func TestWebSocketOutlivesHTTPTimeouts(t *testing.T) {
	t.Parallel()
	h := newHarness(t, AuthToken, nil)
	ts := httptest.NewUnstartedServer(h.s.Handler())
	ts.Config.ReadTimeout = 300 * time.Millisecond
	ts.Config.WriteTimeout = 300 * time.Millisecond
	ts.Start()
	orig := h.ts
	h.ts = ts
	t.Cleanup(orig.Close)

	a, _ := h.connect(newIdentity(t), agentpb.Role_ROLE_APPROVER, authOptions{})
	for range 4 {
		time.Sleep(250 * time.Millisecond)
		a.ping()
	}
}
