package relay

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
)

// PassSigningPrefix separates relay pass signatures from any other use of the
// backend's ML-DSA-65 key, such as share tickets.
const PassSigningPrefix = "cryptex-relay-pass/v1."

// passClockSkew tolerates small clock differences with the backend.
const passClockSkew = 30 * time.Second

var errInvalidPass = errors.New("invalid relay pass")

type PassLimits struct {
	Agents int `json:"agents"`
}

// Pass is a backend-signed permission for one approving device to use the
// hosted relay. Unlike share tickets, a pass is reusable until it expires.
type Pass struct {
	Version  int        `json:"v"`
	KeyID    string     `json:"kid"`
	Audience string     `json:"aud"`
	Subject  string     `json:"sub"`
	Device   string     `json:"dev"`
	IssuedAt int64      `json:"iat"`
	Expiry   int64      `json:"exp"`
	ID       string     `json:"jti"`
	Limits   PassLimits `json:"lim"`
	// Key is the approver's Ed25519 public key, unpadded base64url. It binds
	// the pass to one device key, so a pass copied off the device is useless
	// without that device's private key.
	Key string `json:"key"`
}

// boundTo reports whether the pass was issued for this approver key.
func (p *Pass) boundTo(key []byte) bool {
	return p.Key == base64.RawURLEncoding.EncodeToString(key)
}

func (p *Pass) issuedAt() time.Time { return time.Unix(p.IssuedAt, 0) }

// expiresAt includes the clock skew, so a pass the relay just accepted
// doesn't stop routing a moment later.
func (p *Pass) expiresAt() time.Time { return time.Unix(p.Expiry, 0).Add(passClockSkew) }

// passVerifier checks relay passes offline against the backend's public keys.
type passVerifier struct {
	keys     map[string]*mldsa65.PublicKey
	audience string
	now      func() time.Time
}

func (v *passVerifier) verify(pass string) (*Pass, error) {
	payloadPart, sigPart, ok := strings.Cut(pass, ".")
	if !ok || payloadPart == "" || sigPart == "" {
		return nil, errInvalidPass
	}
	payload, err := base64.RawURLEncoding.DecodeString(payloadPart)
	if err != nil {
		return nil, errInvalidPass
	}
	sig, err := base64.RawURLEncoding.DecodeString(sigPart)
	if err != nil || len(sig) != mldsa65.SignatureSize {
		return nil, errInvalidPass
	}
	var p Pass
	if err := json.Unmarshal(payload, &p); err != nil {
		return nil, errInvalidPass
	}
	key := v.keys[p.KeyID]
	if key == nil {
		return nil, errInvalidPass
	}
	if !mldsa65.Verify(key, []byte(PassSigningPrefix+payloadPart), nil, sig) {
		return nil, errInvalidPass
	}
	now := v.now()
	switch {
	case p.Version != 1,
		p.Audience != v.audience,
		p.Subject == "", p.Device == "", p.ID == "",
		p.Expiry <= p.IssuedAt,
		!p.expiresAt().After(now),
		p.issuedAt().Add(-passClockSkew).After(now),
		p.Limits.Agents <= 0:
		return nil, errInvalidPass
	}
	// Strict decoding makes the encoding canonical, so boundTo can compare
	// strings.
	if key, err := base64.RawURLEncoding.Strict().DecodeString(p.Key); err != nil || len(key) != ed25519.PublicKeySize {
		return nil, errInvalidPass
	}
	return &p, nil
}
