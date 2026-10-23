package agent

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"sync"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agent/termsafe"
	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
)

const (
	// confirmLifetime is how long the retained PairingConfirm waits on the
	// relay for the approver; a little under the relay's limit.
	confirmLifetime = agentproto.MaxRetainLifetime - time.Minute
	// stableConnection is how long a relay connection must last before
	// reconnect delays start over.
	stableConnection = 30 * time.Second
)

// resultTimeout bounds the wait for the relay's Result to a resend or the
// PairingConfirm. The write has its own deadline, but a relay could keep
// the socket alive and never answer. A variable for tests.
var resultTimeout = 20 * time.Second

// errRevoked ends a connection attempt the relay refused as revoked.
var errRevoked = errors.New("the relay says this agent was revoked")

var errUnknownAgent = errors.New("the relay doesn't know this agent")

// errUnsaved ends a connection after a KeysUpdate that couldn't be saved.
// The relay delivers what wasn't acked again on the next connection, and
// the reconnect backoff paces the retries; meanwhile nothing is signed.
var errUnsaved = errors.New("couldn't save the new keys; trying again after reconnecting")

// clockWarning returns the warning for a relay whose clock is more than
// agentproto.ClockSkew from now: envelopes carry expiry times, and the other
// side refuses them past that.
func clockWarning(ch *agentpb.Challenge, now time.Time) (string, bool) {
	if ch.GetServerTime() == 0 {
		return "", false
	}
	offset := now.Sub(time.UnixMilli(ch.GetServerTime()))
	if offset.Abs() <= agentproto.ClockSkew {
		return "", false
	}
	return fmt.Sprintf("Your clock is off by about %d s; requests may be refused", int64(offset.Abs().Round(time.Second)/time.Second)), true
}

// clientOptions is how every cryptex-agent command dials the relay.
func clientOptions(httpClient *http.Client, version string) relayclient.Options {
	return relayclient.Options{HTTPClient: httpClient, UserAgent: "cryptex-agent/" + version}
}

// connectAgent opens /v1/connect as the agent st describes.
func connectAgent(ctx context.Context, st *State, id *agentproto.Identity, opts relayclient.Options) (*relayclient.Conn, error) {
	return relayclient.Connect(ctx, st.RelayURL, id, relayclient.Credentials{Role: agentpb.Role_ROLE_AGENT, Token: st.RelayToken}, opts)
}

// sealPairingConfirm seals the retained PairingConfirm, which tells the
// approver the agent saved its state.
func sealPairingConfirm(id *agentproto.Identity, approver agentproto.Peer, version string, now time.Time) (*agentpb.Envelope, error) {
	return agentproto.Seal(id, approver, &agentpb.Message{Body: &agentpb.Message_PairingConfirm{
		PairingConfirm: &agentpb.PairingConfirm{AgentVersion: version},
	}}, agentproto.SealOptions{ExpiresAt: now.Add(confirmLifetime), Retain: true})
}

func (s *Service) relayLoop(ctx context.Context) {
	backoff := relayclient.NewBackoff()
	var goneWait time.Duration
	unknown, lastGen := 0, -1
	for ctx.Err() == nil {
		s.mu.Lock()
		st, id, gen := s.st, s.id, s.gen
		if gen != lastGen {
			// A new pairing starts with a clean slate.
			goneWait, unknown, lastGen = 0, 0, gen
		}
		switch {
		case st == nil:
			s.noticeLocked("unpaired", slog.LevelWarn, "Not paired. Run cryptex-agent pair.")
		case st.Revoked:
			s.noticeLocked("revoked", slog.LevelWarn, "This agent was revoked. Run cryptex-agent pair to connect again.")
		}
		s.mu.Unlock()
		if st == nil {
			s.waitForPairingChange(ctx, gen, nil)
			continue
		}
		if st.Revoked || !st.GoneSince.IsZero() {
			// Only the relay said so, and nothing proves it: keep the keys
			// (unused) and ask again now and then, in case it was wrong,
			// but not forever.
			since := st.GoneSince
			if since.IsZero() {
				// Revoked in a state file from before GoneSince existed.
				s.markGone(gen)
				since = s.opts.Now()
			}
			left := s.opts.GiveUpAfter - s.opts.Now().Sub(since)
			if left <= 0 {
				s.notice("gave-up", slog.LevelWarn, "The relay has said for a week that this agent is gone; no longer asking. Run cryptex-agent pair to connect again.")
				// Look again daily, without asking the relay, in case the
				// clock was wrong.
				timer := time.NewTimer(maxGoneRetry)
				s.waitForPairingChange(ctx, gen, timer.C)
				timer.Stop()
				continue
			}
			goneWait = min(max(goneWait*2, s.opts.RevokedRetry), maxGoneRetry)
			wait := goneWait/2 + rand.N(goneWait/2+1)
			timer := time.NewTimer(min(wait, left))
			moved := s.waitForPairingChange(ctx, gen, timer.C)
			timer.Stop()
			if moved || ctx.Err() != nil || wait > left {
				continue
			}
		}

		started := time.Now()
		connected, err := s.connectOnce(ctx, st, id, gen)
		if ctx.Err() != nil {
			return
		}
		// Only a connection that held counts as recovered: two machines
		// sharing one identity replace each other on the relay, and must
		// not do so every second.
		if connected && time.Since(started) > stableConnection {
			backoff.Reset()
		}
		if connected {
			goneWait, unknown = 0, 0
		}
		s.mu.Lock()
		same := s.gen == gen
		s.mu.Unlock()
		if !same || errors.Is(err, errRevoked) {
			continue
		}
		if errors.Is(err, errUnknownAgent) {
			if unknown++; unknown >= unknownBeforeSlow {
				// From here on it waits on the slow schedule above.
				s.markGone(gen)
				s.notice("relay:"+err.Error(), slog.LevelWarn, "Relay connection failed", "relay", st.RelayURL, "error", err)
				continue
			}
		} else {
			// Only answers in a row count.
			unknown = 0
		}
		if err != nil {
			s.notice("relay:"+err.Error(), slog.LevelWarn, "Relay connection failed", "relay", st.RelayURL, "error", err)
		}
		timer := time.NewTimer(backoff.Next())
		s.waitForPairingChange(ctx, gen, timer.C)
		timer.Stop()
	}
}

// waitForPairingChange returns once the pairing moves past gen, ctx ends or
// timeout (nil for none) fires, and reports whether the pairing moved.
// Other state changes, such as new keys, don't end the wait.
func (s *Service) waitForPairingChange(ctx context.Context, gen int, timeout <-chan time.Time) (moved bool) {
	for {
		s.mu.Lock()
		moved, changed := s.gen != gen, s.changed
		s.mu.Unlock()
		if moved {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-timeout:
			return false
		case <-changed:
		}
	}
}

// connectOnce runs one relay connection until it ends or the pairing
// changes. connected reports whether the relay accepted us as an agent.
func (s *Service) connectOnce(ctx context.Context, st *State, id *agentproto.Identity, gen int) (connected bool, err error) {
	ctx, cancelCause := context.WithCancelCause(ctx)
	cancel := func() { cancelCause(nil) }
	defer cancel()
	// An unsaved KeysUpdate ends the connection from the inbound handler;
	// its error is this attempt's, so relayLoop backs off and reconnects
	// and the relay delivers the update again.
	defer func() {
		if cause := context.Cause(ctx); err == nil && errors.Is(cause, errUnsaved) {
			err = cause
		}
	}()
	// A new pairing ends this connection wherever it is, including in a
	// Send the relay never answers.
	go func() {
		if s.waitForPairingChange(ctx, gen, nil) {
			cancel()
		}
	}()
	conn, err := connectAgent(ctx, st, id, clientOptions(nil, s.opts.Version))
	if err != nil {
		switch {
		case relayclient.IsStatus(err, agentpb.Status_STATUS_REVOKED):
			s.markRevoked(gen)
			return false, errRevoked
		case relayclient.IsStatus(err, agentpb.Status_STATUS_NOT_FOUND):
			// No registration and no record of a revocation. Keep the keys
			// in case the relay lost data, and keep trying slowly.
			return false, fmt.Errorf("%w. If it was removed on %s, run cryptex-agent pair to connect again", errUnknownAgent, termsafe.Name(st.ApproverName))
		}
		return false, err
	}
	defer conn.Close()
	if conn.Ready().GetRole() != agentpb.Role_ROLE_AGENT {
		return false, fmt.Errorf("the relay accepted this agent as role %v", conn.Ready().GetRole())
	}
	s.checkClock(conn.Challenge())

	s.mu.Lock()
	if s.gen != gen {
		s.mu.Unlock()
		return true, nil
	}
	if s.st.Revoked || !s.st.GoneSince.IsZero() {
		// The relay that said this agent was revoked or unknown takes it
		// again.
		revoked, since := s.st.Revoked, s.st.GoneSince
		if err := s.updateLocked(func(st *State) { st.Revoked, st.GoneSince = false, time.Time{} }); err != nil {
			// Unsaved, a restart would bring the old date back: stay as
			// before and try again on the next connection.
			s.st.Revoked, s.st.GoneSince = revoked, since
			s.mu.Unlock()
			return true, fmt.Errorf("couldn't save the agent state: %w", err)
		}
		if revoked {
			s.log.Info("The relay accepts this agent again; serving its keys")
			s.signalLocked()
		}
	}
	confirmed := s.st.Confirmed
	s.noticeLocked("connected", slog.LevelInfo, "Connected to the relay", "relay", st.RelayURL)
	s.mu.Unlock()

	// Deliveries are handled from the start, during the PairingConfirm and
	// the resends too: what waits for this agent counts against the budget
	// the PairingConfirm needs, and only an Ack frees it.
	inbound := make(chan error, 1)
	stopped := make(chan struct{})
	progress := &inboundProgress{changed: make(chan struct{}), stopped: stopped}
	go func() {
		defer close(stopped)
		err := s.handleInbound(ctx, conn, id, gen, progress)
		if errors.Is(err, errUnsaved) {
			cancelCause(err)
		}
		inbound <- err
	}()
	defer func() {
		cancel()
		<-stopped
	}()

	// The approver ignores sign requests until the PairingConfirm, so it
	// goes out first. New requests wait for s.conn meanwhile and go out
	// with the resends below. If the relay doesn't take it, this attempt
	// ends here: relayLoop reconnects after a backoff and tries again, with
	// the requests still waiting.
	if !confirmed {
		approver := agentproto.Peer{SignPublicKey: st.ApproverSignKey, KEMPublicKey: st.ApproverKEMKey}
		if err := s.confirmOn(ctx, conn, gen, id, approver, progress); err != nil && ctx.Err() == nil {
			return true, fmt.Errorf("couldn't confirm the pairing: %w", err)
		}
	}
	if ctx.Err() != nil {
		return true, nil
	}
	s.mu.Lock()
	if s.gen != gen {
		s.mu.Unlock()
		return true, nil
	}
	s.conn = conn
	resend := s.pending.forResend()
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		if s.conn == conn {
			s.conn = nil
		}
		s.mu.Unlock()
	}()

	// Requests made while offline, or whose Send the last connection cut
	// off.
	for _, r := range resend {
		if ctx.Err() != nil {
			// The pairing changed or the service stops; the rest belongs
			// to whatever comes next.
			return true, nil
		}
		s.resend(ctx, conn, r)
	}

	select {
	case <-ctx.Done():
		return true, nil
	case err := <-inbound:
		return true, err
	}
}

// handleInbound handles Deliver and Revoked frames until the connection or
// ctx ends. A Revoked for this agent marks it, which moves the generation
// on and so ends the connection.
func (s *Service) handleInbound(ctx context.Context, conn *relayclient.Conn, id *agentproto.Identity, gen int, progress *inboundProgress) error {
	for {
		f, err := conn.Next(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return conn.Err()
		}
		switch fr := f.GetFrame().(type) {
		case *agentpb.ServerFrame_Deliver:
			err := s.handleDeliver(ctx, conn, fr.Deliver.GetEnvelope())
			progress.handled(true)
			if err != nil {
				return err
			}
		case *agentpb.ServerFrame_Revoked:
			if k := fr.Revoked.GetAgentKey(); len(k) == 0 || bytes.Equal(k, id.ID()) {
				s.markRevoked(gen)
				return nil
			}
			progress.handled(false)
		default:
			progress.handled(false)
		}
	}
}

// inboundProgress counts the frames handleInbound is done with, so setup
// can wait for those that arrived before a given point.
type inboundProgress struct {
	mu       sync.Mutex
	frames   uint64
	delivers int
	changed  chan struct{}
	stopped  <-chan struct{}
}

func (p *inboundProgress) handled(deliver bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.frames++
	if deliver {
		p.delivers++
	}
	close(p.changed)
	p.changed = make(chan struct{})
}

// waitFor waits until n frames are handled and returns how many of all
// handled so far were Delivers. ok is false if ctx or the handler ended
// first.
func (p *inboundProgress) waitFor(ctx context.Context, n uint64) (delivers int, ok bool) {
	for {
		p.mu.Lock()
		frames, delivers, changed := p.frames, p.delivers, p.changed
		p.mu.Unlock()
		if frames >= n {
			return delivers, true
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return 0, false
		case <-p.stopped:
			return 0, false
		}
	}
}

// checkClock warns once per service if the relay's clock and ours disagree.
func (s *Service) checkClock(ch *agentpb.Challenge) {
	msg, off := clockWarning(ch, s.opts.Now())
	if !off {
		return
	}
	s.mu.Lock()
	warned := s.clockWarned
	s.clockWarned = true
	s.mu.Unlock()
	if !warned {
		s.log.Warn(msg)
	}
}

// confirmOn sends the PairingConfirm. If the relay has no room for it,
// what waits for this agent may be what fills it: the refusal comes after
// everything the relay queued for us, so once those frames are handled,
// their Acks are ahead of one more try. With nothing delivered there is
// nothing to wait for, and the next connection tries again after the
// backoff.
func (s *Service) confirmOn(ctx context.Context, conn *relayclient.Conn, gen int, id *agentproto.Identity, approver agentproto.Peer, progress *inboundProgress) error {
	err := s.sendConfirm(ctx, conn, gen, id, approver)
	if !relayclient.IsStatus(err, agentpb.Status_STATUS_LIMIT_REACHED) && !relayclient.IsStatus(err, agentpb.Status_STATUS_UNAVAILABLE) {
		return err
	}
	waitCtx, cancel := context.WithTimeout(ctx, resultTimeout)
	delivers, ok := progress.waitFor(waitCtx, conn.Queued())
	cancel()
	if !ok || delivers == 0 {
		return err
	}
	return s.sendConfirm(ctx, conn, gen, id, approver)
}

// sendConfirm leaves the PairingConfirm for the pairing of generation gen,
// sealed with that pairing's identity and approver (the connection's own,
// not whatever is current by now).
// It returns an error if the relay didn't take it; nil also when the
// pairing moved on, which the caller sees from ctx and the generation.
func (s *Service) sendConfirm(ctx context.Context, conn *relayclient.Conn, gen int, id *agentproto.Identity, approver agentproto.Peer) error {
	s.mu.Lock()
	current := s.gen == gen && s.st != nil
	s.mu.Unlock()
	if !current || ctx.Err() != nil {
		return nil
	}
	env, err := sealPairingConfirm(id, approver, s.opts.Version, s.opts.Now())
	if err != nil {
		return err
	}
	sendCtx, cancel := context.WithTimeout(ctx, resultTimeout)
	err = conn.Send(sendCtx, env)
	cancel()
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.gen == gen && s.st != nil {
		if err := s.updateLocked(func(st *State) { st.Confirmed = true }); err != nil {
			s.log.Warn("Couldn't save the agent state", "error", err)
		}
	}
	return nil
}

// handleDeliver handles one envelope and Acks it, except a KeysUpdate that
// couldn't be saved, for which it returns errUnsaved.
func (s *Service) handleDeliver(ctx context.Context, conn *relayclient.Conn, env *agentpb.Envelope) error {
	h, err := agentproto.ParseHeader(env)
	if err != nil {
		return nil
	}
	// Ack whatever can't be used, now or later. What couldn't be saved yet
	// isn't acked, so the relay keeps it and delivers it again.
	ack := true
	defer func() {
		if ack {
			conn.Ack(ctx, h.MessageId)
		}
	}()

	now := s.opts.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.id == nil {
		return nil
	}
	opened, err := agentproto.Open(s.id, s.approver, env, now)
	if err != nil {
		s.log.Warn("Dropped an envelope that didn't verify", "error", err)
		return nil
	}
	if s.seenLocked(h, now) {
		return nil
	}
	switch body := opened.Message.GetBody().(type) {
	case *agentpb.Message_SignResponse:
		s.pending.answer(h.InReplyTo, body.SignResponse)
	case *agentpb.Message_KeysUpdate:
		if !s.applyKeysUpdateLocked(body.KeysUpdate) {
			ack = false
			return errUnsaved
		}
	}
	s.seen[string(h.MessageId)] = time.UnixMilli(h.ExpiresAt).Add(agentproto.ClockSkew)
	return nil
}

// seenLocked reports whether h's message ID was handled before, and
// forgets IDs whose envelopes expired. Only a handled envelope is
// remembered, so one that failed can come again.
func (s *Service) seenLocked(h *agentpb.EnvelopeHeader, now time.Time) bool {
	for k, exp := range s.seen {
		if now.After(exp) {
			delete(s.seen, k)
		}
	}
	_, dup := s.seen[string(h.MessageId)]
	return dup
}

// applyKeysUpdateLocked saves u and reports whether it is done with, saved
// or not needed. If the save fails the keys in memory stay as on disk, so
// the same update, delivered again, still applies.
func (s *Service) applyKeysUpdateLocked(u *agentpb.KeysUpdate) bool {
	if s.st == nil || s.st.Revoked {
		return true
	}
	if u.Revision <= s.st.KeysRevision {
		// Already here, maybe read from a write whose directory sync
		// failed, in this process or one before a restart; only acked
		// once a sync succeeds.
		return s.durableLocked()
	}
	keys := grantedKeys(u.Keys)
	st := s.st
	oldKeys, oldRevision, oldName := st.Keys, st.KeysRevision, st.AgentName
	err := s.updateLocked(func(st *State) {
		if u.Revision <= st.KeysRevision {
			return
		}
		st.Keys, st.KeysRevision = keys, u.Revision
		if u.AgentName != "" {
			st.AgentName = termsafe.Name(u.AgentName)
		}
	})
	if err != nil {
		st.Keys, st.KeysRevision, st.AgentName = oldKeys, oldRevision, oldName
		s.log.Warn("Couldn't save the new keys; the relay keeps them for the next connection", "error", err)
		return false
	}
	s.log.Info("Keys updated", "keys", len(keys), "revision", u.Revision)
	return true
}
