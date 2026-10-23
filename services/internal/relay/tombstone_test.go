package relay

import (
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

// expectAgentRefused connects as an agent and checks the Error status.
func (h *harness) expectAgentRefused(agent *agentproto.Identity, status agentpb.Status) {
	h.t.Helper()
	c, reply := h.open(agent, authOptions{role: agentpb.Role_ROLE_AGENT, token: h.cfg.AccessToken})
	if reply.GetError().GetStatus() != status {
		h.t.Fatalf("agent connect: %v, want Error %v", reply, status)
	}
	c.expectClosed()
}

func TestRevokedAgentsLeaveTombstones(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	byApprover := h.fixture()
	if st := byApprover.a.status(unregisterFrame(byApprover.agent.ID())); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	byApprover.a.expectRevoked(byApprover.agent.ID())
	h.expectAgentRefused(byApprover.agent, agentpb.Status_STATUS_REVOKED)

	byItself := h.fixture()
	byItself.g.call(unregisterFrame(nil))
	byItself.a.expectRevoked(byItself.agent.ID())
	h.expectAgentRefused(byItself.agent, agentpb.Status_STATUS_REVOKED)

	approver, agent := newIdentity(t), newIdentity(t)
	revPub, revKey, _ := ed25519.GenerateKey(rand.Reader)
	a, _ := h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	a.status(registerFrame(agent, revPub))
	// Only agents that signed in at least once leave a tombstone.
	g, _ := h.connect(agent, agentpb.Role_ROLE_AGENT, authOptions{})
	if resp := h.postRevoke("application/x-protobuf", marshal(t, agentproto.SignRevoke(revKey, testOrigin, agent.ID(), h.clock.now().UnixMilli()))); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke: %d", resp.StatusCode)
	}
	a.expectRevoked(agent.ID())
	g.expectRevoked(agent.ID())
	g.expectClosed()
	h.expectAgentRefused(agent, agentpb.Status_STATUS_REVOKED)

	h.expectAgentRefused(newIdentity(t), agentpb.Status_STATUS_NOT_FOUND)

	// Registering a tombstoned key again (a re-pair) is allowed and clears it.
	if st := byApprover.a.status(registerFrame(byApprover.agent, make([]byte, 32))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("register a revoked key again: %v", st)
	}
	h.connect(byApprover.agent, agentpb.Role_ROLE_AGENT, authOptions{})
	if revoked, err := h.s.store.isRevoked(byApprover.agent.ID()); err != nil || revoked {
		t.Fatalf("tombstone kept after registering again: %v %v", revoked, err)
	}

	// Tombstones last 90 days.
	h.clock.advance(tombstoneLifetime - time.Hour)
	if err := h.s.sweepStore(); err != nil {
		t.Fatal(err)
	}
	h.expectAgentRefused(byItself.agent, agentpb.Status_STATUS_REVOKED)
	h.clock.advance(time.Hour)
	if err := h.s.sweepStore(); err != nil {
		t.Fatal(err)
	}
	h.expectAgentRefused(byItself.agent, agentpb.Status_STATUS_NOT_FOUND)
	h.expectAgentRefused(agent, agentpb.Status_STATUS_NOT_FOUND)
}

func TestUnknownAgentCreatesNoApprover(t *testing.T) {
	h := newHarness(t, AuthToken, nil)
	for range 3 {
		h.expectAgentRefused(newIdentity(t), agentpb.Status_STATUS_NOT_FOUND)
	}
	h.locked(func() {
		if len(h.s.approvers) != 0 {
			t.Fatalf("%d approver records from agent connections", len(h.s.approvers))
		}
	})
	if approvers, _, _, err := h.s.store.load(); err != nil || len(approvers) != 0 {
		t.Fatalf("%d approver rows in the database, %v", len(approvers), err)
	}
}

// An agent that never signed in was never online to miss its removal, so
// removing it leaves no tombstone, however it is removed.
func TestNeverConnectedAgentsLeaveNoTombstone(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	onPhone := func(o *passOptions) { o.dev = "phone" }
	approver := newIdentity(t)
	a, _ := h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{pass: h.pass(approver, onPhone)})

	byApprover := newIdentity(t)
	a.register(byApprover)
	if st := a.status(unregisterFrame(byApprover.ID())); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	a.expectRevoked(byApprover.ID())

	byKey := newIdentity(t)
	revPub, revKey, _ := ed25519.GenerateKey(rand.Reader)
	a.status(registerFrame(byKey, revPub))
	if resp := h.postRevoke("application/x-protobuf", marshal(t, agentproto.SignRevoke(revKey, testOrigin, byKey.ID(), h.clock.now().UnixMilli()))); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke: %d", resp.StatusCode)
	}
	a.expectRevoked(byKey.ID())

	// A reinstall removes both kinds at once; only the one that signed in
	// gets a tombstone.
	unseen, seen := newIdentity(t), newIdentity(t)
	a.register(unseen)
	a.register(seen)
	h.signIn(seen)
	h.clock.advance(time.Minute)
	reinstalled := newIdentity(t)
	h.connect(reinstalled, agentpb.Role_ROLE_APPROVER, authOptions{pass: h.pass(reinstalled, onPhone)})

	for _, agent := range []*agentproto.Identity{byApprover, byKey, unseen} {
		h.expectAgentRefused(agent, agentpb.Status_STATUS_NOT_FOUND)
	}
	h.expectAgentRefused(seen, agentpb.Status_STATUS_REVOKED)
	if n := h.tombstones(approver); n != 1 {
		t.Fatalf("%d tombstones, want 1", n)
	}
}

func (h *harness) tombstones(approver *agentproto.Identity) (n int) {
	h.t.Helper()
	err := h.s.store.db.QueryRow(`SELECT COUNT(*) FROM revoked_agents WHERE approver_key = ?`, approver.ID()).Scan(&n)
	if err != nil {
		h.t.Fatal(err)
	}
	return n
}

// Each approver keeps its newest tombstones only, whichever way its agents
// went.
func TestTombstoneCapPerApprover(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	h.stop()
	const keep = 3
	h.tune = func(s *Server) { s.maxTombstones = keep }
	h.start()
	onPhone := func(o *passOptions) { o.dev = "phone" }
	approver := newIdentity(t)
	a, _ := h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{pass: h.pass(approver, func(o *passOptions) {
		onPhone(o)
		o.agents = 10
	})})
	other := h.fixture()
	if st := other.a.status(unregisterFrame(other.agent.ID())); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}

	var agents []*agentproto.Identity
	for range keep + 2 {
		agent := newIdentity(t)
		a.register(agent)
		h.signIn(agent)
		h.clock.advance(time.Second)
		if st := a.status(unregisterFrame(agent.ID())); st != agentpb.Status_STATUS_OK {
			t.Fatal(st)
		}
		a.expectRevoked(agent.ID())
		agents = append(agents, agent)
	}
	if n := h.tombstones(approver); n != keep {
		t.Fatalf("%d tombstones, want %d", n, keep)
	}
	for i, agent := range agents {
		want := agentpb.Status_STATUS_REVOKED
		if i < len(agents)-keep {
			want = agentpb.Status_STATUS_NOT_FOUND
		}
		h.expectAgentRefused(agent, want)
	}
	// Other approvers keep theirs.
	h.expectAgentRefused(other.agent, agentpb.Status_STATUS_REVOKED)

	// Removing the approver with two more agents keeps the newest three.
	var last []*agentproto.Identity
	for range 2 {
		agent := newIdentity(t)
		a.register(agent)
		h.signIn(agent)
		last = append(last, agent)
	}
	h.clock.advance(time.Minute)
	reinstalled := newIdentity(t)
	h.connect(reinstalled, agentpb.Role_ROLE_APPROVER, authOptions{pass: h.pass(reinstalled, onPhone)})
	if n := h.tombstones(approver); n != keep {
		t.Fatalf("%d tombstones after the reinstall, want %d", n, keep)
	}
	for _, agent := range append(last, agents[len(agents)-1]) {
		h.expectAgentRefused(agent, agentpb.Status_STATUS_REVOKED)
	}
	h.expectAgentRefused(agents[len(agents)-2], agentpb.Status_STATUS_NOT_FOUND)
}

// RegisterAgent and UnregisterAgent are limited per approver key, across
// reconnects; an agent removing itself is not.
func TestRegistrationChurnLimit(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	approver := newIdentity(t)
	pass := h.pass(approver, func(o *passOptions) { o.agents = 100 })
	a, _ := h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{pass: pass})
	var agents []*agentproto.Identity
	for range registrationsPerMinute {
		agent := newIdentity(t)
		a.register(agent)
		agents = append(agents, agent)
	}
	extra := newIdentity(t)
	if st := a.status(registerFrame(extra, make([]byte, 32))); st != agentpb.Status_STATUS_RATE_LIMITED {
		t.Fatalf("register over the limit: %v", st)
	}
	// Reconnecting doesn't reset it.
	a.ws.CloseNow()
	h.waitOffline(approver)
	a, _ = h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{pass: pass})
	if st := a.status(registerFrame(extra, make([]byte, 32))); st != agentpb.Status_STATUS_RATE_LIMITED {
		t.Fatalf("register over the limit after reconnecting: %v", st)
	}

	for _, agent := range agents[:registrationsPerMinute-1] {
		if st := a.status(unregisterFrame(agent.ID())); st != agentpb.Status_STATUS_OK {
			t.Fatal(st)
		}
		a.expectRevoked(agent.ID())
	}
	survivor := agents[registrationsPerMinute-1]
	// A refused UnregisterAgent counts too.
	if st := a.status(unregisterFrame(newIdentity(t).ID())); st != agentpb.Status_STATUS_NOT_FOUND {
		t.Fatal(st)
	}
	if st := a.status(unregisterFrame(survivor.ID())); st != agentpb.Status_STATUS_RATE_LIMITED {
		t.Fatalf("unregister over the limit: %v", st)
	}
	// The agent can still remove itself.
	g, _ := h.connect(survivor, agentpb.Role_ROLE_AGENT, authOptions{})
	if reply := g.call(unregisterFrame(nil)); reply.GetResult().GetStatus() != agentpb.Status_STATUS_OK {
		t.Fatalf("self unregister: %v", reply)
	}
	a.expectRevoked(survivor.ID())

	h.clock.advance(time.Minute)
	a.register(extra)
	if st := a.status(unregisterFrame(extra.ID())); st != agentpb.Status_STATUS_OK {
		t.Fatalf("unregister in the next minute: %v", st)
	}
	metrics := scrape(t, h)
	for _, want := range []string{
		`cryptex_relay_rate_limited_total{bucket="register_agent"} 2`,
		`cryptex_relay_rate_limited_total{bucket="unregister_agent"} 1`,
	} {
		if !strings.Contains(metrics, want) {
			t.Errorf("metrics lack %s", want)
		}
	}
}
