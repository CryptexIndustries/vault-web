package relay

import (
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

// connectsPerMinute bounds /v1/connect upgrades per client address. Each one
// costs signature checks, and agents reconnect with backoff, so honest
// clients stay far below it even behind a shared address.
const connectsPerMinute = 120

func (s *Server) handleConnect(w http.ResponseWriter, r *http.Request) {
	ip := s.clientIP(r)
	if !s.connectLimiter.Allow(ip, connectsPerMinute) {
		s.metrics.limited(bucketConnect)
		http.Error(w, "too many connections; try again later", http.StatusTooManyRequests)
		return
	}
	if !s.enter() {
		http.Error(w, "the relay is shutting down", http.StatusServiceUnavailable)
		return
	}
	defer s.wg.Done()
	// Unauthenticated sockets cost a goroutine and buffers each while they
	// wait up to authTimeout, so their number is capped before upgrading:
	// on the whole relay, and per address and network so that one client
	// can't hold all of them.
	switch err := s.admitPending(ip); err {
	case nil:
	case errFull:
		s.metrics.limited(bucketConnectPending)
		http.Error(w, "the relay is busy; try again later", http.StatusServiceUnavailable)
		return
	default:
		s.metrics.limited(pendingBucket(err))
		http.Error(w, "too many connections waiting to sign in from this address; try again later", http.StatusTooManyRequests)
		return
	}
	var once sync.Once
	release := func() { once.Do(func() { s.releasePending(ip) }) }
	defer release()
	ws := s.accept(w, r, preAuthReadLimit)
	if ws == nil {
		return
	}
	p := s.newPeer(ws, ip, labelPending)
	defer p.finish()
	start := time.Now()
	reason := s.serveConnect(p, release)
	s.cfg.Logger.Info("connection closed", "endpoint", "connect", "role", p.label,
		"reason", reason, "duration_ms", time.Since(start).Milliseconds())
}

const (
	// pendingPerAddress and pendingPerNetwork cap /v1/connect sockets
	// waiting for Auth per client address (an IPv6 /64) and per network
	// (an IPv6 /48 or IPv4 /24). Honest clients authenticate within a round
	// trip, so even a busy office stays far below them.
	pendingPerAddress = 4
	pendingPerNetwork = 64
)

var errFull = errors.New("too many sockets on the relay")

func (s *Server) admitPending(ip string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pending >= s.cfg.MaxPendingConnections {
		return errFull
	}
	if err := s.pendingBy.admit(ip, pendingPerAddress, pendingPerNetwork); err != nil {
		return err
	}
	s.pending++
	return nil
}

func (s *Server) releasePending(ip string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending--
	s.pendingBy.release(ip)
}

func pendingBucket(err error) string {
	if err == errNetwork {
		return bucketConnectPendingNetwork
	}
	return bucketConnectPendingAddress
}

// serveConnect runs one /v1/connect session and returns why it ended, for
// the log. authenticated is called once Auth has succeeded.
func (s *Server) serveConnect(p *peer, authenticated func()) string {
	nonce := p.sendChallenge()
	f, err := p.read(s.authTimeout)
	if err != nil && !errors.Is(err, errBadFrame) {
		return "no_auth"
	}
	// A message that isn't a frame leaves f nil, which has no Auth either.
	auth := f.GetAuth()
	if auth == nil {
		p.fail(agentpb.Status_STATUS_BAD_REQUEST, "expected Auth")
		return "bad_frame"
	}
	if failure := s.authenticate(p, auth, nonce); failure != nil {
		s.metrics.authRefused(failure.status)
		p.fail(failure.status, failure.message)
		return "auth_" + statusLabel(failure.status)
	}
	defer s.leave(p)
	authenticated()
	p.ws.SetReadLimit(connectReadLimit)

	for {
		f, err := p.read(s.idleTimeout())
		if err != nil {
			if errors.Is(err, errBadFrame) {
				p.fail(agentpb.Status_STATUS_BAD_REQUEST, "expected a binary ClientFrame")
				return "bad_frame"
			}
			return "closed"
		}
		if p.ending.Load() {
			// Replaced, revoked or failed: the last frames are on their way.
			continue
		}
		s.handleFrame(p, f)
	}
}

func (s *Server) leave(p *peer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conns[p.key] == p {
		delete(s.conns, p.key)
	}
}

func (s *Server) handleFrame(p *peer, f *agentpb.ClientFrame) {
	id := f.GetId()
	reply := func(failure *refusal) {
		if failure == nil {
			p.result(id, agentpb.Status_STATUS_OK, "")
			return
		}
		p.result(id, failure.status, failure.message)
	}
	isApprover := p.role == agentpb.Role_ROLE_APPROVER
	switch frame := f.GetFrame().(type) {
	case *agentpb.ClientFrame_Ping:
		p.pong()
	case *agentpb.ClientFrame_Ack:
		s.ack(p, frame.Ack.GetMessageId())
	case *agentpb.ClientFrame_Send:
		failure := s.send(p, frame.Send.GetEnvelope())
		s.metrics.sent(failure)
		reply(failure)
	case *agentpb.ClientFrame_UnregisterAgent:
		// An agent removing itself ends its connection, so only approvers
		// can repeat this.
		if isApprover && !s.unregisterLimiter.Allow(p.key, registrationsPerMinute) {
			s.metrics.limited(bucketUnregister)
			reply(refuse(agentpb.Status_STATUS_RATE_LIMITED, "too many agents removed; wait a minute"))
			return
		}
		s.unregister(p, id, frame.UnregisterAgent.GetAgentKey())
	case *agentpb.ClientFrame_RegisterAgent:
		if !isApprover {
			reply(refuse(agentpb.Status_STATUS_BAD_REQUEST, "only approvers register agents"))
			return
		}
		if !s.registerLimiter.Allow(p.key, registrationsPerMinute) {
			s.metrics.limited(bucketRegister)
			reply(refuse(agentpb.Status_STATUS_RATE_LIMITED, "too many agents registered; wait a minute"))
			return
		}
		reply(s.registerAgent(p, frame.RegisterAgent))
	case *agentpb.ClientFrame_RenewPass:
		if !isApprover || s.cfg.Auth != AuthTicket {
			reply(refuse(agentpb.Status_STATUS_BAD_REQUEST, "RenewPass is for approvers on a relay that uses passes"))
			return
		}
		reply(s.renewPass(p, frame.RenewPass.GetPass()))
	case *agentpb.ClientFrame_ClaimSlot:
		if !isApprover {
			reply(refuse(agentpb.Status_STATUS_BAD_REQUEST, "only approvers claim pairing slots"))
			return
		}
		// On success claimSlot answers with SlotOffer itself.
		if failure := s.claimSlot(p, id, frame.ClaimSlot.GetSlotId()); failure != nil {
			reply(failure)
		}
	case *agentpb.ClientFrame_AnswerSlot:
		if !isApprover {
			reply(refuse(agentpb.Status_STATUS_BAD_REQUEST, "only approvers answer pairing slots"))
			return
		}
		reply(s.answerSlot(p, frame.AnswerSlot))
	default:
		// Auth again, OpenSlot (which belongs on /v1/pair), or nothing.
		if id == 0 {
			p.fail(agentpb.Status_STATUS_BAD_REQUEST, "unexpected frame")
			return
		}
		reply(refuse(agentpb.Status_STATUS_BAD_REQUEST, "unexpected frame"))
	}
}
