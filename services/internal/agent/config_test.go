package agent

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestParseConfig(t *testing.T) {
	cases := []struct {
		in     string
		want   Config
		hasErr bool
	}{
		{"", Config{Relay: DefaultRelayURL, Notify: true}, false},
		{"# comment\n\nrelay = https://relay.example.com\nnotify = false\n", Config{Relay: "https://relay.example.com", Notify: false}, false},
		{`relay="https://r.example.com"` + "\nnotify=Yes", Config{Relay: "https://r.example.com", Notify: true}, false},
		{"terminal = on\nnotify = off", Config{Relay: DefaultRelayURL, Terminal: true}, false},
		{"notify = maybe", Config{}, true},
		{"relay", Config{}, true},
		{"relay =", Config{}, true},
		{"rleay = https://typo.example.com", Config{}, true},
		{"relay = http://relay.example.com", Config{}, true},
		{"relay = http://localhost:8080", Config{Relay: "http://localhost:8080", Notify: true}, false},
	}
	for _, c := range cases {
		got, err := ParseConfig(strings.NewReader(c.in))
		if (err != nil) != c.hasErr {
			t.Errorf("%q: err = %v", c.in, err)
			continue
		}
		if !c.hasErr && got != c.want {
			t.Errorf("%q: got %+v", c.in, got)
		}
	}
	cfg, err := LoadConfig(filepath.Join(t.TempDir(), "missing"))
	if err != nil || cfg.Relay != DefaultRelayURL {
		t.Fatalf("missing config: %+v, %v", cfg, err)
	}
}
