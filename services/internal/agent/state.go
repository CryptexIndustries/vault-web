package agent

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

// The service keeps state.json in step with `pair` and `unpair`, which
// rewrite it from another process, and saves its own changes (keys, the
// confirmation, a revocation) without undoing theirs.

func (s *Service) pollState(ctx context.Context) {
	t := time.NewTicker(s.opts.PollInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		if err := s.reload(); err != nil {
			s.notice("state", slog.LevelWarn, "Can't read the agent state", "error", err)
		}
	}
}

// reload picks up changes `pair` and `unpair` made to state.json.
func (s *Service) reload() error {
	raw, err := s.store.readState()
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if bytes.Equal(raw, s.raw) && (raw == nil) == (s.raw == nil) && s.gen > 0 {
		return nil
	}
	return s.applyLocked(raw)
}

// applyLocked makes raw (state.json's contents) the current state.
func (s *Service) applyLocked(raw []byte) error {
	st, err := parseState(raw)
	if err != nil {
		return err
	}
	var id *agentproto.Identity
	if st != nil {
		if id, err = agentproto.IdentityFromSeeds(st.SignSeed, st.KEMSeed); err != nil {
			return fmt.Errorf("state.json: %w", err)
		}
	}
	old := s.st
	s.raw, s.st, s.id = raw, st, id
	if st != nil {
		s.approver = agentproto.Peer{SignPublicKey: st.ApproverSignKey, KEMPublicKey: st.ApproverKEMKey}
	}
	if s.gen == 0 || connectionChanged(old, st) {
		s.newGenerationLocked(errors.New("the pairing changed"))
	}
	s.signalLocked()
	return nil
}

func connectionChanged(a, b *State) bool {
	if (a == nil) != (b == nil) {
		return true
	}
	if a == nil {
		return false
	}
	return !bytes.Equal(a.SignSeed, b.SignSeed) || a.RelayURL != b.RelayURL || a.RelayToken != b.RelayToken ||
		!bytes.Equal(a.ApproverSignKey, b.ApproverSignKey) || a.Revoked != b.Revoked
}

// newGenerationLocked starts over after the pairing changed: the relay
// connection of the old one ends, and its requests fail with err.
func (s *Service) newGenerationLocked(err error) {
	s.gen++
	s.pending.failAll(err)
}

// signalLocked wakes everything waiting on s.changed.
func (s *Service) signalLocked() {
	close(s.changed)
	s.changed = make(chan struct{})
}

// updateLocked applies change to the state and saves it. change may run
// twice: on the state in memory and on a newer copy from disk.
func (s *Service) updateLocked(change func(*State)) error {
	if s.st == nil {
		return nil
	}
	change(s.st)
	unlock, err := s.store.lock()
	if err != nil {
		return err
	}
	defer unlock()
	current, err := s.store.readState()
	if err != nil {
		return err
	}
	if bytes.Equal(current, s.raw) {
		raw, err := s.store.writeState(s.st)
		if err != nil {
			return err
		}
		s.raw = raw
		return nil
	}
	// `pair` rewrote the file since we read it (it sets Confirmed), or
	// `pair --force` or `unpair` replaced or deleted it.
	disk, err := parseState(current)
	if err != nil || disk == nil || !bytes.Equal(disk.SignSeed, s.st.SignSeed) {
		// Another pairing or none: writing ours back would resurrect what
		// they replaced. The next reload takes their version.
		s.log.Debug("Dropped a state change; state.json now holds another pairing or none")
		return nil
	}
	// Same identity: keep both changes.
	change(disk)
	raw, err := s.store.writeState(disk)
	if err != nil {
		return err
	}
	return s.applyLocked(raw)
}

// durableLocked syncs the data directory and reports whether state.json as
// it is now survives a crash. It always syncs: state read at startup or on
// a reload may come from a write whose sync failed in an earlier process.
func (s *Service) durableLocked() bool {
	if err := s.store.syncDir(); err != nil {
		s.log.Warn("Couldn't make the agent state safe from a crash", "error", err)
		return false
	}
	return true
}

// markRevoked records that the relay says this agent was revoked. The keys
// stay on disk: a Revoked frame and STATUS_REVOKED aren't signed by the
// approver, so a relay could say so falsely, and relayLoop asks again later.
func (s *Service) markRevoked(gen int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.gen != gen || s.st == nil || s.st.Revoked {
		return
	}
	now := s.opts.Now()
	if err := s.updateLocked(func(st *State) {
		st.Revoked = true
		if st.GoneSince.IsZero() {
			st.GoneSince = now
		}
	}); err != nil {
		s.log.Warn("Couldn't save the agent state", "error", err)
	}
	s.newGenerationLocked(errors.New("this agent was revoked"))
	s.signalLocked()
}

// markGone records when the relay began calling this agent unknown, for
// relayLoop's deadline.
func (s *Service) markGone(gen int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.gen != gen || s.st == nil || !s.st.GoneSince.IsZero() {
		return
	}
	now := s.opts.Now()
	if err := s.updateLocked(func(st *State) { st.GoneSince = now }); err != nil {
		s.log.Warn("Couldn't save the agent state", "error", err)
	}
}
