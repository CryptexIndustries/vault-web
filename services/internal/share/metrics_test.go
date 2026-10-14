package share

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func (h *harness) withMetrics() *Metrics {
	m := NewMetrics(h.server.store, slog.New(slog.NewTextHandler(io.Discard, nil)))
	h.server.cfg.Metrics = m
	return m
}

func scrape(t *testing.T, m *Metrics) string {
	t.Helper()
	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("scrape: %d %s", rec.Code, rec.Body)
	}
	return rec.Body.String()
}

func expectLines(t *testing.T, body string, lines ...string) {
	t.Helper()
	for _, line := range lines {
		if !strings.Contains(body, "\n"+line+"\n") {
			t.Errorf("missing %q", line)
		}
	}
}

func TestMetricsCountShareLifecycle(t *testing.T) {
	h := newHarness(t, nil)
	m := h.withMetrics()

	opened := newClientShare()
	openedID := h.create(opened, false)
	if code, _ := h.reveal(openedID, opened, opened.reveal); code != http.StatusOK {
		t.Fatalf("reveal: %d", code)
	}

	guarded := newClientShare()
	guardedID := h.create(guarded, true)
	if code, _ := h.reveal(guardedID, guarded, randomToken()); code != http.StatusForbidden {
		t.Fatalf("wrong passphrase: %d", code)
	}
	if code, _ := h.do("POST", "/share-api/v1/shares/"+guardedID+"/revoke", "",
		map[string]string{"manageToken": b64.EncodeToString(guarded.manage)}); code != http.StatusOK {
		t.Fatalf("revoke: %d", code)
	}

	expiring := newClientShare()
	h.create(expiring, false)
	h.clock.t = h.clock.t.Add(2 * time.Hour)
	if err := h.server.store.Sweep(t.Context(), 30*24*time.Hour); err != nil {
		t.Fatal(err)
	}

	if code, _ := h.do("POST", "/share-api/v1/shares", "Bearer wrong-token", newClientShare().createBody(3600, false)); code != http.StatusUnauthorized {
		t.Fatalf("bad token: %d", code)
	}

	body := scrape(t, m)
	expectLines(t, body,
		`cryptex_share_created_total{auth="token"} 3`,
		`cryptex_share_create_rejected_total{reason="unauthorized"} 1`,
		`cryptex_share_events_total{event="opened"} 1`,
		`cryptex_share_events_total{event="passphrase_failed"} 1`,
		`cryptex_share_events_total{event="revoked"} 1`,
		`cryptex_share_events_total{event="expired"} 1`,
		`cryptex_share_shares{status="viewed"} 1`,
		`cryptex_share_shares{status="revoked"} 1`,
		`cryptex_share_shares{status="expired"} 1`,
		`cryptex_share_shares{status="active"} 0`,
		`cryptex_share_http_requests_total{method="POST",route="/share-api/v1/shares/{id}/reveal",status="200"} 1`,
		`cryptex_share_http_requests_total{method="POST",route="/share-api/v1/shares/{id}/reveal",status="403"} 1`,
	)
	if !strings.Contains(body, "cryptex_share_database_bytes ") || !strings.Contains(body, "go_goroutines ") {
		t.Error("missing database size or Go runtime metrics")
	}
	// Metrics must not identify shares.
	for _, id := range []string{openedID, guardedID} {
		if strings.Contains(body, id) {
			t.Errorf("share ID %s leaked into metrics", id)
		}
	}
}

func TestMetricsBoundTheirLabels(t *testing.T) {
	h := newHarness(t, nil)
	m := h.withMetrics()

	h.do("BREW", "/share-api/v1/info", "", nil)
	h.do("GET", "/share-api/v1/shares/"+strings.Repeat("x", 22)+"/anything", "", nil)
	c := newClientShare()
	id := h.create(c, false)
	for range 31 {
		h.do("POST", "/share-api/v1/shares/"+id+"/peek", "", map[string]string{"peekToken": b64.EncodeToString(c.peek)})
	}

	body := scrape(t, m)
	expectLines(t, body,
		`cryptex_share_rate_limited_total{bucket="open"} 1`,
		`cryptex_share_http_requests_total{method="other",route="unmatched",status="405"} 1`,
		`cryptex_share_http_requests_total{method="GET",route="unmatched",status="404"} 1`,
	)
	if strings.Contains(body, "BREW") || strings.Contains(body, id) {
		t.Error("client-controlled values leaked into labels")
	}
}

func TestStoreStatsAreCachedBetweenScrapes(t *testing.T) {
	h := newHarness(t, nil)
	m := h.withMetrics()
	m.storeStats.now = h.clock.now

	h.create(newClientShare(), false)
	expectLines(t, scrape(t, m), `cryptex_share_shares{status="active"} 1`)
	h.create(newClientShare(), false)
	expectLines(t, scrape(t, m), `cryptex_share_shares{status="active"} 1`)
	h.clock.t = h.clock.t.Add(storeStatsTTL)
	expectLines(t, scrape(t, m), `cryptex_share_shares{status="active"} 2`)
}

func TestMetricsAreNotServedOnTheAPIListener(t *testing.T) {
	h := newHarness(t, nil)
	h.withMetrics()
	if code, _ := h.do("GET", "/metrics", "", nil); code != http.StatusNotFound {
		t.Fatalf("GET /metrics on the API listener: %d", code)
	}
}
