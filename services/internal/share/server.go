package share

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/serverkit"
)

const (
	AuthTicket = "ticket"
	AuthToken  = "token"

	APIPrefix = "/share-api/v1"

	// MinTTL is the shortest expiry a share can have.
	MinTTL          = 60 * time.Second
	tokenBytes      = 32
	maxStatusBatch  = 200
	smallBodyLimit  = 64 << 10
	createBodySlack = 4 << 10
)

var shareIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`)

type Config struct {
	Auth string
	// Tickets verifies subscriber tickets when Auth is "ticket".
	Tickets *TicketVerifier
	// CreationTokens holds SHA-256 hashes of the operator's tokens when Auth is "token".
	CreationTokens [][]byte
	// Server-wide caps. Ticket limits can only lower them.
	MaxBytes  int
	MaxTTL    time.Duration
	MaxActive int
	// ClientIPHeader names a header set by a trusted proxy (for example
	// "X-Forwarded-For" or "CF-Connecting-IP"). Empty uses the socket address.
	ClientIPHeader string
	// TrustedProxyHops is how many proxies append to ClientIPHeader before it
	// reaches this server (the web container passes it through unchanged).
	// The client address is that many entries from the right; anything
	// further left was written by the client and is ignored.
	TrustedProxyHops int
	Logger           *slog.Logger
	// Metrics is optional.
	Metrics *Metrics
}

type Server struct {
	cfg     Config
	store   *Store
	limiter *serverkit.RateLimiter
	mux     *http.ServeMux
}

func NewServer(cfg Config, store *Store) *Server {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	s := &Server{cfg: cfg, store: store, limiter: serverkit.NewRateLimiter(time.Minute, nil), mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	s.mux.HandleFunc("GET "+APIPrefix+"/info", s.handleInfo)
	s.mux.HandleFunc("POST "+APIPrefix+"/shares", s.limit("create", 30, s.handleCreate))
	s.mux.HandleFunc("POST "+APIPrefix+"/shares/status", s.limit("manage", 60, s.handleStatus))
	s.mux.HandleFunc("POST "+APIPrefix+"/shares/{id}/peek", s.limit("open", 30, s.handlePeek))
	s.mux.HandleFunc("POST "+APIPrefix+"/shares/{id}/reveal", s.limit("open", 30, s.handleReveal))
	s.mux.HandleFunc("POST "+APIPrefix+"/shares/{id}/revoke", s.limit("manage", 60, s.handleRevoke))
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	// No cookies are involved, so any origin may call the API. The browser
	// extension and self-hosted web apps need this.
	h.Set("Access-Control-Allow-Origin", "*")
	start := time.Now()
	if r.Method == http.MethodOptions {
		h.Set("Access-Control-Allow-Methods", "GET, POST")
		h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		h.Set("Access-Control-Max-Age", "600")
		w.WriteHeader(http.StatusNoContent)
		s.cfg.Metrics.observeRequest("OPTIONS preflight", r.Method, http.StatusNoContent, time.Since(start))
		return
	}
	rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	s.mux.ServeHTTP(rec, r)
	took := time.Since(start)
	// Log the route pattern, not the path: paths contain share IDs.
	s.cfg.Logger.Info("request", "method", r.Method, "route", r.Pattern,
		"status", rec.status, "duration_ms", took.Milliseconds())
	s.cfg.Metrics.observeRequest(r.Pattern, methodLabel(r.Method), rec.status, took)
}

// methodLabel keeps client-chosen methods out of metric labels.
func methodLabel(method string) string {
	switch method {
	case http.MethodGet, http.MethodPost, http.MethodOptions:
		return method
	}
	return "other"
}

// RunSweeper expires shares and forgets old tombstones until ctx ends.
func (s *Server) RunSweeper(ctx context.Context, every, tombstone time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		err := s.store.Sweep(ctx, tombstone)
		if ctx.Err() == nil {
			s.cfg.Metrics.sweepDone(err)
			if err != nil {
				s.cfg.Logger.Error("sweep failed", "error", err)
			}
		}
		s.limiter.Prune()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

// decodeBody reads a JSON body. On failure it writes the error response and
// returns its code.
func decodeBody(w http.ResponseWriter, r *http.Request, limit int64, dst any) (failure string) {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large")
			return "too_large"
		}
		writeError(w, http.StatusBadRequest, "bad_request")
		return "bad_request"
	}
	return ""
}

func decodeHash(value string) ([]byte, bool) {
	b, err := base64.RawURLEncoding.DecodeString(value)
	return b, err == nil && len(b) == sha256.Size
}

// tokenHash decodes a client token and returns its SHA-256.
func tokenHash(value string) ([]byte, bool) {
	b, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(b) != tokenBytes {
		return nil, false
	}
	sum := sha256.Sum256(b)
	return sum[:], true
}

func (s *Server) clientIP(r *http.Request) string {
	return serverkit.ClientIP(r, s.cfg.ClientIPHeader, s.cfg.TrustedProxyHops)
}

func (s *Server) limit(bucket string, perMinute int, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.limiter.Allow(bucket+"|"+s.clientIP(r), perMinute) {
			s.cfg.Metrics.rateLimitHit(bucket)
			writeError(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
		next(w, r)
	}
}

func (s *Server) handleInfo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"version":  1,
		"auth":     s.cfg.Auth,
		"maxBytes": s.cfg.MaxBytes,
		"maxTtl":   int64(s.cfg.MaxTTL / time.Second),
	})
}

type createRequest struct {
	Ciphertext      string `json:"ciphertext"`
	PeekTokenHash   string `json:"peekTokenHash"`
	RevealTokenHash string `json:"revealTokenHash"`
	ManageTokenHash string `json:"manageTokenHash"`
	TTL             int64  `json:"ttl"`
	Passphrase      bool   `json:"passphrase"`
}

type creator struct {
	owner        string
	maxBytes     int
	maxTTL       time.Duration
	maxActive    int
	ticketID     string
	ticketExpiry time.Time
}

func (s *Server) authorizeCreate(r *http.Request) (*creator, bool) {
	scheme, value, _ := strings.Cut(r.Header.Get("Authorization"), " ")
	c := &creator{maxBytes: s.cfg.MaxBytes, maxTTL: s.cfg.MaxTTL, maxActive: s.cfg.MaxActive}
	switch {
	case s.cfg.Auth == AuthTicket && scheme == "Ticket":
		t, err := s.cfg.Tickets.Verify(value)
		if err != nil {
			return nil, false
		}
		c.owner = "sub:" + t.Subject
		c.maxBytes = min(c.maxBytes, t.Limits.Bytes)
		c.maxTTL = min(c.maxTTL, time.Duration(t.Limits.TTL)*time.Second)
		// Tickets can only lower the operator's caps.
		c.maxActive = min(c.maxActive, t.Limits.Active)
		c.ticketID = t.ID
		c.ticketExpiry = time.Unix(t.Expiry, 0).Add(ticketClockSkew)
		return c, true
	case s.cfg.Auth == AuthToken && scheme == "Bearer" && value != "":
		sum := sha256.Sum256([]byte(value))
		for _, allowed := range s.cfg.CreationTokens {
			if subtle.ConstantTimeCompare(sum[:], allowed) == 1 {
				c.owner = "token:" + hex.EncodeToString(sum[:8])
				return c, true
			}
		}
	}
	return nil, false
}

func (s *Server) handleCreate(w http.ResponseWriter, r *http.Request) {
	c, ok := s.authorizeCreate(r)
	if !ok {
		s.cfg.Metrics.createRejected("unauthorized")
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req createRequest
	limit := int64(base64.RawURLEncoding.EncodedLen(c.maxBytes) + createBodySlack)
	if failure := decodeBody(w, r, limit, &req); failure != "" {
		s.cfg.Metrics.createRejected(failure)
		return
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(req.Ciphertext)
	peek, okPeek := decodeHash(req.PeekTokenHash)
	reveal, okReveal := decodeHash(req.RevealTokenHash)
	manage, okManage := decodeHash(req.ManageTokenHash)
	ttl := time.Duration(req.TTL) * time.Second
	if err != nil || len(ciphertext) == 0 || !okPeek || !okReveal || !okManage || ttl < MinTTL || ttl > c.maxTTL {
		s.cfg.Metrics.createRejected("bad_request")
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	if len(ciphertext) > c.maxBytes {
		s.cfg.Metrics.createRejected("too_large")
		writeError(w, http.StatusRequestEntityTooLarge, "too_large")
		return
	}
	expiresAt := s.store.now().Add(ttl)
	id, err := s.store.Create(r.Context(), NewShare{
		Owner: c.owner, Ciphertext: ciphertext, PeekHash: peek, RevealHash: reveal, ManageHash: manage,
		Passphrase: req.Passphrase, ExpiresAt: expiresAt, MaxActive: c.maxActive,
		TicketID: c.ticketID, TicketExpiry: c.ticketExpiry,
	})
	switch {
	case errors.Is(err, ErrLimitReached):
		s.cfg.Metrics.createRejected("limit_reached")
		writeError(w, http.StatusTooManyRequests, "limit_reached")
	case errors.Is(err, ErrTicketReused):
		s.cfg.Metrics.createRejected("ticket_reused")
		writeError(w, http.StatusUnauthorized, "unauthorized")
	case errors.Is(err, ErrTicketExpired):
		s.cfg.Metrics.createRejected("ticket_expired")
		writeError(w, http.StatusUnauthorized, "unauthorized")
	case err != nil:
		s.internalError(w, "create", err)
	default:
		s.cfg.Metrics.shareCreated(s.cfg.Auth)
		writeJSON(w, http.StatusCreated, map[string]any{"id": id, "expiresAt": expiresAt.UnixMilli()})
	}
}

func (s *Server) shareID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !shareIDPattern.MatchString(id) {
		writeError(w, http.StatusNotFound, "gone")
		return "", false
	}
	return id, true
}

func (s *Server) handlePeek(w http.ResponseWriter, r *http.Request) {
	id, ok := s.shareID(w, r)
	if !ok {
		return
	}
	var req struct {
		PeekToken string `json:"peekToken"`
	}
	if decodeBody(w, r, smallBodyLimit, &req) != "" {
		return
	}
	peek, ok := tokenHash(req.PeekToken)
	if !ok {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	passphrase, expiresAt, err := s.store.Peek(r.Context(), id, peek)
	switch {
	case errors.Is(err, ErrGone):
		writeError(w, http.StatusNotFound, "gone")
	case err != nil:
		s.internalError(w, "peek", err)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"passphrase": passphrase, "expiresAt": expiresAt})
	}
}

func (s *Server) handleReveal(w http.ResponseWriter, r *http.Request) {
	id, ok := s.shareID(w, r)
	if !ok {
		return
	}
	var req struct {
		PeekToken   string `json:"peekToken"`
		RevealToken string `json:"revealToken"`
	}
	if decodeBody(w, r, smallBodyLimit, &req) != "" {
		return
	}
	peek, okPeek := tokenHash(req.PeekToken)
	reveal, okReveal := tokenHash(req.RevealToken)
	if !okPeek || !okReveal {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	ciphertext, attemptsLeft, err := s.store.Reveal(r.Context(), id, peek, reveal)
	switch {
	case errors.Is(err, ErrGone):
		writeError(w, http.StatusNotFound, "gone")
	case errors.Is(err, ErrWrongPassphrase):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "wrong_passphrase", "attemptsLeft": attemptsLeft})
	case errors.Is(err, ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case err != nil:
		s.internalError(w, "reveal", err)
	default:
		writeJSON(w, http.StatusOK, map[string]string{"ciphertext": base64.RawURLEncoding.EncodeToString(ciphertext)})
	}
}

func (s *Server) handleRevoke(w http.ResponseWriter, r *http.Request) {
	id, ok := s.shareID(w, r)
	if !ok {
		return
	}
	var req struct {
		ManageToken string `json:"manageToken"`
	}
	if decodeBody(w, r, smallBodyLimit, &req) != "" {
		return
	}
	manage, ok := tokenHash(req.ManageToken)
	if !ok {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	report, err := s.store.Revoke(r.Context(), id, manage)
	switch {
	case errors.Is(err, ErrGone):
		writeError(w, http.StatusNotFound, "gone")
	case err != nil:
		s.internalError(w, "revoke", err)
	default:
		writeJSON(w, http.StatusOK, report)
	}
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Shares []struct {
			ID          string `json:"id"`
			ManageToken string `json:"manageToken"`
		} `json:"shares"`
	}
	if decodeBody(w, r, smallBodyLimit, &req) != "" {
		return
	}
	if len(req.Shares) > maxStatusBatch {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	queries := make([]StatusQuery, 0, len(req.Shares))
	for _, share := range req.Shares {
		manage, ok := tokenHash(share.ManageToken)
		if !ok || !shareIDPattern.MatchString(share.ID) {
			writeError(w, http.StatusBadRequest, "bad_request")
			return
		}
		queries = append(queries, StatusQuery{ID: share.ID, ManageHash: manage})
	}
	reports, err := s.store.Status(r.Context(), queries)
	if err != nil {
		s.internalError(w, "status", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"shares": reports})
}

func (s *Server) internalError(w http.ResponseWriter, op string, err error) {
	s.cfg.Logger.Error("request failed", "op", op, "error", err)
	writeError(w, http.StatusInternalServerError, "unavailable")
}
