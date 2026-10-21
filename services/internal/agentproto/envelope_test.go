package agentproto

import (
	"bytes"
	"errors"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

func testIdentities(t *testing.T) (agent, approver *Identity) {
	t.Helper()
	agent = vectorIdentity(t, vectorSeeds{seed("agent sign"), seed("agent kem")})
	approver = vectorIdentity(t, vectorSeeds{seed("approver sign"), seed("approver kem")})
	return agent, approver
}

var confirm = &agentpb.Message{Body: &agentpb.Message_PairingConfirm{PairingConfirm: &agentpb.PairingConfirm{AgentVersion: "0.1.0"}}}

func TestIdentitySeedsRoundTrip(t *testing.T) {
	id, err := NewIdentity()
	if err != nil {
		t.Fatal(err)
	}
	signSeed, kemSeed, err := id.Seeds()
	if err != nil {
		t.Fatal(err)
	}
	again, err := IdentityFromSeeds(signSeed, kemSeed)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(again.ID(), id.ID()) || !bytes.Equal(again.KEMPublicKey(), id.KEMPublicKey()) {
		t.Fatal("identity changed after storing its seeds")
	}
	if len(id.KEMPublicKey()) != KEMPublicKeySize {
		t.Fatalf("X-Wing public key is %d bytes", len(id.KEMPublicKey()))
	}
}

func TestOpenRefusesTampering(t *testing.T) {
	agent, approver := testIdentities(t)
	seal := func() *agentpb.Envelope {
		env, err := Seal(agent, peerOf(approver), confirm, SealOptions{ExpiresAt: vectorNow.Add(time.Minute)})
		if err != nil {
			t.Fatal(err)
		}
		return env
	}
	if _, err := Open(approver, peerOf(agent), seal(), vectorNow); err != nil {
		t.Fatal(err)
	}
	for name, field := range map[string]func(*agentpb.Envelope) []byte{
		"header":     func(e *agentpb.Envelope) []byte { return e.Header },
		"enc":        func(e *agentpb.Envelope) []byte { return e.EncapsulatedKey },
		"ciphertext": func(e *agentpb.Envelope) []byte { return e.Ciphertext },
		"signature":  func(e *agentpb.Envelope) []byte { return e.Signature },
	} {
		env := seal()
		b := field(env)
		b[len(b)-1] ^= 1
		if _, err := Open(approver, peerOf(agent), env, vectorNow); err == nil {
			t.Errorf("tampered %s opened", name)
		}
	}
	stranger := vectorIdentity(t, vectorSeeds{seed("stranger sign"), seed("stranger kem")})
	if _, err := Open(approver, peerOf(stranger), seal(), vectorNow); err == nil {
		t.Error("opened an envelope from an unexpected sender")
	}
	if _, err := Open(stranger, peerOf(agent), seal(), vectorNow); err == nil {
		t.Error("opened an envelope addressed to someone else")
	}
}

func TestExpiry(t *testing.T) {
	agent, approver := testIdentities(t)
	open := func(opts SealOptions, now time.Time) error {
		env, err := Seal(agent, peerOf(approver), confirm, opts)
		if err != nil {
			t.Fatal(err)
		}
		_, err = Open(approver, peerOf(agent), env, now)
		return err
	}
	deadline := vectorNow.Add(time.Minute)
	if err := open(SealOptions{ExpiresAt: deadline}, deadline.Add(ClockSkew)); !errors.Is(err, ErrExpired) {
		t.Errorf("past deadline: %v", err)
	}
	if err := open(SealOptions{ExpiresAt: vectorNow.Add(10 * time.Minute)}, vectorNow); !errors.Is(err, ErrInvalidEnvelope) {
		t.Errorf("request deadline beyond 90 s: %v", err)
	}
	if err := open(SealOptions{ExpiresAt: vectorNow.Add(10 * time.Minute), Retain: true}, vectorNow); err != nil {
		t.Errorf("retained envelope: %v", err)
	}
	if err := open(SealOptions{ExpiresAt: vectorNow.Add(31 * 24 * time.Hour), Retain: true}, vectorNow); !errors.Is(err, ErrInvalidEnvelope) {
		t.Errorf("retained beyond 30 days: %v", err)
	}
}

func TestPairingAcceptNeedsTheCode(t *testing.T) {
	agent, approver := testIdentities(t)
	offer, err := proto.Marshal(vectorOffer(agent))
	if err != nil {
		t.Fatal(err)
	}
	binding := PairingBinding{Secret: NewPairingSecret(), OfferHash: OfferHash(offer)}
	accept := func(signer *Identity) *agentpb.Message {
		return &agentpb.Message{Body: &agentpb.Message_PairingAccept{PairingAccept: &agentpb.PairingAccept{
			ApproverSignPublicKey: signer.ID(),
			ApproverKemPublicKey:  signer.KEMPublicKey(),
			AgentName:             "workstation",
		}}}
	}
	seal := func(signer *Identity, msg *agentpb.Message, b PairingBinding) *agentpb.Envelope {
		env, err := Seal(signer, peerOf(agent), msg, SealOptions{ExpiresAt: vectorNow.Add(time.Minute), Pairing: &b})
		if err != nil {
			t.Fatal(err)
		}
		return env
	}

	got, peer, err := OpenPairingAccept(agent, binding, seal(approver, accept(approver), binding), vectorNow)
	if err != nil || got.AgentName != "workstation" || !bytes.Equal(peer.SignPublicKey, approver.ID()) {
		t.Fatalf("valid accept: %v", err)
	}

	// Someone who saw only the slot (the relay) doesn't know the secret.
	wrongSecret := binding
	wrongSecret.Secret = NewPairingSecret()
	if _, _, err := OpenPairingAccept(agent, binding, seal(approver, accept(approver), wrongSecret), vectorNow); err == nil {
		t.Error("accepted an answer without the pairing secret")
	}
	// An answer for a different offer.
	otherOffer := binding
	otherOffer.OfferHash = OfferHash([]byte("another offer"))
	if _, _, err := OpenPairingAccept(agent, binding, seal(approver, accept(approver), otherOffer), vectorNow); err == nil {
		t.Error("accepted an answer bound to another offer")
	}
	// Signed by one key while naming another as the approver.
	stranger := vectorIdentity(t, vectorSeeds{seed("stranger sign"), seed("stranger kem")})
	if _, _, err := OpenPairingAccept(agent, binding, seal(stranger, accept(approver), binding), vectorNow); err == nil {
		t.Error("accepted an answer whose signer isn't the named approver")
	}
	// An ordinary message can't stand in for the pairing answer.
	if _, _, err := OpenPairingAccept(agent, binding, seal(approver, confirm, binding), vectorNow); err == nil {
		t.Error("accepted a pairing envelope without a PairingAccept")
	}
}

func TestRelaySignatures(t *testing.T) {
	agent, _ := testIdentities(t)
	nonce := seed("nonce")
	sig := SignAuth(agent, "https://relay.example", nonce)
	if !VerifyAuth(agent.ID(), "https://relay.example", nonce, sig) {
		t.Fatal("auth signature does not verify")
	}
	// A challenge answered for one relay is useless on another.
	if VerifyAuth(agent.ID(), "https://other.example", nonce, sig) {
		t.Fatal("auth signature verified for another relay")
	}
}

func TestParsePairingCode(t *testing.T) {
	for _, text := range []string{"", "https://example.com", PairingCodePrefix + "!!", PairingCodePrefix} {
		if _, err := ParsePairingCode(text); err == nil {
			t.Errorf("parsed %q", text)
		}
	}
	short, _ := FormatPairingCode(&agentpb.PairingCode{Version: Version, RelayUrl: "https://r", SlotId: []byte{1}, Secret: []byte{1}, OfferHash: make([]byte, 32)})
	if _, err := ParsePairingCode(short); err == nil {
		t.Error("parsed a code with a short secret")
	}
}
