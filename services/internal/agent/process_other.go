//go:build !linux

package agent

import (
	"errors"
	"net"
	"os"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

// cryptex-agent targets Linux; these stubs only keep the module building
// elsewhere.

func peerCred(*net.UnixConn) (int32, uint32, error) {
	return 0, 0, errors.New("peer credentials are only read on Linux")
}

func processChain(int32, uint32) []*agentpb.Process { return nil }

func openTerminal(int32) *os.File { return nil }

func writeTerminal(*os.File, string) {}
