package agent

import (
	"bufio"
	"bytes"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

const (
	procRoot        = "/proc"
	ioctlGetTermios = unix.TCGETS
)

// peerCred returns the pid and uid of the process on the other end of a
// unix socket, as the kernel recorded them at connect time.
func peerCred(c *net.UnixConn) (pid int32, uid uint32, err error) {
	raw, err := c.SyscallConn()
	if err != nil {
		return 0, 0, err
	}
	var cred *unix.Ucred
	var credErr error
	if err := raw.Control(func(fd uintptr) {
		cred, credErr = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
	}); err != nil {
		return 0, 0, err
	}
	if credErr != nil {
		return 0, 0, credErr
	}
	return cred.Pid, cred.Uid, nil
}

func readProcess(pid int32, withCwd bool) (*agentpb.Process, int32, error) {
	dir := filepath.Join(procRoot, strconv.Itoa(int(pid)))
	status, err := os.ReadFile(filepath.Join(dir, "status"))
	if err != nil {
		return nil, 0, err
	}
	p := &agentpb.Process{Pid: pid}
	ppid := int32(-1)
	uidFound := false
	scanner := bufio.NewScanner(bytes.NewReader(status))
	for scanner.Scan() {
		key, value, _ := strings.Cut(scanner.Text(), ":")
		fields := strings.Fields(value)
		if len(fields) == 0 {
			continue
		}
		switch key {
		case "PPid":
			n, err := strconv.ParseInt(fields[0], 10, 32)
			if err == nil {
				ppid = int32(n)
			}
		case "Uid":
			// Real, effective, saved, filesystem; the real uid is first.
			n, err := strconv.ParseUint(fields[0], 10, 32)
			if err == nil {
				p.Uid, uidFound = uint32(n), true
			}
		}
	}
	if ppid < 0 || !uidFound {
		return nil, 0, errors.New("unreadable /proc status")
	}
	// exe and cwd need ptrace access; a process of ours that dropped it
	// (setuid, prctl) just shows without them.
	if exe, err := os.Readlink(filepath.Join(dir, "exe")); err == nil {
		p.Exe = clean(exe, 4096)
	}
	if cmdline, err := os.ReadFile(filepath.Join(dir, "cmdline")); err == nil {
		p.Args = splitArgs(cmdline)
	}
	if withCwd {
		if cwd, err := os.Readlink(filepath.Join(dir, "cwd")); err == nil {
			p.Cwd = clean(cwd, 4096)
		}
	}
	return p, ppid, nil
}

// openTerminal opens the terminal the process at pid writes its errors to,
// where ssh prints its own, or returns nil if that isn't a terminal (a
// script, a pipe, a log file). Opening it while the request is new keeps a
// later process that reuses the pid from getting the line.
func openTerminal(pid int32) *os.File {
	f, err := os.OpenFile(filepath.Join(procRoot, strconv.Itoa(int(pid)), "fd", "2"), os.O_WRONLY|unix.O_NOCTTY|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil
	}
	return keepIfTerminal(f)
}
