package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"golang.org/x/crypto/ssh/agent"
)

// checkRuntimeDir refuses a socket folder another user could tamper with:
// whoever can write there can swap the socket for their own and see every
// request.
func checkRuntimeDir(dir string) error {
	fi, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("the agent socket's folder (XDG_RUNTIME_DIR): %w", err)
	}
	if !fi.IsDir() {
		return fmt.Errorf("%s (XDG_RUNTIME_DIR) isn't a folder", dir)
	}
	st, ok := fi.Sys().(*syscall.Stat_t)
	if ok && st.Uid != uint32(os.Getuid()) {
		return fmt.Errorf("%s (XDG_RUNTIME_DIR) belongs to uid %d, not to you; refusing to put the agent socket there", dir, st.Uid)
	}
	if fi.Mode().Perm()&0o022 != 0 {
		return fmt.Errorf("%s (XDG_RUNTIME_DIR) is writable by other users (mode %04o); refusing to put the agent socket there. It should be 0700", dir, fi.Mode().Perm())
	}
	return nil
}

func listenSocket(path string) (*net.UnixListener, error) {
	if err := checkRuntimeDir(filepath.Dir(path)); err != nil {
		return nil, err
	}
	if fi, err := os.Lstat(path); err == nil {
		if fi.Mode()&os.ModeSocket == 0 {
			return nil, fmt.Errorf("%s exists and isn't a socket", path)
		}
		if c, err := net.DialTimeout("unix", path, time.Second); err == nil {
			c.Close()
			return nil, fmt.Errorf("another cryptex-agent is already serving %s", path)
		}
		// Left behind by an agent that didn't shut down cleanly.
		if err := os.Remove(path); err != nil {
			return nil, err
		}
	}
	ln, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return nil, err
	}
	// XDG_RUNTIME_DIR is private to the user (checked above); this and the
	// peer uid check are belt and braces.
	if err := os.Chmod(path, 0o600); err != nil {
		ln.Close()
		return nil, err
	}
	return ln, nil
}

// acceptLoop serves connections from accept until it reports the listener
// closed or a lasting error.
func (s *Service) acceptLoop(ctx context.Context, accept func() (*net.UnixConn, error)) error {
	var delay time.Duration
	for {
		c, err := accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return nil
			}
			var temp interface{ Temporary() bool }
			if !errors.As(err, &temp) || !temp.Temporary() {
				return err
			}
			// Out of file descriptors and the like: wait for some to free up
			// instead of ending the service, backing off like net/http.
			delay = min(max(2*delay, 5*time.Millisecond), time.Second)
			s.notice("accept", slog.LevelWarn, "Can't accept agent connections for now", "error", err)
			t := time.NewTimer(delay)
			select {
			case <-t.C:
			case <-ctx.Done():
				t.Stop()
				return nil
			}
			continue
		}
		delay = 0
		pid, uid, err := peerCred(c)
		if err != nil || uid != uint32(os.Getuid()) {
			s.log.Warn("refused a connection from another user", "uid", uid, "error", err)
			c.Close()
			continue
		}
		// Tracked before the goroutine starts so Serve's shutdown can't miss
		// it.
		s.mu.Lock()
		s.sessions[c] = struct{}{}
		s.mu.Unlock()
		go s.serveSession(c, pid, uid)
	}
}

func (s *Service) serveSession(c net.Conn, pid int32, uid uint32) {
	defer func() {
		c.Close()
		s.mu.Lock()
		delete(s.sessions, c)
		s.mu.Unlock()
	}()
	_ = agent.ServeAgent(&session{svc: s, pid: pid, uid: uid}, c)
}

func (s *Service) closeSessions() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for c := range s.sessions {
		c.Close()
	}
}
