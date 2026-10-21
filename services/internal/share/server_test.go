package share

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"

	"github.com/CryptexIndustries/vault-web/services/internal/serverkit"
)

const testCreationToken = "self-hosted-token-0123456789abcdef"

var b64 = base64.RawURLEncoding

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

type harness struct {
	t      *testing.T
	server *Server
	clock  *clock
}

func newHarness(t *testing.T, mutate func(*Config)) *harness {
	t.Helper()
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	c := &clock{t: time.Unix(1_800_000_000, 0)}
	store.now = c.now
	sum := sha256.Sum256([]byte(testCreationToken))
	cfg := Config{
		Auth:           AuthToken,
		CreationTokens: [][]byte{sum[:]},
		MaxBytes:       1024,
		MaxTTL:         7 * 24 * time.Hour,
		MaxActive:      3,
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if mutate != nil {
		mutate(&cfg)
	}
	server := NewServer(cfg, store)
	server.limiter = serverkit.NewRateLimiter(time.Minute, c.now)
	return &harness{t: t, server: server, clock: c}
}

func (h *harness) do(method, path, auth string, body any) (int, map[string]any) {
	h.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	req.RemoteAddr = "203.0.113.7:5000"
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	h.server.ServeHTTP(rec, req)
	out := map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

type clientShare struct {
	peek, reveal, manage []byte
	ciphertext           []byte
}

func randomToken() []byte {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return b
}

func hashOf(b []byte) string {
	sum := sha256.Sum256(b)
	return b64.EncodeToString(sum[:])
}

func newClientShare() clientShare {
	return clientShare{peek: randomToken(), reveal: randomToken(), manage: randomToken(), ciphertext: []byte("sealed payload")}
}

func (c clientShare) createBody(ttl int, passphrase bool) map[string]any {
	return map[string]any{
		"ciphertext":      b64.EncodeToString(c.ciphertext),
		"peekTokenHash":   hashOf(c.peek),
		"revealTokenHash": hashOf(c.reveal),
		"manageTokenHash": hashOf(c.manage),
		"ttl":             ttl,
		"passphrase":      passphrase,
	}
}

func (h *harness) create(c clientShare, passphrase bool) string {
	h.t.Helper()
	code, body := h.do("POST", "/share-api/v1/shares", "Bearer "+testCreationToken, c.createBody(3600, passphrase))
	if code != http.StatusCreated {
		h.t.Fatalf("create: %d %v", code, body)
	}
	return body["id"].(string)
}

func (h *harness) reveal(id string, c clientShare, revealToken []byte) (int, map[string]any) {
	return h.do("POST", "/share-api/v1/shares/"+id+"/reveal", "", map[string]string{
		"peekToken": b64.EncodeToString(c.peek), "revealToken": b64.EncodeToString(revealToken),
	})
}

func (h *harness) status(id string, c clientShare) string {
	h.t.Helper()
	code, body := h.do("POST", "/share-api/v1/shares/status", "", map[string]any{
		"shares": []map[string]string{{"id": id, "manageToken": b64.EncodeToString(c.manage)}},
	})
	if code != http.StatusOK {
		h.t.Fatalf("status: %d %v", code, body)
	}
	return body["shares"].([]any)[0].(map[string]any)["status"].(string)
}

func TestRevealBurnsTheShare(t *testing.T) {
	h := newHarness(t, nil)
	c := newClientShare()
	id := h.create(c, false)

	code, body := h.do("POST", "/share-api/v1/shares/"+id+"/peek", "", map[string]string{"peekToken": b64.EncodeToString(c.peek)})
	if code != http.StatusOK || body["passphrase"] != false {
		t.Fatalf("peek: %d %v", code, body)
	}

	code, body = h.reveal(id, c, c.reveal)
	if code != http.StatusOK || body["ciphertext"] != b64.EncodeToString(c.ciphertext) {
		t.Fatalf("reveal: %d %v", code, body)
	}
	if code, _ := h.reveal(id, c, c.reveal); code != http.StatusNotFound {
		t.Fatalf("second reveal: %d", code)
	}
	if got := h.status(id, c); got != StatusViewed {
		t.Fatalf("status = %s", got)
	}
}

func TestPeekNeedsTheLinkToken(t *testing.T) {
	h := newHarness(t, nil)
	c := newClientShare()
	id := h.create(c, false)

	code, _ := h.do("POST", "/share-api/v1/shares/"+id+"/peek", "", map[string]string{"peekToken": b64.EncodeToString(randomToken())})
	if code != http.StatusNotFound {
		t.Fatalf("peek with wrong token: %d", code)
	}
	// Someone with the ID but not the link can't burn it.
	other := newClientShare()
	if code, _ := h.reveal(id, other, c.reveal); code != http.StatusNotFound {
		t.Fatalf("reveal with wrong peek token: %d", code)
	}
	if got := h.status(id, c); got != StatusActive {
		t.Fatalf("status = %s", got)
	}
}

func TestWrongPassphraseBurnsAfterFiveTries(t *testing.T) {
	h := newHarness(t, nil)
	c := newClientShare()
	id := h.create(c, true)

	for attempt := 1; attempt < MaxPassphraseAttempts; attempt++ {
		code, body := h.reveal(id, c, randomToken())
		if code != http.StatusForbidden || body["error"] != "wrong_passphrase" ||
			body["attemptsLeft"] != float64(MaxPassphraseAttempts-attempt) {
			t.Fatalf("attempt %d: %d %v", attempt, code, body)
		}
	}
	if code, _ := h.reveal(id, c, randomToken()); code != http.StatusNotFound {
		t.Fatalf("last attempt: %d", code)
	}
	if code, _ := h.reveal(id, c, c.reveal); code != http.StatusNotFound {
		t.Fatalf("right passphrase after burn: %d", code)
	}
	if got := h.status(id, c); got != StatusBurned {
		t.Fatalf("status = %s", got)
	}
}

func TestRevokeAndExpiry(t *testing.T) {
	h := newHarness(t, nil)
	c := newClientShare()
	id := h.create(c, false)

	code, _ := h.do("POST", "/share-api/v1/shares/"+id+"/revoke", "", map[string]string{"manageToken": b64.EncodeToString(randomToken())})
	if code != http.StatusNotFound {
		t.Fatalf("revoke with wrong token: %d", code)
	}
	code, body := h.do("POST", "/share-api/v1/shares/"+id+"/revoke", "", map[string]string{"manageToken": b64.EncodeToString(c.manage)})
	if code != http.StatusOK || body["status"] != StatusRevoked {
		t.Fatalf("revoke: %d %v", code, body)
	}
	if code, _ := h.reveal(id, c, c.reveal); code != http.StatusNotFound {
		t.Fatalf("reveal after revoke: %d", code)
	}
	if got := h.status(id, c); got != StatusRevoked {
		t.Fatalf("status = %s", got)
	}

	d := newClientShare()
	expiring := h.create(d, false)
	h.clock.t = h.clock.t.Add(2 * time.Hour)
	if got := h.status(expiring, d); got != StatusExpired {
		t.Fatalf("status before sweep = %s", got)
	}
	if code, _ := h.reveal(expiring, d, d.reveal); code != http.StatusNotFound {
		t.Fatalf("reveal after expiry: %d", code)
	}
	if err := h.server.store.Sweep(t.Context(), 30*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if got := h.status(expiring, d); got != StatusExpired {
		t.Fatalf("status after sweep = %s", got)
	}
	h.clock.t = h.clock.t.Add(31 * 24 * time.Hour)
	if err := h.server.store.Sweep(t.Context(), 30*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if got := h.status(expiring, d); got != StatusUnknown {
		t.Fatalf("status after tombstone period = %s", got)
	}
}

func TestCreateLimits(t *testing.T) {
	h := newHarness(t, nil)
	c := newClientShare()

	if code, _ := h.do("POST", "/share-api/v1/shares", "", c.createBody(3600, false)); code != http.StatusUnauthorized {
		t.Fatalf("no auth: %d", code)
	}
	if code, _ := h.do("POST", "/share-api/v1/shares", "Bearer wrong-token-wrong-token-wrong-token", c.createBody(3600, false)); code != http.StatusUnauthorized {
		t.Fatalf("wrong token: %d", code)
	}
	if code, _ := h.do("POST", "/share-api/v1/shares", "Bearer "+testCreationToken, c.createBody(8*24*3600, false)); code != http.StatusBadRequest {
		t.Fatalf("ttl over max: %d", code)
	}
	big := c
	big.ciphertext = bytes.Repeat([]byte{1}, 1025)
	if code, _ := h.do("POST", "/share-api/v1/shares", "Bearer "+testCreationToken, big.createBody(3600, false)); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("too large: %d", code)
	}
	for range 3 {
		h.create(newClientShare(), false)
	}
	code, body := h.do("POST", "/share-api/v1/shares", "Bearer "+testCreationToken, c.createBody(3600, false))
	if code != http.StatusTooManyRequests || body["error"] != "limit_reached" {
		t.Fatalf("over active limit: %d %v", code, body)
	}
}

func TestTicketAuthIsSingleUse(t *testing.T) {
	pk, sk, _ := mldsa65.GenerateKey(rand.Reader)
	h := newHarness(t, func(cfg *Config) {
		cfg.Auth = AuthTicket
		cfg.CreationTokens = nil
		cfg.Tickets = NewTicketVerifier(map[string]*mldsa65.PublicKey{"k1": pk}, "http://localhost:3000")
	})
	h.server.cfg.Tickets.now = h.clock.now

	issue := func(jti string, maxBytes int) string {
		payload, _ := json.Marshal(Ticket{
			Version: 1, KeyID: "k1", Audience: "http://localhost:3000", Subject: "user-a",
			IssuedAt: h.clock.t.Unix(), Expiry: h.clock.t.Add(5 * time.Minute).Unix(), ID: jti,
			Limits: TicketLimits{Active: 200, Bytes: maxBytes, TTL: 3600},
		})
		part := b64.EncodeToString(payload)
		sig := make([]byte, mldsa65.SignatureSize)
		if err := mldsa65.SignTo(sk, []byte(TicketSigningPrefix+part), nil, true, sig); err != nil {
			t.Fatal(err)
		}
		return "Ticket " + part + "." + b64.EncodeToString(sig)
	}

	c := newClientShare()
	ticket := issue("jti-1", 1024)
	if code, body := h.do("POST", "/share-api/v1/shares", ticket, c.createBody(3600, false)); code != http.StatusCreated {
		t.Fatalf("create with ticket: %d %v", code, body)
	}
	if code, _ := h.do("POST", "/share-api/v1/shares", ticket, newClientShare().createBody(3600, false)); code != http.StatusUnauthorized {
		t.Fatalf("reused ticket: %d", code)
	}
	if code, _ := h.do("POST", "/share-api/v1/shares", issue("jti-2", 1024), c.createBody(7200, false)); code != http.StatusBadRequest {
		t.Fatalf("ttl above ticket limit: %d", code)
	}
	if code, _ := h.do("POST", "/share-api/v1/shares", issue("jti-3", 4), c.createBody(3600, false)); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("bytes above ticket limit: %d", code)
	}
	if code, _ := h.do("POST", "/share-api/v1/shares", "Bearer "+testCreationToken, c.createBody(3600, false)); code != http.StatusUnauthorized {
		t.Fatalf("token in ticket mode: %d", code)
	}
}

func TestRateLimitAndHeaders(t *testing.T) {
	h := newHarness(t, nil)
	c := newClientShare()
	id := h.create(c, false)

	req := httptest.NewRequest("OPTIONS", "/share-api/v1/shares", nil)
	rec := httptest.NewRecorder()
	h.server.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("preflight: %d %v", rec.Code, rec.Header())
	}

	var last int
	for range 31 {
		last, _ = h.do("POST", "/share-api/v1/shares/"+id+"/peek", "", map[string]string{"peekToken": b64.EncodeToString(c.peek)})
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("31st peek: %d", last)
	}
	h.clock.t = h.clock.t.Add(time.Minute)
	if code, _ := h.do("POST", "/share-api/v1/shares/"+id+"/peek", "", map[string]string{"peekToken": b64.EncodeToString(c.peek)}); code != http.StatusOK {
		t.Fatalf("peek after window: %d", code)
	}

	rec = httptest.NewRecorder()
	h.server.ServeHTTP(rec, httptest.NewRequest("GET", "/share-api/v1/info", nil))
	if rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("headers: %v", rec.Header())
	}
}

func TestRevokeReportsAnEarlierView(t *testing.T) {
	h := newHarness(t, nil)
	c := newClientShare()
	id := h.create(c, false)
	if code, _ := h.reveal(id, c, c.reveal); code != http.StatusOK {
		t.Fatalf("reveal: %d", code)
	}

	code, body := h.do("POST", "/share-api/v1/shares/"+id+"/revoke", "", map[string]string{"manageToken": b64.EncodeToString(c.manage)})
	if code != http.StatusOK || body["status"] != StatusViewed || body["viewedAt"] == nil {
		t.Fatalf("revoke after view: %d %v", code, body)
	}
}

func TestTicketLimitsCannotRaiseServerCaps(t *testing.T) {
	pk, sk, _ := mldsa65.GenerateKey(rand.Reader)
	h := newHarness(t, func(cfg *Config) {
		cfg.Auth = AuthTicket
		cfg.CreationTokens = nil
		cfg.MaxActive = 2
		cfg.Tickets = NewTicketVerifier(map[string]*mldsa65.PublicKey{"k1": pk}, "http://localhost:3000")
	})
	h.server.cfg.Tickets.now = h.clock.now
	issue := func(jti string) string {
		payload, _ := json.Marshal(Ticket{
			Version: 1, KeyID: "k1", Audience: "http://localhost:3000", Subject: "user-a",
			IssuedAt: h.clock.t.Unix(), Expiry: h.clock.t.Add(5 * time.Minute).Unix(), ID: jti,
			Limits: TicketLimits{Active: 200, Bytes: 1024, TTL: 3600},
		})
		part := b64.EncodeToString(payload)
		sig := make([]byte, mldsa65.SignatureSize)
		if err := mldsa65.SignTo(sk, []byte(TicketSigningPrefix+part), nil, true, sig); err != nil {
			t.Fatal(err)
		}
		return "Ticket " + part + "." + b64.EncodeToString(sig)
	}
	for i, want := range []int{http.StatusCreated, http.StatusCreated, http.StatusTooManyRequests} {
		code, body := h.do("POST", "/share-api/v1/shares", issue(fmt.Sprintf("jti-%d", i)), newClientShare().createBody(3600, false))
		if code != want {
			t.Fatalf("share %d: %d %v", i, code, body)
		}
	}
}

func TestExpiredTicketIsRefusedInsideTheTransaction(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	now := time.Unix(1_800_000_000, 0)
	store.now = func() time.Time { return now }
	c := newClientShare()
	_, err = store.Create(t.Context(), NewShare{
		Owner: "sub:a", Ciphertext: c.ciphertext, PeekHash: make([]byte, 32), RevealHash: make([]byte, 32),
		ManageHash: make([]byte, 32), ExpiresAt: now.Add(time.Hour), MaxActive: 10,
		TicketID: "late", TicketExpiry: now.Add(-time.Second),
	})
	if !errors.Is(err, ErrTicketExpired) {
		t.Fatalf("err = %v", err)
	}
}

func TestClientIPComesFromTrustedHops(t *testing.T) {
	cases := []struct {
		hops   int
		header string
		want   string
	}{
		// One proxy appended the real client.
		{1, "198.51.100.4", "198.51.100.4"},
		{1, "6.6.6.6, 198.51.100.4", "198.51.100.4"},
		// Two proxies appended.
		{2, "6.6.6.6, 198.51.100.4, 10.0.0.2", "198.51.100.4"},
		{2, "198.51.100.4", "203.0.113.7"},
		{1, "::ffff:198.51.100.4", "198.51.100.4"},
		{1, "not-an-ip", "203.0.113.7"},
		{1, "", "203.0.113.7"},
	}
	for _, c := range cases {
		h := newHarness(t, func(cfg *Config) {
			cfg.ClientIPHeader = "X-Forwarded-For"
			cfg.TrustedProxyHops = c.hops
		})
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = "203.0.113.7:5000"
		if c.header != "" {
			req.Header.Set("X-Forwarded-For", c.header)
		}
		if got := h.server.clientIP(req); got != c.want {
			t.Errorf("hops %d, header %q: got %q, want %q", c.hops, c.header, got, c.want)
		}
	}
}
