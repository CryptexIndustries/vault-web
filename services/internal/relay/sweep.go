package relay

import (
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/serverkit"
)

const (
	// memorySweepEvery drives slot deadlines and queue expiry, which are
	// cheap in-memory scans. The database sweep runs less often.
	memorySweepEvery = time.Second
	storeSweepEvery  = time.Minute
	// tombstoneLifetime is how long a revoked agent's key is remembered, so
	// the agent hears "revoked" rather than "unknown" when it reconnects.
	tombstoneLifetime = 90 * 24 * time.Hour
)

func (s *Server) runSweepers() {
	defer close(s.sweeperDone)
	fast := time.NewTicker(memorySweepEvery)
	defer fast.Stop()
	slow := time.NewTicker(storeSweepEvery)
	defer slow.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-fast.C:
			s.sweepMemory()
		case <-slow.C:
			err := s.sweepStore()
			if err != nil {
				s.cfg.Logger.Error("sweep failed", "error", err)
			}
			s.metrics.swept(err)
			for _, l := range []*serverkit.RateLimiter{s.connectLimiter, s.pairConnectLimiter, s.pairLimiter,
				s.revokeLimiter, s.registerLimiter, s.unregisterLimiter} {
				l.Prune()
			}
		}
	}
}

// sweepMemory expires pairing slots and queued envelopes.
func (s *Server) sweepMemory() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	s.expireSlotsLocked(now)
	s.metrics.expiredEnvelopes(s.expireMailboxesLocked(now))
}

// sweepStore deletes expired retained envelopes, old tombstones, and
// approvers whose last pass expired more than the grace period ago, with
// their agents. Routing for them stopped when the pass expired; the grace
// period only lets a device that stayed locked for a while resume without
// pairing every agent again.
func (s *Server) sweepStore() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	if err := s.store.sweepRetained(now); err != nil {
		return err
	}
	if err := s.store.sweepTombstones(now.Add(-tombstoneLifetime)); err != nil {
		return err
	}
	cutoff := now.Add(-s.cfg.RegistrationGrace).UnixMilli()
	for key, a := range s.approvers {
		if a.row.passExpiresAt == 0 || a.row.passExpiresAt > cutoff {
			continue
		}
		if err := s.removeApproverLocked(key, revokedPassExpired, "the relay pass expired"); err != nil {
			return err
		}
	}
	return nil
}
