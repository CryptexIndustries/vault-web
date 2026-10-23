package agent

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/CryptexIndustries/vault-web/services/internal/agent/termsafe"
	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
)

// UnpairOptions configure Unpair.
type UnpairOptions struct {
	Paths   Paths
	Out     io.Writer
	Version string
}

// Unpair runs `cryptex-agent unpair`: it removes the registration on the
// relay, then the local state. If the relay can't be reached the local
// state goes anyway, with a warning.
func Unpair(ctx context.Context, opts UnpairOptions) error {
	if opts.Out == nil {
		opts.Out = io.Discard
	}
	store := Store{Dir: opts.Paths.DataDir}
	st, err := store.LoadState()
	if err != nil {
		return err
	}
	if st == nil {
		fmt.Fprintln(opts.Out, "Not paired.")
		return nil
	}
	// Even a revoked agent asks: only the relay said it was revoked, and
	// it answers REVOKED or NOT_FOUND if that is true.
	relayErr := unregister(ctx, st, opts)
	deleted, err := store.DeleteStateOf(st.SignSeed)
	if err != nil {
		return err
	}
	name := termsafe.Name(st.ApproverName)
	if !deleted {
		// `pair --force` or another `unpair` got there first.
		fmt.Fprintln(opts.Out, "The pairing on this machine changed meanwhile; left it as it is.")
		return nil
	}
	if relayErr != nil {
		fmt.Fprintf(opts.Out, "Couldn't reach the relay (%v).\n", relayErr)
		fmt.Fprintf(opts.Out, "Removed the pairing from this machine, but %s still lists this agent until you revoke it there.\n", name)
		return nil
	}
	fmt.Fprintf(opts.Out, "Unpaired from %s.\n", name)
	return nil
}

func unregister(ctx context.Context, st *State, opts UnpairOptions) error {
	id, err := agentproto.IdentityFromSeeds(st.SignSeed, st.KEMSeed)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	return unregisterAgent(ctx, st.RelayURL, st.RelayToken, id, clientOptions(nil, opts.Version))
}

// unregisterAgent removes agent id from the relay. NOT_FOUND and REVOKED
// mean it is gone already.
func unregisterAgent(ctx context.Context, relayURL, token string, id *agentproto.Identity, clientOpts relayclient.Options) error {
	conn, err := relayclient.Connect(ctx, relayURL, id, relayclient.Credentials{Role: agentpb.Role_ROLE_AGENT, Token: token}, clientOpts)
	if relayclient.IsStatus(err, agentpb.Status_STATUS_NOT_FOUND) || relayclient.IsStatus(err, agentpb.Status_STATUS_REVOKED) {
		return nil
	}
	if err != nil {
		return err
	}
	defer conn.Close()
	err = conn.UnregisterAgent(ctx, nil)
	if relayclient.IsStatus(err, agentpb.Status_STATUS_NOT_FOUND) {
		return nil
	}
	return err
}
