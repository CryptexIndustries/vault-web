package agent

import (
	"context"
	"errors"
	"fmt"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
)

// maxResendFailures is how many reconnects may fail to take a request
// before it is given up, so one the relay can't take (for example because
// it drops the socket) isn't resent until it times out.
const maxResendFailures = 2

// pendingSign is a sign request waiting for the approver's answer.
type pendingSign struct {
	env    *agentpb.Envelope
	answer chan *agentpb.SignResponse
	failed chan error
	// attempted and resendFailures are guarded by Service.mu. attempted is
	// set once a Send went out on a live connection, so the relay may know
	// the message ID.
	attempted      bool
	resendFailures int
}

func newPendingSign(env *agentpb.Envelope) *pendingSign {
	return &pendingSign{env: env, answer: make(chan *agentpb.SignResponse, 1), failed: make(chan error, 1)}
}

// fail hands err to the waiting sign call; later failures are dropped.
func (p *pendingSign) fail(err error) {
	select {
	case p.failed <- err:
	default:
	}
}

// pendingSigns holds the requests by message ID. Service.mu guards it.
type pendingSigns map[string]*pendingSign

func (ps pendingSigns) failAll(err error) {
	for _, p := range ps {
		p.fail(err)
	}
}

// answer hands resp to the request it replies to, if that is still waiting.
func (ps pendingSigns) answer(inReplyTo []byte, resp *agentpb.SignResponse) {
	p := ps[string(inReplyTo)]
	if p == nil {
		return
	}
	select {
	case p.answer <- resp:
	default:
	}
}

type resendItem struct {
	p *pendingSign
	// attempted is whether an earlier connection may have taken it.
	attempted bool
}

// forResend lists every request for a new connection and marks them
// attempted, as the relay may know their IDs from now on.
func (ps pendingSigns) forResend() []resendItem {
	out := make([]resendItem, 0, len(ps))
	for _, p := range ps {
		out = append(out, resendItem{p, p.attempted})
		p.attempted = true
	}
	return out
}

// resend hands a pending request to a new connection.
func (s *Service) resend(ctx context.Context, conn *relayclient.Conn, r resendItem) {
	sendCtx, cancel := context.WithTimeout(ctx, resultTimeout)
	err := conn.Send(sendCtx, r.p.env)
	cancel()
	var se *relayclient.StatusError
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case err == nil:
	case errors.As(err, &se) && !se.Fatal:
		// A relay that already took this message ID refuses the copy as a
		// duplicate (BAD_REQUEST); the request is still on its way.
		if r.attempted && se.Status == agentpb.Status_STATUS_BAD_REQUEST {
			return
		}
		r.p.fail(err)
	case ctx.Err() != nil:
		// Shutting down or the pairing changed; not this request's doing.
	default:
		r.p.resendFailures++
		if r.p.resendFailures >= maxResendFailures {
			r.p.fail(fmt.Errorf("the relay didn't take the request: %w", err))
		}
	}
}
