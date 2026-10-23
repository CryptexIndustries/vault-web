package relayclient_test

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient/fakerelay"
)

func TestURLs(t *testing.T) {
	cases := []struct{ in, path, want string }{
		{"https://relay.cryptex-vault.com", relayclient.ConnectPath, "wss://relay.cryptex-vault.com/v1/connect"},
		{"https://example.com/relay/", relayclient.PairPath, "wss://example.com/relay/v1/pair"},
		{"http://127.0.0.1:8080?x=1", relayclient.ConnectPath, "ws://127.0.0.1:8080/v1/connect"},
		{"http://LocalHost:8080", relayclient.ConnectPath, "ws://LocalHost:8080/v1/connect"},
		{"http://[::1]:8080/r", relayclient.PairPath, "ws://[::1]:8080/r/v1/pair"},
	}
	for _, c := range cases {
		got, err := relayclient.WebSocketURL(c.in, c.path)
		if err != nil || got != c.want {
			t.Errorf("WebSocketURL(%q) = %q, %v; want %q", c.in, got, err, c.want)
		}
	}
	if _, err := relayclient.WebSocketURL("ftp://example.com", relayclient.ConnectPath); err == nil {
		t.Error("accepted an ftp URL")
	}
	// Plain http only on this machine, as the approvers allow: the access
	// token would cross the network in clear.
	for _, in := range []string{"http://relay.example.com", "http://10.0.0.5:8080/relay", "http://127.0.0.2", "http://[::ffff:127.0.0.1]"} {
		if _, err := relayclient.WebSocketURL(in, relayclient.ConnectPath); err == nil {
			t.Errorf("WebSocketURL accepted %s", in)
		}
		if _, err := relayclient.HTTPURL(in, relayclient.RevokePath); err == nil {
			t.Errorf("HTTPURL accepted %s", in)
		}
		if err := relayclient.CheckRelayURL(in); err == nil {
			t.Errorf("CheckRelayURL accepted %s", in)
		}
	}
	if got, _ := relayclient.HTTPURL("https://example.com/r", relayclient.RevokePath); got != "https://example.com/r/v1/revoke" {
		t.Errorf("HTTPURL = %q", got)
	}
	if got, _ := relayclient.Origin("https://Relay.Example.com:443/base/"); got != "https://relay.example.com" {
		t.Errorf("Origin = %q", got)
	}
}

func identity(t *testing.T) *agentproto.Identity {
	t.Helper()
	id, err := agentproto.NewIdentity()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func peer(id *agentproto.Identity) agentproto.Peer {
	return agentproto.Peer{SignPublicKey: id.ID(), KEMPublicKey: id.KEMPublicKey()}
}

func ctx(t *testing.T) context.Context {
	c, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)
	return c
}

// connect dials url as id and closes the connection when the test ends.
func connect(t *testing.T, url string, id *agentproto.Identity, creds relayclient.Credentials) *relayclient.Conn {
	t.Helper()
	conn, err := relayclient.Connect(ctx(t), url, id, creds, relayclient.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

// pairOverFakeRelay registers agent under approver through a real slot
// exchange, so the fake relay routes between them.
func pairOverFakeRelay(t *testing.T, relay *fakerelay.Relay, approver *relayclient.Conn, approverID, agent *agentproto.Identity) {
	t.Helper()
	c := ctx(t)
	offer, _ := proto.Marshal(&agentpb.PairingOffer{ProtocolVersion: 1, SignPublicKey: agent.ID(), KemPublicKey: agent.KEMPublicKey()})
	slotConn, opened, err := relayclient.OpenSlot(c, relay.URL, offer, relayclient.Options{})
	if err != nil {
		t.Fatal(err)
	}
	got, err := approver.ClaimSlot(c, opened.SlotId)
	if err != nil || !bytes.Equal(got.Offer, offer) {
		t.Fatalf("ClaimSlot: %v", err)
	}
	if f, err := slotConn.Next(c); err != nil || f.GetSlotClaimed() == nil {
		t.Fatalf("expected SlotClaimed, got %v, %v", f, err)
	}
	binding := &agentproto.PairingBinding{Secret: agentproto.NewPairingSecret(), OfferHash: agentproto.OfferHash(offer)}
	env, err := agentproto.Seal(approverID, peer(agent), &agentpb.Message{Body: &agentpb.Message_PairingAccept{PairingAccept: &agentpb.PairingAccept{
		ApproverSignPublicKey: approverID.ID(), ApproverKemPublicKey: approverID.KEMPublicKey(),
	}}}, agentproto.SealOptions{ExpiresAt: time.Now().Add(time.Minute), Pairing: binding})
	if err != nil {
		t.Fatal(err)
	}
	// The relay refuses answers for agents that aren't registered yet.
	if err := approver.AnswerSlot(c, opened.SlotId, env); !relayclient.IsStatus(err, agentpb.Status_STATUS_BAD_REQUEST) {
		t.Fatalf("answer before RegisterAgent: %v", err)
	}
	if err := approver.RegisterAgent(c, agent.ID(), make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	if err := approver.AnswerSlot(c, opened.SlotId, env); err != nil {
		t.Fatal(err)
	}
	f, err := slotConn.Next(c)
	if err != nil || f.GetSlotAnswer() == nil {
		t.Fatalf("expected SlotAnswer, got %v, %v", f, err)
	}
	if _, _, err := agentproto.OpenPairingAccept(agent, *binding, f.GetSlotAnswer().Envelope, time.Now()); err != nil {
		t.Fatal(err)
	}
	// The relay closes the pairing socket normally after the answer.
	if _, err := slotConn.Next(c); !errors.Is(err, relayclient.ErrClosed) {
		t.Fatalf("after SlotAnswer: %v", err)
	}
}

// An https relay that redirects must not get the client to follow, or Auth
// and the access token could go to a remote http:// URL that CheckRelayURL
// would have refused. The caller's own client is left as it was.
func TestRelayRedirectsAreRefused(t *testing.T) {
	var hits atomic.Int32
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.Error(w, "should not be reached", http.StatusTeapot)
	}))
	defer plain.Close()
	secure := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://relay.remote.invalid"+r.URL.Path, http.StatusFound)
	}))
	defer secure.Close()
	client := secure.Client()
	transport := client.Transport.(*http.Transport).Clone()
	// The remote name leads to the local listener; nothing leaves the host.
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if address == "relay.remote.invalid:80" {
			address = plain.Listener.Addr().String()
		}
		return (&net.Dialer{}).DialContext(ctx, network, address)
	}
	client.Transport = transport
	opts := relayclient.Options{HTTPClient: client}

	ctx := ctx(t)
	creds := relayclient.Credentials{Role: agentpb.Role_ROLE_AGENT, Token: "self-hosted-relay-token"}
	if conn, err := relayclient.Connect(ctx, secure.URL, identity(t), creds, opts); err == nil || !strings.Contains(err.Error(), "redirect") {
		if conn != nil {
			conn.Close()
		}
		t.Fatalf("Connect followed a redirect: %v", err)
	}
	if conn, _, err := relayclient.OpenSlot(ctx, secure.URL, []byte("offer"), opts); err == nil || !strings.Contains(err.Error(), "redirect") {
		if conn != nil {
			conn.Close()
		}
		t.Fatalf("OpenSlot followed a redirect: %v", err)
	}
	if n := hits.Load(); n != 0 {
		t.Fatalf("the redirect target got %d requests", n)
	}
	if client.CheckRedirect != nil {
		t.Fatal("the caller's client was changed")
	}
}

func TestConnectSendDeliverAck(t *testing.T) {
	relay := fakerelay.Start(t)
	relay.Token = "token"
	c := ctx(t)
	approverID, agentID := identity(t), identity(t)

	if _, err := relayclient.Connect(c, relay.URL, approverID, relayclient.Credentials{Token: "wrong"}, relayclient.Options{}); !relayclient.IsStatus(err, agentpb.Status_STATUS_UNAUTHORIZED) {
		t.Fatalf("wrong token: %v", err)
	}
	approver := connect(t, relay.URL, approverID, relayclient.Credentials{Token: "token"})
	if approver.Ready().Role != agentpb.Role_ROLE_APPROVER || approver.Challenge().KeepaliveSeconds != 30 {
		t.Fatalf("ready = %v, challenge = %v", approver.Ready(), approver.Challenge())
	}
	pairOverFakeRelay(t, relay, approver, approverID, agentID)

	agent := connect(t, relay.URL, agentID, relayclient.Credentials{Role: agentpb.Role_ROLE_AGENT, Token: "token"})
	if agent.Ready().Role != agentpb.Role_ROLE_AGENT {
		t.Fatalf("agent role = %v", agent.Ready().Role)
	}
	env, _ := agentproto.Seal(agentID, peer(approverID), &agentpb.Message{}, agentproto.SealOptions{ExpiresAt: time.Now().Add(time.Minute)})
	if err := agent.Send(c, env); err != nil {
		t.Fatal(err)
	}
	if err := agent.Send(c, env); !relayclient.IsStatus(err, agentpb.Status_STATUS_BAD_REQUEST) {
		t.Fatalf("duplicate send: %v", err)
	}
	f, err := approver.Next(c)
	if err != nil || !proto.Equal(f.GetDeliver().GetEnvelope(), env) {
		t.Fatalf("deliver: %v, %v", f, err)
	}

	// Unacked envelopes come back on reconnect; acked ones don't.
	approver.Close()
	approver = connect(t, relay.URL, approverID, relayclient.Credentials{Token: "token"})
	if len(approver.Ready().Agents) != 1 || !bytes.Equal(approver.Ready().Agents[0], agentID.ID()) {
		t.Fatalf("ready agents = %x", approver.Ready().Agents)
	}
	f, err = approver.Next(c)
	if err != nil || f.GetDeliver() == nil {
		t.Fatalf("redeliver: %v, %v", f, err)
	}
	h, _ := agentproto.ParseHeader(env)
	if err := approver.Ack(c, h.MessageId); err != nil {
		t.Fatal(err)
	}
	approver.Close()
	approver = connect(t, relay.URL, approverID, relayclient.Credentials{Token: "token"})
	short, cancel := context.WithTimeout(c, 300*time.Millisecond)
	defer cancel()
	if f, err := approver.Next(short); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("acked envelope came back: %v, %v", f, err)
	}

	// Revoking the agent: it gets Revoked, then the connection ends.
	if err := approver.UnregisterAgent(c, agentID.ID()); err != nil {
		t.Fatal(err)
	}
	f, err = agent.Next(c)
	if err != nil || !bytes.Equal(f.GetRevoked().GetAgentKey(), agentID.ID()) {
		t.Fatalf("revoked: %v, %v", f, err)
	}
	select {
	case <-agent.Done():
	case <-c.Done():
		t.Fatal("agent connection stayed open after Revoked")
	}
}

func TestReplacedConnectionGetsFatalError(t *testing.T) {
	relay := fakerelay.Start(t)
	c := ctx(t)
	id := identity(t)
	first := connect(t, relay.URL, id, relayclient.Credentials{})
	connect(t, relay.URL, id, relayclient.Credentials{})
	_, err := first.Next(c)
	var se *relayclient.StatusError
	if !errors.As(err, &se) || !se.Fatal || se.Status != agentpb.Status_STATUS_UNAVAILABLE {
		t.Fatalf("replaced connection: %v", err)
	}
	if first.Err() == nil {
		t.Fatal("Err is nil after the connection ended")
	}
	if err := first.Send(c, &agentpb.Envelope{}); err == nil {
		t.Fatal("Send worked on a closed connection")
	}
}

func TestExpiredSlot(t *testing.T) {
	relay := fakerelay.Start(t)
	c := ctx(t)
	agent := identity(t)
	offer, _ := proto.Marshal(&agentpb.PairingOffer{ProtocolVersion: 1, SignPublicKey: agent.ID(), KemPublicKey: agent.KEMPublicKey()})
	conn, _, err := relayclient.OpenSlot(c, relay.URL, offer, relayclient.Options{})
	if err != nil {
		t.Fatal(err)
	}
	relay.ExpireSlots()
	if _, err := conn.Next(c); !relayclient.IsStatus(err, agentpb.Status_STATUS_EXPIRED) {
		t.Fatalf("expired slot: %v", err)
	}
	if _, _, err := relayclient.OpenSlot(c, relay.URL, []byte("not an offer"), relayclient.Options{}); !relayclient.IsStatus(err, agentpb.Status_STATUS_BAD_REQUEST) {
		t.Fatalf("bad offer: %v", err)
	}
}

// stubRelay accepts Auth, counts and answers Pings, and answers the i-th
// Send with delivers[i] Deliver frames before its Result, so the client has
// queued all of them once Send returns.
func stubRelay(t *testing.T, subprotocols []string, version, keepalive uint32, delivers ...int) (string, *atomic.Int32) {
	var pings atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: subprotocols})
		if err != nil {
			return
		}
		defer ws.CloseNow()
		send := func(f *agentpb.ServerFrame) {
			data, _ := proto.Marshal(f)
			ws.Write(r.Context(), websocket.MessageBinary, data)
		}
		send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Challenge{Challenge: &agentpb.Challenge{
			ProtocolVersion: version, Nonce: make([]byte, 32), KeepaliveSeconds: keepalive,
		}}})
		sends := 0
		for {
			_, data, err := ws.Read(r.Context())
			if err != nil {
				return
			}
			var f agentpb.ClientFrame
			proto.Unmarshal(data, &f)
			switch f.GetFrame().(type) {
			case *agentpb.ClientFrame_Auth:
				send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Ready{Ready: &agentpb.Ready{Role: agentpb.Role_ROLE_AGENT}}})
			case *agentpb.ClientFrame_Ping:
				pings.Add(1)
				send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Pong{Pong: &agentpb.Pong{}}})
			case *agentpb.ClientFrame_Send:
				for range delivers[sends] {
					send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Deliver{Deliver: &agentpb.Deliver{Envelope: &agentpb.Envelope{}}}})
				}
				sends++
				send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Result{Result: &agentpb.Result{Id: f.Id, Status: agentpb.Status_STATUS_OK}}})
			}
		}
	}))
	t.Cleanup(srv.Close)
	return srv.URL, &pings
}

func TestKeepalivePingsAtTheAnnouncedInterval(t *testing.T) {
	url, pings := stubRelay(t, []string{relayclient.Subprotocol}, 1, 1)
	conn := connect(t, url, identity(t), relayclient.Credentials{})
	time.Sleep(2600 * time.Millisecond)
	if n := pings.Load(); n < 2 || n > 3 {
		t.Fatalf("%d pings in 2.6 s with a 1 s interval", n)
	}
	if conn.Err() != nil {
		t.Fatalf("connection ended: %v", conn.Err())
	}
}

func TestHandshakeRefusals(t *testing.T) {
	url, _ := stubRelay(t, nil, 1, 1)
	if _, err := relayclient.Connect(ctx(t), url, identity(t), relayclient.Credentials{}, relayclient.Options{}); err == nil {
		t.Fatal("connected without the subprotocol")
	}
	url, _ = stubRelay(t, []string{relayclient.Subprotocol}, 2, 1)
	if _, err := relayclient.Connect(ctx(t), url, identity(t), relayclient.Credentials{}, relayclient.Options{}); err == nil {
		t.Fatal("connected to a relay with another protocol version")
	}
}

func TestBackoff(t *testing.T) {
	b := relayclient.NewBackoff()
	var prevMax time.Duration
	for i := range 10 {
		d := b.Next()
		ceiling := min(time.Second<<i, time.Minute)
		if d < ceiling/2 || d > ceiling {
			t.Fatalf("attempt %d waited %v, want %v to %v", i, d, ceiling/2, ceiling)
		}
		prevMax = ceiling
	}
	if prevMax != time.Minute {
		t.Fatalf("backoff never reached a minute")
	}
	b.Reset()
	if d := b.Next(); d > time.Second {
		t.Fatalf("after Reset waited %v", d)
	}
}

func TestSendChecksTheEnvelopeSize(t *testing.T) {
	relay := fakerelay.Start(t)
	c := ctx(t)
	approverID, agentID := identity(t), identity(t)
	approver := connect(t, relay.URL, approverID, relayclient.Credentials{})
	pairOverFakeRelay(t, relay, approver, approverID, agentID)
	agent := connect(t, relay.URL, agentID, relayclient.Credentials{Role: agentpb.Role_ROLE_AGENT})

	// seal makes an envelope of data bytes plus about 1.3 KiB.
	seal := func(data int) *agentpb.Envelope {
		env, err := agentproto.Seal(agentID, peer(approverID), &agentpb.Message{Body: &agentpb.Message_SignRequest{SignRequest: &agentpb.SignRequest{
			Data: make([]byte, data),
		}}}, agentproto.SealOptions{ExpiresAt: time.Now().Add(time.Minute)})
		if err != nil {
			t.Fatal(err)
		}
		return env
	}
	sends := relay.Sends()
	over := seal(agentproto.MaxEnvelopeSize)
	if proto.Size(over) <= agentproto.MaxEnvelopeSize {
		t.Fatalf("test envelope of %d bytes isn't over the limit", proto.Size(over))
	}
	err := agent.Send(c, over)
	var se *relayclient.StatusError
	if !errors.As(err, &se) || se.Status != agentpb.Status_STATUS_TOO_LARGE || se.Fatal || !errors.Is(err, relayclient.ErrTooLarge) {
		t.Fatalf("oversized Send: %v", err)
	}
	if relay.Sends() != sends || agent.Err() != nil {
		t.Fatal("oversized envelope was sent")
	}

	// One just under the limit goes through, and the other side reads it.
	near := seal(agentproto.MaxEnvelopeSize - 2048)
	if n := proto.Size(near); n > agentproto.MaxEnvelopeSize || n < agentproto.MaxEnvelopeSize-2048 {
		t.Fatalf("test envelope of %d bytes", n)
	}
	if err := agent.Send(c, near); err != nil {
		t.Fatal(err)
	}
	f, err := approver.Next(c)
	if err != nil || !proto.Equal(f.GetDeliver().GetEnvelope(), near) {
		t.Fatalf("deliver: %v", err)
	}
}

func TestFloodingRelayGetsDisconnected(t *testing.T) {
	c := ctx(t)
	url, _ := stubRelay(t, []string{relayclient.Subprotocol}, 1, 30, relayclient.MaxQueuedFrames, 1)
	conn := connect(t, url, identity(t), relayclient.Credentials{})
	// A full queue is fine.
	if err := conn.Send(c, &agentpb.Envelope{}); err != nil {
		t.Fatal(err)
	}
	if err := conn.Err(); err != nil {
		t.Fatalf("closed with a full queue: %v", err)
	}
	// One more frame than the client keeps ends the connection.
	if err := conn.Send(c, &agentpb.Envelope{}); !errors.Is(err, relayclient.ErrFlooded) {
		t.Fatalf("Send after the flood: %v", err)
	}
	select {
	case <-conn.Done():
	case <-c.Done():
		t.Fatal("connection stayed open")
	}
	if !errors.Is(conn.Err(), relayclient.ErrFlooded) {
		t.Fatalf("Err = %v", conn.Err())
	}
	// What was queued is still handed out, then the error.
	for i := range relayclient.MaxQueuedFrames {
		if f, err := conn.Next(c); err != nil || f.GetDeliver() == nil {
			t.Fatalf("frame %d: %v, %v", i, f, err)
		}
	}
	if _, err := conn.Next(c); !errors.Is(err, relayclient.ErrFlooded) {
		t.Fatalf("Next after the queue: %v", err)
	}
}

func TestStatusErrorTextIsSanitized(t *testing.T) {
	err := &relayclient.StatusError{Status: agentpb.Status_STATUS_BAD_REQUEST, Message: "bad\x1b]52;c;cm0gLXJmIH4=\x07 ‮edoc" + strings.Repeat("x", 500)}
	msg := err.Error()
	if strings.ContainsAny(msg, "\x1b\x07‮") || len(msg) > 300 {
		t.Fatalf("Error() = %q", msg)
	}
}
