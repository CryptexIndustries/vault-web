package agent

import (
	"encoding/binary"
	"os/exec"
	"slices"
	"testing"

	"golang.org/x/sys/unix"
)

func TestProcArgs(t *testing.T) {
	buf := binary.NativeEndian.AppendUint32(nil, 2)
	buf = append(buf, "/usr/bin/ssh\x00\x00\x00\x00ssh\x00host\x00SECRET=hunter2\x00HOME=/Users/u\x00"...)
	if got, want := splitArgs(procArgs(buf)), []string{"ssh", "host"}; !slices.Equal(got, want) {
		t.Fatalf("args = %q, want %q", got, want)
	}
	// A rewritten title merged three arguments, and argc still says three.
	merged := binary.NativeEndian.AppendUint32(nil, 3)
	merged = append(merged, "/usr/bin/ssh\x00\x00\x00\x00my title\x00SECRET=hunter2\x00HOME=/Users/u\x00"...)
	if got, want := splitArgs(procArgs(merged)), []string{"my title"}; !slices.Equal(got, want) {
		t.Fatalf("args = %q, want %q", got, want)
	}
	flags := binary.NativeEndian.AppendUint32(nil, 5)
	flags = append(flags, "/usr/bin/ssh\x00\x00\x00\x00ssh\x00-o\x00A=b\x00--c=d\x00host\x00SECRET=hunter2\x00"...)
	if got, want := splitArgs(procArgs(flags)), []string{"ssh", "-o", "A=b", "--c=d", "host"}; !slices.Equal(got, want) {
		t.Fatalf("args = %q, want %q", got, want)
	}
	// Damaged buffers give what they hold, not a panic.
	for _, b := range [][]byte{nil, {1}, buf[:4], buf[:10], buf[:18], buf[:22]} {
		_ = splitArgs(procArgs(b))
	}
}

func TestProcArgsEmptyFirstArgument(t *testing.T) {
	cmd := exec.Command("/bin/sleep", "30")
	cmd.Args = []string{"", "30"}
	cmd.Env = []string{"SECRET=hunter2"}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})
	buf, err := unix.SysctlRaw("kern.procargs2", cmd.Process.Pid)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := splitArgs(procArgs(buf)), []string{"", "30"}; !slices.Equal(got, want) {
		t.Fatalf("args = %q, want %q", got, want)
	}
}
