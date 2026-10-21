package agent

import (
	"bytes"
	"strings"
	"unicode/utf8"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

const (
	maxArgs      = 32
	maxArgLength = 256
	maxParents   = 8
	// maxChainBytes caps the exe, cwd and argument bytes of the process
	// chain. Uncapped, nine processes with long command lines can pass
	// agentproto.MaxEnvelopeSize on their own; this leaves room for the
	// session binds and ssh's data.
	maxChainBytes = 16 << 10
	truncatedMark = "..."
)

func processBytes(p *agentpb.Process) int {
	n := len(p.Exe) + len(p.Cwd)
	for _, a := range p.Args {
		n += len(a)
	}
	return n
}

// capChain keeps the chain within maxChainBytes: the deepest parents go
// first, as the caller and its closest parents say most about a request,
// then the caller's last arguments, with truncatedMark in their place.
func capChain(chain []*agentpb.Process) []*agentpb.Process {
	size := 0
	for _, p := range chain {
		size += processBytes(p)
	}
	for size > maxChainBytes && len(chain) > 1 {
		size -= processBytes(chain[len(chain)-1])
		chain = chain[:len(chain)-1]
	}
	if size > maxChainBytes {
		// exe and cwd are at most 4 KiB each, so the arguments are what
		// is over.
		p := chain[0]
		for len(p.Args) > 0 && size+len(truncatedMark) > maxChainBytes {
			size -= len(p.Args[len(p.Args)-1])
			p.Args = p.Args[:len(p.Args)-1]
		}
		p.Args = append(p.Args, truncatedMark)
	}
	return chain
}

// splitArgs turns /proc/<pid>/cmdline (NUL-terminated arguments) into at
// most maxArgs arguments of at most maxArgLength bytes each.
func splitArgs(cmdline []byte) []string {
	cmdline = bytes.TrimSuffix(cmdline, []byte{0})
	if len(cmdline) == 0 {
		return nil
	}
	parts := bytes.Split(cmdline, []byte{0})
	args := make([]string, 0, min(len(parts), maxArgs))
	for i, part := range parts {
		if i == maxArgs {
			break
		}
		args = append(args, clean(string(part), maxArgLength))
	}
	return args
}

// clean makes s valid UTF-8 (protobuf strings must be) and cuts it to max
// bytes without splitting a character.
func clean(s string, max int) string {
	s = strings.ToValidUTF8(s, "�")
	if len(s) <= max {
		return s
	}
	cut := max - len(truncatedMark)
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + truncatedMark
}
