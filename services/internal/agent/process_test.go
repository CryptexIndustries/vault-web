package agent

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

func TestSplitArgsLimits(t *testing.T) {
	var cmdline []byte
	for i := range 40 {
		arg := strings.Repeat("a", 10)
		if i == 1 {
			arg = strings.Repeat("é", 200) // 400 bytes, cut on a character boundary
		}
		if i == 2 {
			arg = "bad\xffutf8"
		}
		cmdline = append(cmdline, arg...)
		cmdline = append(cmdline, 0)
	}
	args := splitArgs(cmdline)
	if len(args) != maxArgs {
		t.Fatalf("%d args", len(args))
	}
	for i, a := range args {
		if len(a) > maxArgLength || !utf8.ValidString(a) {
			t.Errorf("arg %d: %d bytes, valid %v", i, len(a), utf8.ValidString(a))
		}
	}
	if !strings.HasSuffix(args[1], "...") {
		t.Errorf("long arg not marked as cut: %q", args[1][len(args[1])-8:])
	}
	if splitArgs(nil) != nil {
		t.Error("args for an empty cmdline (kernel thread)")
	}
}

func TestCapChain(t *testing.T) {
	long := func(n int) string { return strings.Repeat("x", n) }
	big := func(pid int32) *agentpb.Process {
		p := &agentpb.Process{Pid: pid, Exe: long(4096)}
		for range maxArgs {
			p.Args = append(p.Args, long(maxArgLength))
		}
		return p
	}
	size := func(chain []*agentpb.Process) int {
		n := 0
		for _, p := range chain {
			n += processBytes(p)
		}
		return n
	}

	small := []*agentpb.Process{{Pid: 10, Exe: "/usr/bin/ssh", Args: []string{"ssh", "host"}}, {Pid: 9, Exe: "/usr/bin/bash"}}
	if got := capChain(small); len(got) != 2 || len(got[0].Args) != 2 {
		t.Fatalf("small chain changed: %v", got)
	}

	// The deepest parents go first; the caller and nearest parents stay.
	chain := []*agentpb.Process{big(100), big(99), big(98), big(97), big(96), big(95), big(94), big(93), big(92)}
	chain[0].Cwd = long(4096)
	got := capChain(chain)
	if size(got) > maxChainBytes || len(got) == 0 {
		t.Fatalf("%d processes, %d bytes", len(got), size(got))
	}
	for i, p := range got {
		if p.Pid != int32(100-i) {
			t.Errorf("process %d has pid %d", i, p.Pid)
		}
	}
	if len(got) == len(chain) {
		t.Error("no parent dropped")
	}

	// A caller over the budget on its own loses its last arguments.
	caller := &agentpb.Process{Pid: 5, Exe: long(4096), Cwd: long(4096)}
	for range 40 {
		caller.Args = append(caller.Args, long(maxArgLength))
	}
	got = capChain([]*agentpb.Process{caller, big(4)})
	if len(got) != 1 || size(got) > maxChainBytes {
		t.Fatalf("%d processes, %d bytes", len(got), size(got))
	}
	if args := got[0].Args; len(args) == 0 || args[len(args)-1] != truncatedMark || args[0] != long(maxArgLength) {
		t.Errorf("caller args not cut at the end: %d args", len(args))
	}
}
