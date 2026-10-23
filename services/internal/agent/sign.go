package agent

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agent/termsafe"
	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
)

// maxHostnameSize caps the hostname sent in offers and requests.
const maxHostnameSize = 255

func (s *Service) listKeys(binds []*agentpb.SessionBind) []*agent.Key {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.st == nil || s.st.Revoked {
		return nil
	}
	var out []*agent.Key
	for _, k := range orderKeys(s.st.Keys, binds, s.hosts) {
		pub, err := ssh.ParsePublicKey(k.PublicKey)
		if err != nil {
			continue
		}
		// ssh-add -L prints comments, and state.json may have been edited.
		out = append(out, &agent.Key{Format: pub.Type(), Blob: k.PublicKey, Comment: termsafe.Comment(k.Comment)})
	}
	return out
}

// sign asks the approver for a signature and waits for the answer. A
// request made while the relay is out of reach waits for the next
// connection.
func (s *Service) sign(key ssh.PublicKey, data []byte, flags agent.SignatureFlags, chain []*agentpb.Process, binds []*agentpb.SessionBind) (*ssh.Signature, error) {
	binds = labelBinds(binds, chain, s.opts.KnownHostsFiles)
	s.mu.Lock()
	if len(s.pending) >= maxWaitingSigns {
		s.mu.Unlock()
		s.log.Warn("Refused a signature request: too many are waiting for the approver", "waiting", maxWaitingSigns)
		return nil, fmt.Errorf("%d requests are already waiting for the approver", maxWaitingSigns)
	}
	env, err := s.sealSignRequestLocked(&agentpb.SignRequest{
		PublicKey:    key.Marshal(),
		Data:         data,
		Flags:        uint32(flags),
		Processes:    chain,
		SessionBinds: binds,
		Hostname:     clean(s.opts.Hostname(), maxHostnameSize),
	})
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	approverName := termsafe.Name(s.st.ApproverName)
	h, _ := agentproto.ParseHeader(env)
	id := string(h.MessageId)
	p := newPendingSign(env)
	s.pending[id] = p
	conn := s.conn
	p.attempted = conn != nil
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pending, id)
		s.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(s.ctx, s.opts.RequestTimeout)
	defer cancel()
	if conn != nil {
		// Without a connection, or if this one ends before the relay
		// answers, the request goes out on the next one.
		if err := conn.Send(ctx, env); err != nil {
			var se *relayclient.StatusError
			if errors.As(err, &se) && !se.Fatal {
				// The relay refused it (too large, over a limit); waiting
				// won't change that.
				return nil, err
			}
		}
	}
	attrs := []any{"approver", approverName, "key", ssh.FingerprintSHA256(key)}
	if n := len(binds); n > 0 && len(binds[n-1].GetHostNames()) > 0 {
		attrs = append(attrs, "server", binds[n-1].GetHostNames()[0])
	}
	if len(chain) > 0 {
		attrs = append(attrs, "process", chain[0].GetExe())
	}
	s.log.Info("Waiting for approval", attrs...)
	if notify := s.opts.Notify; notify != nil {
		t := time.AfterFunc(s.opts.NotifyAfter, func() { notify(approverName) })
		defer t.Stop()
	}
	if s.opts.Terminal && len(chain) > 0 {
		if term := openTerminal(chain[0].GetPid()); term != nil {
			defer term.Close()
			t := time.AfterFunc(terminalAfter, func() {
				writeTerminal(term, "cryptex-agent: waiting for approval on "+approverName)
			})
			defer t.Stop()
		}
	}

	select {
	case resp := <-p.answer:
		return s.finishSign(key, data, flags, binds, resp, approverName)
	case err := <-p.failed:
		return nil, err
	case <-ctx.Done():
		if s.ctx.Err() != nil {
			return nil, errors.New("cryptex-agent is shutting down")
		}
		return nil, fmt.Errorf("no answer from %s in time", approverName)
	}
}

// sealSignRequestLocked checks that the agent may ask for req and seals it
// for the approver.
func (s *Service) sealSignRequestLocked(req *agentpb.SignRequest) (*agentpb.Envelope, error) {
	if s.st == nil {
		return nil, errors.New("not paired; run cryptex-agent pair")
	}
	if s.st.Revoked {
		return nil, errors.New("this agent was revoked; run cryptex-agent pair")
	}
	if !slices.ContainsFunc(s.st.Keys, func(k GrantedKey) bool { return bytes.Equal(k.PublicKey, req.PublicKey) }) {
		return nil, errors.New("this key isn't granted to this agent")
	}
	env, err := agentproto.Seal(s.id, s.approver, &agentpb.Message{Body: &agentpb.Message_SignRequest{SignRequest: req}},
		agentproto.SealOptions{ExpiresAt: s.opts.Now().Add(s.opts.RequestTimeout)})
	if err != nil {
		return nil, err
	}
	// The process chain is capped already; what is left is ssh's data and
	// session binds, which no ssh sends this large.
	if proto.Size(env) > agentproto.MaxEnvelopeSize {
		return nil, errors.New("this request is too large to send to the approver")
	}
	return env, nil
}

func (s *Service) finishSign(key ssh.PublicKey, data []byte, flags agent.SignatureFlags, binds []*agentpb.SessionBind, resp *agentpb.SignResponse, approverName string) (*ssh.Signature, error) {
	switch r := resp.GetResult().(type) {
	case *agentpb.SignResponse_Refusal:
		return nil, refusalError(r.Refusal, approverName)
	case *agentpb.SignResponse_Signature:
		var sig ssh.Signature
		if err := ssh.Unmarshal(r.Signature, &sig); err != nil {
			return nil, errors.New("the approver sent a malformed signature")
		}
		// An RSA key verifies under any of its hashes, so check the one
		// ssh asked for: a SHA-1 signature where SHA-2 was requested would
		// be a downgrade, and ssh would fail the login over it anyway.
		if formats := rsaFormats(key, flags); formats != nil && !slices.Contains(formats, sig.Format) {
			return nil, fmt.Errorf("the approver sent a %s signature where %s was asked for", sig.Format, strings.Join(formats, " or "))
		}
		// A signature that doesn't verify would only fail later inside
		// ssh with a less helpful message.
		if err := key.Verify(data, &sig); err != nil {
			return nil, errors.New("the approver sent a signature that doesn't verify")
		}
		s.rememberHost(key, binds)
		return &sig, nil
	}
	return nil, errors.New("the approver sent an empty answer")
}

// rsaFormats lists the signature formats that answer a request with flags
// for an RSA key (or certificate), and nil for other keys. ssh sets one
// flag; with both, either SHA-2 hash will do.
func rsaFormats(key ssh.PublicKey, flags agent.SignatureFlags) []string {
	if cert, ok := key.(*ssh.Certificate); ok {
		key = cert.Key
	}
	if key.Type() != ssh.KeyAlgoRSA {
		return nil
	}
	var out []string
	if flags&agent.SignatureFlagRsaSha256 != 0 {
		out = append(out, ssh.KeyAlgoRSASHA256)
	}
	if flags&agent.SignatureFlagRsaSha512 != 0 {
		out = append(out, ssh.KeyAlgoRSASHA512)
	}
	if out == nil {
		out = []string{ssh.KeyAlgoRSA}
	}
	return out
}

func refusalError(reason agentpb.RefusalReason, approverName string) error {
	switch reason {
	case agentpb.RefusalReason_REFUSAL_REASON_DENIED:
		return fmt.Errorf("denied on %s", approverName)
	case agentpb.RefusalReason_REFUSAL_REASON_KEY_NOT_GRANTED:
		return fmt.Errorf("%s no longer grants this key to this agent", approverName)
	case agentpb.RefusalReason_REFUSAL_REASON_UNSUPPORTED:
		return fmt.Errorf("%s can't sign with this key type or flags", approverName)
	case agentpb.RefusalReason_REFUSAL_REASON_INVALID:
		return fmt.Errorf("%s refused the request as invalid", approverName)
	}
	return fmt.Errorf("refused by %s", approverName)
}

// rememberHost records key as the one last used with the server ssh bound
// last, for orderKeys.
func (s *Service) rememberHost(key ssh.PublicKey, binds []*agentpb.SessionBind) {
	fp, ok := lastHost(binds)
	if !ok {
		return
	}
	blob := key.Marshal()
	s.mu.Lock()
	defer s.mu.Unlock()
	if bytes.Equal(s.hosts[fp], blob) {
		return
	}
	s.hosts[fp] = blob
	if err := s.store.SaveHosts(s.hosts); err != nil {
		s.log.Warn("Couldn't save hosts.json", "error", err)
	}
}
