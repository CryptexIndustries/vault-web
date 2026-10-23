package relay

import (
	"encoding/base64"
	"encoding/hex"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

func TestMetrics(t *testing.T) {
	h := newHarness(t, AuthTicket, nil)
	f := h.fixture()
	if st := f.g.status(sendFrame(h.seal(f.agent, f.approver, false, time.Minute))); st != agentpb.Status_STATUS_OK {
		t.Fatal(st)
	}
	f.a.expectDeliver()
	f.g.status(sendFrame(h.seal(f.agent, newIdentity(t), false, time.Minute)))
	p := h.openSlot(nil)

	out := scrape(t, h)
	for _, want := range []string{
		`cryptex_relay_connections_total{role="agent"} 1`,
		`cryptex_relay_connections_total{role="approver"} 1`,
		`cryptex_relay_connections_total{role="pairing"} 1`,
		`cryptex_relay_open_connections{role="pairing"} 1`,
		`cryptex_relay_frames_total{type="send"} 2`,
		`cryptex_relay_sends_total{status="ok"} 1`,
		`cryptex_relay_sends_total{status="not_found"} 1`,
		`cryptex_relay_deliveries_total 1`,
		`cryptex_relay_pairing_slots 1`,
		`cryptex_relay_registered_agents 1`,
		`cryptex_relay_registered_approvers 1`,
		`go_goroutines`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("metrics lack %s", want)
		}
	}
	for _, secret := range [][]byte{f.agent.ID(), f.approver.ID(), p.slotID} {
		for _, enc := range []string{hex.EncodeToString(secret), b64(secret), base64.StdEncoding.EncodeToString(secret)} {
			if strings.Contains(out, enc) {
				t.Fatal("metrics contain a key or slot ID")
			}
		}
	}
	if strings.Contains(out, "account-1") || strings.Contains(out, "device-1") {
		t.Fatal("metrics contain a pass subject or device")
	}
}

func TestHealthz(t *testing.T) {
	h := newHarness(t, AuthToken, nil)
	rec := httptest.NewRecorder()
	h.s.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/healthz", nil))
	if rec.Code != 204 || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("healthz: %d %v", rec.Code, rec.Header())
	}
}

func TestNewRefusesBadConfig(t *testing.T) {
	for name, cfg := range map[string]Config{
		"no public URL":    {Auth: AuthToken, AccessToken: testToken, DBPath: ":memory:"},
		"bad public URL":   {PublicURL: "relay.example.com", Auth: AuthToken, AccessToken: testToken, DBPath: ":memory:"},
		"no auth mode":     {PublicURL: testOrigin, DBPath: ":memory:"},
		"ticket, no keys":  {PublicURL: testOrigin, Auth: AuthTicket, DBPath: ":memory:"},
		"token, no token":  {PublicURL: testOrigin, Auth: AuthToken, DBPath: ":memory:"},
		"unknown database": {PublicURL: testOrigin, Auth: AuthToken, AccessToken: testToken, DBPath: t.TempDir() + "/missing/dir/relay.db"},
	} {
		if s, err := New(cfg); err == nil {
			s.Close()
			t.Errorf("%s: accepted", name)
		}
	}
}
