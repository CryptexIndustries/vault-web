package agent

import (
	"context"
	"errors"
	"net"
	"os"
	"syscall"
	"testing"
	"time"
)

type tempErr struct{}

func (tempErr) Error() string   { return "too many open files" }
func (tempErr) Temporary() bool { return true }
func (tempErr) Timeout() bool   { return false }

func TestAcceptLoopRetriesTemporaryErrors(t *testing.T) {
	s := newTestService(t)
	calls := 0
	start := time.Now()
	err := s.acceptLoop(context.Background(), func() (*net.UnixConn, error) {
		calls++
		switch {
		case calls == 1:
			// What accept returns on EMFILE.
			return nil, &net.OpError{Op: "accept", Net: "unix", Err: os.NewSyscallError("accept4", syscall.EMFILE)}
		case calls <= 4:
			return nil, tempErr{}
		}
		return nil, net.ErrClosed
	})
	if err != nil || calls != 5 {
		t.Fatalf("acceptLoop = %v after %d calls", err, calls)
	}
	// 5, 10, 20 and 40 ms.
	if waited := time.Since(start); waited < 75*time.Millisecond {
		t.Errorf("retried after %v in total", waited)
	}

	// A lasting error still ends the loop.
	boom := errors.New("boom")
	if err := s.acceptLoop(context.Background(), func() (*net.UnixConn, error) { return nil, boom }); err != boom {
		t.Fatalf("lasting error: %v", err)
	}

	// Shutting down while backing off returns at once.
	ctx, cancel := context.WithCancel(context.Background())
	calls = 0
	done := make(chan error, 1)
	go func() {
		done <- s.acceptLoop(ctx, func() (*net.UnixConn, error) { calls++; return nil, tempErr{} })
	}()
	time.Sleep(50 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("acceptLoop kept backing off after shutdown")
	}
}
