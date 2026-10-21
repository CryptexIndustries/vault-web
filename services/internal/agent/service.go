// Package agent is cryptex-agent: an SSH agent that holds no private keys
// and asks the paired Cryptex Vault device (the approver) to sign through the
// agent relay.
package agent

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"os"
	"sync"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
)

const (
	defaultPollInterval = 2 * time.Second
	defaultNotifyAfter  = 5 * time.Second
	// terminalAfter keeps the terminal line quiet for requests answered at
	// once, as remembered approvals are.
	terminalAfter       = time.Second
	defaultRevokedRetry = 15 * time.Minute
	// maxGoneRetry caps the wait between asks about an agent the relay
	// calls gone; defaultGiveUpAfter ends the asking.
	maxGoneRetry       = 24 * time.Hour
	defaultGiveUpAfter = 7 * 24 * time.Hour
	// unknownBeforeSlow is how many "unknown agent" answers in a row the
	// normal reconnect schedule allows, in case the relay was restoring.
	unknownBeforeSlow = 3
	// maxWaitingSigns caps the sign requests waiting for the approver, so a
	// local process can't queue an endless stream of prompts.
	maxWaitingSigns = 4
)

// Options configure Run. Only Paths is required.
type Options struct {
	Paths  Paths
	Logger *slog.Logger
	// Version is reported in PairingConfirm and the User-Agent.
	Version string
	// Now is the clock for envelope expiry; time.Now by default.
	Now func() time.Time
	// RequestTimeout is how long a signature request waits for the
	// approver; agentproto.RequestLifetime by default. It is also the
	// envelope's expiry, so it can't be longer.
	RequestTimeout time.Duration
	// NotifyAfter is the wait before the desktop notification.
	NotifyAfter time.Duration
	// Notify replaces the notify-send notification (tests).
	Notify func(approverName string)
	// Terminal prints a line to the requesting terminal while a request
	// waits.
	Terminal bool
	// PollInterval is how often state.json is checked for changes made by
	// `pair` and `unpair`.
	PollInterval time.Duration
	// KnownHostsFiles label the servers in requests with their names; ssh's
	// default files when nil.
	KnownHostsFiles []string
	// Hostname is sent with each request; os.Hostname by default.
	Hostname func() string
	// RevokedRetry is the first wait before an agent the relay calls
	// revoked or unknown asks again; 15 minutes by default, doubling to a
	// day.
	RevokedRetry time.Duration
	// GiveUpAfter is how long after the relay began calling the agent gone
	// it keeps asking; a week by default. Then it waits for a new pairing.
	GiveUpAfter time.Duration
}

func (o *Options) defaults() {
	if o.Logger == nil {
		o.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	if o.Version == "" {
		o.Version = "dev"
	}
	if o.KnownHostsFiles == nil {
		o.KnownHostsFiles = defaultKnownHostsFiles()
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.RequestTimeout <= 0 || o.RequestTimeout > agentproto.RequestLifetime {
		o.RequestTimeout = agentproto.RequestLifetime
	}
	if o.NotifyAfter <= 0 {
		o.NotifyAfter = defaultNotifyAfter
	}
	if o.PollInterval <= 0 {
		o.PollInterval = defaultPollInterval
	}
	if o.Hostname == nil {
		o.Hostname = func() string { h, _ := os.Hostname(); return h }
	}
	if o.RevokedRetry <= 0 {
		o.RevokedRetry = defaultRevokedRetry
	}
	if o.GiveUpAfter <= 0 {
		o.GiveUpAfter = defaultGiveUpAfter
	}
}

// Service is a running agent: the SSH agent socket plus one relay
// connection.
type Service struct {
	opts  Options
	log   *slog.Logger
	store Store
	ln    *net.UnixListener

	// ctx is set by Serve; sign requests end with it.
	ctx context.Context

	mu          sync.Mutex
	raw         []byte // state.json as last read or written
	st          *State
	id          *agentproto.Identity
	approver    agentproto.Peer
	gen         int           // bumped when the identity, relay or approver changes
	changed     chan struct{} // closed and replaced on every state change
	conn        *relayclient.Conn
	pending     pendingSigns
	seen        map[string]time.Time // delivered message IDs, until they expire
	hosts       Hosts
	sessions    map[net.Conn]struct{}
	lastNotice  string
	clockWarned bool
}

// Run serves the agent socket and keeps the relay connection until ctx
// ends.
func Run(ctx context.Context, opts Options) error {
	svc, err := Listen(opts)
	if err != nil {
		return err
	}
	return svc.Serve(ctx)
}

// Listen creates the agent socket and loads the state. Tests can connect to
// the socket as soon as it returns.
func Listen(opts Options) (*Service, error) {
	opts.defaults()
	if opts.Paths.Socket == "" {
		return nil, errors.New("XDG_RUNTIME_DIR isn't set, so there is nowhere to put the agent socket; start cryptex-agent from a login session or as a systemd user service")
	}
	cfg, err := LoadConfig(opts.Paths.ConfigFile)
	if err != nil {
		return nil, err
	}
	if opts.Notify == nil && cfg.Notify {
		opts.Notify = desktopNotifier(opts.Logger)
	}
	opts.Terminal = opts.Terminal || cfg.Terminal
	s := newService(opts)
	if s.hosts, err = s.store.LoadHosts(); err != nil {
		s.log.Warn("ignoring hosts.json", "error", err)
		s.hosts = Hosts{}
	}
	if err := s.reload(); err != nil {
		return nil, err
	}
	if s.ln, err = listenSocket(opts.Paths.Socket); err != nil {
		return nil, err
	}
	return s, nil
}

// newService sets up a Service without reading anything from disk. opts
// already has its defaults.
func newService(opts Options) *Service {
	return &Service{
		opts:     opts,
		log:      opts.Logger,
		store:    Store{Dir: opts.Paths.DataDir},
		changed:  make(chan struct{}),
		pending:  pendingSigns{},
		seen:     map[string]time.Time{},
		hosts:    Hosts{},
		sessions: map[net.Conn]struct{}{},
	}
}

// Serve runs until ctx ends, then closes the socket.
func (s *Service) Serve(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	s.ctx = ctx
	var wg sync.WaitGroup
	wg.Go(func() { s.pollState(ctx) })
	wg.Go(func() { s.relayLoop(ctx) })
	s.log.Info("cryptex-agent listening", "socket", s.opts.Paths.Socket, "version", s.opts.Version)

	acceptErr := make(chan error, 1)
	go func() { acceptErr <- s.acceptLoop(ctx, s.ln.AcceptUnix) }()
	var err error
	select {
	case <-ctx.Done():
	case err = <-acceptErr:
		cancel()
	}
	s.ln.Close()
	s.closeSessions()
	wg.Wait()
	return err
}

// ServiceStatus is a snapshot for tests and diagnostics.
type ServiceStatus struct {
	Paired    bool
	Revoked   bool
	Connected bool
	// Keys is how many keys the agent serves (none while revoked).
	Keys int
}

func (s *Service) Status() ServiceStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := ServiceStatus{Connected: s.conn != nil}
	if s.st != nil {
		st.Paired, st.Revoked = !s.st.Revoked, s.st.Revoked
		if !s.st.Revoked {
			st.Keys = len(s.st.Keys)
		}
	}
	return st
}

// notice logs a message once until a different one replaces it, so a
// service left unpaired doesn't fill the journal.
func (s *Service) notice(key string, level slog.Level, msg string, args ...any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.noticeLocked(key, level, msg, args...)
}

func (s *Service) noticeLocked(key string, level slog.Level, msg string, args ...any) {
	if s.lastNotice == key {
		return
	}
	s.lastNotice = key
	s.log.Log(context.Background(), level, msg, args...)
}
