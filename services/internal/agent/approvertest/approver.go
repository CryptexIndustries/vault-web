// Package approvertest is an approver for tests: it does what the Cryptex
// Vault app does for a paired agent (claim the pairing slot, register the
// agent, answer sign requests) with in-memory ssh.Signers. It approves by
// default; SetPolicy changes that.
package approvertest

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
)

// Options configure Connect.
type Options struct {
	RelayURL string
	// Token for a relay in token mode; it is also handed to agents in
	// PairingAccept, as the app does on self-hosted relays.
	Token string
	// Pass for a relay in ticket mode.
	Pass string
	// Identity is generated when nil.
	Identity *agentproto.Identity
	// Name is shown to the agent as the approver name.
	Name string
	// AllowOther puts requests to sign data that is neither an SSH login
	// nor an SSHSIG signature to the policy instead of refusing them.
	AllowOther bool
	// OnRequest is called after each request is decided.
	OnRequest func(Request)
}

// Approver is a connected test approver. It reconnects with backoff when the
// relay goes away, so relay restarts can be tested.
type Approver struct {
	opts Options
	id   *agentproto.Identity

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	mu        sync.Mutex
	conn      *relayclient.Conn
	connected chan struct{} // closed while conn != nil
	agents    map[string]*PairedAgent
	requests  []*Request
	seen      map[string]bool
	// answers holds the sealed answer per request ID, so a repeated request
	// (the agent resends after a reconnect) gets the same answer again.
	answers map[string]*agentpb.Envelope
	changed chan struct{} // closed and replaced when requests, agents or confirmations change
	policy  Policy
}

// PairedAgent is an agent this approver paired.
type PairedAgent struct {
	// Key is the agent's Ed25519 public key (its relay ID).
	Key   []byte
	Offer *agentpb.PairingOffer
	// RevocationKey is the private half of the key registered with the
	// relay for /v1/revoke.
	RevocationKey ed25519.PrivateKey
	// ConfirmationCode is what the agent must show for the user to finish
	// pairing (agentproto.ConfirmationCode).
	ConfirmationCode string

	peer      agentproto.Peer
	signers   []ssh.Signer
	revision  uint64
	name      string
	confirmed bool
	revoked   bool
}

// Connect authenticates as an approver and starts serving requests.
func Connect(ctx context.Context, opts Options) (*Approver, error) {
	if opts.Name == "" {
		opts.Name = "Test approver"
	}
	id := opts.Identity
	if id == nil {
		var err error
		if id, err = agentproto.NewIdentity(); err != nil {
			return nil, err
		}
	}
	a := &Approver{
		opts:      opts,
		id:        id,
		connected: make(chan struct{}),
		agents:    map[string]*PairedAgent{},
		seen:      map[string]bool{},
		answers:   map[string]*agentpb.Envelope{},
		changed:   make(chan struct{}),
		policy:    approveAll,
	}
	conn, err := a.dial(ctx)
	if err != nil {
		return nil, err
	}
	a.ctx, a.cancel = context.WithCancel(context.Background())
	a.wg.Go(func() { a.run(conn) })
	return a, nil
}

func (a *Approver) dial(ctx context.Context) (*relayclient.Conn, error) {
	conn, err := relayclient.Connect(ctx, a.opts.RelayURL, a.id,
		relayclient.Credentials{Role: agentpb.Role_ROLE_APPROVER, Token: a.opts.Token, Pass: a.opts.Pass},
		relayclient.Options{UserAgent: "approvertest"})
	if err != nil {
		return nil, err
	}
	if conn.Ready().GetRole() != agentpb.Role_ROLE_APPROVER {
		conn.Close()
		return nil, fmt.Errorf("relay gave role %v, want approver", conn.Ready().GetRole())
	}
	return conn, nil
}

func (a *Approver) run(conn *relayclient.Conn) {
	backoff := relayclient.NewBackoff()
	for {
		if conn != nil {
			backoff.Reset()
			a.serve(conn)
			conn.Close()
		}
		select {
		case <-a.ctx.Done():
			return
		case <-time.After(backoff.Next()):
		}
		// nil on failure: the loop waits and tries again.
		conn, _ = a.dial(a.ctx)
	}
}

func (a *Approver) serve(conn *relayclient.Conn) {
	a.mu.Lock()
	a.conn = conn
	close(a.connected)
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.conn = nil
		a.connected = make(chan struct{})
		a.mu.Unlock()
	}()
	for {
		f, err := conn.Next(a.ctx)
		if err != nil {
			return
		}
		switch fr := f.GetFrame().(type) {
		case *agentpb.ServerFrame_Deliver:
			a.handleDeliver(conn, fr.Deliver.GetEnvelope())
		case *agentpb.ServerFrame_Revoked:
			a.mu.Lock()
			if ag := a.agents[string(fr.Revoked.GetAgentKey())]; ag != nil {
				ag.revoked = true
			}
			a.signalLocked()
			a.mu.Unlock()
		}
	}
}

func (a *Approver) signalLocked() {
	close(a.changed)
	a.changed = make(chan struct{})
}

// current waits for a live connection.
func (a *Approver) current(ctx context.Context) (*relayclient.Conn, error) {
	for {
		a.mu.Lock()
		conn, connected := a.conn, a.connected
		a.mu.Unlock()
		if conn != nil && conn.Err() == nil {
			return conn, nil
		}
		select {
		case <-connected:
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-a.ctx.Done():
			return nil, errors.New("approver closed")
		}
	}
}

// Close disconnects.
func (a *Approver) Close() error {
	a.cancel()
	a.mu.Lock()
	conn := a.conn
	a.mu.Unlock()
	if conn != nil {
		conn.Close()
	}
	a.wg.Wait()
	return nil
}

// ID is the approver's Ed25519 public key.
func (a *Approver) ID() []byte { return a.id.ID() }

// Confirmed reports whether the agent's PairingConfirm arrived.
func (a *Approver) Confirmed(agentKey []byte) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	ag := a.agents[string(agentKey)]
	return ag != nil && ag.confirmed
}

// Revoked reports whether the relay told this approver the agent is gone.
func (a *Approver) Revoked(agentKey []byte) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	ag := a.agents[string(agentKey)]
	return ag != nil && ag.revoked
}

// WaitFor blocks until cond is true or ctx ends. cond is checked again
// whenever requests, confirmations or revocations change.
func (a *Approver) WaitFor(ctx context.Context, cond func() bool) error {
	for {
		a.mu.Lock()
		changed := a.changed
		a.mu.Unlock()
		if cond() {
			return nil
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// WaitConfirmed waits for the agent's PairingConfirm.
func (a *Approver) WaitConfirmed(ctx context.Context, agentKey []byte) error {
	return a.WaitFor(ctx, func() bool { return a.Confirmed(agentKey) })
}
