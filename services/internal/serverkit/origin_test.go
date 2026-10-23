package serverkit

import "testing"

func TestNormalizeOrigin(t *testing.T) {
	for raw, want := range map[string]string{
		"https://vault.example.com":           "https://vault.example.com",
		"https://vault.example.com/":          "https://vault.example.com",
		"https://Vault.Example.com/app/":      "https://vault.example.com",
		"https://vault.example.com:443/x?y=1": "https://vault.example.com",
		"http://localhost:3000/":              "http://localhost:3000",
		"HTTP://LOCALHOST:80":                 "http://localhost",
		" https://[::1]:8443 ":                "https://[::1]:8443",
		"https://xn--bcher-kva.example/":      "https://xn--bcher-kva.example",
		"http://127.0.0.1:3000":               "http://127.0.0.1:3000",
	} {
		got, err := NormalizeOrigin(raw)
		if err != nil || got != want {
			t.Errorf("NormalizeOrigin(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
	for _, raw := range []string{"", "vault.example.com", "ftp://vault.example.com", "https://", "https://user:pw@vault.example.com", "https:vault",
		"https://bücher.example", "https://[0:0:0:0:0:0:0:1]", "https://vault.example.com:0443", "https://vault.example.com:99999", "http://127.000.0.1"} {
		if got, err := NormalizeOrigin(raw); err == nil {
			t.Errorf("NormalizeOrigin(%q) = %q, want an error", raw, got)
		}
	}
}
