package main

import (
	"encoding/base64"
	"io"
	"log/slog"
	"testing"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
)

func ticketEnv(t *testing.T) {
	t.Helper()
	pk, _, err := mldsa65.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := pk.MarshalBinary()
	t.Setenv("SHARE_AUTH", "ticket")
	t.Setenv("SHARE_TICKET_PUBLIC_KEYS", "test:"+base64.StdEncoding.EncodeToString(raw))
	t.Setenv("SHARE_TICKET_AUDIENCE", "")
	t.Setenv("NEXT_PUBLIC_APP_URL", "")
}

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func TestTicketAudienceFallsBackToTheWebOrigin(t *testing.T) {
	ticketEnv(t)
	t.Setenv("NEXT_PUBLIC_APP_URL", "https://www.cryptex-vault.com/")
	cfg, err := loadConfig(quiet)
	if err != nil {
		t.Fatal(err)
	}
	if got := cfg.Tickets.Audience(); got != "https://www.cryptex-vault.com" {
		t.Fatalf("audience = %q", got)
	}

	t.Setenv("SHARE_TICKET_AUDIENCE", "https://share.example.net/app")
	cfg, err = loadConfig(quiet)
	if err != nil {
		t.Fatal(err)
	}
	if got := cfg.Tickets.Audience(); got != "https://share.example.net" {
		t.Fatalf("explicit audience = %q", got)
	}
}

func TestMaxTTLMustAllowTheShortestExpiry(t *testing.T) {
	t.Setenv("SHARE_AUTH", "token")
	t.Setenv("SHARE_CREATION_TOKENS", "token-0123456789abcdef0123456789abcdef")
	t.Setenv("SHARE_MAX_TTL_SECONDS", "30")
	if _, err := loadConfig(quiet); err == nil {
		t.Fatal("started with a 30-second maximum expiry")
	}
	t.Setenv("SHARE_MAX_TTL_SECONDS", "60")
	if _, err := loadConfig(quiet); err != nil {
		t.Fatal(err)
	}
}

func TestTicketModeNeedsAValidAudience(t *testing.T) {
	ticketEnv(t)
	if _, err := loadConfig(quiet); err == nil {
		t.Fatal("started without an audience")
	}
	t.Setenv("NEXT_PUBLIC_APP_URL", "vault.example.com")
	if _, err := loadConfig(quiet); err == nil {
		t.Fatal("started with an audience that isn't a URL")
	}
}
