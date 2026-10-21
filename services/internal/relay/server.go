// Package relay is the agent relay: it forwards end-to-end encrypted
// envelopes between cryptex-agent and the approving device, and runs the
// pairing slots that introduce them. It can't read envelopes; it checks
// their signatures and headers only to route them and to refuse forgeries.
// The protocol is in packages/vault-core/src/proto/agent.proto.
package relay

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/serverkit"
)

type Server struct {
	cfg       Config
	origin    string
	now       func() time.Time
	store     *store
	metrics   *metrics
	passes    *passVerifier
	tokenHash []byte
	mux       *http.ServeMux

	connectLimiter     *serverkit.RateLimiter
	pairConnectLimiter *serverkit.RateLimiter
	pairLimiter        *serverkit.RateLimiter
	revokeLimiter      *serverkit.RateLimiter
	// registerLimiter and unregisterLimiter count RegisterAgent and
	// UnregisterAgent per approver key.
	registerLimiter   *serverkit.RateLimiter
	unregisterLimiter *serverkit.RateLimiter

	// Tests shorten these.
	authTimeout  time.Duration
	idleGrace    time.Duration
	outboundSize int
	// maxTombstones caps the tombstones kept per approver key.
	maxTombstones int

	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
	sweeperDone chan struct{}
	closeOnce   sync.Once
	closeErr    error

	// mu guards everything below. The store is written through under it, so
	// memory and database change together.
	mu     sync.Mutex
	closed bool
	// Registrations, a copy of the store's. subs indexes approvers by
	// account, for the per-account agent limit.
	approvers map[string]*approver
	subs      map[string]map[string]*approver
	agents    map[string]*agentRow
	// conns is the live connection per authenticated key.
	conns map[string]*peer
	// mailboxes hold envelopes per recipient key; budget totals their size,
	// for the global and per-account budgets.
	mailboxes map[string]*mailbox
	budget    queueBudget
	// slots are the open pairing slots by ID. pairing counts open /v1/pair
	// sockets in total, pairingBy per client address and network.
	slots     map[string]*slot
	pairing   int
	pairingBy addressCounts
	// pending counts /v1/connect sockets before Auth succeeds, pendingBy per
	// client address and network.
	pending   int
	pendingBy addressCounts
}

// addressCounts counts open sockets per client address key and per network
// around it (serverkit.NetworkKey).
type addressCounts struct {
	byIP, byNet map[string]int
}

func newAddressCounts() addressCounts {
	return addressCounts{byIP: map[string]int{}, byNet: map[string]int{}}
}

// admit counts one more socket for ip unless that would pass perIP or
// perNet. It returns which cap refused it: errAddress or errNetwork.
func (c addressCounts) admit(ip string, perIP, perNet int) error {
	network := serverkit.NetworkKey(ip)
	switch {
	case c.byIP[ip] >= perIP:
		return errAddress
	case c.byNet[network] >= perNet:
		return errNetwork
	}
	c.byIP[ip]++
	c.byNet[network]++
	return nil
}

func (c addressCounts) release(ip string) {
	network := serverkit.NetworkKey(ip)
	if c.byIP[ip]--; c.byIP[ip] <= 0 {
		delete(c.byIP, ip)
	}
	if c.byNet[network]--; c.byNet[network] <= 0 {
		delete(c.byNet, network)
	}
}

var (
	errAddress = errors.New("too many sockets from this address")
	errNetwork = errors.New("too many sockets from this network")
)

// New opens the database, loads registrations and retained envelopes, and
// starts the sweepers. Close stops them.
func New(cfg Config) (*Server, error) {
	cfg = cfg.withDefaults()
	origin, err := serverkit.NormalizeOrigin(cfg.PublicURL)
	if err != nil {
		return nil, fmt.Errorf("public URL: %w", err)
	}
	s := &Server{
		cfg:                cfg,
		origin:             origin,
		now:                cfg.Now,
		mux:                http.NewServeMux(),
		connectLimiter:     serverkit.NewRateLimiter(time.Minute, cfg.Now),
		pairConnectLimiter: serverkit.NewRateLimiter(time.Minute, cfg.Now),
		pairLimiter:        serverkit.NewRateLimiter(slotOpeningWindow, cfg.Now),
		revokeLimiter:      serverkit.NewRateLimiter(time.Minute, cfg.Now),
		registerLimiter:    serverkit.NewRateLimiter(time.Minute, cfg.Now),
		unregisterLimiter:  serverkit.NewRateLimiter(time.Minute, cfg.Now),
		authTimeout:        5 * time.Second,
		idleGrace:          10 * time.Second,
		outboundSize:       outboundBuffer,
		maxTombstones:      maxTombstonesPerApprover,
		sweeperDone:        make(chan struct{}),
		approvers:          map[string]*approver{},
		subs:               map[string]map[string]*approver{},
		agents:             map[string]*agentRow{},
		conns:              map[string]*peer{},
		mailboxes:          map[string]*mailbox{},
		budget:             queueBudget{accounts: map[string]int64{}},
		slots:              map[string]*slot{},
		pairingBy:          newAddressCounts(),
		pendingBy:          newAddressCounts(),
	}
	switch cfg.Auth {
	case AuthTicket:
		if len(cfg.PassKeys) == 0 {
			return nil, errors.New("ticket mode needs relay pass keys")
		}
		s.passes = &passVerifier{keys: cfg.PassKeys, audience: origin, now: cfg.Now}
	case AuthToken:
		if cfg.AccessToken == "" {
			return nil, errors.New("token mode needs an access token")
		}
		sum := sha256.Sum256([]byte(cfg.AccessToken))
		s.tokenHash = sum[:]
	default:
		return nil, fmt.Errorf("auth mode must be %q or %q", AuthTicket, AuthToken)
	}

	s.store, err = openStore(cfg.DBPath)
	if err != nil {
		return nil, err
	}
	if err := s.loadState(); err != nil {
		s.store.close()
		return nil, fmt.Errorf("load state: %w", err)
	}
	s.metrics = newMetrics(s)
	s.ctx, s.cancel = context.WithCancel(context.Background())

	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	s.mux.HandleFunc("GET /v1/connect", s.handleConnect)
	s.mux.HandleFunc("GET /v1/pair", s.handlePair)
	s.mux.HandleFunc("POST /v1/revoke", s.handleRevoke)
	s.mux.HandleFunc("OPTIONS /v1/revoke", s.handleRevokePreflight)

	go s.runSweepers()
	return s, nil
}

func (s *Server) loadState() error {
	approvers, agents, retained, err := s.store.load()
	if err != nil {
		return err
	}
	for _, row := range approvers {
		s.addApproverLocked(row)
	}
	for _, row := range agents {
		a := s.approvers[string(row.approverKey)]
		if a == nil {
			continue // foreign keys make this impossible; skip rather than crash
		}
		r := row
		s.agents[string(row.key)] = &r
		a.agents[string(row.key)] = &r
	}
	for _, row := range retained {
		var env agentpb.Envelope
		if err := proto.Unmarshal(row.envelope, &env); err != nil {
			return fmt.Errorf("retained envelope %d: %w", row.id, err)
		}
		approverKey := s.approverOfLocked(string(row.sender))
		if approverKey == "" {
			approverKey = s.approverOfLocked(string(row.recipient))
		}
		s.mailboxLocked(string(row.recipient)).add(&entry{
			env: &env, sender: string(row.sender), messageID: string(row.messageID),
			account: s.accountLocked(approverKey),
			dropAt:  time.UnixMilli(row.expiresAt), retained: true, dbID: row.id, size: len(row.envelope),
		})
	}
	return nil
}

// Handler serves /v1/connect, /v1/pair, /v1/revoke and /healthz.
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		s.mux.ServeHTTP(w, r)
	})
}

// MetricsHandler serves /metrics in the Prometheus text format. Serve it on
// a listener that is never published.
func (s *Server) MetricsHandler() http.Handler { return s.metrics.handler() }

// Close ends every connection, stops the sweepers and closes the database.
// Call it after the HTTP server has shut down: WebSockets are hijacked, so
// http.Server.Shutdown doesn't wait for them.
func (s *Server) Close() error {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		s.mu.Unlock()
		s.cancel()
		<-s.sweeperDone
		s.wg.Wait()
		s.closeErr = s.store.close()
	})
	return s.closeErr
}

// enter tracks a handler that outlives the HTTP request. It fails once Close
// has started, so Close can wait for every one of them.
func (s *Server) enter() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return false
	}
	s.wg.Add(1)
	return true
}

func (s *Server) clientIP(r *http.Request) string {
	return serverkit.ClientIP(r, s.cfg.ClientIPHeader, s.cfg.TrustedProxyHops)
}

// refusal is a Status and message for the client, sent as a Result or, when
// fatal, as an Error.
type refusal struct {
	status  agentpb.Status
	message string
}

func refuse(status agentpb.Status, message string) *refusal {
	return &refusal{status: status, message: message}
}

const unavailableMessage = "the relay is temporarily unavailable"

// storeFailed logs a database error and returns what the client hears.
func (s *Server) storeFailed(what string, err error) *refusal {
	s.cfg.Logger.Error(what, "error", err)
	return refuse(agentpb.Status_STATUS_UNAVAILABLE, unavailableMessage)
}
