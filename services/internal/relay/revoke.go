package relay

import (
	"bytes"
	"crypto/ed25519"
	"io"
	"mime"
	"net/http"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

const (
	revokesPerMinute = 30
	revokeBodyLimit  = 1 << 10
	// revokeWindow is how far a RevokeRequest's issued_at may be from the
	// relay clock.
	revokeWindow = 5 * time.Minute
)

// handleRevokePreflight lets the web approver post from its own origin. No
// cookies are involved, so any origin may.
func (s *Server) handleRevokePreflight(w http.ResponseWriter, _ *http.Request) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "POST")
	h.Set("Access-Control-Allow-Headers", "Content-Type")
	h.Set("Access-Control-Max-Age", "600")
	w.WriteHeader(http.StatusNoContent)
}

// handleRevoke removes an agent on the word of its revocation key, which any
// device holding the vault has. The agent and the approver don't need to be
// online.
func (s *Server) handleRevoke(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	status := s.revoke(r)
	s.metrics.revokeRequest(status)
	s.cfg.Logger.Info("request", "method", r.Method, "route", "/v1/revoke", "status", status)
	if status == http.StatusNoContent {
		w.WriteHeader(status)
		return
	}
	http.Error(w, http.StatusText(status), status)
}

// revoke returns the HTTP status for a revoke request.
func (s *Server) revoke(r *http.Request) int {
	if !s.revokeLimiter.Allow(s.clientIP(r), revokesPerMinute) {
		s.metrics.limited(bucketRevoke)
		return http.StatusTooManyRequests
	}
	if mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mediaType != "application/x-protobuf" {
		return http.StatusBadRequest
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, revokeBodyLimit+1))
	if err != nil || len(body) > revokeBodyLimit {
		return http.StatusBadRequest
	}
	var req agentpb.RevokeRequest
	if err := proto.Unmarshal(body, &req); err != nil || len(req.GetAgentKey()) != ed25519.PublicKeySize {
		return http.StatusBadRequest
	}

	// The signature check runs without the lock, against the key as it was.
	revocationKey := s.revocationKey(req.GetAgentKey())
	if revocationKey == nil {
		return http.StatusNotFound
	}
	issued := time.UnixMilli(req.GetIssuedAt())
	if d := s.now().Sub(issued); d > revokeWindow || d < -revokeWindow {
		return http.StatusForbidden
	}
	if !agentproto.VerifyRevoke(revocationKey, s.origin, &req) {
		return http.StatusForbidden
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	// Check the key again: a concurrent RegisterAgent may have rotated it.
	ag := s.agents[string(req.GetAgentKey())]
	if ag == nil || !bytes.Equal(ag.revocationKey, revocationKey) {
		return http.StatusNotFound
	}
	if err := s.store.deleteAgent(ag, s.now(), s.maxTombstones); err != nil {
		s.cfg.Logger.Error("delete agent", "error", err)
		return http.StatusInternalServerError
	}
	s.forgetAgentLocked(ag, revokedByKey)
	return http.StatusNoContent
}

// revocationKey returns the registered agent's revocation key, or nil.
func (s *Server) revocationKey(agentKey []byte) []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ag := s.agents[string(agentKey)]; ag != nil {
		return ag.revocationKey
	}
	return nil
}
