package agent_test

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
	sshagent "golang.org/x/crypto/ssh/agent"

	"github.com/CryptexIndustries/vault-web/services/internal/agent"
	"github.com/CryptexIndustries/vault-web/services/internal/agent/approvertest"
	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient/fakerelay"
)

var (
	signersOnce sync.Once
	testSigners []ssh.Signer
)

// signers returns Ed25519, ECDSA and RSA test keys, made once because RSA
// generation is slow under the race detector.
func signers(t *testing.T) []ssh.Signer {
	signersOnce.Do(func() {
		_, ed, _ := ed25519.GenerateKey(rand.Reader)
		ec, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		rk, _ := rsa.GenerateKey(rand.Reader, 2048)
		for _, k := range []any{ed, ec, rk} {
			s, err := ssh.NewSignerFromKey(k)
			if err != nil {
				panic(err)
			}
			testSigners = append(testSigners, s)
		}
	})
	return testSigners
}

type env struct {
	t        *testing.T
	ctx      context.Context
	relay    *fakerelay.Relay
	approver *approvertest.Approver
	paths    agent.Paths
	paired   *approvertest.PairedAgent
	svc      *agent.Service

	mu       sync.Mutex
	notified []string // approver names shown in desktop notifications
}

func newEnv(t *testing.T) *env {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	relay := fakerelay.Start(t)
	// The agent tests sign all sorts of data; approvertest's checks on it
	// have their own tests.
	approver, err := approvertest.Connect(ctx, approvertest.Options{RelayURL: relay.URL, Name: "Pixel 8", AllowOther: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { approver.Close() })
	// Unix socket paths are limited to 108 bytes; test names make
	// t.TempDir long.
	runtime, err := os.MkdirTemp("", "cxa")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(runtime) })
	base := t.TempDir()
	return &env{t: t, ctx: ctx, relay: relay, approver: approver, paths: agent.Paths{
		DataDir:    filepath.Join(base, "data", "cryptex-agent"),
		ConfigFile: filepath.Join(base, "config"),
		Socket:     filepath.Join(runtime, agent.SocketName),
	}}
}

// pair runs agent.Pair against approver.Pair, as the terminal and the phone
// would, and presses Enter once both show the same confirmation code.
func (e *env) pair(keys []ssh.Signer) (*agent.State, string) {
	e.t.Helper()
	codes := make(chan string, 1)
	confirms := make(chan string, 1)
	in, enter := io.Pipe()
	defer enter.Close()
	var out syncBuffer
	type result struct {
		st  *agent.State
		err error
	}
	done := make(chan result, 1)
	go func() {
		st, err := agent.Pair(e.ctx, agent.PairOptions{
			Paths: e.paths, RelayURL: e.relay.URL, Out: &out, In: in, Version: "1.2.3", Hostname: "arch-desktop",
			OnCode:    func(c string) { codes <- c },
			OnConfirm: func(c string) { confirms <- c },
		})
		done <- result{st, err}
	}()
	var code string
	select {
	case code = <-codes:
	case r := <-done:
		e.t.Fatalf("Pair ended before showing a code: %v", r.err)
	}
	paired, err := e.approver.Pair(e.ctx, code, keys, "workstation")
	if err != nil {
		e.t.Fatal(err)
	}
	select {
	case shown := <-confirms:
		if shown != paired.ConfirmationCode {
			e.t.Fatalf("agent shows %s, approver %s", shown, paired.ConfirmationCode)
		}
	case r := <-done:
		e.t.Fatalf("Pair ended before showing the confirmation code: %v", r.err)
	}
	// Nothing is saved before Enter.
	if st, _ := (agent.Store{Dir: e.paths.DataDir}).LoadState(); st != nil && bytes.Equal(ed25519.NewKeyFromSeed(st.SignSeed).Public().(ed25519.PublicKey), paired.Key) {
		e.t.Fatal("state saved before the code was confirmed")
	}
	if _, err := enter.Write([]byte("\n")); err != nil {
		e.t.Fatal(err)
	}
	r := <-done
	if r.err != nil {
		e.t.Fatal(r.err)
	}
	e.paired = paired
	if paired.Offer.Hostname != "arch-desktop" || paired.Offer.AgentVersion != "1.2.3" {
		e.t.Errorf("offer = %v", paired.Offer)
	}
	if err := e.approver.WaitConfirmed(e.ctx, paired.Key); err != nil {
		e.t.Fatal("no PairingConfirm:", err)
	}
	return r.st, out.String()
}

func (e *env) start(opts agent.Options) {
	e.t.Helper()
	opts.Paths = e.paths
	opts.PollInterval = 50 * time.Millisecond
	if opts.Notify == nil {
		opts.Notify = func(name string) {
			e.mu.Lock()
			defer e.mu.Unlock()
			e.notified = append(e.notified, name)
		}
	}
	svc, err := agent.Listen(opts)
	if err != nil {
		e.t.Fatal(err)
	}
	e.svc = svc
	ctx, cancel := context.WithCancel(e.ctx)
	done := make(chan error, 1)
	go func() { done <- svc.Serve(ctx) }()
	e.t.Cleanup(func() {
		cancel()
		if err := <-done; err != nil {
			e.t.Errorf("Serve: %v", err)
		}
	})
	if e.paired != nil {
		e.waitFor("relay connection", func() bool { return svc.Status().Connected })
	}
}

func (e *env) notifications() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return slices.Clone(e.notified)
}

func (e *env) waitFor(what string, cond func() bool) {
	e.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			e.t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (e *env) client() (sshagent.ExtendedAgent, func()) {
	e.t.Helper()
	c, err := net.Dial("unix", e.paths.Socket)
	if err != nil {
		e.t.Fatal(err)
	}
	return sshagent.NewClient(c), func() { c.Close() }
}

func sessionBind(t *testing.T, host ssh.Signer, sid []byte, forwarding bool, corrupt bool) []byte {
	t.Helper()
	sig, err := host.Sign(rand.Reader, sid)
	if err != nil {
		t.Fatal(err)
	}
	if corrupt {
		sig.Blob[0] ^= 1
	}
	return ssh.Marshal(struct {
		HostKey, SessionID, Signature []byte
		Forwarding                    bool
	}{host.PublicKey().Marshal(), sid, ssh.Marshal(sig), forwarding})
}

// userauthData is what ssh signs for a publickey login (RFC 4252).
func userauthData(sid []byte, key ssh.PublicKey) []byte {
	return ssh.Marshal(struct {
		SessionID             []byte
		Type                  byte
		User, Service, Method string
		HasSig                bool
		Algo                  string
		Key                   []byte
	}{sid, 50, "git", "ssh-connection", "publickey", true, key.Type(), key.Marshal()})
}

func TestPairListSign(t *testing.T) {
	e := newEnv(t)
	keys := signers(t)
	st, out := e.pair(keys)
	for _, want := range []string{
		"Relay: " + e.relay.URL,
		"Scan this code in the Cryptex Vault Android app: Devices > Add > Connect an agent",
		"Or paste this code in Cryptex Vault (web app: Connected Agents > +): cryptex-pair:",
		"Waiting for Cryptex Vault...",
		"Code received. Finish in Cryptex Vault.",
		"Pixel 8 wants to pair. Check that it shows:\n\n    " + e.paired.ConfirmationCode + "\n\nPress Enter if it matches, or Ctrl-C to cancel.\n",
		`Paired with Pixel 8 as "workstation".`,
		"3 SSH keys available.",
		"export SSH_AUTH_SOCK=$XDG_RUNTIME_DIR/cryptex-agent.sock",
		"systemctl --user enable --now cryptex-agent",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("pair output lacks %q:\n%s", want, out)
		}
	}
	if strings.ContainsAny(out, "·→") {
		t.Errorf("pair output has a middle dot or arrow")
	}
	if !st.Confirmed || len(st.Keys) != 3 || st.ApproverName != "Pixel 8" {
		t.Errorf("state = %+v", st)
	}
	if _, err := agent.Pair(e.ctx, agent.PairOptions{Paths: e.paths, RelayURL: e.relay.URL}); !errors.Is(err, agent.ErrAlreadyPaired) {
		t.Fatalf("second pair: %v", err)
	}

	e.start(agent.Options{Hostname: func() string { return "arch-desktop" }})
	ag, closeClient := e.client()
	defer closeClient()
	listed, err := ag.List()
	if err != nil || len(listed) != 3 {
		t.Fatalf("List: %v, %v", listed, err)
	}
	for i, k := range listed {
		if !bytes.Equal(k.Marshal(), keys[i].PublicKey().Marshal()) || k.Comment != approvertest.KeyComment(i) {
			t.Errorf("key %d = %s %q", i, k.Type(), k.Comment)
		}
	}

	// A login: ssh binds the session to the server's host key, then signs.
	_, hostPriv, _ := ed25519.GenerateKey(rand.Reader)
	host, _ := ssh.NewSignerFromKey(hostPriv)
	sid := bytes.Repeat([]byte{7}, 32)
	if _, err := ag.Extension("session-bind@openssh.com", sessionBind(t, host, sid, false, false)); err != nil {
		t.Fatal(err)
	}
	data := func(k ssh.Signer) []byte { return userauthData(sid, k.PublicKey()) }
	for _, c := range []struct {
		key    ssh.Signer
		flags  sshagent.SignatureFlags
		format string
	}{
		{keys[1], 0, "ecdsa-sha2-nistp256"},
		{keys[2], sshagent.SignatureFlagRsaSha512, "rsa-sha2-512"},
		{keys[2], sshagent.SignatureFlagRsaSha256, "rsa-sha2-256"},
		{keys[0], 0, "ssh-ed25519"},
	} {
		sig, err := ag.SignWithFlags(c.key.PublicKey(), data(c.key), c.flags)
		if err != nil {
			t.Fatalf("%s: %v", c.format, err)
		}
		if sig.Format != c.format {
			t.Errorf("format %s, want %s", sig.Format, c.format)
		}
		if err := c.key.PublicKey().Verify(data(c.key), sig); err != nil {
			t.Errorf("%s signature doesn't verify: %v", c.format, err)
		}
	}

	reqs := e.approver.Requests()
	if len(reqs) != 4 {
		t.Fatalf("%d requests", len(reqs))
	}
	r := reqs[0]
	if r.Kind != approvertest.KindUserauth || r.Err != nil {
		t.Errorf("approver took the login as %s (%v)", r.Kind, r.Err)
	}
	if r.Sign.Hostname != "arch-desktop" || !bytes.Equal(r.Sign.Data, data(keys[1])) || len(r.Sign.SessionBinds) != 1 ||
		!bytes.Equal(r.Sign.SessionBinds[0].SessionId, sid) || r.Sign.SessionBinds[0].Forwarding {
		t.Errorf("request = %v", r.Sign)
	}
	if len(r.Sign.Processes) == 0 || r.Sign.Processes[0].Pid != int32(os.Getpid()) || r.Sign.Processes[0].Cwd == "" {
		t.Errorf("processes = %v", r.Sign.Processes)
	}
	if reqs[1].Sign.Flags != uint32(sshagent.SignatureFlagRsaSha512) {
		t.Errorf("flags = %d", reqs[1].Sign.Flags)
	}

	// The last key used with this host comes first next time.
	ag2, close2 := e.client()
	defer close2()
	if _, err := ag2.Extension("session-bind@openssh.com", sessionBind(t, host, bytes.Repeat([]byte{8}, 32), false, false)); err != nil {
		t.Fatal(err)
	}
	listed, _ = ag2.List()
	if !bytes.Equal(listed[0].Marshal(), keys[0].PublicKey().Marshal()) {
		t.Errorf("first key after a login with key 0: %s", listed[0].Comment)
	}
	// Signing a key that isn't granted never reaches the approver.
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	otherSigner, _ := ssh.NewSignerFromKey(other)
	if _, err := ag.Sign(otherSigner.PublicKey(), data(otherSigner)); err == nil {
		t.Error("signed with a key that isn't granted")
	}
	if n := len(e.approver.Requests()); n != 4 {
		t.Errorf("%d requests after a refused key", n)
	}
	if n := e.notifications(); len(n) != 0 {
		t.Errorf("notified for quick answers: %v", n)
	}

	var status bytes.Buffer
	if err := agent.PrintStatus(e.paths, &status); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`Paired with Pixel 8 as "workstation"`, "Relay: " + e.relay.URL, "3 SSH keys:", ssh.FingerprintSHA256(keys[0].PublicKey()), "Service: running"} {
		if !strings.Contains(status.String(), want) {
			t.Errorf("status lacks %q:\n%s", want, status.String())
		}
	}
}

func TestRefusalsTimeoutAndNotification(t *testing.T) {
	e := newEnv(t)
	keys := signers(t)[:1]
	e.pair(keys)
	e.start(agent.Options{RequestTimeout: 1500 * time.Millisecond, NotifyAfter: 300 * time.Millisecond})
	ag, closeClient := e.client()
	defer closeClient()
	data := []byte("x")

	e.approver.SetPolicy(func(context.Context, *approvertest.Request) approvertest.Decision { return approvertest.Deny })
	if _, err := ag.Sign(keys[0].PublicKey(), data); err == nil {
		t.Fatal("denied request signed")
	}
	if r := e.approver.Requests(); len(r) != 1 || r[0].Refusal != agentpb.RefusalReason_REFUSAL_REASON_DENIED {
		t.Fatalf("approver requests %+v", r)
	}

	// An answer after the notification delay still works and notifies once,
	// naming the approver.
	e.approver.SetPolicy(approvertest.Delay(600*time.Millisecond, approvertest.Approve))
	if _, err := ag.Sign(keys[0].PublicKey(), data); err != nil {
		t.Fatal(err)
	}
	if n := e.notifications(); len(n) != 1 || n[0] != "Pixel 8" {
		t.Fatalf("notifications %q", n)
	}

	e.approver.SetPolicy(func(context.Context, *approvertest.Request) approvertest.Decision { return approvertest.Ignore })
	start := time.Now()
	if _, err := ag.Sign(keys[0].PublicKey(), data); err == nil {
		t.Fatal("ignored request signed")
	}
	if waited := time.Since(start); waited < 1400*time.Millisecond || waited > 5*time.Second {
		t.Errorf("timed out after %v", waited)
	}

	// A session-bind whose signature doesn't verify is dropped by the
	// agent, so the login it would claim reaches the approver without a
	// bind: the approver sees no host and is told the destination is
	// unknown.
	e.approver.SetPolicy(nil)
	_, hostPriv, _ := ed25519.GenerateKey(rand.Reader)
	host, _ := ssh.NewSignerFromKey(hostPriv)
	sid := bytes.Repeat([]byte{1}, 32)
	if _, err := ag.Extension("session-bind@openssh.com", sessionBind(t, host, sid, false, true)); err == nil {
		t.Fatal("the agent took a forged session-bind")
	}
	if _, err := ag.Sign(keys[0].PublicKey(), userauthData(sid, keys[0].PublicKey())); err != nil {
		t.Fatalf("unbound login: %v", err)
	}
	reqs, _ := e.approver.WaitRequests(e.ctx, 4)
	last := reqs[len(reqs)-1]
	if !last.DestinationUnknown || len(last.Sign.SessionBinds) != 0 {
		t.Fatalf("last request: destination unknown %v with %d binds", last.DestinationUnknown, len(last.Sign.SessionBinds))
	}
}

func TestKeysUpdateRevokeAndReconnect(t *testing.T) {
	e := newEnv(t)
	keys := signers(t)
	e.pair(keys[:1])
	e.start(agent.Options{})
	ag, closeClient := e.client()
	defer closeClient()

	// While the agent is offline, a request waits and goes out on
	// reconnect.
	e.relay.DropConnections()
	sig, err := ag.Sign(keys[0].PublicKey(), []byte("after restart"))
	if err != nil || keys[0].PublicKey().Verify([]byte("after restart"), sig) != nil {
		t.Fatalf("sign across a relay restart: %v", err)
	}

	if err := e.approver.SendKeys(e.ctx, e.paired.Key, keys[1:], "laptop"); err != nil {
		t.Fatal(err)
	}
	e.waitFor("keys update", func() bool {
		l, _ := ag.List()
		return len(l) == 2
	})
	st, _ := agent.Store{Dir: e.paths.DataDir}.LoadState()
	if st.AgentName != "laptop" || st.KeysRevision != 2 {
		t.Errorf("state after update: %+v", st)
	}
	if _, err := ag.Sign(keys[0].PublicKey(), []byte("x")); err == nil {
		t.Error("signed with a key no longer granted")
	}

	if err := e.approver.Unregister(e.ctx, e.paired.Key); err != nil {
		t.Fatal(err)
	}
	e.waitFor("revocation", func() bool { return e.svc.Status().Revoked })
	if l, _ := ag.List(); len(l) != 0 {
		t.Errorf("revoked agent lists %d keys", len(l))
	}
	if _, err := ag.Sign(keys[1].PublicKey(), []byte("x")); err == nil {
		t.Error("revoked agent signed")
	}
	// The relay's word isn't proof, so the keys stay on disk, unused.
	st, _ = agent.Store{Dir: e.paths.DataDir}.LoadState()
	if !st.Revoked || len(st.Keys) != 2 {
		t.Errorf("state after revoke: %+v", st)
	}

	// A revoked agent can pair again without --force, and the running
	// service picks the new pairing up.
	e.pair(keys[:1])
	e.waitFor("new pairing", func() bool { s := e.svc.Status(); return s.Connected && s.Paired && s.Keys == 1 })
	if _, err := ag.Sign(keys[0].PublicKey(), []byte("again")); err != nil {
		t.Fatalf("sign after re-pairing: %v", err)
	}
}

func TestUnpair(t *testing.T) {
	e := newEnv(t)
	e.pair(signers(t)[:1])
	var out bytes.Buffer
	if err := agent.Unpair(e.ctx, agent.UnpairOptions{Paths: e.paths, Out: &out}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "Unpaired from Pixel 8.") || e.relay.IsAgent(e.paired.Key) {
		t.Fatalf("unpair: %q, still registered %v", out.String(), e.relay.IsAgent(e.paired.Key))
	}
	if st, _ := (agent.Store{Dir: e.paths.DataDir}).LoadState(); st != nil {
		t.Fatal("state kept after unpair")
	}

	// Without a relay the local state still goes, with a warning.
	e.pair(signers(t)[:1])
	e.relay.Close()
	out.Reset()
	if err := agent.Unpair(e.ctx, agent.UnpairOptions{Paths: e.paths, Out: &out}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "Pixel 8 still lists this agent until you revoke it there") {
		t.Fatalf("offline unpair: %q", out.String())
	}
	if st, _ := (agent.Store{Dir: e.paths.DataDir}).LoadState(); st != nil {
		t.Fatal("state kept after offline unpair")
	}
}

// An expired code is followed by a fresh one with its own identity, so an
// approver that claimed the old code and registered its key without
// answering doesn't block the next attempt.
func TestPairCodeExpiry(t *testing.T) {
	e := newEnv(t)
	codes := make(chan string, 4)
	opts := agent.PairOptions{Paths: e.paths, RelayURL: e.relay.URL, OnCode: func(c string) { codes <- c }}

	done := make(chan error, 1)
	go func() { _, err := agent.Pair(e.ctx, opts); done <- err }()
	<-codes
	e.relay.ExpireSlots()
	if err := <-done; !errors.Is(err, agent.ErrCodeExpired) {
		t.Fatalf("non-interactive expiry: %v", err)
	}

	// Interactive: Enter shows a new code, which then works.
	in, enter := io.Pipe()
	var out syncBuffer
	opts.Interactive, opts.In, opts.Out = true, in, &out
	go func() { _, err := agent.Pair(e.ctx, opts); done <- err }()
	first := <-codes
	firstCode, err := agentproto.ParsePairingCode(first)
	if err != nil {
		t.Fatal(err)
	}
	otherID, _ := agentproto.NewIdentity()
	other, err := relayclient.Connect(e.ctx, e.relay.URL, otherID, relayclient.Credentials{Role: agentpb.Role_ROLE_APPROVER}, relayclient.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	slot, err := other.ClaimSlot(e.ctx, firstCode.SlotId)
	if err != nil {
		t.Fatal(err)
	}
	offer, err := agentproto.ParseOffer(slot.Offer, firstCode.OfferHash)
	if err != nil {
		t.Fatal(err)
	}
	if err := other.RegisterAgent(e.ctx, offer.SignPublicKey, make([]byte, 32)); err != nil {
		t.Fatal(err)
	}

	e.relay.ExpireSlots()
	e.waitFor("expiry prompt", func() bool {
		return strings.Contains(out.String(), "Code expired. Press Enter for a new one, or Ctrl-C to stop.")
	})
	enter.Write([]byte("\n"))
	second := <-codes
	if first == second {
		t.Fatal("same code after expiry")
	}
	if _, err := e.approver.Pair(e.ctx, first, signers(t)[:1], "w"); err == nil {
		t.Fatal("expired code paired")
	}
	paired, err := e.approver.Pair(e.ctx, second, signers(t)[:1], "w")
	if err != nil {
		t.Fatalf("second code: %v", err)
	}
	// The same input then confirms the code.
	enter.Write([]byte("\n"))
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(paired.Key, offer.SignPublicKey) {
		t.Fatal("the second code reused the first code's identity")
	}
	st, _ := agent.Store{Dir: e.paths.DataDir}.LoadState()
	if st == nil || !bytes.Equal(ed25519.NewKeyFromSeed(st.SignSeed).Public().(ed25519.PublicKey), paired.Key) {
		t.Fatal("saved identity isn't the one that paired")
	}
}

func TestSocketHandling(t *testing.T) {
	e := newEnv(t)
	if _, err := agent.Listen(agent.Options{Paths: agent.Paths{DataDir: e.paths.DataDir}}); err == nil ||
		!strings.Contains(err.Error(), "XDG_RUNTIME_DIR") {
		t.Fatalf("no socket path: %v", err)
	}
	// A stale socket from a crashed agent is replaced.
	ln, err := net.Listen("unix", e.paths.Socket)
	if err != nil {
		t.Fatal(err)
	}
	ln.(*net.UnixListener).SetUnlinkOnClose(false)
	ln.Close()
	e.start(agent.Options{})
	fi, err := os.Stat(e.paths.Socket)
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("socket: %v, %v", fi, err)
	}
	// A live one isn't.
	if _, err := agent.Listen(agent.Options{Paths: e.paths}); err == nil || !strings.Contains(err.Error(), "already") {
		t.Fatalf("second agent: %v", err)
	}
	// Unpaired: List is empty, Sign fails, nothing crashes.
	ag, closeClient := e.client()
	defer closeClient()
	if l, err := ag.List(); err != nil || len(l) != 0 {
		t.Fatalf("unpaired List: %v, %v", l, err)
	}
	if _, err := ag.Sign(signers(t)[0].PublicKey(), []byte("x")); err == nil {
		t.Fatal("unpaired agent signed")
	}
}

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func TestOversizedAndRefusedRequests(t *testing.T) {
	e := newEnv(t)
	keys := signers(t)[:1]
	e.pair(keys)
	// The agent protocol carries no error text, so reasons are read from
	// the service log.
	var log syncBuffer
	// Long enough that waiting for it would fail the timing checks below.
	e.start(agent.Options{RequestTimeout: 60 * time.Second, Logger: slog.New(slog.NewTextHandler(&log, nil))})
	ag, closeClient := e.client()
	defer closeClient()
	key := keys[0].PublicKey()
	lastReason := func() string {
		lines := strings.Split(strings.TrimSpace(log.String()), "\n")
		for i := len(lines) - 1; i >= 0; i-- {
			if strings.Contains(lines[i], "Signature not given") {
				return lines[i]
			}
		}
		return ""
	}

	// Too large for an envelope: refused before it reaches the relay.
	sends := e.relay.Sends()
	if _, err := ag.Sign(key, make([]byte, 70<<10)); err == nil || !strings.Contains(lastReason(), "too large") {
		t.Fatalf("oversized request: %v, log %q", err, lastReason())
	}
	if e.relay.Sends() != sends || len(e.approver.Requests()) != 0 {
		t.Fatal("an oversized request reached the relay")
	}

	// hook applies fn to the agent's sign requests (not retained, unlike
	// PairingConfirm) and counts them.
	var seen atomic.Int32
	hook := func(fn func(n int32) (agentpb.Status, bool)) {
		e.relay.SetSendHook(func(sender []byte, env *agentpb.Envelope) (agentpb.Status, bool) {
			h, err := agentproto.ParseHeader(env)
			if err != nil || !bytes.Equal(sender, e.paired.Key) || h.Retain {
				return agentpb.Status_STATUS_OK, false
			}
			return fn(seen.Add(1))
		})
	}
	timed := func(what string, max time.Duration, wantErr string) {
		t.Helper()
		seen.Store(0)
		start := time.Now()
		_, err := ag.Sign(key, []byte(what))
		if err == nil || !strings.Contains(lastReason(), wantErr) {
			t.Fatalf("%s: %v, log %q, want %q", what, err, lastReason(), wantErr)
		}
		if took := time.Since(start); took > max {
			t.Errorf("%s: failed after %v", what, took)
		}
	}

	// A relay refusal fails the request at once.
	hook(func(int32) (agentpb.Status, bool) { return agentpb.Status_STATUS_LIMIT_REACHED, false })
	timed("refused", 2*time.Second, "relay")
	if seen.Load() != 1 {
		t.Errorf("refused request sent %d times", seen.Load())
	}

	// The first send is cut off and the resend refused: failed on the
	// resend.
	hook(func(n int32) (agentpb.Status, bool) {
		if n == 1 {
			return 0, true
		}
		return agentpb.Status_STATUS_TOO_LARGE, false
	})
	timed("refused on resend", 10*time.Second, "relay")
	if seen.Load() != 2 {
		t.Errorf("sent %d times", seen.Load())
	}

	// A relay that drops the socket whenever the request comes: given up
	// after two failed resends, not resent until the timeout.
	hook(func(int32) (agentpb.Status, bool) { return 0, true })
	timed("dropped", 20*time.Second, "the relay didn't take the request")
	if seen.Load() != 3 {
		t.Errorf("sent %d times", seen.Load())
	}

	// The service is fine afterwards.
	e.relay.SetSendHook(nil)
	e.waitFor("relay connection", func() bool { return e.svc.Status().Connected })
	if _, err := ag.Sign(key, []byte("fine")); err != nil {
		t.Fatal(err)
	}
}
