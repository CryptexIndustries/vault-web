package agent

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func TestStateFilesArePrivateAndAtomic(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "cryptex-agent")
	// A folder someone created with looser permissions gets tightened.
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	store := Store{Dir: dir}
	if st, err := store.LoadState(); st != nil || err != nil {
		t.Fatalf("empty dir: %v, %v", st, err)
	}
	st := &State{
		Version: 1, RelayURL: "https://relay.example.com", SignSeed: bytes.Repeat([]byte{1}, 32), KEMSeed: bytes.Repeat([]byte{2}, 32),
		ApproverName: "Pixel 8", AgentName: "workstation", Keys: []GrantedKey{{PublicKey: []byte{1, 2}, Comment: "GitHub"}},
		KeysRevision: 3, PairedAt: time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC),
	}
	if err := store.SaveState(st); err != nil {
		t.Fatal(err)
	}
	st.KeysRevision = 4
	if err := store.SaveState(st); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveHosts(Hosts{"SHA256:abc": []byte{9}}); err != nil {
		t.Fatal(err)
	}
	mode := func(p string) os.FileMode {
		fi, err := os.Stat(p)
		if err != nil {
			t.Fatal(err)
		}
		return fi.Mode().Perm()
	}
	if m := mode(dir); m != 0o700 {
		t.Errorf("folder mode %o", m)
	}
	entries, _ := os.ReadDir(dir)
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
		if m := mode(filepath.Join(dir, e.Name())); m != 0o600 {
			t.Errorf("%s mode %o", e.Name(), m)
		}
	}
	// No temp files left behind.
	if !slices.Equal(names, []string{"hosts.json", "state.json", "state.lock"}) {
		t.Errorf("files = %v", names)
	}
	got, err := store.LoadState()
	if err != nil || got.KeysRevision != 4 || got.ApproverName != "Pixel 8" || !bytes.Equal(got.SignSeed, st.SignSeed) ||
		!got.PairedAt.Equal(st.PairedAt) || len(got.Keys) != 1 {
		t.Fatalf("round trip: %+v, %v", got, err)
	}
	hosts, err := store.LoadHosts()
	if err != nil || !bytes.Equal(hosts["SHA256:abc"], []byte{9}) {
		t.Fatalf("hosts: %v, %v", hosts, err)
	}
	// Unpair deletes only the pairing it unregistered, not one `pair
	// --force` saved meanwhile.
	if deleted, err := store.DeleteStateOf(bytes.Repeat([]byte{0xee}, 32)); deleted || err != nil {
		t.Fatalf("deleted another pairing: %v, %v", deleted, err)
	}
	if deleted, err := store.DeleteStateOf(st.SignSeed); !deleted || err != nil {
		t.Fatalf("delete the same pairing: %v, %v", deleted, err)
	}
	if st, _ := store.LoadState(); st != nil {
		t.Fatal("state survived DeleteStateOf")
	}
	if hosts, _ := store.LoadHosts(); len(hosts) != 0 {
		t.Fatal("hosts.json survived DeleteStateOf")
	}
	os.WriteFile(filepath.Join(dir, stateFile), []byte(`{"version":2}`), 0o600)
	if _, err := store.LoadState(); err == nil {
		t.Fatal("loaded a state file from a future version")
	}
}
