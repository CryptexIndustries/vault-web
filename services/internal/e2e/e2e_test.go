// Package e2e runs the relay, cryptex-agent and the test approver together in
// one process and drives them with the real OpenSSH tools, including an sshd
// on a local port. Missing tools skip the tests, except in CI.
package e2e

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
	"golang.org/x/crypto/ssh"
	sshagent "golang.org/x/crypto/ssh/agent"

	"github.com/CryptexIndustries/vault-web/services/internal/agent"
	"github.com/CryptexIndustries/vault-web/services/internal/agent/approvertest"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relay"
)

const token = "e2e-access-token"

// relayHost runs one relay on a fixed address so a test can restart it with
// the same database.
type relayHost struct {
	t      *testing.T
	addr   string
	dbPath string
	cfg    func(*relay.Config)

	mu     sync.Mutex
	server *relay.Server
	http   *http.Server
}

func startRelay(t *testing.T, cfg func(*relay.Config)) *relayHost {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	h := &relayHost{t: t, addr: ln.Addr().String(), dbPath: filepath.Join(t.TempDir(), "relay.db"), cfg: cfg}
	h.serve(ln)
	t.Cleanup(h.stop)
	return h
}

func (h *relayHost) URL() string { return "http://" + h.addr }

func (h *relayHost) serve(ln net.Listener) {
	cfg := relay.Config{
		PublicURL:   h.URL(),
		Auth:        relay.AuthToken,
		AccessToken: token,
		Keepalive:   10 * time.Second,
		DBPath:      h.dbPath,
		Logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if h.cfg != nil {
		h.cfg(&cfg)
	}
	srv, err := relay.New(cfg)
	if err != nil {
		h.t.Fatal(err)
	}
	hs := &http.Server{Handler: srv.Handler()}
	go hs.Serve(ln)
	h.mu.Lock()
	h.server, h.http = srv, hs
	h.mu.Unlock()
}

func (h *relayHost) stop() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.server == nil {
		return
	}
	// Shutdown doesn't wait for WebSockets; Close ends them.
	h.http.Close()
	h.server.Close()
	h.server = nil
}

// restart stops the relay and starts a new one on the same address and
// database, as a redeploy would.
func (h *relayHost) restart() {
	h.stop()
	var ln net.Listener
	var err error
	for range 50 {
		if ln, err = net.Listen("tcp", h.addr); err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err != nil {
		h.t.Fatal(err)
	}
	h.serve(ln)
}

// paired is one agent paired with one test approver.
type paired struct {
	t        *testing.T
	approver *approvertest.Approver
	agentKey []byte
	paths    agent.Paths
	service  *agent.Service
	stopSvc  func()
	opts     agent.Options
	keys     []ssh.Signer
}

type setup struct {
	approver approvertest.Options
	agent    func(*agent.Options)
}

func testKeys(t *testing.T) []ssh.Signer {
	t.Helper()
	_, edKey, _ := ed25519.GenerateKey(rand.Reader)
	ecKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	rsaKey, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	var out []ssh.Signer
	for _, k := range []any{edKey, ecKey, rsaKey} {
		s, err := ssh.NewSignerFromKey(k)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func ctxFor(t *testing.T, d time.Duration) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), d)
	t.Cleanup(cancel)
	return ctx
}

func pair(t *testing.T, rh *relayHost, s setup) *paired {
	t.Helper()
	ctx := ctxFor(t, 60*time.Second)
	opts := s.approver
	opts.RelayURL = rh.URL()
	if opts.Token == "" && opts.Pass == "" {
		opts.Token = token
	}
	approver, err := approvertest.Connect(ctx, opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { approver.Close() })

	// Unix socket paths are limited to 108 bytes, so not under t.TempDir().
	sockDir, err := os.MkdirTemp("", "cxa-e2e-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(sockDir) })
	data := t.TempDir()
	paths := agent.Paths{
		DataDir:    filepath.Join(data, "data"),
		ConfigFile: filepath.Join(data, "config"),
		Socket:     filepath.Join(sockDir, "agent.sock"),
	}
	p := &paired{t: t, approver: approver, paths: paths, keys: testKeys(t)}

	codes, confirms := make(chan string, 1), make(chan string, 1)
	pairErr := make(chan error, 1)
	in, enter := io.Pipe()
	defer enter.Close()
	go func() {
		_, err := agent.Pair(ctx, agent.PairOptions{
			Paths: paths, RelayURL: rh.URL(), Version: "e2e", Out: io.Discard, In: in,
			OnCode:    func(code string) { codes <- code },
			OnConfirm: func(code string) { confirms <- code },
		})
		pairErr <- err
	}()
	var code string
	select {
	case code = <-codes:
	case err := <-pairErr:
		t.Fatalf("pair stopped before showing a code: %v", err)
	case <-ctx.Done():
		t.Fatal("no pairing code")
	}
	pa, err := approver.Pair(ctx, code, p.keys, "workstation")
	if err != nil {
		t.Fatal(err)
	}
	// The user compares the codes on both screens and presses Enter.
	select {
	case shown := <-confirms:
		if shown != pa.ConfirmationCode {
			t.Fatalf("agent shows confirmation code %s, approver %s", shown, pa.ConfirmationCode)
		}
	case err := <-pairErr:
		t.Fatalf("pair stopped before the confirmation code: %v", err)
	case <-ctx.Done():
		t.Fatal("no confirmation code")
	}
	if _, err := enter.Write([]byte("\n")); err != nil {
		t.Fatal(err)
	}
	if err := <-pairErr; err != nil {
		t.Fatal(err)
	}
	p.agentKey = pa.Key
	if err := approver.WaitConfirmed(ctx, pa.Key); err != nil {
		t.Fatalf("no PairingConfirm: %v", err)
	}

	agentOpts := agent.Options{
		Paths: paths, Version: "e2e", PollInterval: 100 * time.Millisecond,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		// No notify-send while tests run.
		Notify: func(string) {},
	}
	if s.agent != nil {
		s.agent(&agentOpts)
	}
	p.opts = agentOpts
	p.startAgent()
	t.Cleanup(p.stopAgent)
	p.waitFor(func() bool { return p.service.Status().Connected }, "agent never connected to the relay")
	return p
}

// startAgent runs `cryptex-agent run` in-process.
func (p *paired) startAgent() {
	p.t.Helper()
	svc, err := agent.Listen(p.opts)
	if err != nil {
		p.t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		svc.Serve(ctx)
	}()
	p.service = svc
	p.stopSvc = func() {
		cancel()
		<-done
	}
}

func (p *paired) stopAgent() {
	if p.stopSvc != nil {
		p.stopSvc()
		p.stopSvc = nil
	}
}

func (p *paired) waitFor(cond func() bool, msg string) {
	p.t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			p.t.Fatal(msg)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// tool runs an OpenSSH tool against the agent socket.
func (p *paired) tool(stdin []byte, name string, args ...string) ([]byte, error) {
	p.t.Helper()
	cmd := exec.Command(name, args...)
	cmd.Env = append(os.Environ(), "SSH_AUTH_SOCK="+p.paths.Socket)
	cmd.Stdin = bytes.NewReader(stdin)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return out, errors.New(strings.TrimSpace(stderr.String()) + ": " + err.Error())
	}
	return out, nil
}

// sshsigData is what ssh-keygen -Y sign asks the agent to sign (an SSHSIG
// blob, PROTOCOL.sshsig); approvertest refuses data that is neither that
// nor an SSH login.
func sshsigData() []byte {
	return append([]byte("SSHSIG"), ssh.Marshal(struct {
		Namespace, Reserved, Hash string
		H                         []byte
	}{"git", "", "sha512", make([]byte, 64)})...)
}

func (p *paired) client() sshagent.ExtendedAgent {
	p.t.Helper()
	conn, err := net.Dial("unix", p.paths.Socket)
	if err != nil {
		p.t.Fatal(err)
	}
	p.t.Cleanup(func() { conn.Close() })
	return sshagent.NewClient(conn)
}

// needTools skips when OpenSSH isn't installed, except in CI where a skip
// would hide that the suite didn't run.
func needTools(t *testing.T, names ...string) {
	t.Helper()
	for _, name := range names {
		if _, err := exec.LookPath(name); err != nil {
			if os.Getenv("CI") != "" {
				t.Fatalf("%s is required in CI", name)
			}
			t.Skipf("%s not installed", name)
		}
	}
}

func TestListAndSignWithOpenSSHTools(t *testing.T) {
	needTools(t, "ssh-add", "ssh-keygen")
	p := pair(t, startRelay(t, nil), setup{})

	out, err := p.tool(nil, "ssh-add", "-L")
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) != len(p.keys) {
		t.Fatalf("ssh-add -L listed %d keys, want %d:\n%s", len(lines), len(p.keys), out)
	}
	for i, k := range p.keys {
		want := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(k.PublicKey()))) + " " + approvertest.KeyComment(i)
		if lines[i] != want {
			t.Errorf("ssh-add -L line %d = %q, want %q", i, lines[i], want)
		}
	}

	dir := t.TempDir()
	message := []byte("commit to sign\n")
	for i, k := range p.keys {
		pub := filepath.Join(dir, "key.pub")
		os.WriteFile(pub, ssh.MarshalAuthorizedKey(k.PublicKey()), 0o600)
		sig, err := p.tool(message, "ssh-keygen", "-Y", "sign", "-f", pub, "-n", "git")
		if err != nil {
			t.Fatalf("%s: ssh-keygen -Y sign: %v", k.PublicKey().Type(), err)
		}
		sigPath := filepath.Join(dir, "msg.sig")
		os.WriteFile(sigPath, sig, 0o600)
		allowedPath := filepath.Join(dir, "allowed_signers")
		os.WriteFile(allowedPath, append([]byte("signer@example.com "), ssh.MarshalAuthorizedKey(k.PublicKey())...), 0o600)
		if _, err := p.tool(message, "ssh-keygen", "-Y", "verify", "-f", allowedPath, "-I", "signer@example.com", "-n", "git", "-s", sigPath); err != nil {
			t.Fatalf("%s: ssh-keygen -Y verify: %v", k.PublicKey().Type(), err)
		}
		reqs := p.approver.Requests()
		if len(reqs) != i+1 {
			t.Fatalf("approver saw %d requests, want %d", len(reqs), i+1)
		}
		last := reqs[i].Sign
		if !bytes.Equal(last.PublicKey, k.PublicKey().Marshal()) {
			t.Error("request names the wrong key")
		}
		if reqs[i].Kind != approvertest.KindSSHSig || reqs[i].Namespace != "git" {
			t.Errorf("approver saw %s %q, want sshsig git", reqs[i].Kind, reqs[i].Namespace)
		}
		if len(last.Processes) == 0 || filepath.Base(last.Processes[0].Exe) != "ssh-keygen" {
			t.Errorf("first process in the chain = %+v, want ssh-keygen", last.Processes)
		}
	}
}

func TestKeysUpdate(t *testing.T) {
	p := pair(t, startRelay(t, nil), setup{})
	ctx := ctxFor(t, 20*time.Second)
	if err := p.approver.SendKeys(ctx, p.agentKey, p.keys[:1], "renamed"); err != nil {
		t.Fatal(err)
	}
	client := p.client()
	p.waitFor(func() bool {
		keys, err := client.List()
		return err == nil && len(keys) == 1 && bytes.Equal(keys[0].Blob, p.keys[0].PublicKey().Marshal())
	}, "key list never shrank to the one key left")
	st, err := agent.Store{Dir: p.paths.DataDir}.LoadState()
	if err != nil || st.AgentName != "renamed" {
		t.Fatalf("state after KeysUpdate: %+v %v", st, err)
	}
}

func TestRevokeOverHTTP(t *testing.T) {
	p := pair(t, startRelay(t, nil), setup{})
	ctx := ctxFor(t, 20*time.Second)
	status, err := p.approver.RevokeOverHTTP(ctx, p.agentKey)
	if err != nil || status != http.StatusNoContent {
		t.Fatalf("revoke: %d %v", status, err)
	}
	p.waitFor(func() bool { return p.service.Status().Revoked }, "agent never learned it was revoked")
	keys, err := p.client().List()
	if err != nil || len(keys) != 0 {
		t.Fatalf("revoked agent lists %d keys (%v)", len(keys), err)
	}
	if err := p.approver.WaitFor(ctx, func() bool { return p.approver.Revoked(p.agentKey) }); err != nil {
		t.Fatal("approver wasn't told about the revocation")
	}
}

func TestRevokedWhileOffline(t *testing.T) {
	p := pair(t, startRelay(t, nil), setup{})
	ctx := ctxFor(t, 20*time.Second)
	// The machine is off while the user revokes the agent on the phone.
	p.stopAgent()
	if status, err := p.approver.RevokeOverHTTP(ctx, p.agentKey); err != nil || status != http.StatusNoContent {
		t.Fatalf("revoke: %d %v", status, err)
	}
	p.startAgent()
	p.waitFor(func() bool { return p.service.Status().Revoked }, "agent revoked while offline never found out")
	if keys, err := p.client().List(); err != nil || len(keys) != 0 {
		t.Fatalf("revoked agent lists %d keys (%v)", len(keys), err)
	}
}

func TestUnpair(t *testing.T) {
	p := pair(t, startRelay(t, nil), setup{})
	ctx := ctxFor(t, 20*time.Second)
	if err := agent.Unpair(ctx, agent.UnpairOptions{Paths: p.paths, Out: io.Discard, Version: "e2e"}); err != nil {
		t.Fatal(err)
	}
	if err := p.approver.WaitFor(ctx, func() bool { return p.approver.Revoked(p.agentKey) }); err != nil {
		t.Fatal("approver wasn't told the agent unpaired itself")
	}
	p.waitFor(func() bool { return !p.service.Status().Paired }, "service still paired after unpair")
	// The relay's Revoked notice reaches the service after unpair deleted
	// the state; the service must not write it back.
	time.Sleep(5 * p.opts.PollInterval)
	if st, err := (agent.Store{Dir: p.paths.DataDir}).LoadState(); err != nil || st != nil {
		t.Fatalf("state after unpair: %+v %v", st, err)
	}
	if status := p.service.Status(); status.Paired || status.Revoked {
		t.Fatalf("service status after unpair: %+v", status)
	}
}

func TestRequestSurvivesRelayRestart(t *testing.T) {
	rh := startRelay(t, nil)
	p := pair(t, rh, setup{})
	ctx := ctxFor(t, 40*time.Second)
	client := p.client()

	// The relay restarts while the user is still looking at the request.
	release := make(chan struct{})
	p.approver.SetPolicy(func(ctx context.Context, _ *approvertest.Request) approvertest.Decision {
		select {
		case <-release:
		case <-ctx.Done():
		}
		return approvertest.Approve
	})
	result := make(chan error, 1)
	go func() {
		sig, err := client.Sign(p.keys[0].PublicKey(), sshsigData())
		if err == nil {
			err = p.keys[0].PublicKey().Verify(sshsigData(), sig)
		}
		result <- err
	}()
	if err := p.approver.WaitFor(ctx, func() bool { return len(p.approver.Requests()) == 1 }); err != nil {
		t.Fatal(err)
	}
	rh.restart()
	close(release)
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("sign across a relay restart: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("request never answered after the relay restarted")
	}
}

// signPass makes a relay pass the way the Online Services backend does, for
// the approver whose relay key is approverKey.
func signPass(t *testing.T, key *mldsa65.PrivateKey, aud, sub, dev string, agents int, exp time.Time, approverKey []byte) string {
	t.Helper()
	raw, _ := json.Marshal(relay.Pass{
		Version: 1, KeyID: "e2e", Audience: aud, Subject: sub, Device: dev,
		IssuedAt: time.Now().Add(-time.Minute).Unix(), Expiry: exp.Unix(), ID: dev + "-" + sub,
		Limits: relay.PassLimits{Agents: agents}, Key: base64.RawURLEncoding.EncodeToString(approverKey),
	})
	part := base64.RawURLEncoding.EncodeToString(raw)
	sig := make([]byte, mldsa65.SignatureSize)
	if err := mldsa65.SignTo(key, []byte(relay.PassSigningPrefix+part), nil, true, sig); err != nil {
		t.Fatal(err)
	}
	return part + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func TestHostedRelayWithPasses(t *testing.T) {
	pk, sk, err := mldsa65.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	rh := startRelay(t, func(c *relay.Config) {
		c.Auth = relay.AuthTicket
		c.AccessToken = ""
		c.PassKeys = map[string]*mldsa65.PublicKey{"e2e": pk}
	})
	phone, err := agentproto.NewIdentity()
	if err != nil {
		t.Fatal(err)
	}
	pass := signPass(t, sk, rh.URL(), "user-1", "phone-1", 1, time.Now().Add(7*24*time.Hour), phone.ID())
	p := pair(t, rh, setup{approver: approvertest.Options{Pass: pass, Identity: phone}})
	if _, err := p.client().Sign(p.keys[0].PublicKey(), sshsigData()); err != nil {
		t.Fatalf("sign through the hosted relay: %v", err)
	}

	// The pass allows one agent, so a second pairing is refused.
	ctx := ctxFor(t, 30*time.Second)
	codes := make(chan string, 1)
	sockDir := t.TempDir()
	go agent.Pair(ctx, agent.PairOptions{
		Paths: agent.Paths{DataDir: filepath.Join(sockDir, "data")}, RelayURL: rh.URL(), Out: io.Discard,
		OnCode: func(code string) { codes <- code },
	})
	if _, err := p.approver.Pair(ctx, <-codes, p.keys, "second"); err == nil || !strings.Contains(strings.ToLower(err.Error()), "limit") {
		t.Fatalf("second agent over the pass limit: %v", err)
	}

	// Passes for another relay, expired ones, or ones issued for another
	// device's key don't get an approver in.
	other, err := agentproto.NewIdentity()
	if err != nil {
		t.Fatal(err)
	}
	for name, bad := range map[string]string{
		"wrong audience": signPass(t, sk, "https://relay.example", "user-1", "phone-2", 25, time.Now().Add(time.Hour), other.ID()),
		"expired":        signPass(t, sk, rh.URL(), "user-1", "phone-2", 25, time.Now().Add(-time.Hour), other.ID()),
		"another key":    signPass(t, sk, rh.URL(), "user-1", "phone-2", 25, time.Now().Add(time.Hour), phone.ID()),
	} {
		connectCtx := ctxFor(t, 10*time.Second)
		if a, err := approvertest.Connect(connectCtx, approvertest.Options{RelayURL: rh.URL(), Pass: bad, Identity: other}); err == nil {
			a.Close()
			t.Errorf("%s: approver connected", name)
		}
	}
}
