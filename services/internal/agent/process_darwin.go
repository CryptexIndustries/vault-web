package agent

/*
#include <libproc.h>
#include <sys/proc_info.h>
*/
import "C"

import (
	"bytes"
	"encoding/binary"
	"errors"
	"net"
	"os"
	"unsafe"

	"golang.org/x/sys/unix"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

const ioctlGetTermios = unix.TIOCGETA

// peerCred returns the pid and uid of the process on the other end of a unix
// socket. The uid is fixed at connect time, so the access check uses it. The
// pid is the socket's last owner and changes if the socket is passed on.
func peerCred(c *net.UnixConn) (pid int32, uid uint32, err error) {
	raw, err := c.SyscallConn()
	if err != nil {
		return 0, 0, err
	}
	var cred *unix.Xucred
	var peerPid int
	var credErr, pidErr error
	if err := raw.Control(func(fd uintptr) {
		cred, credErr = unix.GetsockoptXucred(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
		peerPid, pidErr = unix.GetsockoptInt(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERPID)
	}); err != nil {
		return 0, 0, err
	}
	if err := errors.Join(credErr, pidErr); err != nil {
		return 0, 0, err
	}
	return int32(peerPid), cred.Uid, nil
}

func readProcess(pid int32, withCwd bool) (*agentpb.Process, int32, error) {
	info, err := unix.SysctlKinfoProc("kern.proc.pid", int(pid))
	if err != nil {
		return nil, 0, err
	}
	p := &agentpb.Process{Pid: pid, Uid: info.Eproc.Pcred.P_ruid}
	// The approver is shown this path, so it comes from the kernel:
	// kern.procargs2 also starts with one, but that copy sits in the
	// process's own memory, where it can be rewritten.
	p.Exe = clean(procPath(pid), 4096)
	if buf, err := unix.SysctlRaw("kern.procargs2", int(pid)); err == nil {
		p.Args = splitArgs(procArgs(buf))
	}
	if withCwd {
		p.Cwd = clean(procCwd(pid), 4096)
	}
	return p, info.Eproc.Ppid, nil
}

func procPath(pid int32) string {
	var buf [C.PROC_PIDPATHINFO_MAXSIZE]C.char
	n := C.proc_pidpath(C.int(pid), unsafe.Pointer(&buf[0]), C.uint32_t(len(buf)))
	if n <= 0 {
		return ""
	}
	return C.GoStringN(&buf[0], n)
}

func procCwd(pid int32) string {
	var info C.struct_proc_vnodepathinfo
	size := C.int(unsafe.Sizeof(info))
	if C.proc_pidinfo(C.int(pid), C.PROC_PIDVNODEPATHINFO, 0, unsafe.Pointer(&info), size) != size {
		return ""
	}
	return C.GoString(&info.pvi_cdir.vip_path[0])
}

// procArgs cuts the NUL-terminated arguments out of a kern.procargs2 buffer:
// argc as a native int32, the executable path, NUL padding up to an 8-byte
// boundary, the arguments, then the environment, which must stay out of the
// request. An empty first argument is a NUL too, so only the padding is
// skipped. A process that rewrites its title can merge its arguments while
// argc stays the same, so the arguments also end at the first one that could
// be an environment entry.
func procArgs(buf []byte) []byte {
	if len(buf) < 4 {
		return nil
	}
	argc := int(binary.NativeEndian.Uint32(buf))
	rest := buf[4:]
	path := bytes.IndexByte(rest, 0)
	if path < 0 {
		return nil
	}
	rest = rest[min((path+8)&^7, len(rest)):]
	end, afterFlag := 0, false
	for i := range argc {
		n := bytes.IndexByte(rest[end:], 0)
		if n < 0 {
			break
		}
		arg := rest[end : end+n]
		// "-o Name=value" and "--name=value" are arguments. The first argument
		// is a program name, even as "-zsh".
		flag := bytes.HasPrefix(arg, []byte("-"))
		if bytes.IndexByte(arg, '=') > 0 && !flag && !afterFlag {
			break
		}
		afterFlag = flag && i > 0
		end += n + 1
	}
	return rest[:end]
}

// openTerminal does what the Linux one does, finding fd 2 through libproc.
func openTerminal(pid int32) *os.File {
	var info C.struct_vnode_fdinfowithpath
	size := C.int(unsafe.Sizeof(info))
	if C.proc_pidfdinfo(C.int(pid), 2, C.PROC_PIDFDVNODEPATHINFO, unsafe.Pointer(&info), size) != size {
		return nil
	}
	f, err := os.OpenFile(C.GoString(&info.pvip.vip_path[0]), os.O_WRONLY|unix.O_NOCTTY|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil
	}
	return keepIfTerminal(f)
}
