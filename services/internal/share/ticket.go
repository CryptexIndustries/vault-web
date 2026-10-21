package share

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"

	"github.com/CryptexIndustries/vault-web/services/internal/serverkit"
)

// TicketSigningPrefix separates ticket signatures from any other use of the
// backend's ML-DSA-65 key.
const TicketSigningPrefix = "cryptex-share-ticket/v1."

// ticketClockSkew tolerates small clock differences with the backend.
const ticketClockSkew = 30 * time.Second

var ErrInvalidTicket = errors.New("invalid ticket")

type TicketLimits struct {
	Active int   `json:"active"`
	Bytes  int   `json:"bytes"`
	TTL    int64 `json:"ttl"`
}

type Ticket struct {
	Version  int          `json:"v"`
	KeyID    string       `json:"kid"`
	Audience string       `json:"aud"`
	Subject  string       `json:"sub"`
	IssuedAt int64        `json:"iat"`
	Expiry   int64        `json:"exp"`
	ID       string       `json:"jti"`
	Limits   TicketLimits `json:"lim"`
}

// TicketVerifier checks backend-signed subscriber tickets.
type TicketVerifier struct {
	keys     map[string]*mldsa65.PublicKey
	audience string
	now      func() time.Time
}

// ParseTicketKeys reads "kid:base64,kid2:base64".
func ParseTicketKeys(raw string) (map[string]*mldsa65.PublicKey, error) {
	return serverkit.ParseMLDSA65Keys(raw)
}

func NewTicketVerifier(keys map[string]*mldsa65.PublicKey, audience string) *TicketVerifier {
	return &TicketVerifier{keys: keys, audience: audience, now: time.Now}
}

// Audience is the origin tickets must name.
func (v *TicketVerifier) Audience() string { return v.audience }

func (v *TicketVerifier) Verify(ticket string) (*Ticket, error) {
	payloadPart, sigPart, ok := strings.Cut(ticket, ".")
	if !ok || payloadPart == "" || sigPart == "" {
		return nil, ErrInvalidTicket
	}
	payload, err := base64.RawURLEncoding.DecodeString(payloadPart)
	if err != nil {
		return nil, ErrInvalidTicket
	}
	sig, err := base64.RawURLEncoding.DecodeString(sigPart)
	if err != nil || len(sig) != mldsa65.SignatureSize {
		return nil, ErrInvalidTicket
	}
	var t Ticket
	if err := json.Unmarshal(payload, &t); err != nil {
		return nil, ErrInvalidTicket
	}
	key := v.keys[t.KeyID]
	if key == nil {
		return nil, ErrInvalidTicket
	}
	if !mldsa65.Verify(key, []byte(TicketSigningPrefix+payloadPart), nil, sig) {
		return nil, ErrInvalidTicket
	}
	now := v.now()
	switch {
	case t.Version != 1,
		t.Audience != v.audience,
		t.Subject == "",
		t.ID == "",
		t.Expiry <= t.IssuedAt,
		time.Unix(t.Expiry, 0).Add(ticketClockSkew).Before(now),
		time.Unix(t.IssuedAt, 0).Add(-ticketClockSkew).After(now),
		t.Limits.Active <= 0, t.Limits.Bytes <= 0, t.Limits.TTL <= 0:
		return nil, ErrInvalidTicket
	}
	return &t, nil
}
