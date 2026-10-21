package agent

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agent/termsafe"
	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
)

// ErrAlreadyPaired is returned by Pair without Force.
var ErrAlreadyPaired = errors.New("already paired")

// ErrCodeExpired is returned by Pair when a code expired and no new one can
// be offered (not interactive).
var ErrCodeExpired = errors.New("the pairing code expired")

// ErrPairingCancelled is returned by Pair when the user didn't confirm the
// code. Pair has said so on Out already.
var ErrPairingCancelled = errors.New("pairing cancelled")

// PairOptions configure Pair.
type PairOptions struct {
	Paths Paths
	// RelayURL overrides the config file's relay and DefaultRelayURL.
	RelayURL string
	// Force replaces an existing pairing once the new one succeeds. The old
	// one stays registered on the relay until revoked on the approver.
	Force bool
	// Invert draws the QR code for light terminal themes.
	Invert  bool
	Version string
	Out     io.Writer
	// Interactive offers a new code after one expires, waiting for Enter
	// on In.
	Interactive bool
	// In is where Enter confirms the code both sides show (and asks for a
	// new code when Interactive); os.Stdin by default.
	In io.Reader
	// Hostname goes into the offer; os.Hostname by default.
	Hostname   string
	HTTPClient *http.Client
	// OnCode receives every pairing code as it is printed (tests).
	OnCode func(code string)
	// OnConfirm receives the confirmation code once it is printed, before
	// Pair waits for Enter (tests).
	OnConfirm func(code string)
}

func (o *PairOptions) defaults() {
	if o.Out == nil {
		o.Out = io.Discard
	}
	if o.Version == "" {
		o.Version = "dev"
	}
	if o.Hostname == "" {
		o.Hostname, _ = os.Hostname()
	}
	if o.In == nil {
		o.In = os.Stdin
	}
}

// pairing is what the approver's answer to a code establishes.
type pairing struct {
	id        *agentproto.Identity
	accept    *agentpb.PairingAccept
	approver  agentproto.Peer
	offerHash []byte
}

// Pair runs `cryptex-agent pair`: it shows a pairing code, waits for the
// approver and saves the new state.
func Pair(ctx context.Context, opts PairOptions) (*State, error) {
	opts.defaults()
	store := Store{Dir: opts.Paths.DataDir}
	old, err := store.LoadState()
	if err != nil {
		return nil, err
	}
	if old != nil && !old.Revoked && !opts.Force {
		return nil, fmt.Errorf("%w with %s as %q; run cryptex-agent unpair first, or pair --force to replace it", ErrAlreadyPaired, termsafe.Name(old.ApproverName), termsafe.Name(old.AgentName))
	}
	relayURL, err := pairingRelay(opts)
	if err != nil {
		return nil, err
	}
	clientOpts := clientOptions(opts.HTTPClient, opts.Version)
	in := bufio.NewReader(opts.In)
	p, err := waitForApprover(ctx, opts, in, relayURL, clientOpts)
	if err != nil {
		return nil, err
	}
	// Whoever scans the code first gets to answer it. The code both sides
	// show covers the offer and the approver's keys, so a match means the
	// answer came from the phone in the user's hand.
	if err := confirmCode(ctx, opts, in, p); err != nil {
		fmt.Fprintln(opts.Out, "Pairing cancelled.")
		// The approver registered the agent already; remove it so it doesn't
		// linger on the phone. ctx may have ended (Ctrl-C), so the removal
		// gets a little time of its own.
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if err := unregisterAgent(cleanupCtx, relayURL, p.accept.RelayToken, p.id, clientOpts); err != nil {
			fmt.Fprintf(opts.Out, "Couldn't remove this agent from the relay (%v); remove it in Cryptex Vault.\n", err)
		}
		return nil, ErrPairingCancelled
	}

	signSeed, kemSeed, err := p.id.Seeds()
	if err != nil {
		return nil, err
	}
	st := &State{
		Version:         1,
		RelayURL:        relayURL,
		RelayToken:      p.accept.RelayToken,
		SignSeed:        signSeed,
		KEMSeed:         kemSeed,
		ApproverSignKey: p.approver.SignPublicKey,
		ApproverKEMKey:  p.approver.KEMPublicKey,
		ApproverName:    termsafe.Name(p.accept.ApproverName),
		AgentName:       termsafe.Name(p.accept.AgentName),
		Keys:            grantedKeys(p.accept.Keys),
		KeysRevision:    p.accept.KeysRevision,
		PairedAt:        time.Now().UTC().Truncate(time.Second),
	}
	if err := store.SaveState(st); err != nil {
		return nil, fmt.Errorf("save the pairing: %w", err)
	}
	if err := confirmPairing(ctx, st, p, opts, clientOpts); err != nil {
		fmt.Fprintf(opts.Out, "Couldn't confirm the pairing with the relay yet (%v). The agent service retries when it connects.\n", err)
	} else if cur, err := store.UpdateState(st.SignSeed, func(cur *State) bool {
		// Re-read under the lock so a KeysUpdate the running service saved
		// meanwhile isn't overwritten.
		if cur.Confirmed {
			return false
		}
		cur.Confirmed = true
		return true
	}); err == nil && cur != nil {
		st = cur
	}
	printPaired(opts.Out, st, opts.Paths.Socket)
	return st, nil
}

// pairingRelay is the relay URL from the flag, else the config file.
func pairingRelay(opts PairOptions) (string, error) {
	relayURL := strings.TrimSpace(opts.RelayURL)
	if relayURL == "" {
		cfg, err := LoadConfig(opts.Paths.ConfigFile)
		if err != nil {
			return "", err
		}
		relayURL = cfg.Relay
	}
	relayURL = strings.TrimSuffix(relayURL, "/")
	if _, err := relayclient.Origin(relayURL); err != nil {
		return "", fmt.Errorf("relay URL: %w", err)
	}
	if err := relayclient.CheckRelayURL(relayURL); err != nil {
		return "", err
	}
	return relayURL, nil
}

// confirmCode shows the confirmation code and waits for Enter.
func confirmCode(ctx context.Context, opts PairOptions, in *bufio.Reader, p *pairing) error {
	code := agentproto.ConfirmationCode(p.offerHash, p.approver.SignPublicKey, p.approver.KEMPublicKey)
	name := termsafe.Name(p.accept.ApproverName)
	if name == "" {
		name = "Cryptex Vault"
	}
	fmt.Fprintf(opts.Out, "%s wants to pair. Check that it shows:\n\n    %s\n\nPress Enter if it matches, or Ctrl-C to cancel.\n", name, code)
	if opts.OnConfirm != nil {
		opts.OnConfirm(code)
	}
	return readLine(ctx, in)
}

// waitForApprover shows codes until one is answered, offering a new one
// after each expiry when interactive.
func waitForApprover(ctx context.Context, opts PairOptions, in *bufio.Reader, relayURL string, clientOpts relayclient.Options) (*pairing, error) {
	for {
		// Each code gets its own identity: an approver that claimed the last
		// one may have registered that key on the relay without answering,
		// and would hold it against the next approver.
		id, offer, err := newOffer(opts)
		if err != nil {
			return nil, err
		}
		accept, approver, err := pairOnce(ctx, opts, relayURL, id, offer, clientOpts)
		if errors.Is(err, ErrCodeExpired) && opts.Interactive {
			fmt.Fprintln(opts.Out, "Code expired. Press Enter for a new one, or Ctrl-C to stop.")
			if err := readLine(ctx, in); err != nil {
				if ctx.Err() != nil {
					return nil, err
				}
				return nil, ErrCodeExpired
			}
			continue
		}
		if err != nil {
			return nil, err
		}
		return &pairing{id: id, accept: accept, approver: approver, offerHash: agentproto.OfferHash(offer)}, nil
	}
}

// newOffer makes a fresh agent identity and the PairingOffer for it.
func newOffer(opts PairOptions) (*agentproto.Identity, []byte, error) {
	id, err := agentproto.NewIdentity()
	if err != nil {
		return nil, nil, err
	}
	offer, err := proto.MarshalOptions{Deterministic: true}.Marshal(&agentpb.PairingOffer{
		ProtocolVersion: agentproto.Version,
		SignPublicKey:   id.ID(),
		KemPublicKey:    id.KEMPublicKey(),
		Hostname:        clean(opts.Hostname, maxHostnameSize),
		Os:              runtime.GOOS,
		Arch:            runtime.GOARCH,
		AgentVersion:    opts.Version,
	})
	if err != nil {
		return nil, nil, err
	}
	return id, offer, nil
}

// pairOnce shows one code and waits for it to be used or to expire.
func pairOnce(ctx context.Context, opts PairOptions, relayURL string, id *agentproto.Identity, offer []byte, clientOpts relayclient.Options) (*agentpb.PairingAccept, agentproto.Peer, error) {
	conn, opened, err := relayclient.OpenSlot(ctx, relayURL, offer, clientOpts)
	if err != nil {
		return nil, agentproto.Peer{}, err
	}
	defer conn.Close()
	if msg, ok := clockWarning(conn.Challenge(), time.Now()); ok {
		fmt.Fprintln(opts.Out, msg)
	}
	binding := agentproto.PairingBinding{Secret: agentproto.NewPairingSecret(), OfferHash: agentproto.OfferHash(offer)}
	code, err := agentproto.FormatPairingCode(&agentpb.PairingCode{
		Version:   agentproto.Version,
		RelayUrl:  relayURL,
		SlotId:    opened.SlotId,
		Secret:    binding.Secret,
		OfferHash: binding.OfferHash,
	})
	if err != nil {
		return nil, agentproto.Peer{}, err
	}
	picture, err := RenderQR(code, opts.Invert)
	if err != nil {
		return nil, agentproto.Peer{}, err
	}
	fmt.Fprintf(opts.Out, "Relay: %s\n", relayURL)
	fmt.Fprintln(opts.Out, "Scan this code in the Cryptex Vault Android app: Devices > Add > Connect an agent")
	fmt.Fprint(opts.Out, picture)
	fmt.Fprintf(opts.Out, "Or paste this code in Cryptex Vault (web app: Connected Agents > +): %s\n\n", code)
	fmt.Fprintln(opts.Out, "Waiting for Cryptex Vault...")
	if opts.OnCode != nil {
		opts.OnCode(code)
	}

	for {
		f, err := conn.Next(ctx)
		if err != nil {
			if relayclient.IsStatus(err, agentpb.Status_STATUS_EXPIRED) {
				return nil, agentproto.Peer{}, ErrCodeExpired
			}
			if errors.Is(err, relayclient.ErrClosed) {
				return nil, agentproto.Peer{}, errors.New("the relay closed the pairing connection")
			}
			return nil, agentproto.Peer{}, err
		}
		switch fr := f.GetFrame().(type) {
		case *agentpb.ServerFrame_SlotClaimed:
			fmt.Fprintln(opts.Out, "Code received. Finish in Cryptex Vault.")
		case *agentpb.ServerFrame_SlotAnswer:
			accept, approver, err := agentproto.OpenPairingAccept(id, binding, fr.SlotAnswer.GetEnvelope(), time.Now())
			if err != nil {
				return nil, agentproto.Peer{}, fmt.Errorf("the answer to the pairing code didn't verify: %w", err)
			}
			return accept, approver, nil
		}
	}
}

// readLine waits for a line on in. A line cut off by EOF doesn't count:
// that is Ctrl-D or a closed pipe, not Enter.
func readLine(ctx context.Context, in *bufio.Reader) error {
	done := make(chan error, 1)
	go func() {
		_, err := in.ReadString('\n')
		done <- err
	}()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// confirmPairing connects as the new agent and leaves the retained
// PairingConfirm.
func confirmPairing(ctx context.Context, st *State, p *pairing, opts PairOptions, clientOpts relayclient.Options) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	conn, err := connectAgent(ctx, st, p.id, clientOpts)
	if err != nil {
		return err
	}
	defer conn.Close()
	if conn.Ready().GetRole() != agentpb.Role_ROLE_AGENT {
		return errors.New("the relay doesn't list this agent")
	}
	env, err := sealPairingConfirm(p.id, p.approver, opts.Version, time.Now())
	if err != nil {
		return err
	}
	return conn.Send(ctx, env)
}

func printPaired(out io.Writer, st *State, socket string) {
	fmt.Fprintf(out, "\nPaired with %s as %q.\n", termsafe.Name(st.ApproverName), termsafe.Name(st.AgentName))
	fmt.Fprintln(out, keyCount(len(st.Keys))+" available.")
	fmt.Fprintln(out, "\nTo use it in this shell:")
	fmt.Fprintln(out, "  export SSH_AUTH_SOCK=$XDG_RUNTIME_DIR/"+SocketName)
	if _, err := listSocket(socket); err == nil {
		fmt.Fprintln(out, "\nThe agent service is running and picks up the new pairing within a few seconds.")
	} else {
		fmt.Fprintln(out, "\nTo run the agent in the background and start it at login:")
		fmt.Fprintln(out, "  systemctl --user enable --now cryptex-agent")
	}
}
