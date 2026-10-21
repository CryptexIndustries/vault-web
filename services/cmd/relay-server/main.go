// Command relay-server forwards end-to-end encrypted messages between
// cryptex-agent and the device that approves its SSH requests.
//
// It never sees private keys or plaintext: envelopes are encrypted between
// the agent and the approver, and the relay only checks their signatures and
// headers to route them.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/relay"
	"github.com/CryptexIndustries/vault-web/services/internal/serverkit"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(serverkit.Healthcheck(serverkit.Env("RELAY_LISTEN_ADDR", ":8080")))
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("relay server stopped", "error", err)
		os.Exit(1)
	}
}

// Keep-alive bounds: below 10 seconds clients would ping constantly; above
// an hour a dead connection holds its slot for most of a day.
const (
	minKeepaliveSeconds = 10
	maxKeepaliveSeconds = 3600
	minTokenLength      = 32
	// minQueueBytes keeps both budgets above what one recipient may queue,
	// so a typo can't make every Send fail.
	minQueueBytes = 1 << 20
)

func loadConfig(logger *slog.Logger) (relay.Config, error) {
	cfg := relay.Config{
		Auth:           serverkit.Env("RELAY_AUTH_MODE", relay.AuthToken),
		ClientIPHeader: serverkit.Env("RELAY_CLIENT_IP_HEADER", ""),
		DBPath:         serverkit.Env("RELAY_DB_PATH", "/data/relay.db"),
		Logger:         logger,
	}
	raw := serverkit.Env("RELAY_PUBLIC_URL", "")
	if raw == "" {
		return cfg, errors.New("RELAY_PUBLIC_URL is required")
	}
	origin, err := serverkit.NormalizeOrigin(raw)
	if err != nil {
		return cfg, fmt.Errorf("RELAY_PUBLIC_URL: %w", err)
	}
	cfg.PublicURL = origin

	ints := []struct {
		name     string
		fallback int
		dst      *int
	}{
		{"RELAY_MAX_AGENTS", 25, &cfg.MaxAgents},
		{"RELAY_MAX_PAIRING_SLOTS", 1000, &cfg.MaxPairingSlots},
		{"RELAY_MAX_PENDING_CONNECTIONS", 1000, &cfg.MaxPendingConnections},
		{"RELAY_TRUSTED_PROXY_HOPS", 1, &cfg.TrustedProxyHops},
	}
	for _, v := range ints {
		n, err := serverkit.EnvInt(v.name, v.fallback)
		if err != nil {
			return cfg, err
		}
		*v.dst = n
	}
	keepalive, err := serverkit.EnvInt("RELAY_KEEPALIVE_SECONDS", 240)
	if err != nil {
		return cfg, err
	}
	if keepalive < minKeepaliveSeconds || keepalive > maxKeepaliveSeconds {
		return cfg, fmt.Errorf("RELAY_KEEPALIVE_SECONDS must be between %d and %d", minKeepaliveSeconds, maxKeepaliveSeconds)
	}
	cfg.Keepalive = time.Duration(keepalive) * time.Second
	graceDays, err := serverkit.EnvInt("RELAY_REGISTRATION_GRACE_DAYS", 30)
	if err != nil {
		return cfg, err
	}
	cfg.RegistrationGrace = time.Duration(graceDays) * 24 * time.Hour
	queueBytes, err := serverkit.EnvInt("RELAY_MAX_QUEUE_BYTES", 64<<20)
	if err != nil {
		return cfg, err
	}
	if queueBytes < minQueueBytes {
		return cfg, fmt.Errorf("RELAY_MAX_QUEUE_BYTES must be at least %d", minQueueBytes)
	}
	cfg.MaxQueueBytes = int64(queueBytes)
	accountBytes, err := serverkit.EnvInt("RELAY_MAX_ACCOUNT_QUEUE_BYTES", 4<<20)
	if err != nil {
		return cfg, err
	}
	if accountBytes < minQueueBytes {
		return cfg, fmt.Errorf("RELAY_MAX_ACCOUNT_QUEUE_BYTES must be at least %d", minQueueBytes)
	}
	cfg.MaxAccountQueueBytes = int64(accountBytes)

	switch cfg.Auth {
	case relay.AuthTicket:
		keys, err := serverkit.EnvOrFile("RELAY_PASS_PUBLIC_KEYS")
		if err != nil {
			return cfg, err
		}
		cfg.PassKeys, err = serverkit.ParseMLDSA65Keys(keys)
		if err != nil {
			return cfg, fmt.Errorf("RELAY_PASS_PUBLIC_KEYS: %w", err)
		}
	case relay.AuthToken:
		token, err := serverkit.EnvOrFile("RELAY_ACCESS_TOKEN")
		if err != nil {
			return cfg, err
		}
		if token == "" {
			return cfg, errors.New("RELAY_ACCESS_TOKEN is required with RELAY_AUTH_MODE=token")
		}
		if len(token) < minTokenLength {
			return cfg, fmt.Errorf("RELAY_ACCESS_TOKEN must be at least %d characters", minTokenLength)
		}
		cfg.AccessToken = token
	default:
		return cfg, fmt.Errorf("RELAY_AUTH_MODE must be %q or %q", relay.AuthTicket, relay.AuthToken)
	}
	return cfg, nil
}

func run(logger *slog.Logger) error {
	cfg, err := loadConfig(logger)
	if err != nil {
		return err
	}
	server, err := relay.New(cfg)
	if err != nil {
		return err
	}
	defer server.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Metrics get their own listener so they are never reachable through the
	// public proxy. "off" disables them.
	var metricsServer *http.Server
	if addr := serverkit.Env("RELAY_METRICS_ADDR", ":9090"); addr != "off" {
		metricsServer = &http.Server{
			Addr:              addr,
			Handler:           server.MetricsHandler(),
			ReadHeaderTimeout: 5 * time.Second,
			ReadTimeout:       5 * time.Second,
			WriteTimeout:      15 * time.Second,
			IdleTimeout:       30 * time.Second,
			MaxHeaderBytes:    8 << 10,
		}
	}

	// The timeouts apply to plain requests; net/http clears them when the
	// relay upgrades a connection to a WebSocket.
	httpServer := &http.Server{
		Addr:              serverkit.Env("RELAY_LISTEN_ADDR", ":8080"),
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	errCh := make(chan error, 2)
	go func() {
		logger.Info("relay server listening", "addr", httpServer.Addr, "auth", cfg.Auth,
			"public_url", cfg.PublicURL, "keepalive_seconds", int(cfg.Keepalive/time.Second))
		errCh <- httpServer.ListenAndServe()
	}()
	if metricsServer != nil {
		go func() {
			logger.Info("metrics listening", "addr", metricsServer.Addr)
			errCh <- fmt.Errorf("metrics: %w", metricsServer.ListenAndServe())
		}()
	}

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	if metricsServer != nil {
		wg.Go(func() { _ = metricsServer.Shutdown(shutdownCtx) })
	}
	err = httpServer.Shutdown(shutdownCtx)
	wg.Wait()
	// Shutdown doesn't wait for hijacked WebSockets; Close ends them.
	if closeErr := server.Close(); err == nil {
		err = closeErr
	}
	return err
}
