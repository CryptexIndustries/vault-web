//go:build linux

package agent

import (
	"os"
	"testing"
)

func TestProcessChainOfThisTest(t *testing.T) {
	chain := processChain(int32(os.Getpid()), uint32(os.Getuid()))
	if len(chain) == 0 {
		t.Fatal("empty chain")
	}
	self := chain[0]
	exe, _ := os.Executable()
	cwd, _ := os.Getwd()
	if self.Pid != int32(os.Getpid()) || self.Uid != uint32(os.Getuid()) || self.Exe != exe || self.Cwd != cwd {
		t.Errorf("self = %+v, want exe %s cwd %s", self, exe, cwd)
	}
	wantArgs := os.Args[:min(len(os.Args), maxArgs)]
	for i, a := range self.Args {
		if want := clean(wantArgs[i], maxArgLength); a != want {
			t.Errorf("arg %d = %q, want %q", i, a, want)
		}
	}
	if len(chain) > maxParents+1 {
		t.Errorf("%d processes", len(chain))
	}
	for _, p := range chain[1:] {
		if p.Cwd != "" || p.Pid <= 1 || p.Uid != uint32(os.Getuid()) {
			t.Errorf("parent %+v", p)
		}
	}
	if len(chain) > 1 && chain[1].Pid != int32(os.Getppid()) {
		t.Errorf("first parent pid %d, want %d", chain[1].Pid, os.Getppid())
	}
}
