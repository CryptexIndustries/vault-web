package relay

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

type pairing struct {
	agent  *agentproto.Identity
	c      *client
	offer  []byte
	slotID []byte
	secret []byte
}

func makeOffer(t *testing.T, agent *agentproto.Identity) []byte {
	t.Helper()
	offer, err := proto.Marshal(&agentpb.PairingOffer{
		ProtocolVersion: 1, SignPublicKey: agent.ID(), KemPublicKey: agent.KEMPublicKey(),
		Hostname: "arch-desktop", Os: "linux", Arch: "amd64", AgentVersion: "0.1.0",
	})
	if err != nil {
		t.Fatal(err)
	}
	return offer
}

func openSlotFrame(offer []byte) *agentpb.ClientFrame {
	return &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_OpenSlot{OpenSlot: &agentpb.OpenSlot{Offer: offer}}}
}

func forwardedFor(ip string) http.Header {
	return http.Header{"X-Forwarded-For": {ip}}
}

// openSlot plays the agent side of `cryptex-agent pair` up to SlotOpened.
func (h *harness) openSlot(header http.Header) *pairing {
	h.t.Helper()
	p := &pairing{agent: newIdentity(h.t), secret: agentproto.NewPairingSecret()}
	p.offer = makeOffer(h.t, p.agent)
	p.c = h.dial("/v1/pair", header)
	if ch := p.c.next().GetChallenge(); ch == nil || ch.KeepaliveSeconds == 0 {
		h.t.Fatalf("no challenge on /v1/pair: %v", ch)
	}
	p.c.write(openSlotFrame(p.offer))
	reply := p.c.next()
	opened := reply.GetSlotOpened()
	if opened == nil {
		h.t.Fatalf("got %v, want SlotOpened", reply)
	}
	if len(opened.SlotId) != slotIDSize || opened.ExpiresAt != h.clock.now().Add(SlotLifetime).UnixMilli() {
		h.t.Fatalf("slot opened = %v", opened)
	}
	p.slotID = opened.SlotId
	return p
}

func claimFrame(slotID []byte) *agentpb.ClientFrame {
	return &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_ClaimSlot{ClaimSlot: &agentpb.ClaimSlot{SlotId: slotID}}}
}

func answerFrame(slotID []byte, env *agentpb.Envelope) *agentpb.ClientFrame {
	return &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_AnswerSlot{AnswerSlot: &agentpb.AnswerSlot{SlotId: slotID, Envelope: env}}}
}

// accept seals the PairingAccept the way the approver does.
func (h *harness) accept(approver *agentproto.Identity, p *pairing) *agentpb.Envelope {
	h.t.Helper()
	env, err := agentproto.Seal(approver, peerOf(p.agent), &agentpb.Message{Body: &agentpb.Message_PairingAccept{PairingAccept: &agentpb.PairingAccept{
		ApproverSignPublicKey: approver.ID(), ApproverKemPublicKey: approver.KEMPublicKey(),
		ApproverName: "Pixel 8", AgentName: "workstation",
	}}}, agentproto.SealOptions{
		ExpiresAt: h.clock.now().Add(time.Minute),
		Pairing:   &agentproto.PairingBinding{Secret: p.secret, OfferHash: agentproto.OfferHash(p.offer)},
	})
	if err != nil {
		h.t.Fatal(err)
	}
	return env
}

func TestPairingLifecycle(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	approver, rival := newIdentity(t), newIdentity(t)
	a, _ := h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	b, _ := h.connect(rival, agentpb.Role_ROLE_APPROVER, authOptions{
		pass: h.pass(rival, func(o *passOptions) { o.sub = "account-2" }),
	})
	p := h.openSlot(nil)

	h.clock.advance(time.Minute)
	claimed := h.clock.now().Add(SlotLifetime).UnixMilli()
	reply := a.call(claimFrame(p.slotID))
	offer := reply.GetSlotOffer()
	if offer == nil || !bytes.Equal(offer.Offer, p.offer) || offer.ExpiresAt != claimed {
		t.Fatalf("claim: %v", reply)
	}
	if got := p.c.next().GetSlotClaimed(); got == nil || got.ExpiresAt != claimed {
		t.Fatalf("agent got %v, want SlotClaimed", got)
	}
	// The same approver may claim again (the app retried); the deadline
	// doesn't move and the agent hears nothing new.
	h.clock.advance(time.Second)
	if again := a.call(claimFrame(p.slotID)).GetSlotOffer(); again == nil || again.ExpiresAt != claimed {
		t.Fatalf("second claim: %v", again)
	}
	p.c.expectQuiet()
	if st := b.status(claimFrame(p.slotID)); st != agentpb.Status_STATUS_ALREADY_CLAIMED {
		t.Fatalf("rival claim: %v", st)
	}

	accept := h.accept(approver, p)
	noMAC := h.seal(approver, p.agent, false, time.Minute)
	wrongAgent := h.accept(approver, &pairing{agent: newIdentity(t), secret: p.secret, offer: p.offer})
	tampered := h.accept(approver, p)
	tampered.Ciphertext[0] ^= 1
	bad := agentpb.Status_STATUS_BAD_REQUEST
	if st := a.status(answerFrame(p.slotID, accept)); st != bad {
		t.Errorf("answer before RegisterAgent: %v", st)
	}
	if st := b.status(answerFrame(p.slotID, h.accept(rival, p))); st != bad {
		t.Errorf("answer from the rival: %v", st)
	}
	a.register(p.agent)
	for name, env := range map[string]*agentpb.Envelope{"without a MAC": noMAC, "to another agent": wrongAgent, "bad signature": tampered} {
		if st := a.status(answerFrame(p.slotID, env)); st != bad {
			t.Errorf("answer %s: %v", name, st)
		}
	}
	if st := a.status(answerFrame(make([]byte, 16), accept)); st != agentpb.Status_STATUS_NOT_FOUND {
		t.Errorf("answer to an unknown slot: %v", st)
	}
	p.c.expectQuiet()

	if st := a.status(answerFrame(p.slotID, accept)); st != agentpb.Status_STATUS_OK {
		t.Fatalf("answer: %v", st)
	}
	answer := p.c.next().GetSlotAnswer()
	if answer == nil {
		t.Fatal("agent got no SlotAnswer")
	}
	got, pinned, err := agentproto.OpenPairingAccept(p.agent, agentproto.PairingBinding{
		Secret: p.secret, OfferHash: agentproto.OfferHash(p.offer),
	}, answer.Envelope, h.clock.now())
	if err != nil || got.AgentName != "workstation" || !bytes.Equal(pinned.SignPublicKey, approver.ID()) {
		t.Fatalf("open accept: %v %v", got, err)
	}
	p.c.expectClosed()
	if st := a.status(claimFrame(p.slotID)); st != agentpb.Status_STATUS_NOT_FOUND {
		t.Fatalf("claim after answer: %v", st)
	}
	// The agent now connects normally.
	h.connect(p.agent, agentpb.Role_ROLE_AGENT, authOptions{})
	if !strings.Contains(scrape(t, h), `cryptex_relay_slot_outcomes_total{outcome="answered"} 1`) {
		t.Error("answered slot not counted")
	}
}

func TestPairingExpiry(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	a, _ := h.connect(newIdentity(t), agentpb.Role_ROLE_APPROVER, authOptions{})

	t.Run("unclaimed", func(t *testing.T) {
		p := h.openSlot(nil)
		h.clock.advance(SlotLifetime)
		// Refused at once, even before the sweeper notices.
		if st := a.status(claimFrame(p.slotID)); st != agentpb.Status_STATUS_NOT_FOUND {
			t.Fatalf("claim after expiry: %v", st)
		}
		h.s.sweepMemory()
		p.c.expectError(agentpb.Status_STATUS_EXPIRED)
		p.c.expectClosed()
	})
	t.Run("claimed", func(t *testing.T) {
		p := h.openSlot(nil)
		h.clock.advance(2 * time.Minute)
		if a.call(claimFrame(p.slotID)).GetSlotOffer() == nil {
			t.Fatal("claim failed")
		}
		p.c.next()
		// The claim moved the deadline past the original one.
		h.clock.advance(2 * time.Minute)
		h.s.sweepMemory()
		p.c.expectQuiet()
		h.clock.advance(time.Minute)
		h.s.sweepMemory()
		p.c.expectError(agentpb.Status_STATUS_EXPIRED)
		p.c.expectClosed()
	})
}

func TestPairingSocketCloseDeletesSlot(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	a, _ := h.connect(newIdentity(t), agentpb.Role_ROLE_APPROVER, authOptions{})
	p := h.openSlot(nil)
	p.c.ws.CloseNow()
	h.waitFor("slot deleted", func() (gone bool) {
		h.locked(func() { gone = len(h.s.slots) == 0 && h.s.pairing == 0 })
		return gone
	})
	if st := a.status(claimFrame(p.slotID)); st != agentpb.Status_STATUS_NOT_FOUND {
		t.Fatalf("claim after close: %v", st)
	}
}

func TestPairingSocketRules(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	agent := newIdentity(t)
	good := makeOffer(t, agent)
	offerWith := func(mutate func(*agentpb.PairingOffer)) []byte {
		o := &agentpb.PairingOffer{ProtocolVersion: 1, SignPublicKey: agent.ID(), KemPublicKey: agent.KEMPublicKey()}
		mutate(o)
		raw, _ := proto.Marshal(o)
		return raw
	}
	cases := []struct {
		name   string
		frame  *agentpb.ClientFrame
		status agentpb.Status
	}{
		{"too large", openSlotFrame(offerWith(func(o *agentpb.PairingOffer) {
			o.Hostname = strings.Repeat("x", agentproto.MaxOfferSize)
		})), agentpb.Status_STATUS_TOO_LARGE},
		{"not an offer", openSlotFrame([]byte{0xff, 0xff}), agentpb.Status_STATUS_BAD_REQUEST},
		{"wrong version", openSlotFrame(offerWith(func(o *agentpb.PairingOffer) { o.ProtocolVersion = 2 })), agentpb.Status_STATUS_BAD_REQUEST},
		{"short KEM key", openSlotFrame(offerWith(func(o *agentpb.PairingOffer) { o.KemPublicKey = o.KemPublicKey[:32] })), agentpb.Status_STATUS_BAD_REQUEST},
		{"short sign key", openSlotFrame(offerWith(func(o *agentpb.PairingOffer) { o.SignPublicKey = o.SignPublicKey[:16] })), agentpb.Status_STATUS_BAD_REQUEST},
		{"Send", sendFrame(nil), agentpb.Status_STATUS_BAD_REQUEST},
		{"Auth", &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_Auth{Auth: &agentpb.Auth{}}}, agentpb.Status_STATUS_BAD_REQUEST},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := h.dial("/v1/pair", nil)
			c.next()
			c.write(tc.frame)
			c.expectError(tc.status)
			c.expectClosed()
		})
	}
	t.Run("second OpenSlot", func(t *testing.T) {
		c := h.dial("/v1/pair", nil)
		c.next()
		c.ping() // Ping is fine before and after
		c.write(openSlotFrame(good))
		if c.next().GetSlotOpened() == nil {
			t.Fatal("no slot")
		}
		c.ping()
		c.write(openSlotFrame(good))
		c.expectError(agentpb.Status_STATUS_BAD_REQUEST)
		c.expectClosed()
	})
	t.Run("no offer in time", func(t *testing.T) {
		c := h.dial("/v1/pair", nil)
		c.next()
		c.expectClosed()
	})
}

func TestPairingLimits(t *testing.T) {
	trustProxy := func(cfg *Config) { cfg.ClientIPHeader = "X-Forwarded-For" }

	t.Run("sockets per address", func(t *testing.T) {
		h := newHarness(t, AuthTicket, trustProxy)
		h.openSlot(forwardedFor("198.51.100.1"))
		h.openSlot(forwardedFor("198.51.100.1"))
		c := h.dial("/v1/pair", forwardedFor("198.51.100.1"))
		// Challenge first, as on every socket, then the refusal.
		c.expectChallenge()
		c.expectError(agentpb.Status_STATUS_RATE_LIMITED)
		c.expectClosed()
		h.openSlot(forwardedFor("198.51.100.2"))
	})
	t.Run("sockets per network", func(t *testing.T) {
		h := newHarness(t, AuthTicket, trustProxy)
		for i := range pairingSocketsPerNetwork / pairingSocketsPerIP {
			for range pairingSocketsPerIP {
				h.openSlot(forwardedFor(fmt.Sprintf("2001:db8:5:%x::1", i)))
			}
		}
		// A fresh /64 in the same /48 is refused, after the Challenge.
		c := h.dial("/v1/pair", forwardedFor("2001:db8:5:ff::1"))
		c.expectChallenge()
		if e := c.expectError(agentpb.Status_STATUS_RATE_LIMITED); !strings.Contains(e.Message, "network") {
			t.Fatalf("message %q", e.Message)
		}
		c.expectClosed()
		h.openSlot(forwardedFor("2001:db8:6::1"))
		// The same holds for an IPv4 /24.
		for i := range pairingSocketsPerNetwork / pairingSocketsPerIP {
			for range pairingSocketsPerIP {
				h.openSlot(forwardedFor(fmt.Sprintf("198.51.100.%d", i+1)))
			}
		}
		c = h.dial("/v1/pair", forwardedFor("198.51.100.200"))
		c.expectChallenge()
		c.expectError(agentpb.Status_STATUS_RATE_LIMITED)
		c.expectClosed()
		h.openSlot(forwardedFor("198.51.101.1"))
		if !strings.Contains(scrape(t, h), `cryptex_relay_rate_limited_total{bucket="pair_socket_network"} 2`) {
			t.Error("refused sockets not counted")
		}
	})
	t.Run("upgrades per address", func(t *testing.T) {
		h := newHarness(t, AuthTicket, trustProxy)
		get := func(ip string) int {
			t.Helper()
			req, err := http.NewRequest("GET", h.ts.URL+"/v1/pair", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("X-Forwarded-For", ip)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			return resp.StatusCode
		}
		for i := range pairUpgradesPerMinute {
			if st := get("198.51.100.7"); st == http.StatusTooManyRequests {
				t.Fatalf("limited after %d", i)
			}
		}
		// Refused before the upgrade, with no socket to hold.
		if st := get("198.51.100.7"); st != http.StatusTooManyRequests {
			t.Fatalf("over the limit: HTTP %d", st)
		}
		if c, st := h.tryDial("/v1/pair", forwardedFor("198.51.100.7")); c != nil || st != http.StatusTooManyRequests {
			t.Fatalf("WebSocket over the limit: HTTP %d", st)
		}
		h.openSlot(forwardedFor("198.51.100.8"))
		h.clock.advance(time.Minute)
		h.openSlot(forwardedFor("198.51.100.7"))
	})
	t.Run("slot openings per address", func(t *testing.T) {
		h := newHarness(t, AuthTicket, trustProxy)
		for range slotOpeningsPerIP {
			p := h.openSlot(forwardedFor("198.51.100.3"))
			p.c.ws.CloseNow()
			h.waitFor("socket released", func() (done bool) {
				h.locked(func() { done = h.s.pairing == 0 })
				return done
			})
		}
		c := h.dial("/v1/pair", forwardedFor("198.51.100.3"))
		c.next()
		c.write(openSlotFrame(makeOffer(t, newIdentity(t))))
		c.expectError(agentpb.Status_STATUS_RATE_LIMITED)
		c.expectClosed()
		// The window is ten minutes.
		h.clock.advance(10 * time.Minute)
		h.openSlot(forwardedFor("198.51.100.3"))
	})
	t.Run("global cap", func(t *testing.T) {
		h := newHarness(t, AuthTicket, func(cfg *Config) {
			trustProxy(cfg)
			cfg.MaxPairingSlots = 1
		})
		h.openSlot(forwardedFor("198.51.100.4"))
		c := h.dial("/v1/pair", forwardedFor("198.51.100.5"))
		c.expectChallenge()
		c.expectError(agentpb.Status_STATUS_UNAVAILABLE)
		c.expectClosed()
	})
}
