package approvertest

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient"
	"github.com/CryptexIndustries/vault-web/services/internal/relayclient/fakerelay"
)

func TestSignWithFlags(t *testing.T) {
	rk, _ := rsa.GenerateKey(rand.Reader, 2048)
	rsaSigner, _ := ssh.NewSignerFromKey(rk)
	_, ek, _ := ed25519.GenerateKey(rand.Reader)
	edSigner, _ := ssh.NewSignerFromKey(ek)
	data := []byte("data")
	cases := []struct {
		signer ssh.Signer
		flags  agent.SignatureFlags
		want   string
	}{
		{rsaSigner, 0, ssh.KeyAlgoRSA},
		{rsaSigner, agent.SignatureFlagRsaSha256, ssh.KeyAlgoRSASHA256},
		{rsaSigner, agent.SignatureFlagRsaSha512, ssh.KeyAlgoRSASHA512},
		// OpenSSH's ssh-agent checks SHA-256 first when both are set.
		{rsaSigner, agent.SignatureFlagRsaSha256 | agent.SignatureFlagRsaSha512, ssh.KeyAlgoRSASHA256},
		{edSigner, agent.SignatureFlagRsaSha512, ssh.KeyAlgoED25519},
	}
	for _, c := range cases {
		sig, err := signWithFlags(c.signer, data, c.flags)
		if err != nil {
			t.Fatal(err)
		}
		if sig.Format != c.want || c.signer.PublicKey().Verify(data, sig) != nil {
			t.Errorf("flags %d: format %s, want %s", c.flags, sig.Format, c.want)
		}
	}
}

func TestPairChecksTheCode(t *testing.T) {
	relay := fakerelay.Start(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	a, err := Connect(ctx, Options{RelayURL: relay.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if _, err := a.Pair(ctx, "cryptex-pair:nonsense", nil, "x"); err == nil {
		t.Error("paired with a malformed code")
	}
	code, _ := agentproto.FormatPairingCode(&agentpb.PairingCode{
		Version: 1, RelayUrl: "https://other.example.com", SlotId: []byte{1},
		Secret: make([]byte, 32), OfferHash: make([]byte, 32),
	})
	if _, err := a.Pair(ctx, code, nil, "x"); err == nil {
		t.Error("paired with a code for another relay")
	}
	code, _ = agentproto.FormatPairingCode(&agentpb.PairingCode{
		Version: 1, RelayUrl: relay.URL, SlotId: []byte{1}, Secret: make([]byte, 32), OfferHash: make([]byte, 32),
	})
	if _, err := a.Pair(ctx, code, nil, "x"); err == nil {
		t.Error("paired with a slot that doesn't exist")
	}
}

// A copy that doesn't open, delivered first with the genuine message ID,
// must not make the approver skip the genuine request.
func TestTamperedCopyDoesNotHideTheRequest(t *testing.T) {
	relay := fakerelay.Start(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	a, err := Connect(ctx, Options{RelayURL: relay.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	agentID, _ := agentproto.NewIdentity()
	offer, _ := proto.Marshal(&agentpb.PairingOffer{ProtocolVersion: 1, SignPublicKey: agentID.ID(), KemPublicKey: agentID.KEMPublicKey()})
	slotConn, opened, err := relayclient.OpenSlot(ctx, relay.URL, offer, relayclient.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer slotConn.Close()
	code, _ := agentproto.FormatPairingCode(&agentpb.PairingCode{
		Version: 1, RelayUrl: relay.URL, SlotId: opened.SlotId, Secret: agentproto.NewPairingSecret(), OfferHash: agentproto.OfferHash(offer),
	})
	_, ek, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(ek)
	if _, err := a.Pair(ctx, code, []ssh.Signer{signer}, "w"); err != nil {
		t.Fatal(err)
	}
	agentConn, err := relayclient.Connect(ctx, relay.URL, agentID, relayclient.Credentials{Role: agentpb.Role_ROLE_AGENT}, relayclient.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer agentConn.Close()

	approverPeer := agentproto.Peer{SignPublicKey: a.ID(), KEMPublicKey: a.id.KEMPublicKey()}
	env, err := agentproto.Seal(agentID, approverPeer, &agentpb.Message{Body: &agentpb.Message_SignRequest{SignRequest: &agentpb.SignRequest{
		PublicKey: signer.PublicKey().Marshal(), Data: sshsig("git", "sha512"),
	}}}, agentproto.SealOptions{ExpiresAt: time.Now().Add(time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	tampered := proto.Clone(env).(*agentpb.Envelope)
	tampered.Ciphertext[0] ^= 1
	if !relay.Deliver(a.ID(), tampered) {
		t.Fatal("approver offline")
	}
	if err := agentConn.Send(ctx, env); err != nil {
		t.Fatal(err)
	}
	reqs, err := a.WaitRequests(ctx, 1)
	if err != nil || len(reqs) != 1 || reqs[0].Decision != Approve || len(reqs[0].Signature) == 0 {
		t.Fatalf("requests = %+v, %v", reqs, err)
	}
	// And the agent gets its answer.
	f, err := agentConn.Next(ctx)
	if err != nil {
		t.Fatal(err)
	}
	answer, err := agentproto.Open(agentID, approverPeer, f.GetDeliver().GetEnvelope(), time.Now())
	if err != nil || answer.Message.GetSignResponse().GetSignature() == nil {
		t.Fatalf("answer: %v, %v", answer, err)
	}
}
