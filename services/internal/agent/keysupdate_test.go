package agent

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relay"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
)

const testRelayToken = "agent-test-relay-token-0123456789"

// serveRelay runs a real relay in token mode on srv, which isn't started
// yet, with envelope budgets (global and per account) of budget bytes, or
// the defaults for 0.
func serveRelay(t *testing.T, srv *httptest.Server, budget int64) {
	t.Helper()
	rs, err := relay.New(relay.Config{
		PublicURL: "http://" + srv.Listener.Addr().String(), Auth: relay.AuthToken, AccessToken: testRelayToken, DBPath: ":memory:",
		Keepalive: time.Second, MaxQueueBytes: budget, MaxAccountQueueBytes: budget,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		srv.Close()
		t.Fatal(err)
	}
	srv.Config.Handler = rs.Handler()
	srv.Start()
	t.Cleanup(func() {
		srv.Close()
		rs.Close()
	})
}

func peerOf(id *agentproto.Identity) agentproto.Peer {
	return agentproto.Peer{SignPublicKey: id.ID(), KEMPublicKey: id.KEMPublicKey()}
}

// pairedService is an agent paired with phone on relayURL, holding one key
// at revision 1.
func pairedService(t *testing.T, relayURL string, phone *agentproto.Identity, confirmed bool) *Service {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	s := newTestService(t)
	st := testState(7)
	st.RelayURL, st.RelayToken, st.Confirmed = relayURL, testRelayToken, confirmed
	st.ApproverSignKey, st.ApproverKEMKey = phone.ID(), phone.KEMPublicKey()
	st.Keys = []GrantedKey{{PublicKey: signer.PublicKey().Marshal()}}
	loadState(t, s, st)
	return s
}

// registeredPhone connects phone to relayURL as an approver and registers
// the agent.
func registeredPhone(ctx context.Context, t *testing.T, relayURL string, phone, agent *agentproto.Identity) *relayclient.Conn {
	t.Helper()
	c, err := relayclient.Connect(ctx, relayURL, phone, relayclient.Credentials{Role: agentpb.Role_ROLE_APPROVER, Token: testRelayToken}, relayclient.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	if err := c.RegisterAgent(ctx, agent.ID(), make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	return c
}

func keysUpdateFor(t *testing.T, phone *agentproto.Identity, to agentproto.Peer, u *agentpb.KeysUpdate) *agentpb.Envelope {
	t.Helper()
	env, err := agentproto.Seal(phone, to, &agentpb.Message{Body: &agentpb.Message_KeysUpdate{KeysUpdate: u}},
		agentproto.SealOptions{ExpiresAt: time.Now().Add(time.Hour), Retain: true})
	if err != nil {
		t.Fatal(err)
	}
	return env
}

// phoneFixture is a confirmed agent on a real relay and the phone it is
// paired with, connected.
type phoneFixture struct {
	ctx     context.Context
	s       *Service
	phoneID *agentproto.Identity
	phone   *relayclient.Conn
}

func newPhoneFixture(t *testing.T) *phoneFixture {
	t.Helper()
	srv := httptest.NewUnstartedServer(nil)
	serveRelay(t, srv, 0)
	phoneID, err := agentproto.NewIdentity()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)
	s := pairedService(t, srv.URL, phoneID, true)
	return &phoneFixture{ctx: ctx, s: s, phoneID: phoneID, phone: registeredPhone(ctx, t, srv.URL, phoneID, s.id)}
}

// sendKeys leaves a KeysUpdate at revision on the relay for the agent.
func (f *phoneFixture) sendKeys(t *testing.T, revision uint64) {
	t.Helper()
	if err := f.phone.Send(f.ctx, keysUpdateFor(t, f.phoneID, peerOf(f.s.id), &agentpb.KeysUpdate{Revision: revision})); err != nil {
		t.Fatal(err)
	}
}

// deliver connects svc to the relay once and handles the envelope it
// delivers, if one comes within 2 seconds.
func (f *phoneFixture) deliver(t *testing.T, svc *Service) (got bool, err error) {
	t.Helper()
	conn, err := connectAgent(f.ctx, svc.st, svc.id, clientOptions(nil, "test"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	wait, stop := context.WithTimeout(f.ctx, 2*time.Second)
	defer stop()
	fr, err := conn.Next(wait)
	if errors.Is(err, context.DeadlineExceeded) {
		return false, nil
	}
	if err != nil {
		t.Fatal(err)
	}
	err = svc.handleDeliver(f.ctx, conn, fr.GetDeliver().GetEnvelope())
	// An Ack has no answer. The relay handles frames in order, so the
	// Result to a Send (an empty one, refused) means it was handled.
	if err := conn.Send(f.ctx, nil); err == nil {
		t.Fatal("the relay took an empty Send")
	}
	return true, err
}

// A retained KeysUpdate waiting for an unconfirmed agent can hold the very
// bytes its PairingConfirm needs. The agent must take and Ack it while it
// confirms, or every reconnect is refused the same way.
func TestWaitingUpdateDoesNotBlockConfirm(t *testing.T) {
	phone, err := agentproto.NewIdentity()
	if err != nil {
		t.Fatal(err)
	}
	// The budget is sized below, so the relay starts after the envelopes
	// are sealed; the URL is needed for the state, so take a port first.
	srv := httptest.NewUnstartedServer(nil)
	url := "http://" + srv.Listener.Addr().String()
	s := pairedService(t, url, phone, false)
	key := s.st.Keys[0].PublicKey
	update := keysUpdateFor(t, phone, peerOf(s.id), &agentpb.KeysUpdate{Revision: 2, AgentName: "updated",
		Keys: []*agentpb.GrantedKey{{PublicKey: key, Comment: strings.Repeat("k", 4000)}}})

	// Retained updates for offline agents fill the rest of the budget, one
	// byte short of room for the PairingConfirm.
	var others []*agentproto.Identity
	var fillers []*agentpb.Envelope
	var used int64
	var many []*agentpb.GrantedKey
	for range 200 {
		many = append(many, &agentpb.GrantedKey{PublicKey: key, Comment: strings.Repeat("k", 255)})
	}
	for range 18 {
		other, err := agentproto.NewIdentity()
		if err != nil {
			t.Fatal(err)
		}
		env := keysUpdateFor(t, phone, peerOf(other), &agentpb.KeysUpdate{Revision: 2, Keys: many})
		others, fillers = append(others, other), append(fillers, env)
		used += int64(proto.Size(env))
	}
	serveRelay(t, srv, used+int64(proto.Size(update))+1)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	p := registeredPhone(ctx, t, url, phone, s.id)
	for i, other := range others {
		if err := p.RegisterAgent(ctx, other.ID(), make([]byte, 32)); err != nil {
			t.Fatal(err)
		}
		if err := p.Send(ctx, fillers[i]); err != nil {
			t.Fatal(err)
		}
	}
	if err := p.Send(ctx, update); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := s.connectOnce(ctx, s.st, s.id, s.gen)
		done <- err
	}()
	deadline := time.After(5 * time.Second)
	for {
		s.mu.Lock()
		ok := s.st.Confirmed && s.st.KeysRevision == 2
		s.mu.Unlock()
		if ok {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("connectOnce ended before confirming: %v", err)
		case <-deadline:
			t.Fatal("never confirmed")
		case <-time.After(20 * time.Millisecond):
		}
	}
	cancel()
	<-done
}

// breakStateLock makes every state save fail until the returned function
// runs: state.lock can't be opened while it is a directory.
func breakStateLock(t *testing.T, s *Service) (restore func()) {
	t.Helper()
	lock := filepath.Join(s.store.Dir, lockFile)
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(lock, 0o700); err != nil {
		t.Fatal(err)
	}
	return func() {
		if err := os.Remove(lock); err != nil {
			t.Fatal(err)
		}
	}
}

// A KeysUpdate that can't be saved isn't acked, and the keys in memory stay
// as on disk, so the relay delivers it again and it still applies.
func TestUnsavedKeysUpdateComesAgain(t *testing.T) {
	f := newPhoneFixture(t)
	f.sendKeys(t, 2)
	restore := breakStateLock(t, f.s)
	if got, err := f.deliver(t, f.s); !got || !errors.Is(err, errUnsaved) {
		t.Fatalf("first delivery: got %v, %v; want errUnsaved", got, err)
	}
	if f.s.st.KeysRevision != 1 || len(f.s.st.Keys) != 1 {
		t.Fatalf("memory went to revision %d with %d keys without saving", f.s.st.KeysRevision, len(f.s.st.Keys))
	}

	// Storage is back; the next connection gets the update again.
	restore()
	if got, err := f.deliver(t, f.s); !got || err != nil {
		t.Fatalf("second delivery: got %v, %v", got, err)
	}
	disk, err := f.s.store.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	if disk.KeysRevision != 2 || len(disk.Keys) != 0 {
		t.Fatalf("on disk: revision %d with %d keys, want revision 2 with none", disk.KeysRevision, len(disk.Keys))
	}
}

// The relay delivers an envelope once per connection, so after a
// KeysUpdate that couldn't be saved the connection must end; the reconnect
// gets it again and saves it once storage is back.
func TestUnsavedKeysUpdateEndsTheConnection(t *testing.T) {
	f := newPhoneFixture(t)
	s := f.s
	ctx, cancel := context.WithCancel(f.ctx)
	defer cancel()
	restore := breakStateLock(t, s)
	done := make(chan error, 1)
	go func() {
		_, err := s.connectOnce(ctx, s.st, s.id, s.gen)
		done <- err
	}()
	waitFor(t, "connected", func() bool { return s.Status().Connected })
	f.sendKeys(t, 2)
	select {
	case err := <-done:
		if !errors.Is(err, errUnsaved) {
			t.Fatalf("connectOnce: %v, want errUnsaved", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the connection stayed up after a KeysUpdate that couldn't be saved")
	}

	restore()
	go func() {
		_, err := s.connectOnce(ctx, s.st, s.id, s.gen)
		done <- err
	}()
	waitFor(t, "revision 2 on disk", func() bool {
		disk, err := s.store.LoadState()
		return err == nil && disk.KeysRevision == 2
	})
	cancel()
	<-done
}

// waitFor polls cond for up to 5 seconds.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// failDirSync makes directory syncs fail while *failing is true.
func failDirSync(t *testing.T, failing *bool) {
	fsyncDir = func(d *os.File) error {
		if *failing {
			return errors.New("injected directory fsync failure")
		}
		return d.Sync()
	}
	t.Cleanup(func() { fsyncDir = (*os.File).Sync })
}

// A save whose directory sync fails has replaced state.json without
// making it durable. The KeysUpdate stays unacked, also once a reload took
// the visible new revision, until a directory sync succeeds.
func TestFailedDirectorySyncWithholdsAck(t *testing.T) {
	f := newPhoneFixture(t)
	f.sendKeys(t, 2)
	failing := true
	failDirSync(t, &failing)

	if got, err := f.deliver(t, f.s); !got || !errors.Is(err, errUnsaved) {
		t.Fatalf("first delivery: got %v, %v; want errUnsaved", got, err)
	}
	// state.json now shows revision 2; a reload takes it.
	if err := f.s.reload(); err != nil {
		t.Fatal(err)
	}
	if got, err := f.deliver(t, f.s); !got || !errors.Is(err, errUnsaved) {
		t.Fatalf("after the reload: got %v, %v; want the update again, unacked", got, err)
	}
	failing = false
	if got, err := f.deliver(t, f.s); !got || err != nil {
		t.Fatalf("with the sync working: got %v, %v; want the update, acked", got, err)
	}
	if got, _ := f.deliver(t, f.s); got {
		t.Fatal("the relay still has the update after it was acked")
	}
}

// A restart forgets that a write's directory sync failed, but not the
// risk: an update already in state.json is only acked after a sync works.
func TestRestartedServiceSyncsBeforeAck(t *testing.T) {
	f := newPhoneFixture(t)
	f.sendKeys(t, 2)
	failing := true
	failDirSync(t, &failing)
	if got, err := f.deliver(t, f.s); !got || !errors.Is(err, errUnsaved) {
		t.Fatalf("first delivery: got %v, %v; want errUnsaved", got, err)
	}

	// A new process starts from state.json, which shows revision 2.
	restarted := newService(f.s.opts)
	if err := restarted.reload(); err != nil {
		t.Fatal(err)
	}
	if restarted.st.KeysRevision != 2 {
		t.Fatalf("restarted at revision %d", restarted.st.KeysRevision)
	}
	if got, err := f.deliver(t, restarted); !got || !errors.Is(err, errUnsaved) {
		t.Fatalf("after the restart: got %v, %v; want the update again, unacked", got, err)
	}
	if got, _ := f.deliver(t, restarted); !got {
		t.Fatal("the relay no longer has the update")
	}
}
