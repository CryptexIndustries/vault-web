package agent

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/ssh"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	opts := Options{Paths: Paths{DataDir: filepath.Join(t.TempDir(), "cryptex-agent")}}
	opts.defaults()
	return newService(opts)
}

// loadState saves st and has s pick it up, as after `pair`.
func loadState(t *testing.T, s *Service, st *State) {
	t.Helper()
	if err := s.store.SaveState(st); err != nil {
		t.Fatal(err)
	}
	if err := s.reload(); err != nil {
		t.Fatal(err)
	}
}

func testState(seed byte) *State {
	return &State{
		Version: 1, RelayURL: "https://relay.example.com", SignSeed: bytes.Repeat([]byte{seed}, 32), KEMSeed: bytes.Repeat([]byte{seed}, 32),
		ApproverName: "Pixel 8", AgentName: "workstation", KeysRevision: 1,
	}
}

func TestStateChangesMergeWithPairRewrite(t *testing.T) {
	s := newTestService(t)
	loadState(t, s, testState(1))
	_, edKey, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(edKey)
	update := func(rev uint64) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.applyKeysUpdateLocked(&agentpb.KeysUpdate{
			Keys: []*agentpb.GrantedKey{{PublicKey: signer.PublicKey().Marshal(), Comment: "GitHub"}}, Revision: rev, AgentName: "laptop",
		})
	}

	// `pair` confirms after the service read the file, then a KeysUpdate
	// arrives before the next poll: both survive.
	confirmed := testState(1)
	confirmed.Confirmed = true
	if err := s.store.SaveState(confirmed); err != nil {
		t.Fatal(err)
	}
	update(2)
	disk, err := s.store.LoadState()
	if err != nil || !disk.Confirmed || disk.KeysRevision != 2 || len(disk.Keys) != 1 || disk.AgentName != "laptop" {
		t.Fatalf("on disk: %+v, %v", disk, err)
	}
	if st := s.Status(); st.Keys != 1 || !s.st.Confirmed {
		t.Errorf("in memory: %+v, confirmed %v", st, s.st.Confirmed)
	}

	// `pair --force` put another identity there: the change is dropped.
	other := testState(2)
	if err := s.store.SaveState(other); err != nil {
		t.Fatal(err)
	}
	update(3)
	disk, _ = s.store.LoadState()
	if !bytes.Equal(disk.SignSeed, other.SignSeed) || disk.KeysRevision != 1 || len(disk.Keys) != 0 {
		t.Fatalf("other pairing overwritten: %+v", disk)
	}

	// `unpair` deleted it: it stays deleted.
	if err := s.reload(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.store.DeleteStateOf(other.SignSeed); err != nil {
		t.Fatal(err)
	}
	update(4)
	if st, _ := s.store.LoadState(); st != nil {
		t.Fatalf("unpaired state resurrected: %+v", st)
	}
}
