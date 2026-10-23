package agent

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/sys/unix"

	"github.com/CryptexIndustries/vault-web/services/internal/agent/termsafe"
	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

const (
	stateFile = "state.json"
	hostsFile = "hosts.json"
	// lockFile guards state.json; see Store.lock. It is never deleted, so
	// every process locks the same file.
	lockFile = "state.lock"
)

// GrantedKey is an SSH public key the approver lets this agent use.
type GrantedKey struct {
	// PublicKey is the SSH wire format.
	PublicKey []byte `json:"public_key"`
	Comment   string `json:"comment"`
}

// grantedKeys keeps the keys that parse; the approver's list is trusted but
// a key the SSH library can't read is useless to ssh anyway. Comments end up
// in ssh-add -L and status output, so they are made safe to print.
func grantedKeys(in []*agentpb.GrantedKey) []GrantedKey {
	out := make([]GrantedKey, 0, len(in))
	for _, k := range in {
		if _, err := ssh.ParsePublicKey(k.GetPublicKey()); err == nil {
			out = append(out, GrantedKey{PublicKey: k.PublicKey, Comment: termsafe.Comment(k.Comment)})
		}
	}
	return out
}

// State is everything the agent knows about its pairing.
type State struct {
	Version    int    `json:"version"`
	RelayURL   string `json:"relay_url"`
	RelayToken string `json:"relay_token,omitempty"`
	// SignSeed and KEMSeed are the agent identity (secret).
	SignSeed []byte `json:"sign_seed"`
	KEMSeed  []byte `json:"kem_seed"`

	ApproverSignKey []byte `json:"approver_sign_key"`
	ApproverKEMKey  []byte `json:"approver_kem_key"`
	ApproverName    string `json:"approver_name"`
	AgentName       string `json:"agent_name"`

	Keys         []GrantedKey `json:"keys"`
	KeysRevision uint64       `json:"keys_revision"`
	PairedAt     time.Time    `json:"paired_at"`
	// Confirmed is set once the retained PairingConfirm reached the relay;
	// until then the service sends it when it connects.
	Confirmed bool `json:"confirmed"`
	// Revoked is set when the relay said the registration is gone. The
	// relay can't prove that, so the keys stay but aren't served, and the
	// flag clears if the relay takes the agent again.
	Revoked bool `json:"revoked,omitempty"`
	// GoneSince is when the relay began saying this agent is revoked or
	// unknown. It clears when the relay takes the agent again; a week
	// later the service stops asking.
	GoneSince time.Time `json:"gone_since,omitzero"`
}

// Hosts maps a server's SHA256 host key fingerprint to the key blob last
// used with it. Public data, but kept with the rest at 0600.
type Hosts map[string][]byte

// Store reads and writes the data directory.
type Store struct{ Dir string }

func (s Store) ensureDir() error {
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return err
	}
	// MkdirAll leaves an existing folder alone; the identity must not be
	// readable by others, so tighten it.
	return os.Chmod(s.Dir, 0o700)
}

// lock takes the data directory's lock, shared by the service, `pair` and
// `unpair` so that each read, merge and write (or delete) of state.json
// happens as one step. Atomic renames alone keep readers safe, but a write
// based on an older read could still undo another process's change. The
// lock goes with the returned function or the process.
func (s Store) lock() (unlock func(), err error) {
	if err := s.ensureDir(); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(s.Dir, lockFile), os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}
	for {
		err = unix.Flock(int(f.Fd()), unix.LOCK_EX)
		if err != unix.EINTR {
			break
		}
	}
	if err != nil {
		f.Close()
		return nil, fmt.Errorf("lock %s: %w", lockFile, err)
	}
	return func() { f.Close() }, nil
}

// writeAtomic replaces name in one step so a crash never leaves half a
// state file, and a reader never sees one.
func (s Store) writeAtomic(name string, data []byte) error {
	if err := s.ensureDir(); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.Dir, "."+name+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), filepath.Join(s.Dir, name)); err != nil {
		return err
	}
	// Readers see the new file now, but the rename only survives a crash
	// once the directory is synced.
	if err := s.syncDir(); err != nil {
		return fmt.Errorf("saved, but not yet safe from a crash: %s: %w", name, err)
	}
	return nil
}

// syncDir makes renames in the data directory durable.
func (s Store) syncDir() error {
	dir, err := os.Open(s.Dir)
	if err != nil {
		return err
	}
	err = fsyncDir(dir)
	if cerr := dir.Close(); err == nil {
		err = cerr
	}
	return err
}

// fsyncDir is dir.Sync; tests replace it to make the sync fail.
var fsyncDir = (*os.File).Sync

// readState returns state.json's contents, nil when it doesn't exist.
func (s Store) readState() ([]byte, error) {
	data, err := os.ReadFile(filepath.Join(s.Dir, stateFile))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return data, err
}

func parseState(data []byte) (*State, error) {
	if data == nil {
		return nil, nil
	}
	var st State
	if err := json.Unmarshal(data, &st); err != nil {
		return nil, fmt.Errorf("state.json: %w", err)
	}
	if st.Version != 1 {
		return nil, fmt.Errorf("state.json: unsupported version %d", st.Version)
	}
	return &st, nil
}

// LoadState returns nil without an error when the agent isn't paired.
func (s Store) LoadState() (*State, error) {
	data, err := s.readState()
	if err != nil {
		return nil, err
	}
	return parseState(data)
}

// SaveState writes state.json atomically.
func (s Store) SaveState(st *State) error {
	unlock, err := s.lock()
	if err != nil {
		return err
	}
	defer unlock()
	_, err = s.writeState(st)
	return err
}

// UpdateState applies change to state.json if it still holds the identity
// with this sign seed, all under the lock, and returns the saved state, or
// nil if it changed nothing. change returns false to leave the file alone.
func (s Store) UpdateState(signSeed []byte, change func(*State) bool) (*State, error) {
	unlock, err := s.lock()
	if err != nil {
		return nil, err
	}
	defer unlock()
	st, err := s.LoadState()
	if err != nil || st == nil || !bytes.Equal(st.SignSeed, signSeed) || !change(st) {
		return nil, err
	}
	if _, err := s.writeState(st); err != nil {
		return nil, err
	}
	return st, nil
}

// writeState is SaveState, returning the bytes written.
func (s Store) writeState(st *State) ([]byte, error) {
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return nil, err
	}
	return data, s.writeAtomic(stateFile, data)
}

// DeleteStateOf forgets the pairing and the host memory if state.json
// still holds the identity with this sign seed. It reports whether it
// deleted anything.
func (s Store) DeleteStateOf(signSeed []byte) (bool, error) {
	unlock, err := s.lock()
	if err != nil {
		return false, err
	}
	defer unlock()
	st, err := s.LoadState()
	if err != nil || st == nil || !bytes.Equal(st.SignSeed, signSeed) {
		return false, err
	}
	for _, name := range []string{stateFile, hostsFile} {
		if err := os.Remove(filepath.Join(s.Dir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return true, err
		}
	}
	return true, nil
}

// LoadHosts returns an empty map when the file doesn't exist.
func (s Store) LoadHosts() (Hosts, error) {
	data, err := os.ReadFile(filepath.Join(s.Dir, hostsFile))
	if errors.Is(err, os.ErrNotExist) {
		return Hosts{}, nil
	}
	if err != nil {
		return nil, err
	}
	hosts := Hosts{}
	if err := json.Unmarshal(data, &hosts); err != nil {
		return nil, fmt.Errorf("hosts.json: %w", err)
	}
	return hosts, nil
}

// SaveHosts writes hosts.json atomically.
func (s Store) SaveHosts(h Hosts) error {
	data, err := json.MarshalIndent(h, "", "  ")
	if err != nil {
		return err
	}
	return s.writeAtomic(hostsFile, data)
}
