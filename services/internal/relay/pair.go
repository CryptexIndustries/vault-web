package relay

import (
	"errors"
	"net/http"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

const (
	// SlotLifetime is how long a pairing slot waits to be scanned, and then
	// again to be answered once claimed.
	SlotLifetime = 3 * time.Minute

	// Pairing is unauthenticated, so each address gets few sockets and few
	// slots. Pairing an agent takes one of each. The network cap (an IPv6
	// /48 or IPv4 /24) stops a holder of many addresses from taking every
	// slot on the relay.
	pairingSocketsPerIP      = 2
	pairingSocketsPerNetwork = 16
	slotOpeningsPerIP        = 10
	slotOpeningWindow        = 10 * time.Minute
	// pairUpgradesPerMinute bounds /v1/pair upgrades per address before
	// any of the above runs, so refused sockets aren't free either.
	pairUpgradesPerMinute = 20
	slotIDSize            = 16
	pairingMACSize        = 32
)

// slot is one pairing offer, alive as long as the agent's /v1/pair socket.
type slot struct {
	id        string
	offer     []byte
	agentKey  string
	peer      *peer
	expiresAt time.Time
	// claimedBy is the approver key that scanned the code first.
	claimedBy string
}

func (s *Server) handlePair(w http.ResponseWriter, r *http.Request) {
	ip := s.clientIP(r)
	if !s.pairConnectLimiter.Allow(ip, pairUpgradesPerMinute) {
		s.metrics.limited(bucketPairConnect)
		http.Error(w, "too many pairing connections; try again later", http.StatusTooManyRequests)
		return
	}
	if !s.enter() {
		http.Error(w, "the relay is shutting down", http.StatusServiceUnavailable)
		return
	}
	defer s.wg.Done()
	ws := s.accept(w, r, preAuthReadLimit)
	if ws == nil {
		return
	}
	p := s.newPeer(ws, ip, labelPairing)
	s.metrics.connected(labelPairing)
	defer p.finish()
	start := time.Now()
	reason := s.servePair(p)
	s.cfg.Logger.Info("connection closed", "endpoint", "pair", "reason", reason,
		"duration_ms", time.Since(start).Milliseconds())
}

// servePair runs one /v1/pair session and returns why it ended, for the log.
func (s *Server) servePair(p *peer) string {
	// Challenge comes first on every socket, so a client reads a refusal the
	// same way as any other frame.
	p.sendChallenge()
	if failure := s.admitPairing(p.ip); failure != nil {
		p.fail(failure.status, failure.message)
		return statusLabel(failure.status)
	}
	defer s.releasePairing(p)

	deadline := time.Now().Add(s.authTimeout)
	for {
		timeout := s.idleTimeout()
		if p.slot == nil {
			timeout = time.Until(deadline)
		}
		f, err := p.read(timeout)
		if err != nil {
			if errors.Is(err, errBadFrame) {
				p.fail(agentpb.Status_STATUS_BAD_REQUEST, "expected a binary ClientFrame")
				return "bad_frame"
			}
			if p.slot == nil {
				return "no_offer"
			}
			return "closed"
		}
		if p.ending.Load() {
			continue
		}
		switch frame := f.GetFrame().(type) {
		case *agentpb.ClientFrame_Ping:
			p.pong()
		case *agentpb.ClientFrame_OpenSlot:
			if p.slot != nil {
				p.fail(agentpb.Status_STATUS_BAD_REQUEST, "this socket already has a pairing slot")
				return "bad_frame"
			}
			if failure := s.openSlot(p, frame.OpenSlot.GetOffer()); failure != nil {
				p.fail(failure.status, failure.message)
				return statusLabel(failure.status)
			}
		default:
			p.fail(agentpb.Status_STATUS_BAD_REQUEST, "only OpenSlot and Ping are allowed here")
			return "bad_frame"
		}
	}
}

func (s *Server) admitPairing(ip string) *refusal {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pairing >= s.cfg.MaxPairingSlots {
		return refuse(agentpb.Status_STATUS_UNAVAILABLE, "the relay has too many pairing codes open; try again in a few minutes")
	}
	switch s.pairingBy.admit(ip, pairingSocketsPerIP, pairingSocketsPerNetwork) {
	case nil:
	case errNetwork:
		s.metrics.limited(bucketPairSocketNetwork)
		return refuse(agentpb.Status_STATUS_RATE_LIMITED, "too many pairing codes open from this network")
	default:
		s.metrics.limited(bucketPairSocket)
		return refuse(agentpb.Status_STATUS_RATE_LIMITED, "too many pairing codes open from this address")
	}
	s.pairing++
	return nil
}

// releasePairing runs when the socket closes; its slot goes with it.
func (s *Server) releasePairing(p *peer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pairing--
	s.pairingBy.release(p.ip)
	if p.slot != nil && s.slots[p.slot.id] == p.slot {
		s.endSlotLocked(p.slot, slotClosed)
	}
}

func (s *Server) openSlot(p *peer, offer []byte) *refusal {
	if !s.pairLimiter.Allow(p.ip, slotOpeningsPerIP) {
		s.metrics.limited(bucketOpenSlot)
		return refuse(agentpb.Status_STATUS_RATE_LIMITED, "too many pairing codes from this address; wait a few minutes")
	}
	if len(offer) > agentproto.MaxOfferSize {
		return refuse(agentpb.Status_STATUS_TOO_LARGE, "the pairing offer is too large")
	}
	parsed, err := agentproto.ParseOffer(offer, agentproto.OfferHash(offer))
	if err != nil {
		return refuse(agentpb.Status_STATUS_BAD_REQUEST, "invalid pairing offer")
	}
	sl := &slot{
		id:        string(randomBytes(slotIDSize)),
		offer:     offer,
		agentKey:  string(parsed.SignPublicKey),
		peer:      p,
		expiresAt: s.now().Add(SlotLifetime),
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.slots[sl.id] = sl
	p.slot = sl
	s.metrics.slotOpened()
	p.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_SlotOpened{SlotOpened: &agentpb.SlotOpened{
		SlotId: []byte(sl.id), ExpiresAt: sl.expiresAt.UnixMilli(),
	}}})
	return nil
}

// endSlotLocked deletes a slot; outcome labels the metric.
func (s *Server) endSlotLocked(sl *slot, outcome string) {
	delete(s.slots, sl.id)
	s.metrics.slotEnded(outcome)
}

// expireSlotsLocked ends slots whose deadline passed and closes their
// sockets.
func (s *Server) expireSlotsLocked(now time.Time) {
	for _, sl := range s.slots {
		if !now.Before(sl.expiresAt) {
			s.endSlotLocked(sl, slotExpired)
			sl.peer.fail(agentpb.Status_STATUS_EXPIRED, "the pairing code expired")
		}
	}
}

// liveSlotLocked returns the slot if it exists and its deadline hasn't
// passed (the sweeper may not have run yet).
func (s *Server) liveSlotLocked(id []byte) *slot {
	sl := s.slots[string(id)]
	if sl == nil || !s.now().Before(sl.expiresAt) {
		return nil
	}
	return sl
}

// claimSlot answers with SlotOffer itself; a returned refusal becomes a
// Result.
func (s *Server) claimSlot(p *peer, id uint32, slotID []byte) *refusal {
	s.mu.Lock()
	defer s.mu.Unlock()
	if a := s.approvers[p.key]; a == nil || a.passExpired(s.now()) {
		return refuse(agentpb.Status_STATUS_UNAVAILABLE, passExpiredMessage)
	}
	sl := s.liveSlotLocked(slotID)
	if sl == nil {
		return refuse(agentpb.Status_STATUS_NOT_FOUND, "the pairing code expired or was already used")
	}
	if sl.claimedBy != "" && sl.claimedBy != p.key {
		return refuse(agentpb.Status_STATUS_ALREADY_CLAIMED, "another device already scanned this pairing code")
	}
	if sl.claimedBy == "" {
		sl.claimedBy = p.key
		sl.expiresAt = s.now().Add(SlotLifetime)
		sl.peer.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_SlotClaimed{SlotClaimed: &agentpb.SlotClaimed{
			ExpiresAt: sl.expiresAt.UnixMilli(),
		}}})
	}
	p.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_SlotOffer{SlotOffer: &agentpb.SlotOffer{
		Id: id, Offer: sl.offer, ExpiresAt: sl.expiresAt.UnixMilli(),
	}}})
	return nil
}

func (s *Server) answerSlot(p *peer, req *agentpb.AnswerSlot) *refusal {
	env := req.GetEnvelope()
	h, failure := s.checkEnvelope(env, p.key)
	if failure != nil {
		// The approver built this envelope a moment ago; any problem with it
		// is a bad request, expiry included.
		return refuse(agentpb.Status_STATUS_BAD_REQUEST, failure.message)
	}
	if len(env.GetPairingMac()) != pairingMACSize {
		return refuse(agentpb.Status_STATUS_BAD_REQUEST, "the pairing answer needs a pairing MAC")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sl := s.liveSlotLocked(req.GetSlotId())
	if sl == nil {
		return refuse(agentpb.Status_STATUS_NOT_FOUND, "the pairing code expired or was already used")
	}
	if sl.claimedBy != p.key {
		return refuse(agentpb.Status_STATUS_BAD_REQUEST, "claim the pairing slot first")
	}
	if string(h.Recipient) != sl.agentKey {
		return refuse(agentpb.Status_STATUS_BAD_REQUEST, "the answer is not addressed to this agent")
	}
	if ag := s.agents[sl.agentKey]; ag == nil || string(ag.approverKey) != p.key {
		return refuse(agentpb.Status_STATUS_BAD_REQUEST, "register the agent before answering")
	}
	s.endSlotLocked(sl, slotAnswered)
	sl.peer.end(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_SlotAnswer{SlotAnswer: &agentpb.SlotAnswer{
		Envelope: env,
	}}}, "paired")
	return nil
}
