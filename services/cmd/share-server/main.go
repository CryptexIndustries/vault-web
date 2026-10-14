// Command share-server stores one-time share links for Cryptex Vault.
//
// It only ever holds ciphertext and token hashes. The decryption key stays in
// the link fragment, which browsers never send to a server.
package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/share"
)

func main() {
	// The runtime image has no shell or wget, so the binary checks itself.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("share server stopped", "error", err)
		os.Exit(1)
	}
}

func healthcheck() int {
	_, port, err := net.SplitHostPort(env("SHARE_LISTEN_ADDR", ":8080"))
	if err != nil {
		return 1
	}
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return 1
	}
	return 0
}

func env(name, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return fallback
}

// envOrFile reads NAME, or the file named by NAME_FILE (Docker secrets).
func envOrFile(name string) (string, error) {
	if path := env(name+"_FILE", ""); path != "" {
		raw, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("%s_FILE: %w", name, err)
		}
		return strings.TrimSpace(string(raw)), nil
	}
	return env(name, ""), nil
}

func envInt(name string, fallback int) (int, error) {
	raw := env(name, "")
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return v, nil
}

func loadConfig(logger *slog.Logger) (share.Config, error) {
	cfg := share.Config{
		Auth:           env("SHARE_AUTH", share.AuthToken),
		ClientIPHeader: env("SHARE_CLIENT_IP_HEADER", ""),
		Logger:         logger,
	}
	maxBytes, err := envInt("SHARE_MAX_BYTES", 64<<10)
	if err != nil {
		return cfg, err
	}
	maxTTL, err := envInt("SHARE_MAX_TTL_SECONDS", 7*24*3600)
	if err != nil {
		return cfg, err
	}
	maxActive, err := envInt("SHARE_MAX_ACTIVE", 200)
	if err != nil {
		return cfg, err
	}
	cfg.MaxBytes, cfg.MaxTTL, cfg.MaxActive = maxBytes, time.Duration(maxTTL)*time.Second, maxActive
	if cfg.MaxTTL < share.MinTTL {
		return cfg, fmt.Errorf("SHARE_MAX_TTL_SECONDS must be at least %d", int(share.MinTTL/time.Second))
	}
	hops, err := envInt("SHARE_TRUSTED_PROXY_HOPS", 1)
	if err != nil {
		return cfg, err
	}
	cfg.TrustedProxyHops = hops

	switch cfg.Auth {
	case share.AuthTicket:
		// Tickets carry the public web origin; the web app's own setting is
		// the usual source.
		raw := env("SHARE_TICKET_AUDIENCE", env("NEXT_PUBLIC_APP_URL", ""))
		if raw == "" {
			return cfg, errors.New("SHARE_TICKET_AUDIENCE or NEXT_PUBLIC_APP_URL is required with SHARE_AUTH=ticket")
		}
		audience, err := share.NormalizeOrigin(raw)
		if err != nil {
			return cfg, fmt.Errorf("ticket audience: %w", err)
		}
		keys, err := share.ParseTicketKeys(env("SHARE_TICKET_PUBLIC_KEYS", ""))
		if err != nil {
			return cfg, fmt.Errorf("SHARE_TICKET_PUBLIC_KEYS: %w", err)
		}
		cfg.Tickets = share.NewTicketVerifier(keys, audience)
	case share.AuthToken:
		tokens, err := envOrFile("SHARE_CREATION_TOKENS")
		if err != nil {
			return cfg, err
		}
		for _, token := range strings.FieldsFunc(tokens, func(r rune) bool { return r == ',' || r == '\n' }) {
			token = strings.TrimSpace(token)
			if token == "" {
				continue
			}
			if len(token) < 32 {
				return cfg, errors.New("SHARE_CREATION_TOKENS entries must be at least 32 characters")
			}
			sum := sha256.Sum256([]byte(token))
			cfg.CreationTokens = append(cfg.CreationTokens, sum[:])
		}
		if len(cfg.CreationTokens) == 0 {
			return cfg, errors.New("SHARE_CREATION_TOKENS is required with SHARE_AUTH=token")
		}
	default:
		return cfg, fmt.Errorf("SHARE_AUTH must be %q or %q", share.AuthTicket, share.AuthToken)
	}
	return cfg, nil
}

func run(logger *slog.Logger) error {
	cfg, err := loadConfig(logger)
	if err != nil {
		return err
	}
	tombstoneDays, err := envInt("SHARE_TOMBSTONE_DAYS", 30)
	if err != nil {
		return err
	}
	store, err := share.OpenStore(env("SHARE_DB_PATH", "/data/share.db"))
	if err != nil {
		return err
	}
	defer store.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Metrics get their own listener so they are never reachable through the
	// web proxy. "off" disables them.
	var metricsServer *http.Server
	if addr := env("SHARE_METRICS_ADDR", ":9090"); addr != "off" {
		metrics := share.NewMetrics(store, logger)
		cfg.Metrics = metrics
		metricsServer = &http.Server{
			Addr:              addr,
			Handler:           metrics.Handler(),
			ReadHeaderTimeout: 5 * time.Second,
			ReadTimeout:       5 * time.Second,
			WriteTimeout:      15 * time.Second,
			IdleTimeout:       30 * time.Second,
			MaxHeaderBytes:    8 << 10,
		}
	}

	server := share.NewServer(cfg, store)
	go server.RunSweeper(ctx, time.Minute, time.Duration(tombstoneDays)*24*time.Hour)

	httpServer := &http.Server{
		Addr:              env("SHARE_LISTEN_ADDR", ":8080"),
		Handler:           server,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}
	errCh := make(chan error, 2)
	go func() {
		logger.Info("share server listening", "addr", httpServer.Addr, "auth", cfg.Auth)
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
	// Stop both listeners at once so a slow metrics client can't use up the
	// time the API needs to finish its requests.
	var wg sync.WaitGroup
	if metricsServer != nil {
		wg.Go(func() { _ = metricsServer.Shutdown(shutdownCtx) })
	}
	err = httpServer.Shutdown(shutdownCtx)
	wg.Wait()
	return err
}
