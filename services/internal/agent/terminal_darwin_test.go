package agent

import (
	"bytes"
	"os"
	"testing"
	"unsafe"

	"golang.org/x/sys/unix"
)

// openPTY returns a pseudo-terminal's controller and terminal ends.
func openPTY(t *testing.T) (controller, terminal *os.File) {
	t.Helper()
	controller, err := os.OpenFile("/dev/ptmx", os.O_RDWR|unix.O_NOCTTY, 0)
	if err != nil {
		t.Skip("no pseudo-terminals:", err)
	}
	t.Cleanup(func() { controller.Close() })
	fd := controller.Fd()
	var name [128]byte
	for _, op := range []struct {
		req uintptr
		arg unsafe.Pointer
	}{{unix.TIOCPTYGRANT, nil}, {unix.TIOCPTYUNLK, nil}, {unix.TIOCPTYGNAME, unsafe.Pointer(&name[0])}} {
		if _, _, errno := unix.Syscall(unix.SYS_IOCTL, fd, op.req, uintptr(op.arg)); errno != 0 {
			t.Fatal(errno)
		}
	}
	path := string(name[:bytes.IndexByte(name[:], 0)])
	terminal, err = os.OpenFile(path, os.O_RDWR|unix.O_NOCTTY, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { terminal.Close() })
	return controller, terminal
}
