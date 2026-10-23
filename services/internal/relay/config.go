package relay

import (
	"log/slog"
	"time"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
)

const (
	AuthTicket = "ticket"
	AuthToken  = "token"
)

// Config is everything cmd/relay-server reads from its environment.
type Config struct {
	// PublicURL is reduced to its origin, which clients sign into Auth and
	// relay passes name as their audience.
	PublicURL string
	// Auth is AuthTicket (hosted, relay passes) or AuthToken (self-hosted).
	Auth string
	// PassKeys verify relay passes in ticket mode.
	PassKeys map[string]*mldsa65.PublicKey
	// AccessToken is required from every client in token mode.
	AccessToken string
	// MaxAgents caps registered agents on the whole relay in token mode.
	// Default 25.
	MaxAgents int
	// Keepalive is announced in Challenge; connections silent for twice as
	// long plus 10 seconds are closed. Default 240 seconds.
	Keepalive time.Duration
	// ClientIPHeader names a header set by a trusted proxy (for example
	// "X-Forwarded-For" or "CF-Connecting-IP"). Empty uses the socket address.
	ClientIPHeader string
	// TrustedProxyHops is how many proxies append to ClientIPHeader. Default 1.
	TrustedProxyHops int
	// MaxPairingSlots caps open /v1/pair sockets on the whole relay. Each
	// holds at most one slot. Default 1000.
	MaxPairingSlots int
	// RegistrationGrace is how long an approver's registrations outlive its
	// last relay pass. Default 30 days.
	RegistrationGrace time.Duration
	// MaxQueueBytes caps the envelopes held in memory, retained ones
	// included, across all recipients. Sends beyond it get UNAVAILABLE.
	// Default 64 MiB.
	MaxQueueBytes int64
	// MaxAccountQueueBytes caps the same bytes per account: the pass
	// subject in ticket mode, the approver key in token mode. Sends beyond
	// it get LIMIT_REACHED, so one account can't use up MaxQueueBytes.
	// Default 4 MiB.
	MaxAccountQueueBytes int64
	// MaxPendingConnections caps /v1/connect sockets that haven't finished
	// Auth. Upgrades beyond it get HTTP 503. Default 1000.
	MaxPendingConnections int
	// DBPath is the SQLite file; ":memory:" in tests.
	DBPath string
	Logger *slog.Logger
	// Now is the clock for every expiry decision. Default time.Now.
	Now func() time.Time
}

func (cfg Config) withDefaults() Config {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.MaxAgents <= 0 {
		cfg.MaxAgents = 25
	}
	if cfg.Keepalive <= 0 {
		cfg.Keepalive = 240 * time.Second
	}
	if cfg.TrustedProxyHops <= 0 {
		cfg.TrustedProxyHops = 1
	}
	if cfg.MaxPairingSlots <= 0 {
		cfg.MaxPairingSlots = 1000
	}
	if cfg.RegistrationGrace <= 0 {
		cfg.RegistrationGrace = 30 * 24 * time.Hour
	}
	if cfg.MaxQueueBytes <= 0 {
		cfg.MaxQueueBytes = 64 << 20
	}
	if cfg.MaxAccountQueueBytes <= 0 {
		cfg.MaxAccountQueueBytes = 4 << 20
	}
	if cfg.MaxPendingConnections <= 0 {
		cfg.MaxPendingConnections = 1000
	}
	return cfg
}
