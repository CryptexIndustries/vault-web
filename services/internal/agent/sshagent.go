package agent

import (
	"bytes"
	"errors"
	"slices"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

const (
	sessionBindExtension = "session-bind@openssh.com"
	// OpenSSH's ssh-agent keeps at most 16 binds per connection and session
	// IDs of at most 128 bytes; more than that is not something ssh sends.
	maxSessionBinds  = 16
	maxSessionIDSize = 128
)

var errNoKeys = errors.New("this agent holds no keys")

// session is one client connection to the agent socket. ssh records the
// servers it talks to with session-bind on the connection it uses for them,
// so binds are per connection.
type session struct {
	svc   *Service
	pid   int32
	uid   uint32
	chain []*agentpb.Process
	binds []*agentpb.SessionBind
}

var _ agent.ExtendedAgent = (*session)(nil)

func (s *session) List() ([]*agent.Key, error) {
	return s.svc.listKeys(s.binds), nil
}

func (s *session) Sign(key ssh.PublicKey, data []byte) (*ssh.Signature, error) {
	return s.SignWithFlags(key, data, 0)
}

func (s *session) SignWithFlags(key ssh.PublicKey, data []byte, flags agent.SignatureFlags) (*ssh.Signature, error) {
	// The process tree is read when signing rather than at connect time so
	// it shows the caller as it is now; ssh is still waiting for us.
	if s.chain == nil {
		s.chain = capChain(processChain(s.pid, s.uid))
	}
	sig, err := s.svc.sign(key, data, flags, s.chain, s.binds)
	attrs := []any{"key", ssh.FingerprintSHA256(key)}
	if len(s.chain) > 0 {
		attrs = append(attrs, "process", s.chain[0].Exe)
	}
	if err != nil {
		s.svc.log.Info("Signature not given", append(attrs, "reason", err)...)
	} else {
		s.svc.log.Info("Signed", attrs...)
	}
	return sig, err
}

func (s *session) Extension(extensionType string, contents []byte) ([]byte, error) {
	if extensionType != sessionBindExtension {
		return nil, agent.ErrExtensionUnsupported
	}
	bind, err := parseSessionBind(contents)
	if err != nil {
		// An extension failure tells ssh the bind didn't take; it carries on.
		return nil, err
	}
	// A bind that doesn't verify names a host ssh never talked to. The
	// approver checks again, but nothing here (key order, the hosts file)
	// should act on one either.
	if err := agentproto.VerifySessionBind(bind); err != nil {
		return nil, err
	}
	for _, b := range s.binds {
		if sameBind(b, bind) {
			return nil, nil
		}
	}
	if len(s.binds) >= maxSessionBinds {
		return nil, errors.New("too many session binds")
	}
	s.binds = append(s.binds, bind)
	// An empty reply makes ServeAgent answer SSH_AGENT_SUCCESS.
	return nil, nil
}

func (s *session) Add(agent.AddedKey) error       { return errNoKeys }
func (s *session) Remove(ssh.PublicKey) error     { return errNoKeys }
func (s *session) RemoveAll() error               { return errNoKeys }
func (s *session) Lock([]byte) error              { return errNoKeys }
func (s *session) Unlock([]byte) error            { return errNoKeys }
func (s *session) Signers() ([]ssh.Signer, error) { return nil, nil }

func sameBind(a, b *agentpb.SessionBind) bool {
	return bytes.Equal(a.HostKey, b.HostKey) && bytes.Equal(a.SessionId, b.SessionId) &&
		bytes.Equal(a.Signature, b.Signature) && a.Forwarding == b.Forwarding
}

// parseSessionBind reads the extension body: string hostkey, string
// session_id, string signature, bool is_forwarding. Extension verifies the
// signature.
func parseSessionBind(contents []byte) (*agentpb.SessionBind, error) {
	var msg struct {
		HostKey    []byte
		SessionID  []byte
		Signature  []byte
		Forwarding bool
	}
	if err := ssh.Unmarshal(contents, &msg); err != nil {
		return nil, errors.New("malformed session-bind")
	}
	if len(msg.SessionID) == 0 || len(msg.SessionID) > maxSessionIDSize {
		return nil, errors.New("malformed session-bind")
	}
	if _, err := ssh.ParsePublicKey(msg.HostKey); err != nil {
		return nil, errors.New("malformed session-bind host key")
	}
	var sig ssh.Signature
	if err := ssh.Unmarshal(msg.Signature, &sig); err != nil || sig.Format == "" {
		return nil, errors.New("malformed session-bind signature")
	}
	return &agentpb.SessionBind{
		HostKey: msg.HostKey, SessionId: msg.SessionID, Signature: msg.Signature, Forwarding: msg.Forwarding,
	}, nil
}

// lastHost is the SHA256 fingerprint of the server bound last, the one ssh
// is logging in to. A chain with a forwarding bind has none: the forwarded
// connection comes from another machine, whose ssh can bind any host.
func lastHost(binds []*agentpb.SessionBind) (fingerprint string, ok bool) {
	if len(binds) == 0 || slices.ContainsFunc(binds, (*agentpb.SessionBind).GetForwarding) {
		return "", false
	}
	hostKey, err := ssh.ParsePublicKey(binds[len(binds)-1].HostKey)
	if err != nil {
		return "", false
	}
	return ssh.FingerprintSHA256(hostKey), true
}

// orderKeys puts the key last used with the most recently bound server
// first, so ssh tries it before running into the server's attempt limit.
// Without a trustworthy last host (see lastHost) the pairing order stays.
func orderKeys(keys []GrantedKey, binds []*agentpb.SessionBind, hosts Hosts) []GrantedKey {
	out := append([]GrantedKey(nil), keys...)
	fp, ok := lastHost(binds)
	if !ok {
		return out
	}
	last := hosts[fp]
	for i, k := range out {
		if bytes.Equal(k.PublicKey, last) {
			copy(out[1:i+1], out[:i])
			out[0] = k
			break
		}
	}
	return out
}
