package main

import (
	"encoding/base64"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

const token = "relay-token-0123456789abcdef0123456789"

func baseEnv(t *testing.T) {
	t.Helper()
	for _, name := range []string{"RELAY_AUTH_MODE", "RELAY_PASS_PUBLIC_KEYS", "RELAY_PASS_PUBLIC_KEYS_FILE",
		"RELAY_ACCESS_TOKEN", "RELAY_ACCESS_TOKEN_FILE", "RELAY_MAX_AGENTS", "RELAY_KEEPALIVE_SECONDS",
		"RELAY_REGISTRATION_GRACE_DAYS", "RELAY_MAX_PAIRING_SLOTS", "RELAY_CLIENT_IP_HEADER", "RELAY_TRUSTED_PROXY_HOPS",
		"RELAY_MAX_QUEUE_BYTES", "RELAY_MAX_ACCOUNT_QUEUE_BYTES", "RELAY_MAX_PENDING_CONNECTIONS"} {
		t.Setenv(name, "")
	}
	t.Setenv("RELAY_PUBLIC_URL", "https://Relay.Example.com/")
	t.Setenv("RELAY_ACCESS_TOKEN", token)
}

func TestDefaultsAndPublicURL(t *testing.T) {
	baseEnv(t)
	cfg, err := loadConfig(quiet)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PublicURL != "https://relay.example.com" || cfg.Auth != "token" || cfg.AccessToken != token ||
		cfg.MaxAgents != 25 || cfg.Keepalive != 240*time.Second || cfg.MaxPairingSlots != 1000 ||
		cfg.RegistrationGrace != 30*24*time.Hour || cfg.TrustedProxyHops != 1 || cfg.DBPath != "/data/relay.db" ||
		cfg.MaxQueueBytes != 64<<20 || cfg.MaxAccountQueueBytes != 4<<20 || cfg.MaxPendingConnections != 1000 {
		t.Fatalf("cfg = %+v", cfg)
	}

	t.Setenv("RELAY_PUBLIC_URL", "")
	if _, err := loadConfig(quiet); err == nil {
		t.Fatal("started without RELAY_PUBLIC_URL")
	}
	t.Setenv("RELAY_PUBLIC_URL", "relay.example.com")
	if _, err := loadConfig(quiet); err == nil {
		t.Fatal("started with a public URL that isn't a URL")
	}
}

func TestTokenMode(t *testing.T) {
	baseEnv(t)
	t.Setenv("RELAY_ACCESS_TOKEN", "short")
	if _, err := loadConfig(quiet); err == nil {
		t.Fatal("accepted a short token")
	}
	t.Setenv("RELAY_ACCESS_TOKEN", "")
	if _, err := loadConfig(quiet); err == nil {
		t.Fatal("started without a token")
	}
	path := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(path, []byte(token+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RELAY_ACCESS_TOKEN_FILE", path)
	cfg, err := loadConfig(quiet)
	if err != nil || cfg.AccessToken != token {
		t.Fatalf("token from file: %q, %v", cfg.AccessToken, err)
	}
}

func TestTicketMode(t *testing.T) {
	baseEnv(t)
	t.Setenv("RELAY_AUTH_MODE", "ticket")
	if _, err := loadConfig(quiet); err == nil {
		t.Fatal("started without pass keys")
	}
	pk, _, err := mldsa65.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := pk.MarshalBinary()
	t.Setenv("RELAY_PASS_PUBLIC_KEYS", "k1:"+base64.StdEncoding.EncodeToString(raw))
	t.Setenv("RELAY_KEEPALIVE_SECONDS", "90")
	cfg, err := loadConfig(quiet)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.PassKeys) != 1 || cfg.Keepalive != 90*time.Second {
		t.Fatalf("cfg = %+v", cfg)
	}
	t.Setenv("RELAY_AUTH_MODE", "open")
	if _, err := loadConfig(quiet); err == nil {
		t.Fatal("accepted an unknown auth mode")
	}
}

func TestNumericBounds(t *testing.T) {
	for name, value := range map[string]string{
		"RELAY_KEEPALIVE_SECONDS":       "5",
		"RELAY_MAX_AGENTS":              "0",
		"RELAY_MAX_PAIRING_SLOTS":       "-1",
		"RELAY_REGISTRATION_GRACE_DAYS": "a week",
		"RELAY_MAX_QUEUE_BYTES":         "65536",
		"RELAY_MAX_ACCOUNT_QUEUE_BYTES": "65536",
		"RELAY_MAX_PENDING_CONNECTIONS": "0",
	} {
		baseEnv(t)
		t.Setenv(name, value)
		if _, err := loadConfig(quiet); err == nil {
			t.Errorf("%s=%s accepted", name, value)
		}
	}
	baseEnv(t)
	t.Setenv("RELAY_MAX_QUEUE_BYTES", "268435456")
	t.Setenv("RELAY_MAX_ACCOUNT_QUEUE_BYTES", "8388608")
	t.Setenv("RELAY_MAX_PENDING_CONNECTIONS", "50")
	if cfg, err := loadConfig(quiet); err != nil || cfg.MaxQueueBytes != 256<<20 || cfg.MaxAccountQueueBytes != 8<<20 ||
		cfg.MaxPendingConnections != 50 {
		t.Errorf("queue and pending settings: %+v, %v", cfg, err)
	}
	baseEnv(t)
	t.Setenv("RELAY_KEEPALIVE_SECONDS", "4000")
	if _, err := loadConfig(quiet); err == nil {
		t.Error("keep-alive over an hour accepted")
	}
}
