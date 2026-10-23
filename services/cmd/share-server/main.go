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
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/serverkit"
	"github.com/CryptexIndustries/vault-web/services/internal/share"
)

// version is set at build time with -ldflags "-X main.version=1.0.1".
var version = "dev"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "healthcheck":
			// The runtime image has no shell or wget, so the binary checks itself.
			os.Exit(serverkit.Healthcheck(serverkit.Env("SHARE_LISTEN_ADDR", ":8080")))
		case "version", "--version":
			fmt.Println("share-server", version)
			return
		}
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("share server stopped", "error", err)
		os.Exit(1)
	}
}

func loadConfig(logger *slog.Logger) (share.Config, error) {
	cfg := share.Config{
		Auth:           serverkit.Env("SHARE_AUTH", share.AuthToken),
		ClientIPHeader: serverkit.Env("SHARE_CLIENT_IP_HEADER", ""),
		Logger:         logger,
	}
	maxBytes, err := serverkit.EnvInt("SHARE_MAX_BYTES", 64<<10)
	if err != nil {
		return cfg, err
	}
	maxTTL, err := serverkit.EnvInt("SHARE_MAX_TTL_SECONDS", 7*24*3600)
	if err != nil {
		return cfg, err
	}
	maxActive, err := serverkit.EnvInt("SHARE_MAX_ACTIVE", 200)
	if err != nil {
		return cfg, err
	}
	cfg.MaxBytes, cfg.MaxTTL, cfg.MaxActive = maxBytes, time.Duration(maxTTL)*time.Second, maxActive
	if cfg.MaxTTL < share.MinTTL {
		return cfg, fmt.Errorf("SHARE_MAX_TTL_SECONDS must be at least %d", int(share.MinTTL/time.Second))
	}
	hops, err := serverkit.EnvInt("SHARE_TRUSTED_PROXY_HOPS", 1)
	if err != nil {
		return cfg, err
	}
	cfg.TrustedProxyHops = hops

	switch cfg.Auth {
	case share.AuthTicket:
		// Tickets carry the public web origin; the web app's own setting is
		// the usual source.
		raw := serverkit.Env("SHARE_TICKET_AUDIENCE", serverkit.Env("NEXT_PUBLIC_APP_URL", ""))
		if raw == "" {
			return cfg, errors.New("SHARE_TICKET_AUDIENCE or NEXT_PUBLIC_APP_URL is required with SHARE_AUTH=ticket")
		}
		audience, err := serverkit.NormalizeOrigin(raw)
		if err != nil {
			return cfg, fmt.Errorf("ticket audience: %w", err)
		}
		keys, err := share.ParseTicketKeys(serverkit.Env("SHARE_TICKET_PUBLIC_KEYS", ""))
		if err != nil {
			return cfg, fmt.Errorf("SHARE_TICKET_PUBLIC_KEYS: %w", err)
		}
		cfg.Tickets = share.NewTicketVerifier(keys, audience)
	case share.AuthToken:
		tokens, err := serverkit.EnvOrFile("SHARE_CREATION_TOKENS")
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
	tombstoneDays, err := serverkit.EnvInt("SHARE_TOMBSTONE_DAYS", 30)
	if err != nil {
		return err
	}
	store, err := share.OpenStore(serverkit.Env("SHARE_DB_PATH", "/data/share.db"))
	if err != nil {
		return err
	}
	defer store.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Metrics get their own listener so they are never reachable through the
	// web proxy. "off" disables them.
	var metricsServer *http.Server
	if addr := serverkit.Env("SHARE_METRICS_ADDR", ":9090"); addr != "off" {
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
		Addr:              serverkit.Env("SHARE_LISTEN_ADDR", ":8080"),
		Handler:           server,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}
	errCh := make(chan error, 2)
	go func() {
		logger.Info("share server listening", "addr", httpServer.Addr, "auth", cfg.Auth, "version", version)
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
