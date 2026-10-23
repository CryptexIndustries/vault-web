package relay

import (
	"errors"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

// send queues an envelope from p and delivers it if the recipient is online.
func (s *Server) send(p *peer, env *agentpb.Envelope) *refusal {
	h, failure := s.checkEnvelope(env, p.key)
	if failure != nil {
		return failure
	}
	if len(env.GetPairingMac()) != 0 {
		return refuse(agentpb.Status_STATUS_BAD_REQUEST, "pairing envelopes go through AnswerSlot")
	}
	recipient := string(h.Recipient)
	e := &entry{
		env: env, sender: p.key, messageID: string(h.MessageId),
		dropAt: time.UnixMilli(h.ExpiresAt).Add(agentproto.ClockSkew), retained: h.Retain, size: proto.Size(env),
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	approverKey, failure := s.routeLocked(p.key, p.role, recipient)
	if failure != nil {
		return failure
	}
	e.account = s.accountLocked(approverKey)
	mb := s.mailboxLocked(recipient)
	if mb.has(e.messageID) {
		return refuse(agentpb.Status_STATUS_BAD_REQUEST, "duplicate message ID")
	}
	if !e.retained && mb.seenFrom[e.sender] >= maxSeen {
		// Expired IDs may free room ahead of the sweeper.
		s.metrics.expiredEnvelopes(mb.expire(s.now()))
	}
	freed, failure := mb.room(e, s.retainedCapLocked(recipient), s.queuedCapLocked(recipient))
	if failure != nil {
		return failure
	}
	grow := int64(e.size) - int64(freed)
	if s.budget.accounts[e.account]+grow > s.cfg.MaxAccountQueueBytes {
		return refuse(agentpb.Status_STATUS_LIMIT_REACHED, "this account has too many messages waiting; try again later")
	}
	if s.budget.total+grow > s.cfg.MaxQueueBytes {
		return refuse(agentpb.Status_STATUS_UNAVAILABLE, "the relay is holding too many messages; try again later")
	}
	if e.retained {
		if failure := s.storeRetained(e, h); failure != nil {
			return failure
		}
	}
	mb.put(e)
	if to := s.conns[recipient]; to != nil {
		to.deliverLocked([]*entry{e})
	}
	return nil
}

// approverOfLocked returns the approver key behind key, an approver or an
// agent, or "" for neither.
func (s *Server) approverOfLocked(key string) string {
	if s.approvers[key] != nil {
		return key
	}
	if ag := s.agents[key]; ag != nil {
		return string(ag.approverKey)
	}
	return ""
}

// accountLocked names the budget an approver's envelopes, both ways, count
// against: its pass subject in ticket mode. In token mode every approver
// has the same owner, but each still gets its own budget, so one buggy
// client can't take the whole relay.
func (s *Server) accountLocked(approverKey string) string {
	if a := s.approvers[approverKey]; a != nil && s.cfg.Auth == AuthTicket {
		return "sub:" + a.row.sub
	}
	return "key:" + approverKey
}

// checkEnvelope validates an envelope the way every recipient will, so
// forgeries and junk never get queued.
func (s *Server) checkEnvelope(env *agentpb.Envelope, sender string) (*agentpb.EnvelopeHeader, *refusal) {
	if env == nil {
		return nil, refuse(agentpb.Status_STATUS_BAD_REQUEST, "missing envelope")
	}
	if proto.Size(env) > agentproto.MaxEnvelopeSize {
		return nil, refuse(agentpb.Status_STATUS_TOO_LARGE, "the envelope is too large")
	}
	h, err := agentproto.ParseHeader(env)
	if err != nil {
		return nil, refuse(agentpb.Status_STATUS_BAD_REQUEST, "invalid envelope header")
	}
	if string(h.Sender) != sender {
		return nil, refuse(agentpb.Status_STATUS_BAD_REQUEST, "the envelope sender is not this connection")
	}
	if !agentproto.VerifySignature(env, h) {
		return nil, refuse(agentpb.Status_STATUS_BAD_REQUEST, "invalid envelope signature")
	}
	if err := agentproto.CheckExpiry(h, s.now()); err != nil {
		if errors.Is(err, agentproto.ErrExpired) {
			return nil, refuse(agentpb.Status_STATUS_EXPIRED, "the envelope expired")
		}
		return nil, refuse(agentpb.Status_STATUS_BAD_REQUEST, "the envelope expiry is too far out")
	}
	return h, nil
}

// routeLocked checks that sender may reach recipient: an agent only its
// approver, an approver only its own agents. It returns the approver's key.
func (s *Server) routeLocked(sender string, role agentpb.Role, recipient string) (string, *refusal) {
	notFound := refuse(agentpb.Status_STATUS_NOT_FOUND, "unknown recipient")
	var approverKey string
	switch role {
	case agentpb.Role_ROLE_AGENT:
		ag := s.agents[sender]
		if ag == nil {
			return "", refuse(agentpb.Status_STATUS_REVOKED, "this agent is no longer registered")
		}
		if string(ag.approverKey) != recipient {
			return "", notFound
		}
		approverKey = recipient
	case agentpb.Role_ROLE_APPROVER:
		if a := s.approvers[sender]; a == nil || a.agents[recipient] == nil {
			return "", notFound
		}
		approverKey = sender
	default:
		return "", notFound
	}
	a := s.approvers[approverKey]
	if a == nil {
		return "", notFound
	}
	if a.passExpired(s.now()) {
		return "", refuse(agentpb.Status_STATUS_UNAVAILABLE, passExpiredMessage)
	}
	return approverKey, nil
}

// retainedCapLocked is how many retained envelopes recipient may hold: one
// per sender that can reach it, so an approver's agents and an agent's
// approver. Replacement per sender keeps it there already; the cap makes
// sure a slip elsewhere can't let one recipient pile up rows.
func (s *Server) retainedCapLocked(recipient string) int {
	if a := s.approvers[recipient]; a != nil {
		return len(a.agents)
	}
	return 1
}

// queuedCapLocked is how many non-retained envelopes recipient may hold.
func (s *Server) queuedCapLocked(recipient string) int {
	if ag := s.agents[recipient]; ag != nil && !ag.authenticated() {
		return maxQueuedUnseen
	}
	return maxQueued
}

// storeRetained writes a retained envelope, replacing the sender's older
// row, and records the row ID in e.
func (s *Server) storeRetained(e *entry, h *agentpb.EnvelopeHeader) *refusal {
	raw, err := proto.Marshal(e.env)
	if err != nil {
		return refuse(agentpb.Status_STATUS_BAD_REQUEST, "invalid envelope")
	}
	id, err := s.store.putRetained(retainedRow{
		recipient: h.Recipient, sender: h.Sender, messageID: h.MessageId,
		envelope: raw, expiresAt: e.dropAt.UnixMilli(),
	})
	if err != nil {
		return s.storeFailed("store retained envelope", err)
	}
	e.dbID = id
	return nil
}

// ack removes a delivered envelope from p's mailbox.
func (s *Server) ack(p *peer, messageID []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	mb := s.mailboxes[p.key]
	if mb == nil {
		return
	}
	e := mb.find(string(messageID))
	if e == nil {
		return
	}
	if e.retained {
		if err := s.store.deleteRetained(e.dbID, []byte(p.key), []byte(e.messageID)); err != nil {
			// Keep it: an envelope that comes back after a restart beats one
			// that is gone from memory but not from disk.
			s.cfg.Logger.Error("delete retained envelope", "error", err)
			return
		}
	}
	mb.remove(e)
}
