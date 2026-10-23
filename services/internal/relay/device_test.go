package relay

import (
	"strings"
	"testing"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

// A pass copied off a device is useless without that device's key.
func TestStolenPassWithAnotherKey(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	victim, thief := newIdentity(t), newIdentity(t)
	stolen := h.pass(victim, nil)

	c, reply := h.open(thief, authOptions{role: agentpb.Role_ROLE_APPROVER, pass: stolen})
	if reply.GetError().GetStatus() != agentpb.Status_STATUS_UNAUTHORIZED {
		t.Fatalf("Auth with a pass for another key: %v", reply)
	}
	c.expectClosed()

	// The thief's own connection can't adopt the stolen pass either.
	a, _ := h.connect(thief, agentpb.Role_ROLE_APPROVER, authOptions{
		pass: h.pass(thief, func(o *passOptions) { o.agents = 1 }),
	})
	h.clock.advance(time.Minute)
	if st := a.status(renewFrame(h.pass(victim, func(o *passOptions) { o.agents = 50 }))); st != agentpb.Status_STATUS_UNAUTHORIZED {
		t.Fatalf("RenewPass with a pass for another key: %v", st)
	}
	if st := a.status(renewFrame(h.pass(thief, nil))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("RenewPass with its own pass: %v", st)
	}
	h.locked(func() {
		if n := len(h.s.approvers); n != 1 {
			t.Errorf("approvers = %d, want only the thief's own", n)
		}
	})
}

// A reinstalled app has a new key on the same device; it takes the device
// over and the old key's agents are removed as if unregistered.
func TestReinstallReplacesApprover(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	oldKey, newKey, laptop := newIdentity(t), newIdentity(t), newIdentity(t)
	onPhone := func(o *passOptions) { o.dev = "phone" }
	oldPass := h.pass(oldKey, onPhone)
	old, _ := h.connect(oldKey, agentpb.Role_ROLE_APPROVER, authOptions{pass: oldPass})
	agent := newIdentity(t)
	old.register(agent)
	g, _ := h.connect(agent, agentpb.Role_ROLE_AGENT, authOptions{})
	// Another device on the account is not affected.
	l, _ := h.connect(laptop, agentpb.Role_ROLE_APPROVER, authOptions{pass: h.pass(laptop, func(o *passOptions) { o.dev = "laptop" })})
	laptopAgent := newIdentity(t)
	l.register(laptopAgent)
	if st := g.status(sendFrame(h.seal(agent, oldKey, true, time.Hour))); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	old.expectDeliver()

	h.clock.advance(time.Minute)
	fresh, ready := h.connect(newKey, agentpb.Role_ROLE_APPROVER, authOptions{pass: h.pass(newKey, onPhone)})
	if len(ready.Agents) != 0 {
		t.Fatalf("the new key inherited agents: %v", ready.Agents)
	}
	old.expectRevoked(agent.ID())
	if e := old.expectError(agentpb.Status_STATUS_UNAUTHORIZED); !strings.Contains(e.Message, "new key") {
		t.Fatalf("message = %q", e.Message)
	}
	old.expectClosed()
	g.expectRevoked(agent.ID())
	g.expectClosed()
	l.expectQuiet()

	c, reply := h.open(agent, authOptions{role: agentpb.Role_ROLE_AGENT})
	if reply.GetError().GetStatus() != agentpb.Status_STATUS_REVOKED {
		t.Fatalf("removed agent connects: %v", reply)
	}
	c.expectClosed()
	// The old install's pass is older than the new key's, so it can't take
	// the device back.
	c, reply = h.open(oldKey, authOptions{role: agentpb.Role_ROLE_APPROVER, pass: oldPass})
	if reply.GetError().GetStatus() != agentpb.Status_STATUS_UNAUTHORIZED {
		t.Fatalf("old key with its old pass: %v", reply)
	}
	c.expectClosed()

	h.locked(func() {
		if len(h.s.approvers) != 2 || h.s.approvers[string(oldKey.ID())] != nil || len(h.s.agents) != 1 {
			t.Errorf("approvers %d, agents %d after the reinstall", len(h.s.approvers), len(h.s.agents))
		}
		if h.s.budget.total != 0 {
			t.Errorf("queue bytes %d after the old approver went", h.s.budget.total)
		}
	})
	if !strings.Contains(scrape(t, h), `cryptex_relay_revokes_total{source="replaced"} 1`) {
		t.Error("replaced agent not counted")
	}

	// RenewPass moving a key onto a device takes it over the same way.
	h.clock.advance(time.Minute)
	if st := fresh.status(renewFrame(h.pass(newKey, func(o *passOptions) { o.dev = "laptop" }))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("renew onto the laptop's device: %v", st)
	}
	l.expectRevoked(laptopAgent.ID())
	l.expectError(agentpb.Status_STATUS_UNAUTHORIZED)
}

// Approvers whose pass lapsed keep their agents for the grace period, but
// those agents don't block a new device on the account.
func TestAgentLimitIgnoresExpiredApprovers(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	phone, tablet := newIdentity(t), newIdentity(t)
	p, _ := h.connect(phone, agentpb.Role_ROLE_APPROVER, authOptions{pass: h.pass(phone, func(o *passOptions) {
		o.agents, o.exp = 2, o.iat.Add(24*time.Hour)
	})})
	p.register(newIdentity(t))
	p.register(newIdentity(t))

	h.clock.advance(2 * 24 * time.Hour)
	tb, _ := h.connect(tablet, agentpb.Role_ROLE_APPROVER, authOptions{pass: h.pass(tablet, func(o *passOptions) { o.agents = 2 })})
	tb.register(newIdentity(t))
	tb.register(newIdentity(t))
	if st := tb.status(registerFrame(newIdentity(t), make([]byte, 32))); st != agentpb.Status_STATUS_LIMIT_REACHED {
		t.Fatalf("third agent on the live device: %v", st)
	}
	h.locked(func() {
		if n := len(h.s.agents); n != 4 {
			t.Errorf("agents = %d; the lapsed phone's should still be stored", n)
		}
	})
}
