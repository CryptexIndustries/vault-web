package agent

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

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
	if err := unix.IoctlSetPointerInt(int(controller.Fd()), unix.TIOCSPTLCK, 0); err != nil {
		t.Fatal(err)
	}
	n, err := unix.IoctlGetInt(int(controller.Fd()), unix.TIOCGPTN)
	if err != nil {
		t.Fatal(err)
	}
	terminal, err = os.OpenFile("/dev/pts/"+strconv.Itoa(n), os.O_RDWR|unix.O_NOCTTY, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { terminal.Close() })
	return controller, terminal
}

// startWithStderr runs a process that waits, with stderr going to w.
func startWithStderr(t *testing.T, w *os.File) int32 {
	t.Helper()
	cmd := exec.Command("sleep", "30")
	cmd.Stderr = w
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cmd.Process.Kill(); cmd.Wait() })
	return int32(cmd.Process.Pid)
}

func TestWriteTerminal(t *testing.T) {
	controller, terminal := openPTY(t)
	term := openTerminal(startWithStderr(t, terminal))
	if term == nil {
		t.Fatal("didn't open the terminal")
	}
	defer term.Close()
	writeTerminal(term, "cryptex-agent: waiting for approval on Phone")
	controller.SetReadDeadline(time.Now().Add(5 * time.Second))
	buf := make([]byte, 256)
	n, err := controller.Read(buf)
	if err != nil || !strings.Contains(string(buf[:n]), "waiting for approval on Phone") {
		t.Fatalf("terminal got %q, %v", buf[:n], err)
	}

	// A pipe (a script, a log) gets nothing.
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if term := openTerminal(startWithStderr(t, w)); term != nil {
		term.Close()
		t.Fatal("opened a pipe as a terminal")
	}
	w.Close()

	// A terminal nobody reads doesn't hold the agent up.
	done := make(chan struct{})
	go func() {
		writeTerminal(term, strings.Repeat("x", 1<<20))
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("writing to a full terminal blocked")
	}
}
