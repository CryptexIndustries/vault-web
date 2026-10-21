package relay

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

func (h *harness) postRevoke(contentType string, body []byte) *http.Response {
	h.t.Helper()
	resp, err := http.Post(h.ts.URL+"/v1/revoke", contentType, bytes.NewReader(body))
	if err != nil {
		h.t.Fatal(err)
	}
	resp.Body.Close()
	return resp
}

func marshal(t *testing.T, m proto.Message) []byte {
	t.Helper()
	raw, err := proto.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestRevokeOverHTTP(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	approver, agent := newIdentity(t), newIdentity(t)
	revPub, revKey, _ := ed25519.GenerateKey(rand.Reader)
	a, _ := h.connect(approver, agentpb.Role_ROLE_APPROVER, authOptions{})
	if st := a.status(registerFrame(agent, revPub)); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	g, _ := h.connect(agent, agentpb.Role_ROLE_AGENT, authOptions{})

	now := h.clock.now().UnixMilli()
	_, otherKey, _ := ed25519.GenerateKey(rand.Reader)
	const pb = "application/x-protobuf"
	valid := marshal(t, agentproto.SignRevoke(revKey, testOrigin, agent.ID(), now))
	cases := []struct {
		name        string
		contentType string
		body        []byte
		status      int
	}{
		{"wrong content type", "application/json", valid, http.StatusBadRequest},
		{"not protobuf", pb, []byte{0xff, 0xff, 0xff}, http.StatusBadRequest},
		{"too large", pb, append(bytes.Clone(valid), bytes.Repeat([]byte{0}, revokeBodyLimit)...), http.StatusBadRequest},
		{"short agent key", pb, marshal(t, agentproto.SignRevoke(revKey, testOrigin, agent.ID()[:16], now)), http.StatusBadRequest},
		{"unknown agent", pb, marshal(t, agentproto.SignRevoke(revKey, testOrigin, newIdentity(t).ID(), now)), http.StatusNotFound},
		{"wrong revocation key", pb, marshal(t, agentproto.SignRevoke(otherKey, testOrigin, agent.ID(), now)), http.StatusForbidden},
		{"too old", pb, marshal(t, agentproto.SignRevoke(revKey, testOrigin, agent.ID(), now-(6*time.Minute).Milliseconds())), http.StatusForbidden},
		{"too far ahead", pb, marshal(t, agentproto.SignRevoke(revKey, testOrigin, agent.ID(), now+(6*time.Minute).Milliseconds())), http.StatusForbidden},
	}
	for _, tc := range cases {
		if resp := h.postRevoke(tc.contentType, tc.body); resp.StatusCode != tc.status {
			t.Errorf("%s: %d, want %d", tc.name, resp.StatusCode, tc.status)
		}
	}
	g.expectQuiet()

	// Four minutes of skew is fine.
	late := marshal(t, agentproto.SignRevoke(revKey, testOrigin, agent.ID(), now-(4*time.Minute).Milliseconds()))
	resp := h.postRevoke(pb+"; charset=binary", late)
	if resp.StatusCode != http.StatusNoContent || resp.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("revoke: %d %v", resp.StatusCode, resp.Header)
	}
	g.expectRevoked(agent.ID())
	g.expectClosed()
	a.expectRevoked(agent.ID())
	if resp := h.postRevoke(pb, late); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("second revoke: %d", resp.StatusCode)
	}
	if !strings.Contains(scrape(t, h), `cryptex_relay_revokes_total{source="revocation_key"} 1`) {
		t.Error("revoke not counted")
	}

	req, _ := http.NewRequest(http.MethodOptions, h.ts.URL+"/v1/revoke", nil)
	pre, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	pre.Body.Close()
	if pre.StatusCode != http.StatusNoContent || !strings.Contains(pre.Header.Get("Access-Control-Allow-Headers"), "Content-Type") {
		t.Fatalf("preflight: %d %v", pre.StatusCode, pre.Header)
	}
}

func TestRevocationKeyRotates(t *testing.T) {
	h := newHarness(t, AuthToken, nil)
	agent := newIdentity(t)
	oldPub, oldKey, _ := ed25519.GenerateKey(rand.Reader)
	newPub, newKey, _ := ed25519.GenerateKey(rand.Reader)
	a, _ := h.connect(newIdentity(t), agentpb.Role_ROLE_APPROVER, authOptions{})
	for _, key := range [][]byte{oldPub, newPub} {
		if st := a.status(registerFrame(agent, key)); st != agentpb.Status_STATUS_OK {
			t.Fatal(st)
		}
	}
	now := h.clock.now().UnixMilli()
	if resp := h.postRevoke("application/x-protobuf", marshal(t, agentproto.SignRevoke(oldKey, testOrigin, agent.ID(), now))); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("old revocation key: %d", resp.StatusCode)
	}
	if resp := h.postRevoke("application/x-protobuf", marshal(t, agentproto.SignRevoke(newKey, testOrigin, agent.ID(), now))); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("new revocation key: %d", resp.StatusCode)
	}
	a.expectRevoked(agent.ID())
}

func TestRevokeRateLimit(t *testing.T) {
	h := newHarness(t, AuthToken, nil)
	for i := range revokesPerMinute {
		if resp := h.postRevoke("text/plain", nil); resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("request %d: %d", i, resp.StatusCode)
		}
	}
	if resp := h.postRevoke("text/plain", nil); resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("over the limit: %d", resp.StatusCode)
	}
	h.clock.advance(time.Minute)
	if resp := h.postRevoke("text/plain", nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("next window: %d", resp.StatusCode)
	}
}
