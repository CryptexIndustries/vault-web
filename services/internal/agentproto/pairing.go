package agentproto

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

// PairingCodePrefix starts every pairing code, in the QR code and when
// pasted, so the app can tell it apart from other QR codes.
const PairingCodePrefix = "cryptex-pair:"

// MaxOfferSize caps the unauthenticated upload to a pairing slot.
const MaxOfferSize = 4096

// ErrInvalidPairingCode covers every malformed code or offer, so a scan of
// some other QR code gets one plain answer.
var ErrInvalidPairingCode = errors.New("invalid pairing code")

// NewPairingSecret returns the one-time secret for a pairing code.
func NewPairingSecret() []byte {
	secret := make([]byte, SecretSize)
	rand.Read(secret)
	return secret
}

// OfferHash is the SHA-256 the pairing code carries for the slot's offer.
func OfferHash(offer []byte) []byte {
	sum := sha256.Sum256(offer)
	return sum[:]
}

// FormatPairingCode encodes a code as "cryptex-pair:" + base64url.
func FormatPairingCode(code *agentpb.PairingCode) (string, error) {
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(code)
	if err != nil {
		return "", err
	}
	return PairingCodePrefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

// ParsePairingCode decodes and checks a pairing code. Surrounding whitespace
// is ignored because people paste it.
func ParsePairingCode(text string) (*agentpb.PairingCode, error) {
	encoded, ok := strings.CutPrefix(strings.TrimSpace(text), PairingCodePrefix)
	if !ok {
		return nil, ErrInvalidPairingCode
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, ErrInvalidPairingCode
	}
	var code agentpb.PairingCode
	if err := proto.Unmarshal(raw, &code); err != nil {
		return nil, ErrInvalidPairingCode
	}
	if code.Version != Version || code.RelayUrl == "" || len(code.SlotId) == 0 ||
		len(code.Secret) != SecretSize || len(code.OfferHash) != sha256.Size {
		return nil, ErrInvalidPairingCode
	}
	return &code, nil
}

// ParseOffer decodes a slot's offer after checking it against the hash from
// the pairing code.
func ParseOffer(offer, wantHash []byte) (*agentpb.PairingOffer, error) {
	if len(offer) > MaxOfferSize || !bytes.Equal(OfferHash(offer), wantHash) {
		return nil, ErrInvalidPairingCode
	}
	var o agentpb.PairingOffer
	if err := proto.Unmarshal(offer, &o); err != nil {
		return nil, ErrInvalidPairingCode
	}
	if o.ProtocolVersion != Version || len(o.SignPublicKey) != ed25519.PublicKeySize ||
		len(o.KemPublicKey) != KEMPublicKeySize {
		return nil, ErrInvalidPairingCode
	}
	return &o, nil
}

// confirmationAlphabet is Crockford's base32: no I, L, O or U, so the code is
// easy to read aloud and compare.
const confirmationAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// ConfirmationCode is the short code the agent and the approver both show
// once the approver has answered, formatted like "4F7K-2Q9M". The user checks
// they match, which shows the agent paired with the device in their hand and
// not with someone who saw the QR code first. It covers the offer and the
// approver's keys; 40 bits are plenty because a mismatch only needs noticing.
func ConfirmationCode(offerHash, approverSignKey, approverKEMKey []byte) string {
	h := sha256.New()
	h.Write([]byte("cryptex-agent/v1 confirmation code\x00"))
	h.Write(offerHash)
	h.Write(approverSignKey)
	h.Write(approverKEMKey)
	sum := h.Sum(nil)
	bits := uint64(sum[0])<<32 | uint64(sum[1])<<24 | uint64(sum[2])<<16 | uint64(sum[3])<<8 | uint64(sum[4])
	out := make([]byte, 0, 9)
	for i := 7; i >= 0; i-- {
		out = append(out, confirmationAlphabet[(bits>>(5*uint(i)))&31])
		if i == 4 {
			out = append(out, '-')
		}
	}
	return string(out)
}
