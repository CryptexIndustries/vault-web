package approvertest

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"time"

	"golang.org/x/crypto/ssh"
	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
)

// Pair claims the slot in code, registers the agent with a fresh
// revocation key and answers with a PairingAccept granting keys.
func (a *Approver) Pair(ctx context.Context, code string, keys []ssh.Signer, agentName string) (*PairedAgent, error) {
	pc, err := agentproto.ParsePairingCode(code)
	if err != nil {
		return nil, err
	}
	want, _ := relayclient.Origin(a.opts.RelayURL)
	if got, err := relayclient.Origin(pc.RelayUrl); err != nil || got != want {
		return nil, fmt.Errorf("the code is for relay %q, this approver uses %q", pc.RelayUrl, a.opts.RelayURL)
	}
	conn, err := a.current(ctx)
	if err != nil {
		return nil, err
	}
	slot, err := conn.ClaimSlot(ctx, pc.SlotId)
	if err != nil {
		return nil, fmt.Errorf("claim slot: %w", err)
	}
	offer, err := agentproto.ParseOffer(slot.Offer, pc.OfferHash)
	if err != nil {
		return nil, err
	}
	revPub, revKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	if err := conn.RegisterAgent(ctx, offer.SignPublicKey, revPub); err != nil {
		return nil, fmt.Errorf("register agent: %w", err)
	}
	ag := &PairedAgent{
		Key:              offer.SignPublicKey,
		Offer:            offer,
		RevocationKey:    revKey,
		ConfirmationCode: agentproto.ConfirmationCode(pc.OfferHash, a.id.ID(), a.id.KEMPublicKey()),
		peer:             agentproto.Peer{SignPublicKey: offer.SignPublicKey, KEMPublicKey: offer.KemPublicKey},
		signers:          keys,
		revision:         1,
		name:             agentName,
	}
	env, err := agentproto.Seal(a.id, ag.peer, &agentpb.Message{Body: &agentpb.Message_PairingAccept{PairingAccept: &agentpb.PairingAccept{
		ApproverSignPublicKey: a.id.ID(),
		ApproverKemPublicKey:  a.id.KEMPublicKey(),
		ApproverName:          a.opts.Name,
		AgentName:             agentName,
		Keys:                  grantedKeys(keys),
		KeysRevision:          ag.revision,
		RelayToken:            a.opts.Token,
	}}}, agentproto.SealOptions{
		ExpiresAt: time.Now().Add(agentproto.RequestLifetime),
		Pairing:   &agentproto.PairingBinding{Secret: pc.Secret, OfferHash: pc.OfferHash},
	})
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.agents[string(ag.Key)] = ag
	a.mu.Unlock()
	if err := conn.AnswerSlot(ctx, pc.SlotId, env); err != nil {
		return nil, fmt.Errorf("answer slot: %w", err)
	}
	return ag, nil
}

// KeyComment is the comment approvertest gives the i-th granted key.
func KeyComment(i int) string { return fmt.Sprintf("test key %d (approvertest)", i+1) }

func grantedKeys(signers []ssh.Signer) []*agentpb.GrantedKey {
	out := make([]*agentpb.GrantedKey, len(signers))
	for i, s := range signers {
		out[i] = &agentpb.GrantedKey{PublicKey: s.PublicKey().Marshal(), Comment: KeyComment(i)}
	}
	return out
}

// SendKeys replaces an agent's granted keys with a retained KeysUpdate
// (revision one higher than the last). name may be empty to keep the
// agent's name.
func (a *Approver) SendKeys(ctx context.Context, agentKey []byte, keys []ssh.Signer, name string) error {
	a.mu.Lock()
	ag := a.agents[string(agentKey)]
	if ag == nil {
		a.mu.Unlock()
		return errors.New("unknown agent")
	}
	ag.revision++
	ag.signers = keys
	if name != "" {
		ag.name = name
	}
	update := &agentpb.KeysUpdate{Keys: grantedKeys(keys), Revision: ag.revision, AgentName: name}
	peer := ag.peer
	a.mu.Unlock()
	env, err := agentproto.Seal(a.id, peer, &agentpb.Message{Body: &agentpb.Message_KeysUpdate{KeysUpdate: update}},
		agentproto.SealOptions{ExpiresAt: time.Now().Add(agentproto.MaxRetainLifetime - time.Minute), Retain: true})
	if err != nil {
		return err
	}
	conn, err := a.current(ctx)
	if err != nil {
		return err
	}
	return conn.Send(ctx, env)
}

// Unregister removes an agent over the approver's own connection.
func (a *Approver) Unregister(ctx context.Context, agentKey []byte) error {
	conn, err := a.current(ctx)
	if err != nil {
		return err
	}
	return conn.UnregisterAgent(ctx, agentKey)
}

// RevokeOverHTTP revokes an agent through POST /v1/revoke, as another
// vault device would. It returns the HTTP status code.
func (a *Approver) RevokeOverHTTP(ctx context.Context, agentKey []byte) (int, error) {
	a.mu.Lock()
	ag := a.agents[string(agentKey)]
	a.mu.Unlock()
	if ag == nil {
		return 0, errors.New("unknown agent")
	}
	origin, err := relayclient.Origin(a.opts.RelayURL)
	if err != nil {
		return 0, err
	}
	body, err := proto.Marshal(agentproto.SignRevoke(ag.RevocationKey, origin, agentKey, time.Now().UnixMilli()))
	if err != nil {
		return 0, err
	}
	u, err := relayclient.HTTPURL(a.opts.RelayURL, relayclient.RevokePath)
	if err != nil {
		return 0, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	httpReq.Header.Set("Content-Type", "application/x-protobuf")
	resp, err := relayclient.NoRedirects(nil).Do(httpReq)
	if err != nil {
		return 0, err
	}
	resp.Body.Close()
	return resp.StatusCode, nil
}
