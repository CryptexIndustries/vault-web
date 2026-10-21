// Package agentproto implements the cryptography of the agent protocol
// (agent.proto): envelopes between an agent and its approver, the pairing
// code, and the signatures clients show the relay. The TypeScript side lives
// in packages/vault-core/src/agent and must stay byte-compatible; the vectors
// in testdata check both directions.
package agentproto

import (
	"bytes"
	"crypto/ed25519"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/hpke"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

const (
	// Version is the protocol version in EnvelopeHeader, PairingCode,
	// PairingOffer and Challenge.
	Version = 1

	MessageIDSize = 16
	SecretSize    = 32
	// KEMPublicKeySize and KEMSeedSize are X-Wing sizes.
	KEMPublicKeySize = 1216
	KEMSeedSize      = 32

	// MaxEnvelopeSize caps a serialized Envelope. The relay refuses larger
	// ones with STATUS_TOO_LARGE, so senders check before sending.
	MaxEnvelopeSize = 64 << 10

	// RequestLifetime is how long a sign request waits for an answer.
	RequestLifetime = 90 * time.Second
	// MaxRetainLifetime caps retained envelopes such as KeysUpdate.
	MaxRetainLifetime = 30 * 24 * time.Hour
	// ClockSkew is tolerated between agent, relay and approver clocks.
	ClockSkew = 30 * time.Second
)

var (
	messageInfo = []byte("cryptex-agent/v1 message")
	pairingInfo = []byte("cryptex-agent/v1 pairing")
	pairingMAC  = []byte("cryptex-agent/v1 pairing mac")
	envelopeCtx = []byte("cryptex-agent/v1 envelope\x00")
)

var (
	ErrInvalidEnvelope = errors.New("invalid envelope")
	ErrExpired         = errors.New("envelope expired")
)

// kem is the HPKE KEM for every envelope: MLKEM768-X25519 (X-Wing).
func kem() hpke.KEM { return hpke.MLKEM768X25519() }

func kdf() hpke.KDF   { return hpke.HKDFSHA256() }
func aead() hpke.AEAD { return hpke.ChaCha20Poly1305() }

// Identity is one side's long-term keys: Ed25519 for signing and the relay
// ID, X-Wing for receiving envelopes.
type Identity struct {
	Sign ed25519.PrivateKey
	KEM  hpke.PrivateKey
}

// NewIdentity returns fresh random keys.
func NewIdentity() (*Identity, error) {
	signSeed := make([]byte, ed25519.SeedSize)
	kemSeed := make([]byte, KEMSeedSize)
	rand.Read(signSeed)
	rand.Read(kemSeed)
	return IdentityFromSeeds(signSeed, kemSeed)
}

// IdentityFromSeeds rebuilds keys from a 32-byte Ed25519 seed and a 32-byte
// X-Wing seed, the form they are stored in.
func IdentityFromSeeds(signSeed, kemSeed []byte) (*Identity, error) {
	if len(signSeed) != ed25519.SeedSize || len(kemSeed) != KEMSeedSize {
		return nil, errors.New("identity seeds must be 32 bytes each")
	}
	kemKey, err := kem().NewPrivateKey(kemSeed)
	if err != nil {
		return nil, err
	}
	return &Identity{Sign: ed25519.NewKeyFromSeed(signSeed), KEM: kemKey}, nil
}

// ID is the Ed25519 public key, which identifies the client on the relay.
func (id *Identity) ID() []byte { return []byte(id.Sign.Public().(ed25519.PublicKey)) }

// KEMPublicKey is the serialized X-Wing public key.
func (id *Identity) KEMPublicKey() []byte { return id.KEM.PublicKey().Bytes() }

// Seeds returns the Ed25519 and X-Wing seeds for storage.
func (id *Identity) Seeds() (signSeed, kemSeed []byte, err error) {
	kemSeed, err = id.KEM.Bytes()
	if err != nil {
		return nil, nil, err
	}
	return id.Sign.Seed(), kemSeed, nil
}

// Peer is the other side as pinned at pairing.
type Peer struct {
	SignPublicKey []byte
	KEMPublicKey  []byte
}

// SealOptions are the header fields a caller chooses.
type SealOptions struct {
	InReplyTo []byte
	ExpiresAt time.Time
	Retain    bool
	// Pairing seals a PairingAccept: info is bound to the offer and the
	// envelope gets a MAC keyed by the pairing secret.
	Pairing *PairingBinding
}

// PairingBinding ties the PairingAccept envelope to one pairing code.
type PairingBinding struct {
	Secret    []byte
	OfferHash []byte
}

// Seal encrypts msg to peer and signs the envelope with from.
func Seal(from *Identity, to Peer, msg *agentpb.Message, opts SealOptions) (*agentpb.Envelope, error) {
	plaintext, err := proto.Marshal(msg)
	if err != nil {
		return nil, err
	}
	messageID := make([]byte, MessageIDSize)
	rand.Read(messageID)
	header, err := proto.MarshalOptions{Deterministic: true}.Marshal(&agentpb.EnvelopeHeader{
		Version:   Version,
		Sender:    from.ID(),
		Recipient: to.SignPublicKey,
		MessageId: messageID,
		InReplyTo: opts.InReplyTo,
		ExpiresAt: opts.ExpiresAt.UnixMilli(),
		Retain:    opts.Retain,
	})
	if err != nil {
		return nil, err
	}
	pk, err := kem().NewPublicKey(to.KEMPublicKey)
	if err != nil {
		return nil, err
	}
	info := messageInfo
	if opts.Pairing != nil {
		info = pairingHPKEInfo(opts.Pairing.OfferHash)
	}
	enc, sender, err := hpke.NewSender(pk, kdf(), aead(), info)
	if err != nil {
		return nil, err
	}
	ciphertext, err := sender.Seal(header, plaintext)
	if err != nil {
		return nil, err
	}
	env := &agentpb.Envelope{Header: header, EncapsulatedKey: enc, Ciphertext: ciphertext}
	input := SigningInput(env)
	env.Signature = ed25519.Sign(from.Sign, input)
	if opts.Pairing != nil {
		env.PairingMac = pairingTag(opts.Pairing, input)
	}
	return env, nil
}

// ParseHeader decodes an envelope's header and checks its shape. The relay
// uses it to route; Open uses it before decrypting.
func ParseHeader(env *agentpb.Envelope) (*agentpb.EnvelopeHeader, error) {
	var h agentpb.EnvelopeHeader
	if err := proto.Unmarshal(env.GetHeader(), &h); err != nil {
		return nil, ErrInvalidEnvelope
	}
	if h.Version != Version ||
		len(h.Sender) != ed25519.PublicKeySize ||
		len(h.Recipient) != ed25519.PublicKeySize ||
		len(h.MessageId) != MessageIDSize ||
		(len(h.InReplyTo) != 0 && len(h.InReplyTo) != MessageIDSize) ||
		h.ExpiresAt <= 0 {
		return nil, ErrInvalidEnvelope
	}
	return &h, nil
}

// VerifySignature checks the sender's signature against the header's sender
// key. It says nothing about whether that sender is trusted.
func VerifySignature(env *agentpb.Envelope, h *agentpb.EnvelopeHeader) bool {
	return len(env.GetSignature()) == ed25519.SignatureSize &&
		ed25519.Verify(h.Sender, SigningInput(env), env.GetSignature())
}

// CheckExpiry refuses envelopes past their deadline or with a deadline
// further out than the protocol allows.
func CheckExpiry(h *agentpb.EnvelopeHeader, now time.Time) error {
	expires := time.UnixMilli(h.ExpiresAt)
	limit := RequestLifetime
	if h.Retain {
		limit = MaxRetainLifetime
	}
	if !expires.Add(ClockSkew).After(now) {
		return ErrExpired
	}
	if expires.After(now.Add(limit + ClockSkew)) {
		return ErrInvalidEnvelope
	}
	return nil
}

// Opened is a verified and decrypted envelope.
type Opened struct {
	Header  *agentpb.EnvelopeHeader
	Message *agentpb.Message
}

// Open verifies an envelope from the pinned peer and decrypts it. Callers
// still reject message IDs they have seen before the envelope expires.
func Open(to *Identity, from Peer, env *agentpb.Envelope, now time.Time) (*Opened, error) {
	h, err := ParseHeader(env)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(h.Sender, from.SignPublicKey) || !bytes.Equal(h.Recipient, to.ID()) {
		return nil, ErrInvalidEnvelope
	}
	if len(env.GetPairingMac()) != 0 || !VerifySignature(env, h) {
		return nil, ErrInvalidEnvelope
	}
	if err := CheckExpiry(h, now); err != nil {
		return nil, err
	}
	msg, err := decrypt(to, env, messageInfo)
	if err != nil {
		return nil, err
	}
	return &Opened{Header: h, Message: msg}, nil
}

// OpenPairingAccept checks and decrypts the approver's answer on /v1/pair.
// The approver's keys come from inside the envelope, so the pairing MAC is
// what proves it was sealed by someone holding the pairing code. Returns the
// approver as a Peer to pin.
func OpenPairingAccept(agent *Identity, binding PairingBinding, env *agentpb.Envelope, now time.Time) (*agentpb.PairingAccept, Peer, error) {
	h, err := ParseHeader(env)
	if err != nil {
		return nil, Peer{}, err
	}
	input := SigningInput(env)
	if !bytes.Equal(h.Recipient, agent.ID()) || !hmac.Equal(env.GetPairingMac(), pairingTag(&binding, input)) {
		return nil, Peer{}, ErrInvalidEnvelope
	}
	if err := CheckExpiry(h, now); err != nil {
		return nil, Peer{}, err
	}
	msg, err := decrypt(agent, env, pairingHPKEInfo(binding.OfferHash))
	if err != nil {
		return nil, Peer{}, err
	}
	accept := msg.GetPairingAccept()
	if accept == nil ||
		!bytes.Equal(accept.ApproverSignPublicKey, h.Sender) ||
		len(accept.ApproverKemPublicKey) != KEMPublicKeySize ||
		!VerifySignature(env, h) {
		return nil, Peer{}, ErrInvalidEnvelope
	}
	return accept, Peer{SignPublicKey: accept.ApproverSignPublicKey, KEMPublicKey: accept.ApproverKemPublicKey}, nil
}

func decrypt(to *Identity, env *agentpb.Envelope, info []byte) (*agentpb.Message, error) {
	recipient, err := hpke.NewRecipient(env.GetEncapsulatedKey(), to.KEM, kdf(), aead(), info)
	if err != nil {
		return nil, ErrInvalidEnvelope
	}
	plaintext, err := recipient.Open(env.GetHeader(), env.GetCiphertext())
	if err != nil {
		return nil, ErrInvalidEnvelope
	}
	var msg agentpb.Message
	if err := proto.Unmarshal(plaintext, &msg); err != nil {
		return nil, ErrInvalidEnvelope
	}
	return &msg, nil
}

// SigningInput is what the envelope signature and pairing MAC cover: a
// context string, then header, encapsulated key and ciphertext, each with a
// 4-byte big-endian length.
func SigningInput(env *agentpb.Envelope) []byte {
	out := bytes.Clone(envelopeCtx)
	for _, part := range [][]byte{env.GetHeader(), env.GetEncapsulatedKey(), env.GetCiphertext()} {
		out = binary.BigEndian.AppendUint32(out, uint32(len(part)))
		out = append(out, part...)
	}
	return out
}

// pairingHPKEInfo binds a PairingAccept's encryption to the offer it answers.
func pairingHPKEInfo(offerHash []byte) []byte {
	return append(bytes.Clone(pairingInfo), offerHash...)
}

func pairingTag(b *PairingBinding, input []byte) []byte {
	key, err := hkdf.Key(sha256.New, b.Secret, b.OfferHash, string(pairingMAC), sha256.Size)
	if err != nil {
		panic(err) // only fails for lengths over 255 hash blocks
	}
	mac := hmac.New(sha256.New, key)
	mac.Write(input)
	return mac.Sum(nil)
}
