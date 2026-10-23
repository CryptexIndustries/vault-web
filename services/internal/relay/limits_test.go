package relay

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

// sealSized builds a valid sign request whose serialized envelope is exactly
// size bytes.
func (h *harness) sealSized(from, to *agentproto.Identity, size int) *agentpb.Envelope {
	h.t.Helper()
	data := size - 2048
	for range 10 {
		msg := &agentpb.Message{Body: &agentpb.Message_SignRequest{SignRequest: &agentpb.SignRequest{Data: make([]byte, data)}}}
		env, err := agentproto.Seal(from, peerOf(to), msg, agentproto.SealOptions{ExpiresAt: h.clock.now().Add(time.Minute)})
		if err != nil {
			h.t.Fatal(err)
		}
		got := proto.Size(env)
		if got == size {
			return env
		}
		data += size - got
	}
	h.t.Fatalf("couldn't build a %d-byte envelope", size)
	return nil
}

func (h *harness) queueBytes() (n int64) {
	h.locked(func() { n = h.s.budget.total })
	return n
}

// The read limit leaves room for the largest envelope, so one just over it
// gets a Result instead of a dropped socket.
func TestEnvelopeSizeLimit(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	f := h.fixture()
	largest := h.sealSized(f.agent, f.approver, agentproto.MaxEnvelopeSize)
	if st := f.g.status(sendFrame(largest)); st != agentpb.Status_STATUS_OK {
		t.Fatalf("envelope of exactly MaxEnvelopeSize: %v", st)
	}
	f.a.expectDeliver()

	over := h.sealSized(f.agent, f.approver, agentproto.MaxEnvelopeSize)
	over.Ciphertext = append(over.Ciphertext, 0)
	if n := proto.Size(over); n != agentproto.MaxEnvelopeSize+1 {
		t.Fatalf("size %d", n)
	}
	if st := f.g.status(sendFrame(over)); st != agentpb.Status_STATUS_TOO_LARGE {
		t.Fatalf("envelope one byte over: %v", st)
	}
	f.g.ping()
	f.a.expectQuiet()
}

// Before Auth the read limit is small: a pass-sized Auth fits, a huge one
// closes the socket.
func TestReadLimitBeforeAuth(t *testing.T) {
	h := newHarness(t, AuthToken, nil)
	c, reply := h.open(newIdentity(t), authOptions{role: agentpb.Role_ROLE_APPROVER, token: strings.Repeat("x", preAuthReadLimit)})
	if reply != nil {
		t.Fatalf("got %v, want the socket closed", reply)
	}
	c.expectClosed()
}

func TestPendingConnectionCap(t *testing.T) {
	h := newHarness(t, AuthToken, func(cfg *Config) { cfg.MaxPendingConnections = 2 })
	first := h.dial("/v1/connect", nil)
	second := h.dial("/v1/connect", nil)

	dialStatus := func() int {
		_, st := h.tryDial("/v1/connect", nil)
		return st
	}
	if st := dialStatus(); st != http.StatusServiceUnavailable {
		t.Fatalf("third pending connection: HTTP %d", st)
	}

	// A connection that authenticates no longer counts.
	ready := h.auth(first, newIdentity(t), authOptions{role: agentpb.Role_ROLE_APPROVER, token: testToken})
	if ready.GetReady() == nil {
		t.Fatalf("auth: %v", ready)
	}
	third := h.dial("/v1/connect", nil)
	third.expectChallenge()
	if st := dialStatus(); st != http.StatusServiceUnavailable {
		t.Fatalf("over the cap again: HTTP %d", st)
	}
	// Nor does one that closes or fails Auth.
	second.ws.CloseNow()
	h.waitFor("pending released", func() (done bool) {
		h.locked(func() { done = h.s.pending <= 1 })
		return done
	})
	third.expectClosed() // the auth timeout
	h.waitFor("pending released", func() (done bool) {
		h.locked(func() { done = h.s.pending == 0 })
		return done
	})
	first.ping()
	if !strings.Contains(scrape(t, h), `cryptex_relay_rate_limited_total{bucket="connect_pending"} 2`) {
		t.Error("refused upgrades not counted")
	}
}

// Non-retained envelopes waiting for one recipient are capped by count and
// by bytes; retained ones have their own cap.
func TestQueueLimitsPerRecipient(t *testing.T) {
	t.Run("count", func(t *testing.T) {
		h := newHarness(t, AuthTicket, nil)
		f := h.fixture()
		f.a.ws.CloseNow()
		for i := range maxQueued {
			if st := f.g.status(sendFrame(h.seal(f.agent, f.approver, false, time.Minute))); st != agentpb.Status_STATUS_OK {
				t.Fatalf("send %d: %v", i, st)
			}
		}
		if st := f.g.status(sendFrame(h.seal(f.agent, f.approver, false, time.Minute))); st != agentpb.Status_STATUS_LIMIT_REACHED {
			t.Fatalf("send over the limit: %v", st)
		}
		if st := f.g.status(sendFrame(h.seal(f.agent, f.approver, true, time.Hour))); st != agentpb.Status_STATUS_OK {
			t.Fatalf("retained send: %v", st)
		}
	})
	t.Run("bytes", func(t *testing.T) {
		h := newHarness(t, AuthTicket, nil)
		f := h.fixture()
		f.a.ws.CloseNow()
		h.waitOffline(f.approver)

		const size = 60 << 10
		fit := maxQueuedBytes / size
		var first *agentpb.Envelope
		for i := range fit {
			env := h.sealSized(f.agent, f.approver, size)
			if first == nil {
				first = env
			}
			if st := f.g.status(sendFrame(env)); st != agentpb.Status_STATUS_OK {
				t.Fatalf("send %d: %v", i, st)
			}
		}
		if st := f.g.status(sendFrame(h.sealSized(f.agent, f.approver, size))); st != agentpb.Status_STATUS_LIMIT_REACHED {
			t.Fatalf("send over 1 MiB: %v", st)
		}
		if st := f.g.status(sendFrame(h.seal(f.agent, f.approver, true, time.Hour))); st != agentpb.Status_STATUS_OK {
			t.Fatalf("retained send: %v", st)
		}

		// An Ack makes room again.
		a, _ := h.connect(f.approver, agentpb.Role_ROLE_APPROVER, authOptions{})
		for range fit + 1 {
			a.expectDeliver()
		}
		a.ack(first)
		a.ping()
		if st := f.g.status(sendFrame(h.sealSized(f.agent, f.approver, size))); st != agentpb.Status_STATUS_OK {
			t.Fatalf("send after an ack: %v", st)
		}
	})
}

func TestQueueGlobalBudget(t *testing.T) {
	const size = 32 << 10
	h := newHarness(t, AuthTicket, func(cfg *Config) { cfg.MaxQueueBytes = 3 * size })
	f, other := h.fixture(), h.fixture()
	f.g.ws.CloseNow()
	other.g.ws.CloseNow()
	h.waitOffline(f.agent)
	h.waitOffline(other.agent)

	sends := []struct {
		c   *client
		env *agentpb.Envelope
	}{
		{f.a, h.sealSized(f.approver, f.agent, size)},
		{f.a, h.sealSized(f.approver, f.agent, size)},
		{other.a, h.sealSized(other.approver, other.agent, size)},
	}
	for _, send := range sends {
		if st := send.c.status(sendFrame(send.env)); st != agentpb.Status_STATUS_OK {
			t.Fatal(st)
		}
	}
	// The budget is for the whole relay, whoever sends.
	if st := f.a.status(sendFrame(h.seal(f.approver, f.agent, false, time.Minute))); st != agentpb.Status_STATUS_UNAVAILABLE {
		t.Fatalf("send over the global budget: %v", st)
	}
	if st := other.a.status(sendFrame(h.seal(other.approver, other.agent, false, time.Minute))); st != agentpb.Status_STATUS_UNAVAILABLE {
		t.Fatalf("send over the global budget from another account: %v", st)
	}

	// Removing an agent returns its queue to the budget.
	if st := f.a.status(unregisterFrame(f.agent.ID())); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	f.a.expectRevoked(f.agent.ID())
	if got := h.queueBytes(); got != size {
		t.Fatalf("queue bytes %d after the unregister, want %d", got, size)
	}
	if st := other.a.status(sendFrame(h.sealSized(other.approver, other.agent, size))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("send after room was freed: %v", st)
	}
	// So does expiry.
	h.clock.advance(time.Minute + agentproto.ClockSkew)
	h.s.sweepMemory()
	if got := h.queueBytes(); got != 0 {
		t.Fatalf("queue bytes %d after expiry", got)
	}
}

// Retained envelopes are one per sender, and the cap makes sure a recipient
// never holds more than its senders' worth.
func TestRetainedCapPerRecipient(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	f := h.fixture()
	// Stand in for a row that outlived its sender.
	h.locked(func() {
		h.s.mailboxLocked(string(f.approver.ID())).add(&entry{
			env: &agentpb.Envelope{}, sender: "gone", messageID: "stale", retained: true,
			dropAt: h.clock.now().Add(time.Hour), size: 1,
		})
	})
	f.a.expectQuiet()
	if st := f.g.status(sendFrame(h.seal(f.agent, f.approver, true, time.Hour))); st != agentpb.Status_STATUS_LIMIT_REACHED {
		t.Fatalf("retained send over the cap: %v", st)
	}
	// Non-retained sends are not affected.
	if st := f.g.status(sendFrame(h.seal(f.agent, f.approver, false, time.Minute))); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	f.a.expectDeliver()
	// A second agent raises the cap to two.
	f.a.register(newIdentity(t))
	if st := f.g.status(sendFrame(h.seal(f.agent, f.approver, true, time.Hour))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("retained send within the cap: %v", st)
	}
	f.a.expectDeliver()
	// Replacing its own retained envelope is always allowed.
	h.locked(func() {
		mb := h.s.mailboxes[string(f.approver.ID())]
		mb.add(&entry{env: &agentpb.Envelope{}, sender: "gone too", messageID: "stale 2", retained: true,
			dropAt: h.clock.now().Add(time.Hour), size: 1})
	})
	if st := f.g.status(sendFrame(h.seal(f.agent, f.approver, true, time.Hour))); st != agentpb.Status_STATUS_OK {
		t.Fatalf("retained replacement at the cap: %v", st)
	}
}

// A backlog bigger than the outbound buffer is written with flow control,
// not dropped with the connection.
func TestBacklogLargerThanOutboundBuffer(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	h.stop()
	h.tune = func(s *Server) { s.outboundSize = 4 }
	h.start()

	f := h.fixture()
	f.a.ws.CloseNow()
	h.waitOffline(f.approver)
	retained := h.seal(f.agent, f.approver, true, time.Hour)
	if st := f.g.status(sendFrame(retained)); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	var queued []*agentpb.Envelope
	for range maxQueued {
		env := h.seal(f.agent, f.approver, false, time.Minute)
		if st := f.g.status(sendFrame(env)); st != agentpb.Status_STATUS_OK {
			t.Fatal(st)
		}
		queued = append(queued, env)
	}

	// Every reconnect gets the whole backlog, retained first.
	for round := range 2 {
		a, _ := h.connect(f.approver, agentpb.Role_ROLE_APPROVER, authOptions{})
		if got := a.expectDeliver(); messageID(t, got) != messageID(t, retained) {
			t.Fatalf("round %d: retained envelope not first", round)
		}
		for i, env := range queued {
			if got := a.expectDeliver(); messageID(t, got) != messageID(t, env) {
				t.Fatalf("round %d: delivery %d out of order", round, i)
			}
		}
		// Still connected, and new envelopes follow the backlog.
		retained = h.seal(f.agent, f.approver, true, time.Hour)
		if st := f.g.status(sendFrame(retained)); st != agentpb.Status_STATUS_OK {
			t.Fatal(st)
		}
		if got := a.expectDeliver(); messageID(t, got) != messageID(t, retained) {
			t.Fatalf("round %d: live delivery missing", round)
		}
		a.ping()
		a.ws.CloseNow()
		h.waitOffline(f.approver)
	}
}

// Sockets waiting for Auth are capped per address (an IPv6 /64) and per
// network (an IPv4 /24 or IPv6 /48), so one client can't hold the global cap.
func TestPendingCapsPerAddressAndNetwork(t *testing.T) {
	h := newHarness(t, AuthToken, func(cfg *Config) { cfg.ClientIPHeader = "X-Forwarded-For" })
	h.stop()
	// The sockets below must outlive the time it takes to open them.
	h.tune = func(s *Server) { s.authTimeout = time.Minute }
	h.start()

	hold := func(ip string) {
		t.Helper()
		h.dial("/v1/connect", forwardedFor(ip)).expectChallenge()
	}
	refused := func(ip string) {
		t.Helper()
		if c, st := h.tryDial("/v1/connect", forwardedFor(ip)); c != nil || st != http.StatusTooManyRequests {
			t.Fatalf("pending socket from %s: HTTP %d, want 429", ip, st)
		}
	}

	first := h.dial("/v1/connect", forwardedFor("198.51.100.1"))
	for range pendingPerAddress - 1 {
		hold("198.51.100.1")
	}
	refused("198.51.100.1")
	// A socket that signs in no longer counts.
	if reply := h.auth(first, newIdentity(t), authOptions{role: agentpb.Role_ROLE_APPROVER, token: testToken}); reply.GetReady() == nil {
		t.Fatalf("auth: %v", reply)
	}
	hold("198.51.100.1")
	refused("198.51.100.1")

	// The rest of the /24 fills up to the network cap.
	for i := 2; i <= pendingPerNetwork/pendingPerAddress; i++ {
		for range pendingPerAddress {
			hold(fmt.Sprintf("198.51.100.%d", i))
		}
	}
	refused("198.51.100.200")
	hold("198.51.101.1")

	// IPv6: one /64 is one address, one /48 one network.
	for i := range pendingPerAddress {
		hold(fmt.Sprintf("2001:db8:1:1::%x", i+1))
	}
	refused("2001:db8:1:1::ff")
	for i := 2; i <= pendingPerNetwork/pendingPerAddress; i++ {
		for range pendingPerAddress {
			hold(fmt.Sprintf("2001:db8:1:%x::1", i))
		}
	}
	refused("2001:db8:1:ff::1")
	hold("2001:db8:2::1")

	metrics := scrape(t, h)
	for _, want := range []string{
		`cryptex_relay_rate_limited_total{bucket="connect_pending_address"} 3`,
		`cryptex_relay_rate_limited_total{bucket="connect_pending_network"} 2`,
	} {
		if !strings.Contains(metrics, want) {
			t.Errorf("metrics lack %s", want)
		}
	}
}

// A socket that doesn't send Auth is closed after 5 seconds.
func TestDefaultAuthTimeout(t *testing.T) {
	t.Parallel()
	h := newHarness(t, AuthToken, nil)
	h.stop()
	// Started by hand: the harness shortens the timeout.
	s, err := New(h.cfg)
	if err != nil {
		t.Fatal(err)
	}
	h.s, h.ts = s, httptest.NewServer(s.Handler())
	c := h.dial("/v1/connect", nil)
	c.expectChallenge()
	start := time.Now()
	select {
	case f, ok := <-c.frames:
		if ok {
			t.Fatalf("got %v, want the socket closed", f)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("the socket stayed open")
	}
	if took := time.Since(start); took < 4*time.Second || took > 7*time.Second {
		t.Fatalf("closed after %v, want about 5s", took)
	}
}
