package agent

import (
	"errors"
	"fmt"
	"io"
	"net"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"

	"github.com/CryptexIndustries/vault-web/services/internal/agent/termsafe"
)

// PrintStatus runs `cryptex-agent status`.
func PrintStatus(paths Paths, out io.Writer) error {
	st, err := Store{Dir: paths.DataDir}.LoadState()
	if err != nil {
		return err
	}
	switch {
	case st == nil:
		fmt.Fprintln(out, "Not paired. Run cryptex-agent pair.")
	case st.Revoked:
		fmt.Fprintf(out, "This agent (%q) was revoked on %s, or the relay says so. Run cryptex-agent pair to connect again.\n", termsafe.Name(st.AgentName), termsafe.Name(st.ApproverName))
		fmt.Fprintf(out, "Relay: %s\n", termsafe.Message(st.RelayURL))
	default:
		fmt.Fprintf(out, "Paired with %s as %q on %s.\n", termsafe.Name(st.ApproverName), termsafe.Name(st.AgentName), st.PairedAt.Local().Format("2 Jan 2006"))
		fmt.Fprintf(out, "Relay: %s\n", termsafe.Message(st.RelayURL))
		if !st.GoneSince.IsZero() {
			fmt.Fprintf(out, "The relay hasn't known this agent since %s. The service asks again less and less often, and stops a week after that.\n", st.GoneSince.Local().Format("2 Jan 2006 15:04"))
		}
		if !st.Confirmed {
			fmt.Fprintln(out, "The relay hasn't received the pairing confirmation yet; the service sends it when it connects.")
		}
		fmt.Fprintf(out, "%s:\n", keyCount(len(st.Keys)))
		for _, k := range st.Keys {
			pub, err := ssh.ParsePublicKey(k.PublicKey)
			if err != nil {
				continue
			}
			fmt.Fprintf(out, "  %s  %s  %s\n", pub.Type(), ssh.FingerprintSHA256(pub), termsafe.Comment(k.Comment))
		}
	}
	keys, err := listSocket(paths.Socket)
	switch {
	case err == nil:
		fmt.Fprintf(out, "Service: running at %s, listing %s.\n", paths.Socket, keyCount(len(keys)))
	case paths.Socket == "":
		fmt.Fprintln(out, "Service: unknown, XDG_RUNTIME_DIR isn't set.")
	default:
		fmt.Fprintln(out, "Service: not running. Start it with: systemctl --user enable --now cryptex-agent")
	}
	return nil
}

func keyCount(n int) string {
	if n == 1 {
		return "1 SSH key"
	}
	return fmt.Sprintf("%d SSH keys", n)
}

func listSocket(socket string) ([]*agent.Key, error) {
	if socket == "" {
		return nil, errors.New("XDG_RUNTIME_DIR isn't set")
	}
	c, err := net.DialTimeout("unix", socket, 2*time.Second)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(3 * time.Second))
	return agent.NewClient(c).List()
}
