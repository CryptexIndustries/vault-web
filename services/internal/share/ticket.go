package share

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
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
	keys := map[string]*mldsa65.PublicKey{}
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		kid, encoded, ok := strings.Cut(entry, ":")
		if !ok || kid == "" {
			return nil, fmt.Errorf("ticket key %q: want <kid>:<base64>", entry)
		}
		raw, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("ticket key %q: %w", kid, err)
		}
		var pk mldsa65.PublicKey
		if err := pk.UnmarshalBinary(raw); err != nil {
			return nil, fmt.Errorf("ticket key %q: %w", kid, err)
		}
		keys[kid] = &pk
	}
	if len(keys) == 0 {
		return nil, errors.New("no ticket keys configured")
	}
	return keys, nil
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

// NormalizeOrigin turns a URL such as "https://Vault.example.com:443/app/"
// into the origin a browser reports ("https://vault.example.com"). The backend
// signs that form into tickets, and Verify compares it exactly. Hosts that a
// browser would rewrite in ways this function doesn't (internationalized
// names, non-canonical IP addresses or ports) are refused, so a mismatch
// fails at startup instead of rejecting every ticket.
func NormalizeOrigin(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil {
		return "", fmt.Errorf("%q is not an http(s) URL", raw)
	}
	host := strings.ToLower(u.Hostname())
	for _, r := range host {
		if r > unicode.MaxASCII {
			return "", fmt.Errorf("%q has a non-ASCII host; use its xn-- form", raw)
		}
	}
	if ip, err := netip.ParseAddr(host); err == nil && ip.String() != host {
		return "", fmt.Errorf("%q has a non-canonical IP address; use %s", raw, ip)
	} else if err != nil && strings.Trim(host, "0123456789.") == "" {
		return "", fmt.Errorf("%q has an IPv4 address a browser would rewrite", raw)
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	port := u.Port()
	if port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port {
			return "", fmt.Errorf("%q has an invalid port", raw)
		}
	}
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		port = ""
	}
	if port != "" {
		host += ":" + port
	}
	return u.Scheme + "://" + host, nil
}
