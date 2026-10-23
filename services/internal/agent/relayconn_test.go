package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
)

// scriptedRelay accepts the agent, answers pings and reports the header of
// each Send in order. answer gives a Send's Result status, or false to never
// answer it.
func scriptedRelay(t *testing.T, answer func(*agentpb.EnvelopeHeader) (agentpb.Status, bool)) (url string, sent <-chan *agentpb.EnvelopeHeader) {
	t.Helper()
	got := make(chan *agentpb.EnvelopeHeader, 16)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{relayclient.Subprotocol}})
		if err != nil {
			return
		}
		defer ws.CloseNow()
		send := func(f *agentpb.ServerFrame) {
			raw, _ := proto.Marshal(f)
			_ = ws.Write(r.Context(), websocket.MessageBinary, raw)
		}
		send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Challenge{Challenge: &agentpb.Challenge{
			ProtocolVersion: agentproto.Version, Nonce: make([]byte, 32), KeepaliveSeconds: 1,
		}}})
		for {
			_, raw, err := ws.Read(r.Context())
			if err != nil {
				return
			}
			var f agentpb.ClientFrame
			if proto.Unmarshal(raw, &f) != nil {
				return
			}
			switch fr := f.GetFrame().(type) {
			case *agentpb.ClientFrame_Auth:
				send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Ready{Ready: &agentpb.Ready{Role: agentpb.Role_ROLE_AGENT}}})
			case *agentpb.ClientFrame_Send:
				h, err := agentproto.ParseHeader(fr.Send.GetEnvelope())
				if err != nil {
					return
				}
				select {
				case got <- h:
				default:
				}
				if status, ok := answer(h); ok {
					send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Result{Result: &agentpb.Result{Id: f.GetId(), Status: status}}})
				}
			case *agentpb.ClientFrame_Ping:
				send(&agentpb.ServerFrame{Frame: &agentpb.ServerFrame_Pong{Pong: &agentpb.Pong{}}})
			}
		}
	}))
	t.Cleanup(srv.Close)
	return srv.URL, got
}

func silentRelay(t *testing.T) (string, <-chan *agentpb.EnvelopeHeader) {
	return scriptedRelay(t, func(*agentpb.EnvelopeHeader) (agentpb.Status, bool) { return 0, false })
}

// unconfirmedState is a pairing on relayURL whose PairingConfirm is still
// to be sent.
func unconfirmedState(t *testing.T, seed byte, relayURL string) *State {
	t.Helper()
	approver, err := agentproto.NewIdentity()
	if err != nil {
		t.Fatal(err)
	}
	st := testState(seed)
	st.RelayURL = relayURL
	st.ApproverSignKey, st.ApproverKEMKey = approver.ID(), approver.KEMPublicKey()
	return st
}

// queueRequest adds a sign request waiting for a connection, as one made
// while offline.
func queueRequest(t *testing.T, s *Service) *pendingSign {
	t.Helper()
	env, err := agentproto.Seal(s.id, s.approver, &agentpb.Message{Body: &agentpb.Message_SignRequest{SignRequest: &agentpb.SignRequest{}}},
		agentproto.SealOptions{ExpiresAt: time.Now().Add(time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	p := newPendingSign(env)
	s.mu.Lock()
	s.pending["waiting"] = p
	s.mu.Unlock()
	return p
}

func shortResultTimeout(t *testing.T) {
	old := resultTimeout
	resultTimeout = 200 * time.Millisecond
	t.Cleanup(func() { resultTimeout = old })
}

// A relay that never answers the PairingConfirm must not keep the service
// on the old pairing after a new one is saved, and unpairing meanwhile must
// not seal anything for the identity that is gone.
func TestPairingChangeEndsBlockedConfirm(t *testing.T) {
	for name, change := range map[string]func(*testing.T, *Service){
		"re-pair": func(t *testing.T, s *Service) {
			loadState(t, s, unconfirmedState(t, 2, "https://new-relay.example.com"))
		},
		"unpair": func(t *testing.T, s *Service) {
			if _, err := s.store.DeleteStateOf(testState(1).SignSeed); err != nil {
				t.Fatal(err)
			}
			if err := s.reload(); err != nil {
				t.Fatal(err)
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			relayURL, sent := silentRelay(t)
			s := newTestService(t)
			loadState(t, s, unconfirmedState(t, 1, relayURL))
			queueRequest(t, s)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			type result struct {
				err   error
				panic any
			}
			done := make(chan result, 1)
			go func() {
				var r result
				defer func() { r.panic = recover(); done <- r }()
				_, r.err = s.connectOnce(ctx, s.st, s.id, s.gen)
			}()
			select {
			case <-sent:
			case <-ctx.Done():
				t.Fatal("the PairingConfirm never reached the relay")
			}

			change(t, s)
			select {
			case r := <-done:
				if r.panic != nil || r.err != nil {
					t.Fatalf("connectOnce: %v, panic %v", r.err, r.panic)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("the connection to the old relay outlived the pairing change")
			}
		})
	}
}

// Without a pairing change, an unanswered Send gives up after resultTimeout.
func TestUnansweredConfirmTimesOut(t *testing.T) {
	shortResultTimeout(t)
	relayURL, _ := silentRelay(t)
	s := newTestService(t)
	loadState(t, s, unconfirmedState(t, 1, relayURL))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, err := connectAgent(ctx, s.st, s.id, clientOptions(nil, "test"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	done := make(chan error, 1)
	go func() { done <- s.sendConfirm(ctx, conn, s.gen, s.id, s.approver) }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("sendConfirm reported success without the relay's Result")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("sendConfirm still waits for a Result that never comes")
	}
	if s.st.Confirmed {
		t.Fatal("confirmed without the relay's Result")
	}
}

// The approver ignores sign requests from an agent whose PairingConfirm it
// hasn't seen, so a request made before the connection (resent on it) must
// reach the relay after the PairingConfirm, not before.
func TestPairingConfirmGoesBeforeRequests(t *testing.T) {
	relayURL, sent := scriptedRelay(t, func(*agentpb.EnvelopeHeader) (agentpb.Status, bool) { return agentpb.Status_STATUS_OK, true })
	s := newTestService(t)
	loadState(t, s, unconfirmedState(t, 1, relayURL))
	queueRequest(t, s)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	go func() { _, _ = s.connectOnce(ctx, s.st, s.id, s.gen) }()

	var order []bool // Retain: only the PairingConfirm is retained
	for len(order) < 2 {
		select {
		case h := <-sent:
			order = append(order, h.Retain)
		case <-ctx.Done():
			t.Fatalf("the relay got %d envelopes, want the PairingConfirm and the request", len(order))
		}
	}
	if !order[0] || order[1] {
		t.Fatal("the request reached the relay before the PairingConfirm")
	}
}

// A PairingConfirm the relay refuses or never answers ends the connection
// attempt before any request goes out, so the reconnect sends it again
// first. The approver would ignore requests sent ahead of it.
func TestFailedConfirmEndsTheAttempt(t *testing.T) {
	shortResultTimeout(t)
	for name, answer := range map[string]func(*agentpb.EnvelopeHeader) (agentpb.Status, bool){
		"refused": func(h *agentpb.EnvelopeHeader) (agentpb.Status, bool) {
			if h.Retain {
				return agentpb.Status_STATUS_UNAVAILABLE, true
			}
			return agentpb.Status_STATUS_OK, true
		},
		"unanswered": func(*agentpb.EnvelopeHeader) (agentpb.Status, bool) { return 0, false },
	} {
		t.Run(name, func(t *testing.T) {
			relayURL, sent := scriptedRelay(t, answer)
			s := newTestService(t)
			loadState(t, s, unconfirmedState(t, 1, relayURL))
			waiting := queueRequest(t, s)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if _, err := s.connectOnce(ctx, s.st, s.id, s.gen); err == nil {
				t.Fatal("connectOnce went on after the PairingConfirm failed")
			}
			time.Sleep(100 * time.Millisecond) // anything late reaches the relay
			var confirms, others int
			for len(sent) > 0 {
				if (<-sent).Retain {
					confirms++
				} else {
					others++
				}
			}
			// Nothing was waiting for the agent, so there is no second try
			// on this connection.
			if confirms != 1 {
				t.Fatalf("the relay got %d PairingConfirms, want 1", confirms)
			}
			if others != 0 {
				t.Fatal("a request went out without the PairingConfirm")
			}
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.conn != nil || s.st.Confirmed || waiting.attempted {
				t.Fatalf("conn %v, confirmed %v, request attempted %v", s.conn != nil, s.st.Confirmed, waiting.attempted)
			}
			select {
			case err := <-waiting.failed:
				t.Fatalf("the request failed instead of waiting for the next attempt: %v", err)
			default:
			}
		})
	}
}
