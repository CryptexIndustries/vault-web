package relay

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

// The database sweep can delete an expired retained row before the memory
// sweep drops its mailbox entry, and SQLite can give the row's id to the
// next insert. A late Ack of the expired envelope must not delete that new
// row, here another account's, which would then be lost on restart.
func TestLateAckKeepsReusedRetainedRow(t *testing.T) {
	h := newHarness(t, AuthTicket, func(cfg *Config) { cfg.DBPath = filepath.Join(t.TempDir(), "relay.db") })
	first := h.fixtureIn("first-account", 5)
	other := h.fixtureIn("other-account", 5)
	other.g.ws.CloseNow()
	h.waitOffline(other.agent)

	old := h.seal(first.approver, first.agent, true, time.Second)
	if st := first.a.status(sendFrame(old)); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	first.g.expectDeliver() // not acked yet
	var oldID int64
	h.locked(func() { oldID = h.s.mailboxes[string(first.agent.ID())].retained[0].dbID })
	h.clock.advance(time.Second + agentproto.ClockSkew)
	if err := h.s.sweepStore(); err != nil {
		t.Fatal(err)
	}

	fresh := h.seal(other.approver, other.agent, true, time.Hour)
	if st := other.a.status(sendFrame(fresh)); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	var newID int64
	h.locked(func() { newID = h.s.mailboxes[string(other.agent.ID())].retained[0].dbID })
	if newID != oldID {
		t.Fatalf("SQLite didn't reuse the row id (old %d, new %d); the test needs it to", oldID, newID)
	}
	first.g.ack(old)
	first.g.ping() // the Ack is handled before the Pong

	h.stop()
	h.start()
	var kept bool
	h.locked(func() {
		mb := h.s.mailboxes[string(other.agent.ID())]
		kept = mb != nil && len(mb.retained) == 1 && mb.retained[0].messageID == messageID(t, fresh)
	})
	if !kept {
		t.Fatal("the late Ack deleted another account's retained envelope")
	}
}
