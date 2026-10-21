package serverkit

import (
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
)

func TestClientIPComesFromTrustedHops(t *testing.T) {
	cases := []struct {
		header string
		hops   int
		value  string
		want   string
	}{
		{"X-Forwarded-For", 1, "198.51.100.4", "198.51.100.4"},
		{"X-Forwarded-For", 1, "6.6.6.6, 198.51.100.4", "198.51.100.4"},
		{"X-Forwarded-For", 2, "6.6.6.6, 198.51.100.4, 10.0.0.2", "198.51.100.4"},
		{"X-Forwarded-For", 2, "198.51.100.4", "203.0.113.7"},
		{"X-Forwarded-For", 0, "198.51.100.4", "198.51.100.4"},
		{"X-Forwarded-For", 1, "::ffff:198.51.100.4", "198.51.100.4"},
		{"X-Forwarded-For", 1, "not-an-ip", "203.0.113.7"},
		{"X-Forwarded-For", 1, "", "203.0.113.7"},
		// Without a configured header, client-written headers are ignored.
		{"", 1, "198.51.100.4", "203.0.113.7"},
		// IPv6 addresses share a bucket per /64.
		{"X-Forwarded-For", 1, "2001:db8:1:2:aaaa::1", "2001:db8:1:2::/64"},
		{"X-Forwarded-For", 1, "2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2::/64"},
		{"X-Forwarded-For", 1, "2001:db8:1:3::1", "2001:db8:1:3::/64"},
		{"X-Forwarded-For", 1, "fe80::1%eth0", "fe80::/64"},
	}
	for _, c := range cases {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = "203.0.113.7:5000"
		if c.value != "" {
			req.Header.Set("X-Forwarded-For", c.value)
		}
		if got := ClientIP(req, c.header, c.hops); got != c.want {
			t.Errorf("header %q, hops %d, value %q: got %q, want %q", c.header, c.hops, c.value, got, c.want)
		}
	}

	// The socket address is grouped the same way.
	for remote, want := range map[string]string{
		"[2001:db8:5:6:7:8:9:a]:5000": "2001:db8:5:6::/64",
		"[::ffff:198.51.100.9]:5000":  "198.51.100.9",
		"198.51.100.9:5000":           "198.51.100.9",
		"not-an-address":              "not-an-address",
	} {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = remote
		if got := ClientIP(req, "", 1); got != want {
			t.Errorf("socket %q: got %q, want %q", remote, got, want)
		}
	}
}

func TestNetworkKey(t *testing.T) {
	for key, want := range map[string]string{
		"198.51.100.4":        "198.51.100.0/24",
		"198.51.100.250":      "198.51.100.0/24",
		"198.51.101.4":        "198.51.101.0/24",
		"2001:db8:1:2::/64":   "2001:db8:1::/48",
		"2001:db8:1:ff::/64":  "2001:db8:1::/48",
		"2001:db8:2:2::/64":   "2001:db8:2::/48",
		"2001:db8:1:2::7":     "2001:db8:1::/48",
		"::ffff:198.51.100.4": "198.51.100.0/24",
		"not-an-address":      "not-an-address",
	} {
		if got := NetworkKey(key); got != want {
			t.Errorf("NetworkKey(%q) = %q, want %q", key, got, want)
		}
	}
	// Every ClientIP key in one network maps to the same network key.
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "[2001:db8:7:8:9::1]:5000"
	if got := NetworkKey(ClientIP(req, "", 1)); got != "2001:db8:7::/48" {
		t.Errorf("from ClientIP: %q", got)
	}
}

func TestRateLimiterWindowsAndBound(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	l := NewRateLimiter(time.Minute, func() time.Time { return now })
	for i := range 2 {
		if !l.Allow("a", 2) {
			t.Fatalf("request %d refused", i)
		}
	}
	if l.Allow("a", 2) {
		t.Fatal("third request in the window allowed")
	}
	now = now.Add(time.Minute)
	if !l.Allow("a", 2) {
		t.Fatal("new window refused")
	}

	l.maxKeys = 3
	l.windows = map[string]*rateWindow{}
	for i := range 3 {
		if !l.Allow(fmt.Sprintf("client-%d", i), 1) {
			t.Fatalf("client %d refused", i)
		}
	}
	if !l.Allow("client-new-1", 1) {
		t.Fatal("first overflow request refused")
	}
	if l.Allow("client-new-2", 1) {
		t.Fatal("overflow bucket not shared")
	}
	if len(l.windows) > 4 {
		t.Fatalf("limiter grew to %d keys", len(l.windows))
	}
	now = now.Add(time.Minute)
	l.Prune()
	if len(l.windows) != 0 {
		t.Fatalf("prune kept %d windows", len(l.windows))
	}
}

func TestParseMLDSA65Keys(t *testing.T) {
	pk, _, err := mldsa65.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := pk.MarshalBinary()
	encoded := base64.StdEncoding.EncodeToString(raw)
	for _, bad := range []string{"", " , ", "nokid", ":" + encoded, "a:not-base64!", "a:" + base64.StdEncoding.EncodeToString(raw[:10])} {
		if _, err := ParseMLDSA65Keys(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	keys, err := ParseMLDSA65Keys("a:" + encoded + ", b:" + encoded)
	if err != nil || len(keys) != 2 || !keys["a"].Equal(pk) {
		t.Fatalf("keys = %d, err = %v", len(keys), err)
	}
}

func TestEnvHelpers(t *testing.T) {
	t.Setenv("SK_TEST", "  value ")
	if got := Env("SK_TEST", "x"); got != "value" {
		t.Fatalf("Env = %q", got)
	}
	if got := Env("SK_TEST_MISSING", "x"); got != "x" {
		t.Fatalf("fallback = %q", got)
	}

	path := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(path, []byte("from-file\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SK_SECRET", "from-env")
	if got, err := EnvOrFile("SK_SECRET"); err != nil || got != "from-env" {
		t.Fatalf("EnvOrFile = %q, %v", got, err)
	}
	t.Setenv("SK_SECRET_FILE", path)
	if got, err := EnvOrFile("SK_SECRET"); err != nil || got != "from-file" {
		t.Fatalf("EnvOrFile with _FILE = %q, %v", got, err)
	}
	t.Setenv("SK_SECRET_FILE", path+".missing")
	if _, err := EnvOrFile("SK_SECRET"); err == nil {
		t.Fatal("missing _FILE accepted")
	}

	for value, want := range map[string]int{"": 7, "12": 12} {
		t.Setenv("SK_INT", value)
		if got, err := EnvInt("SK_INT", 7); err != nil || got != want {
			t.Errorf("EnvInt(%q) = %d, %v", value, got, err)
		}
	}
	for _, value := range []string{"0", "-1", "ten"} {
		t.Setenv("SK_INT", value)
		if _, err := EnvInt("SK_INT", 7); err == nil {
			t.Errorf("EnvInt(%q) accepted", value)
		}
	}
}

func TestHealthcheck(t *testing.T) {
	status := http.StatusNoContent
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(status)
	}))
	defer ts.Close()
	// Only the port counts: the check always asks the loopback address.
	_, port, _ := net.SplitHostPort(ts.Listener.Addr().String())
	addr := ":" + port
	if got := Healthcheck(addr); got != 0 {
		t.Fatalf("healthy server: exit %d", got)
	}
	status = http.StatusServiceUnavailable
	if got := Healthcheck(addr); got != 1 {
		t.Fatalf("unhealthy server: exit %d", got)
	}
	if got := Healthcheck("no-port"); got != 1 {
		t.Fatalf("bad address: exit %d", got)
	}
}
