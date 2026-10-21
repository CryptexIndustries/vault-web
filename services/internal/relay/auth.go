package relay

import (
	"crypto/sha256"
	"crypto/subtle"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

// tokenSubject is the owner of every approver in token mode: one token is
// one owner.
const tokenSubject = "token"

func unauthorized(message string) *refusal {
	return refuse(agentpb.Status_STATUS_UNAUTHORIZED, message)
}

// authenticate checks Auth for the role the client claims and makes p the
// live connection for its key.
func (s *Server) authenticate(p *peer, auth *agentpb.Auth, nonce []byte) *refusal {
	role := auth.GetRole()
	if role != agentpb.Role_ROLE_AGENT && role != agentpb.Role_ROLE_APPROVER {
		return refuse(agentpb.Status_STATUS_BAD_REQUEST, "Auth must say whether this is an agent or an approver")
	}
	if !agentproto.VerifyAuth(auth.GetPublicKey(), s.origin, nonce, auth.GetSignature()) {
		return unauthorized("invalid Auth signature for " + s.origin)
	}
	if s.cfg.Auth == AuthToken && !s.tokenMatches(auth.GetToken()) {
		return unauthorized("wrong relay access token")
	}
	key := string(auth.GetPublicKey())
	var pass *Pass
	if role == agentpb.Role_ROLE_APPROVER && s.cfg.Auth == AuthTicket {
		if auth.GetPass() == "" {
			return unauthorized("a relay pass is required")
		}
		// Before taking the lock; ML-DSA is the slow part.
		var failure *refusal
		if pass, failure = s.verifyPass(auth.GetPass(), key); failure != nil {
			return failure
		}
	}
	failure, unknownAgent := s.admit(p, key, role, pass)
	if unknownAgent {
		return s.refuseUnknownAgent(key)
	}
	return failure
}

func (s *Server) tokenMatches(token string) bool {
	sum := sha256.Sum256([]byte(token))
	return subtle.ConstantTimeCompare(sum[:], s.tokenHash) == 1
}

// verifyPass checks a relay pass and that it was issued for key.
func (s *Server) verifyPass(raw, key string) (*Pass, *refusal) {
	pass, err := s.passes.verify(raw)
	if err != nil {
		return nil, unauthorized("invalid or expired relay pass")
	}
	if !pass.boundTo([]byte(key)) {
		return nil, unauthorized("the relay pass was issued for another device key")
	}
	return pass, nil
}

// admit records the client and makes p the live connection for key. It all
// happens under one lock, so nothing can be queued for the key between
// Ready and the backlog. unknownAgent reports an agent key with no
// registration.
func (s *Server) admit(p *peer, key string, role agentpb.Role, pass *Pass) (failure *refusal, unknownAgent bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var ready *agentpb.Ready
	if role == agentpb.Role_ROLE_AGENT {
		ag := s.agents[key]
		if ag == nil {
			return nil, true
		}
		now := s.now()
		if err := s.store.touchAgent(ag.key, now); err != nil {
			s.cfg.Logger.Error("update agent last seen", "error", err)
		}
		ag.lastSeenAt = now.UnixMilli()
		ready = &agentpb.Ready{Role: agentpb.Role_ROLE_AGENT}
	} else {
		a, failure := s.recordApproverLocked(key, pass)
		if failure != nil {
			return failure, false
		}
		ready = approverReady(a)
	}
	p.setRole(key, role)
	if old := s.conns[key]; old != nil {
		old.fail(agentpb.Status_STATUS_UNAVAILABLE, "connected elsewhere")
	}
	s.conns[key] = p
	p.send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Ready{Ready: ready}})
	s.deliverAllLocked(p)
	return nil, false
}

// refuseUnknownAgent tells a removed agent that it was revoked and anyone
// else that the relay doesn't know the key. The tombstone lookup runs
// without the lock, since any signed-in key can trigger it.
func (s *Server) refuseUnknownAgent(key string) *refusal {
	revoked, err := s.store.isRevoked([]byte(key))
	switch {
	case err != nil:
		return s.storeFailed("look up revoked agent", err)
	case revoked:
		return refuse(agentpb.Status_STATUS_REVOKED, "this agent was revoked")
	}
	return refuse(agentpb.Status_STATUS_NOT_FOUND, "this relay doesn't know this agent")
}

func approverReady(a *approver) *agentpb.Ready {
	ready := &agentpb.Ready{Role: agentpb.Role_ROLE_APPROVER}
	if a.row.passExpiresAt != 0 {
		ready.PassExpiresAt = a.row.passExpiresAt - passClockSkew.Milliseconds()
	}
	for agentKey := range a.agents {
		ready.Agents = append(ready.Agents, []byte(agentKey))
	}
	return ready
}

// recordApproverLocked creates or updates the approver for key from its
// pass (nil in token mode).
func (s *Server) recordApproverLocked(key string, pass *Pass) (*approver, *refusal) {
	if s.agents[key] != nil {
		return nil, unauthorized("this key is registered as an agent")
	}
	a := s.approvers[key]
	row := approverRow{key: []byte(key), sub: tokenSubject, createdAt: s.now().UnixMilli()}
	if pass != nil {
		row.sub = pass.Subject
		row.applyPass(pass)
	}
	if a != nil {
		if a.row.sub != row.sub {
			return nil, unauthorized("this key belongs to another account")
		}
		// Reconnecting with the same pass, or an older one, changes nothing.
		if row.passIssuedAt <= a.row.passIssuedAt {
			return a, nil
		}
		row.createdAt = a.row.createdAt
	}
	return s.saveApproverLocked(a, row, pass)
}

func (s *Server) renewPass(p *peer, raw string) *refusal {
	pass, failure := s.verifyPass(raw, p.key)
	if failure != nil {
		return failure
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a := s.approvers[p.key]
	if a == nil {
		return unauthorized("this approver is no longer registered")
	}
	if pass.Subject != a.row.sub {
		return unauthorized("the pass is for another account")
	}
	// An older pass replayed later must not shorten the expiry or bring back
	// an old limit.
	if pass.issuedAt().UnixMilli() <= a.row.passIssuedAt {
		return nil
	}
	row := a.row
	row.applyPass(pass)
	_, failure = s.saveApproverLocked(a, row, pass)
	return failure
}

func (r *approverRow) applyPass(pass *Pass) {
	r.dev = pass.Device
	r.passIssuedAt = pass.issuedAt().UnixMilli()
	r.passExpiresAt = pass.expiresAt().UnixMilli()
	r.agentLimit = pass.Limits.Agents
}

// saveApproverLocked writes row and updates a, or adds the approver when a
// is nil. With a pass, the key first takes over the pass's device.
func (s *Server) saveApproverLocked(a *approver, row approverRow, pass *Pass) (*approver, *refusal) {
	if pass != nil {
		if failure := s.claimDeviceLocked(string(row.key), pass); failure != nil {
			return nil, failure
		}
	}
	if err := s.store.putApprover(row); err != nil {
		return nil, s.storeFailed("store approver", err)
	}
	if a == nil {
		return s.addApproverLocked(row), nil
	}
	a.row = row
	return a, nil
}

// claimDeviceLocked makes key the only approver for the pass's device. A
// reinstalled app has a new key on the same device; the old key went with
// the old install, so its record goes too, and its agents are removed the
// way UnregisterAgent removes them (they were paired with the old key and
// can't reach the new one anyway). A pass no newer than the one the current
// key showed is refused, so an old install can't take the device back.
func (s *Server) claimDeviceLocked(key string, pass *Pass) *refusal {
	var replaced []string
	for otherKey, other := range s.subs[pass.Subject] {
		if otherKey == key || other.row.dev != pass.Device {
			continue
		}
		if pass.issuedAt().UnixMilli() <= other.row.passIssuedAt {
			return unauthorized("this device has a newer relay pass for another key")
		}
		replaced = append(replaced, otherKey)
	}
	for _, otherKey := range replaced {
		if err := s.removeApproverLocked(otherKey, revokedReplaced, "this device was set up again with a new key"); err != nil {
			return s.storeFailed("remove replaced approver", err)
		}
	}
	return nil
}
