package agentproto

import (
	"fmt"

	"golang.org/x/crypto/ssh"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

// VerifySessionBind checks that the host key in a session-bind signed its
// session ID. The agent drops binds that fail, and the approver checks again
// before it shows the host: the agent passes along what ssh sent, and ssh on
// a forwarded connection may be on a host that isn't trusted.
func VerifySessionBind(b *agentpb.SessionBind) error {
	hostKey, err := ssh.ParsePublicKey(b.GetHostKey())
	if err != nil {
		return fmt.Errorf("session-bind host key: %w", err)
	}
	var sig ssh.Signature
	if err := ssh.Unmarshal(b.GetSignature(), &sig); err != nil {
		return fmt.Errorf("session-bind signature: %w", err)
	}
	if err := hostKey.Verify(b.GetSessionId(), &sig); err != nil {
		return fmt.Errorf("session-bind doesn't verify: %w", err)
	}
	return nil
}
