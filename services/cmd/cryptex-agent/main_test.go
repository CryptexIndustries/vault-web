package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/CryptexIndustries/vault-web/services/internal/agent/approvertest"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient/fakerelay"
)

func runCmd(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := run(args, strings.NewReader(""), &out, &errOut)
	return code, out.String(), errOut.String()
}

// tempHome points HOME and XDG_RUNTIME_DIR at a new folder.
func tempHome(t *testing.T) string {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_DATA_HOME", "")
	t.Setenv("XDG_CONFIG_HOME", "")
	t.Setenv("XDG_RUNTIME_DIR", home)
	return home
}

func TestCommands(t *testing.T) {
	home := tempHome(t)
	if code, out, _ := runCmd(t, "version"); code != 0 || out != "cryptex-agent dev\n" {
		t.Errorf("version: %d %q", code, out)
	}
	if code, _, errOut := runCmd(t, "frobnicate"); code != 2 || !strings.Contains(errOut, "unknown command") {
		t.Errorf("unknown command: %d %q", code, errOut)
	}
	if code, _, _ := runCmd(t); code != 2 {
		t.Errorf("no command: %d", code)
	}
	if code, _, _ := runCmd(t, "status", "extra"); code != 2 {
		t.Errorf("status with an argument: %d", code)
	}
	code, out, _ := runCmd(t, "status")
	if code != 0 || !strings.Contains(out, "Not paired. Run cryptex-agent pair.") || !strings.Contains(out, "Service: not running") {
		t.Errorf("status: %d %q", code, out)
	}
	if code, out, _ := runCmd(t, "unpair"); code != 0 || out != "Not paired.\n" {
		t.Errorf("unpair: %d %q", code, out)
	}
	// A broken config file stops pair before it touches the network.
	cfg := filepath.Join(home, ".config", "cryptex-agent")
	os.MkdirAll(cfg, 0o700)
	os.WriteFile(filepath.Join(cfg, "config"), []byte("relay = ftp://nope\n"), 0o600)
	if code, _, errOut := runCmd(t, "pair"); code != 1 || !strings.Contains(errOut, "relay URL") {
		t.Errorf("pair with a bad relay: %d %q", code, errOut)
	}
	if code, _, _ := runCmd(t, "pair", "--relay"); code != 2 {
		t.Errorf("pair --relay without a value: %d", code)
	}
	if strings.ContainsAny(usage, "·→") {
		t.Error("usage has a middle dot or arrow")
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

func waitForOutput(t *testing.T, out *syncBuffer, want string) string {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !strings.Contains(out.String(), want) {
		if time.Now().After(deadline) {
			t.Fatalf("no %q in:\n%s", want, out.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
	return out.String()
}

// Closing stdin at the confirmation prompt cancels: exit 1, nothing saved.
func TestPairCancelledAtConfirmation(t *testing.T) {
	home := tempHome(t)
	relay := fakerelay.Start(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	approver, err := approvertest.Connect(ctx, approvertest.Options{RelayURL: relay.URL, Name: "Pixel 8"})
	if err != nil {
		t.Fatal(err)
	}
	defer approver.Close()

	in, closeIn := io.Pipe()
	var out, errOut syncBuffer
	exit := make(chan int, 1)
	go func() { exit <- run([]string{"pair", "--relay", relay.URL}, in, &out, &errOut) }()
	text := waitForOutput(t, &out, "Waiting for Cryptex Vault")
	code, _, _ := strings.Cut(text[strings.Index(text, "cryptex-pair:"):], "\n")
	_, edKey, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(edKey)
	paired, err := approver.Pair(ctx, code, []ssh.Signer{signer}, "workstation")
	if err != nil {
		t.Fatal(err)
	}
	waitForOutput(t, &out, "    "+paired.ConfirmationCode+"\n")
	closeIn.Close()
	if c := <-exit; c != 1 {
		t.Fatalf("exit %d, stderr %q", c, errOut.String())
	}
	if !strings.HasSuffix(out.String(), "Pairing cancelled.\n") || errOut.String() != "" {
		t.Fatalf("stdout %q, stderr %q", out.String(), errOut.String())
	}
	if _, err := os.Stat(filepath.Join(home, ".local", "share", "cryptex-agent", "state.json")); !os.IsNotExist(err) {
		t.Fatalf("state.json: %v", err)
	}
	if relay.IsAgent(paired.Key) {
		t.Fatal("still registered on the relay")
	}
}
