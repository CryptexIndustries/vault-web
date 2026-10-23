package relay

import (
	"crypto/ed25519"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

// signIn connects an agent once and leaves, so it counts as authenticated.
func (h *harness) signIn(agent *agentproto.Identity) {
	h.t.Helper()
	g, _ := h.connect(agent, agentpb.Role_ROLE_AGENT, authOptions{})
	g.ws.CloseNow()
	h.waitOffline(agent)
}

func (h *harness) accountBytes(account string) (n int64) {
	h.locked(func() { n = h.s.budget.accounts[account] })
	return n
}

func TestAccountQueueBudget(t *testing.T) {
	const size = 32 << 10
	h := newHarness(t, AuthTicket, func(cfg *Config) { cfg.MaxAccountQueueBytes = 3 * size })
	f := h.fixtureIn("account-1", 5)
	second := newIdentity(t)
	f.a.register(second)
	h.signIn(second)
	f.g.ws.CloseNow()
	h.waitOffline(f.agent)

	for i, to := range []*agentproto.Identity{f.agent, f.agent, second} {
		if st := f.a.status(sendFrame(h.sealSized(f.approver, to, size))); st != agentpb.Status_STATUS_OK {
			t.Fatalf("send %d: %v", i, st)
		}
	}
	if got := h.accountBytes("sub:account-1"); got != 3*size {
		t.Fatalf("account bytes %d, want %d", got, 3*size)
	}
	// Full, whichever agent it is for, and well below the global budget.
	if st := f.a.status(sendFrame(h.seal(f.approver, second, false, time.Minute))); st != agentpb.Status_STATUS_LIMIT_REACHED {
		t.Fatalf("send over the account budget: %v", st)
	}

	// Another device of the same account shares the budget, both ways.
	dev2 := h.fixtureIn("account-1", 5)
	if st := dev2.a.status(sendFrame(h.seal(dev2.approver, dev2.agent, false, time.Minute))); st != agentpb.Status_STATUS_LIMIT_REACHED {
		t.Fatalf("send from the account's other device: %v", st)
	}
	if st := dev2.g.status(sendFrame(h.seal(dev2.agent, dev2.approver, false, time.Minute))); st != agentpb.Status_STATUS_LIMIT_REACHED {
		t.Fatalf("send from an agent of the account: %v", st)
	}

	// Another account is not affected.
	other := h.fixtureIn("account-2", 5)
	if st := other.a.status(sendFrame(h.sealSized(other.approver, other.agent, size))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("send from another account: %v", st)
	}
	other.g.expectDeliver()

	// An Ack makes room again.
	g, _ := h.connect(f.agent, agentpb.Role_ROLE_AGENT, authOptions{})
	first := g.expectDeliver()
	g.expectDeliver()
	g.ack(first)
	g.ping()
	if st := f.a.status(sendFrame(h.sealSized(f.approver, second, size))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("send after an ack: %v", st)
	}

	// Removing an agent returns its bytes to the account.
	if st := f.a.status(unregisterFrame(second.ID())); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	if got := h.accountBytes("sub:account-1"); got != size {
		t.Fatalf("account bytes %d after the unregister, want %d", got, size)
	}
}

// A retained envelope that a newer one replaced is still in memory while
// the recipient's outbound queue holds it, so it counts against the budgets
// until the writer takes it or the connection goes.
func TestOutboundQueueCountsAgainstBudget(t *testing.T) {
	const size = 60 << 10
	h := newHarness(t, AuthToken, func(cfg *Config) {
		cfg.MaxQueueBytes = 1 << 20
		cfg.MaxAccountQueueBytes = 1 << 20
	})
	f := h.fixture()
	var target *peer
	h.locked(func() { target = h.s.conns[string(f.agent.ID())] })
	resume := f.g.stall()
	defer resume()

	refused := false
	for i := 0; i < 1000 && !refused; i++ {
		env := h.seal(f.approver, f.agent, true, time.Hour)
		env.Ciphertext = make([]byte, size)
		env.Signature = ed25519.Sign(f.approver.Sign, agentproto.SigningInput(env))
		switch st := f.a.status(sendFrame(env)); st {
		case agentpb.Status_STATUS_OK:
		case agentpb.Status_STATUS_LIMIT_REACHED:
			refused = true
		default:
			t.Fatalf("send %d: %v", i, st)
		}
		// Each queued Deliver holds an envelope of its own.
		if held, counted := int64(len(target.out))*size, h.queueBytes(); held > counted {
			t.Fatalf("send %d: the outbound queue holds %d bytes, the budget counts %d", i, held, counted)
		}
	}
	if !refused {
		t.Fatal("a recipient that stopped reading never filled the budget")
	}

	// The queue is released with the connection; only the latest retained
	// envelope, in the mailbox, still counts.
	f.g.ws.CloseNow()
	h.waitOffline(f.agent)
	h.waitFor("the outbound queue released", func() bool { return h.queueBytes() < 2*size })
}

// In token mode every approver has the same owner, but each approver key
// still gets its own budget.
func TestAccountQueueBudgetTokenMode(t *testing.T) {
	const size = 32 << 10
	h := newHarness(t, AuthToken, func(cfg *Config) { cfg.MaxAccountQueueBytes = 2 * size })
	f, other := h.fixture(), h.fixture()
	for range 2 {
		if st := f.a.status(sendFrame(h.sealSized(f.approver, f.agent, size))); st != agentpb.Status_STATUS_OK {
			t.Fatal(st)
		}
	}
	if st := f.a.status(sendFrame(h.seal(f.approver, f.agent, false, time.Minute))); st != agentpb.Status_STATUS_LIMIT_REACHED {
		t.Fatalf("send over the approver's budget: %v", st)
	}
	if st := other.a.status(sendFrame(h.sealSized(other.approver, other.agent, size))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("send from another approver: %v", st)
	}
}

// An agent that never signed in may hold its retained KeysUpdate and one
// more envelope, nothing else.
func TestUnseenAgentQueue(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	f := h.fixture()
	fresh := newIdentity(t)
	f.a.register(fresh)

	if st := f.a.status(sendFrame(h.seal(f.approver, fresh, true, time.Hour))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("retained send: %v", st)
	}
	if st := f.a.status(sendFrame(h.seal(f.approver, fresh, false, time.Minute))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("first request: %v", st)
	}
	if st := f.a.status(sendFrame(h.seal(f.approver, fresh, false, time.Minute))); st != agentpb.Status_STATUS_LIMIT_REACHED {
		t.Fatalf("second request: %v", st)
	}
	// A newer KeysUpdate still replaces the old one.
	latest := h.seal(f.approver, fresh, true, time.Hour)
	if st := f.a.status(sendFrame(latest)); st != agentpb.Status_STATUS_OK {
		t.Fatalf("retained replacement: %v", st)
	}

	// The relay remembers across a restart that the agent never signed in.
	// Requests live in memory only, so the queue starts empty again.
	h.stop()
	h.cfg.DBPath = t.TempDir() + "/relay.db"
	h.start()
	f = h.fixture()
	f.a.register(fresh)
	h.stop()
	h.start()
	a, _ := h.connect(f.approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	for range maxQueuedUnseen {
		if st := a.status(sendFrame(h.seal(f.approver, fresh, false, time.Minute))); st != agentpb.Status_STATUS_OK {
			t.Fatal(st)
		}
	}
	if st := a.status(sendFrame(h.seal(f.approver, fresh, false, time.Minute))); st != agentpb.Status_STATUS_LIMIT_REACHED {
		t.Fatalf("request after a restart: %v", st)
	}

	// Once it signs in, the usual caps apply.
	g, _ := h.connect(fresh, agentpb.Role_ROLE_AGENT, authOptions{})
	g.expectDeliver()
	for i := range 3 {
		if st := a.status(sendFrame(h.seal(f.approver, fresh, false, time.Minute))); st != agentpb.Status_STATUS_OK {
			t.Fatalf("request %d after signing in: %v", i, st)
		}
		g.expectDeliver()
	}
}

// Accounts register made-up agents and queue envelopes
// for them that nobody will collect. Each account stops at its own budget,
// so three of them can't fill the relay and lock everyone else out.
func TestFakeAgentsCannotFillRelay(t *testing.T) {
	t.Parallel()
	for _, signedIn := range []bool{false, true} {
		t.Run(fmt.Sprintf("signed in %v", signedIn), func(t *testing.T) {
			t.Parallel()
			h := newHarness(t, AuthTicket, nil)
			const size = agentproto.MaxEnvelopeSize
			attackers := 3
			// Without the per-account budget, each account could hold one
			// retained and 1 MiB of requests for each of its 25 agents.
			if per := int64(25 * (maxQueuedBytes + size)); int64(attackers)*per <= h.s.cfg.MaxQueueBytes {
				t.Fatalf("the scenario doesn't exceed the global budget: %d", int64(attackers)*per)
			}
			for i := range attackers {
				sub := fmt.Sprintf("attacker-%d", i)
				approver := newIdentity(t)
				a, _ := h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{
					pass: h.pass(approver, func(o *passOptions) { o.sub, o.agents = sub, 25 }),
				})
				var refused int
				for range 25 {
					agent := newIdentity(t)
					a.register(agent)
					if signedIn {
						g, _ := h.connect(agent, agentpb.Role_ROLE_AGENT, authOptions{})
						g.ws.CloseNow()
					}
					if st := a.status(sendFrame(h.seal(approver, agent, true, time.Hour))); st != agentpb.Status_STATUS_OK &&
						st != agentpb.Status_STATUS_LIMIT_REACHED {
						t.Fatalf("retained send: %v", st)
					}
					for {
						st := a.status(sendFrame(h.sealSized(approver, agent, size)))
						if st == agentpb.Status_STATUS_OK {
							continue
						}
						if st != agentpb.Status_STATUS_LIMIT_REACHED {
							t.Fatalf("%s: send refused with %v, want LIMIT_REACHED", sub, st)
						}
						refused++
						break
					}
				}
				if got := h.accountBytes("sub:" + sub); got > h.s.cfg.MaxAccountQueueBytes {
					t.Fatalf("%s holds %d bytes", sub, got)
				}
				if refused != 25 {
					t.Fatalf("%s: %d agents refused", sub, refused)
				}
			}
			h.locked(func() {
				if limit := int64(attackers) * h.s.cfg.MaxAccountQueueBytes; h.s.budget.total > limit {
					t.Fatalf("the relay holds %d bytes, more than %d", h.s.budget.total, limit)
				}
			})

			// Everyone else still gets through.
			victim := h.fixtureIn("victim", 5)
			if st := victim.g.status(sendFrame(h.sealSized(victim.agent, victim.approver, size))); st != agentpb.Status_STATUS_OK {
				t.Fatalf("victim's agent: %v", st)
			}
			victim.a.expectDeliver()
			if st := victim.a.status(sendFrame(h.seal(victim.approver, victim.agent, false, time.Minute))); st != agentpb.Status_STATUS_OK {
				t.Fatalf("victim's approver: %v", st)
			}
			victim.g.expectDeliver()
		})
	}
}

// Seen message IDs are capped per sender, so one agent sending as fast as it
// can doesn't block the approver's other agents.
func TestSeenIDsPerSender(t *testing.T) {
	t.Parallel()
	h := newHarness(t, AuthTicket, nil)
	f := h.fixture()
	quiet := newIdentity(t)
	f.a.register(quiet)
	q, _ := h.connect(quiet, agentpb.Role_ROLE_AGENT, authOptions{})

	// The approver acks everything but the last three, so the queue cap
	// doesn't get in the way and three stay queued.
	const unacked = 3
	for i := range maxSeen {
		if st := f.g.status(sendFrame(h.seal(f.agent, f.approver, false, time.Minute))); st != agentpb.Status_STATUS_OK {
			t.Fatalf("send %d: %v", i, st)
		}
		if env := f.a.expectDeliver(); i < maxSeen-unacked {
			f.a.ack(env)
		}
	}
	if st := f.g.status(sendFrame(h.seal(f.agent, f.approver, false, time.Minute))); st != agentpb.Status_STATUS_LIMIT_REACHED {
		t.Fatalf("send past the seen cap: %v", st)
	}
	if st := q.status(sendFrame(h.seal(quiet, f.approver, false, time.Minute))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("the other agent: %v", st)
	}
	f.a.expectDeliver()

	// Once the IDs expire the flooding agent may send again. The three
	// unacked envelopes are dropped on the way, by the sweeper or by the
	// send itself, and counted either way.
	h.clock.advance(time.Minute + agentproto.ClockSkew)
	if st := f.g.status(sendFrame(h.seal(f.agent, f.approver, false, time.Minute))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("send after the IDs expired: %v", st)
	}
	f.a.expectDeliver()
	// The quiet agent's envelope expired too, unacked.
	if want := fmt.Sprintf("cryptex_relay_expired_envelopes_total %d\n", unacked+1); !strings.Contains(scrape(t, h), want) {
		t.Errorf("metrics lack %q", want)
	}
	h.locked(func() {
		mb := h.s.mailboxes[string(f.approver.ID())]
		if n := mb.seenFrom[string(f.agent.ID())]; n != 1 {
			t.Errorf("%d IDs remembered from the flooding agent, want 1", n)
		}
		if _, ok := mb.seenFrom[string(quiet.ID())]; ok {
			t.Error("the quiet agent's expired ID is still counted")
		}
	})
}
