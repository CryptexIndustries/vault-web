package approvertest

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
)

// Decision is what the policy does with a request.
type Decision int

const (
	Approve Decision = iota
	Deny
	// Ignore sends no answer, so the agent times out.
	Ignore
)

func (d Decision) String() string {
	switch d {
	case Approve:
		return "approve"
	case Deny:
		return "deny"
	case Ignore:
		return "ignore"
	}
	return "unknown"
}

// Policy decides a request. It runs in its own goroutine, so it may block
// (to delay an answer) until ctx ends.
type Policy func(ctx context.Context, req *Request) Decision

func approveAll(context.Context, *Request) Decision { return Approve }

// Delay waits d, then decides with then.
func Delay(d time.Duration, then Decision) Policy {
	return func(ctx context.Context, _ *Request) Decision {
		select {
		case <-time.After(d):
		case <-ctx.Done():
		}
		return then
	}
}

// Request is one sign request as received, with what happened to it.
type Request struct {
	AgentKey  []byte
	MessageID []byte
	Sign      *agentpb.SignRequest
	// Key is the parsed SignRequest.PublicKey (nil if it didn't parse).
	Key ssh.PublicKey
	// Kind is what the data is; Namespace is the SSHSIG namespace (such as
	// "git"). Both are set once the request is decided.
	Kind      Kind
	Namespace string
	// DestinationUnknown marks a login that doesn't say which server it is
	// for (no session-bind, or one through a forwarded agent). The app always
	// asks for these with a warning and never approves them from a
	// remembered rule.
	DestinationUnknown bool

	// Set once the request is answered or dropped.
	Decision Decision
	// Refusal is the reason sent, if any.
	Refusal agentpb.RefusalReason
	// Signature is the SSH wire signature sent, if any.
	Signature []byte
	Err       error
	// Done is set once the decision was carried out.
	Done bool
}

// SetPolicy replaces the policy for requests that arrive from now on. The
// default approves everything. A policy only sees requests that pass the
// checks the app must make (see classify).
func (a *Approver) SetPolicy(p Policy) {
	if p == nil {
		p = approveAll
	}
	a.mu.Lock()
	a.policy = p
	a.mu.Unlock()
}

// Requests returns copies of every sign request received so far, decided
// or not.
func (a *Approver) Requests() []Request {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]Request, len(a.requests))
	for i, r := range a.requests {
		out[i] = *r
	}
	return out
}

// WaitRequests waits until n requests have been answered (or ignored) and
// returns every request received.
func (a *Approver) WaitRequests(ctx context.Context, n int) ([]Request, error) {
	err := a.WaitFor(ctx, func() bool {
		done := 0
		for _, r := range a.Requests() {
			if r.Done {
				done++
			}
		}
		return done >= n
	})
	return a.Requests(), err
}

func (a *Approver) handleDeliver(conn *relayclient.Conn, env *agentpb.Envelope) {
	h, err := agentproto.ParseHeader(env)
	if err != nil {
		return
	}
	defer conn.Ack(a.ctx, h.MessageId)
	a.mu.Lock()
	ag := a.agents[string(h.Sender)]
	var peer agentproto.Peer
	if ag != nil {
		peer = ag.peer
	}
	a.mu.Unlock()
	if ag == nil {
		return
	}
	// Open before marking the ID seen: a tampered copy that arrives first
	// must not make the genuine envelope look like a repeat.
	opened, err := agentproto.Open(a.id, peer, env, time.Now())
	if err != nil {
		return
	}
	a.mu.Lock()
	if a.seen[string(h.MessageId)] {
		// The agent didn't get our answer (for example the relay restarted
		// before delivering it). Send the same answer again rather than
		// asking twice; if we haven't decided yet, the answer follows.
		answer := a.answers[string(h.MessageId)]
		a.mu.Unlock()
		if answer != nil {
			a.wg.Go(func() { a.send(answer) })
		}
		return
	}
	a.seen[string(h.MessageId)] = true
	a.mu.Unlock()
	switch body := opened.Message.GetBody().(type) {
	case *agentpb.Message_PairingConfirm:
		a.mu.Lock()
		ag.confirmed = true
		a.signalLocked()
		a.mu.Unlock()
	case *agentpb.Message_SignRequest:
		req := &Request{AgentKey: ag.Key, MessageID: h.MessageId, Sign: body.SignRequest}
		req.Key, _ = ssh.ParsePublicKey(body.SignRequest.PublicKey)
		a.mu.Lock()
		a.requests = append(a.requests, req)
		policy := a.policy
		a.signalLocked()
		a.mu.Unlock()
		// The policy may block; other frames keep flowing meanwhile.
		a.wg.Go(func() { a.answer(ag, h, req, policy) })
	}
}

func (a *Approver) answer(ag *PairedAgent, h *agentpb.EnvelopeHeader, req *Request, policy Policy) {
	resp, decision, err := a.decide(ag, h, req, policy)
	a.mu.Lock()
	req.Decision = decision
	if resp != nil {
		req.Refusal = resp.GetRefusal()
		req.Signature = resp.GetSignature()
	}
	req.Err = err
	a.mu.Unlock()
	if resp != nil {
		env, sealErr := agentproto.Seal(a.id, ag.peer, &agentpb.Message{Body: &agentpb.Message_SignResponse{SignResponse: resp}},
			agentproto.SealOptions{InReplyTo: h.MessageId, ExpiresAt: time.Now().Add(agentproto.RequestLifetime)})
		if sealErr == nil {
			a.mu.Lock()
			a.answers[string(h.MessageId)] = env
			a.mu.Unlock()
			sealErr = a.send(env)
		}
		if sealErr != nil {
			a.mu.Lock()
			req.Err = sealErr
			a.mu.Unlock()
		}
	}
	a.mu.Lock()
	req.Done = true
	snapshot := *req
	a.signalLocked()
	a.mu.Unlock()
	if a.opts.OnRequest != nil {
		a.opts.OnRequest(snapshot)
	}
}

func (a *Approver) send(env *agentpb.Envelope) error {
	ctx, cancel := context.WithTimeout(a.ctx, 10*time.Second)
	defer cancel()
	conn, err := a.current(ctx)
	if err != nil {
		return err
	}
	return conn.Send(ctx, env)
}

func refuse(reason agentpb.RefusalReason) *agentpb.SignResponse {
	return &agentpb.SignResponse{Result: &agentpb.SignResponse_Refusal{Refusal: reason}}
}

// decide checks the request the way the app must, then applies the policy.
func (a *Approver) decide(ag *PairedAgent, h *agentpb.EnvelopeHeader, req *Request, policy Policy) (*agentpb.SignResponse, Decision, error) {
	invalid := refuse(agentpb.RefusalReason_REFUSAL_REASON_INVALID)
	for _, b := range req.Sign.SessionBinds {
		if err := agentproto.VerifySessionBind(b); err != nil {
			return invalid, Deny, err
		}
	}
	kind, namespace, destUnknown, err := classify(req.Sign)
	a.mu.Lock()
	req.Kind, req.Namespace, req.DestinationUnknown = kind, namespace, destUnknown
	a.mu.Unlock()
	if err != nil {
		return invalid, Deny, err
	}
	if kind == KindOther && !a.opts.AllowOther {
		return invalid, Deny, errors.New("the data is neither an SSH login nor an SSHSIG signature")
	}
	a.mu.Lock()
	var signer ssh.Signer
	for _, s := range ag.signers {
		if bytes.Equal(s.PublicKey().Marshal(), req.Sign.PublicKey) {
			signer = s
		}
	}
	a.mu.Unlock()
	if signer == nil {
		return refuse(agentpb.RefusalReason_REFUSAL_REASON_KEY_NOT_GRANTED), Deny, errors.New("key not granted")
	}
	ctx, cancel := context.WithDeadline(a.ctx, time.UnixMilli(h.ExpiresAt))
	defer cancel()
	switch decision := policy(ctx, req); decision {
	case Ignore:
		return nil, Ignore, nil
	case Deny:
		return refuse(agentpb.RefusalReason_REFUSAL_REASON_DENIED), Deny, nil
	default:
		sig, err := signWithFlags(signer, req.Sign.Data, agent.SignatureFlags(req.Sign.Flags))
		if err != nil {
			return refuse(agentpb.RefusalReason_REFUSAL_REASON_UNSUPPORTED), Approve, err
		}
		return &agentpb.SignResponse{Result: &agentpb.SignResponse_Signature{Signature: ssh.Marshal(sig)}}, Approve, nil
	}
}

// signWithFlags honors the RSA SHA-2 flags the way ssh-agent does; other
// key types ignore them.
func signWithFlags(signer ssh.Signer, data []byte, flags agent.SignatureFlags) (*ssh.Signature, error) {
	if signer.PublicKey().Type() != ssh.KeyAlgoRSA {
		return signer.Sign(rand.Reader, data)
	}
	algo := ssh.KeyAlgoRSA
	// Same precedence as OpenSSH's ssh-agent when both flags are set.
	switch {
	case flags&agent.SignatureFlagRsaSha256 != 0:
		algo = ssh.KeyAlgoRSASHA256
	case flags&agent.SignatureFlagRsaSha512 != 0:
		algo = ssh.KeyAlgoRSASHA512
	}
	as, ok := signer.(ssh.AlgorithmSigner)
	if !ok {
		return nil, errors.New("signer can't choose an RSA algorithm")
	}
	return as.SignWithAlgorithm(rand.Reader, data, algo)
}
