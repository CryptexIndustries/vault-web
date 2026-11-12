//go:build linux || darwin

package agent

import (
	"errors"
	"os"
	"time"

	"golang.org/x/sys/unix"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

// processChain describes the caller and its parents for the approval
// screen. Parents stop at pid 1 or at a process of another user, whose
// details aren't ours to send.
func processChain(pid int32, uid uint32) []*agentpb.Process {
	var chain []*agentpb.Process
	for level := 0; level <= maxParents && pid > 1; level++ {
		p, ppid, err := readProcess(pid, level == 0)
		if err != nil || p.Uid != uid {
			break
		}
		chain = append(chain, p)
		pid = ppid
	}
	return chain
}

// IsTerminal reports whether f is a terminal.
func IsTerminal(f *os.File) bool {
	_, err := unix.IoctlGetTermios(int(f.Fd()), ioctlGetTermios)
	return err == nil
}

// keepIfTerminal returns f if it is a terminal, or closes it and returns
// nil.
func keepIfTerminal(f *os.File) *os.File {
	// Not f.Fd(): that would make the file blocking again.
	raw, err := f.SyscallConn()
	termErr := errors.New("not checked")
	if err == nil {
		err = raw.Control(func(fd uintptr) { _, termErr = unix.IoctlGetTermios(int(fd), ioctlGetTermios) })
	}
	if err != nil || termErr != nil {
		f.Close()
		return nil
	}
	return f
}

// writeTerminal writes line to a terminal from openTerminal, giving up if a
// paused or full terminal doesn't take it within a second.
func writeTerminal(f *os.File, line string) {
	_ = f.SetWriteDeadline(time.Now().Add(time.Second))
	_, _ = f.WriteString(line + "\r\n")
}
