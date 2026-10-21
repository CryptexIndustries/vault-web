package relay

import (
	"crypto/ed25519"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

const passExpiredMessage = "the approving device's relay pass expired; open Cryptex Vault on it"

const (
	// registrationsPerMinute bounds RegisterAgent and, separately,
	// UnregisterAgent per approver key. Pairing registers one agent at a
	// time; the limit stops a client from churning rows and tombstones.
	registrationsPerMinute = 30
	// maxTombstonesPerApprover bounds the revoked_agents rows one approver
	// can leave behind; the oldest go first.
	maxTombstonesPerApprover = 1000
)

type approver struct {
	row    approverRow
	agents map[string]*agentRow
}

// passExpired reports whether routing for this approver has stopped. Token
// mode approvers never expire.
func (a *approver) passExpired(now time.Time) bool {
	return a.row.passExpiresAt != 0 && now.UnixMilli() >= a.row.passExpiresAt
}

func (s *Server) addApproverLocked(row approverRow) *approver {
	a := &approver{row: row, agents: map[string]*agentRow{}}
	key := string(row.key)
	s.approvers[key] = a
	if s.subs[row.sub] == nil {
		s.subs[row.sub] = map[string]*approver{}
	}
	s.subs[row.sub][key] = a
	return a
}

func (s *Server) registerAgent(p *peer, req *agentpb.RegisterAgent) *refusal {
	agentKey, revocationKey := req.GetAgentKey(), req.GetRevocationKey()
	if len(agentKey) != ed25519.PublicKeySize || len(revocationKey) != ed25519.PublicKeySize {
		return refuse(agentpb.Status_STATUS_BAD_REQUEST, "agent and revocation keys must be 32 bytes")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a := s.approvers[p.key]
	if a == nil {
		return unauthorized("this approver is no longer registered")
	}
	if a.passExpired(s.now()) {
		return refuse(agentpb.Status_STATUS_UNAVAILABLE, passExpiredMessage)
	}
	key := string(agentKey)
	if key == p.key || s.approvers[key] != nil {
		return refuse(agentpb.Status_STATUS_BAD_REQUEST, "that key is an approver")
	}
	row := agentRow{key: agentKey, approverKey: []byte(p.key), revocationKey: revocationKey}
	existing := s.agents[key]
	if existing != nil {
		if string(existing.approverKey) != p.key {
			return refuse(agentpb.Status_STATUS_ALREADY_CLAIMED, "the agent is registered to another approver")
		}
		// Registering again only updates the revocation key.
		row.createdAt, row.lastSeenAt = existing.createdAt, existing.lastSeenAt
	} else {
		if count, limit := s.agentCountLocked(a); count >= limit {
			return refuse(agentpb.Status_STATUS_LIMIT_REACHED, "the agent limit for this account is reached")
		}
		// lastSeenAt stays 0 until the agent authenticates.
		row.createdAt = s.now().UnixMilli()
	}
	if err := s.store.putAgent(row); err != nil {
		return s.storeFailed("store agent", err)
	}
	if existing != nil {
		existing.revocationKey = revocationKey
		return nil
	}
	s.agents[key] = &row
	a.agents[key] = &row
	return nil
}

// agentCountLocked returns how many agents count against a's limit and what
// the limit is. Ticket mode counts per account against the newest pass, and
// only under approvers whose pass is still valid: a lapsed device keeps its
// agents for the grace period but must not block a new one. Token mode
// counts the whole relay, because one token is one owner.
func (s *Server) agentCountLocked(a *approver) (count, limit int) {
	if s.cfg.Auth == AuthToken {
		return len(s.agents), s.cfg.MaxAgents
	}
	now := s.now()
	newest := a
	for _, other := range s.subs[a.row.sub] {
		if other.passExpired(now) {
			continue
		}
		count += len(other.agents)
		if other.row.passIssuedAt > newest.row.passIssuedAt {
			newest = other
		}
	}
	return count, newest.row.agentLimit
}

// unregister handles UnregisterAgent: an approver removes one of its agents,
// an agent removes itself.
func (s *Server) unregister(p *peer, id uint32, agentKey []byte) {
	source, notFound := revokedByApprover, "no such agent under this approver"
	if p.role == agentpb.Role_ROLE_AGENT {
		if len(agentKey) != 0 && string(agentKey) != p.key {
			p.result(id, agentpb.Status_STATUS_BAD_REQUEST, "an agent can only unregister itself")
			return
		}
		agentKey = []byte(p.key)
		source, notFound = revokedByAgent, "this agent is not registered"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ag := s.agents[string(agentKey)]
	if ag == nil || (p.role == agentpb.Role_ROLE_APPROVER && string(ag.approverKey) != p.key) {
		p.result(id, agentpb.Status_STATUS_NOT_FOUND, notFound)
		return
	}
	if err := s.store.deleteAgent(ag, s.now(), s.maxTombstones); err != nil {
		s.cfg.Logger.Error("delete agent", "error", err)
		p.result(id, agentpb.Status_STATUS_UNAVAILABLE, unavailableMessage)
		return
	}
	// The Result goes out before the Revoked notices.
	p.result(id, agentpb.Status_STATUS_OK, "")
	s.forgetAgentLocked(ag, source)
}

// forgetAgentLocked drops an agent from memory after its rows are gone,
// with its queues and what it sent, and tells the agent (closing it) and
// its approver. source labels the revokes metric.
func (s *Server) forgetAgentLocked(ag *agentRow, source string) {
	key := string(ag.key)
	approverKey := string(ag.approverKey)
	delete(s.agents, key)
	if a := s.approvers[approverKey]; a != nil {
		delete(a.agents, key)
	}
	s.dropMailboxLocked(key)
	if mb := s.mailboxes[approverKey]; mb != nil {
		mb.dropFrom(key)
	}
	revoked := &agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Revoked{Revoked: &agentpb.Revoked{AgentKey: ag.key}}}
	if conn := s.conns[key]; conn != nil {
		delete(s.conns, key)
		conn.end(revoked, "revoked")
	}
	if conn := s.conns[approverKey]; conn != nil {
		conn.send(revoked)
	}
	s.metrics.revoked(source)
}

// removeApproverLocked deletes an approver with all its agents: one whose
// pass lapsed long ago, or one replaced by a new key on the same device.
// source labels the revokes metric; message goes to the approver if online.
func (s *Server) removeApproverLocked(key, source, message string) error {
	a := s.approvers[key]
	if a == nil {
		return nil
	}
	if err := s.store.deleteApprover(a.row.key, s.now(), s.maxTombstones); err != nil {
		return err
	}
	for _, ag := range a.agents {
		s.forgetAgentLocked(ag, source)
	}
	delete(s.approvers, key)
	delete(s.subs[a.row.sub], key)
	if len(s.subs[a.row.sub]) == 0 {
		delete(s.subs, a.row.sub)
	}
	s.dropMailboxLocked(key)
	if conn := s.conns[key]; conn != nil {
		delete(s.conns, key)
		conn.fail(agentpb.Status_STATUS_UNAUTHORIZED, message)
	}
	return nil
}
