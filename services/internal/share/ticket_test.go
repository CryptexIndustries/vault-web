package share

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
)

type ticketVector struct {
	Seed      string `json:"seed"`
	PublicKey string `json:"publicKey"`
	Ticket    string `json:"ticket"`
	Payload   Ticket `json:"payload"`
}

func loadVector(t *testing.T) ticketVector {
	t.Helper()
	raw, err := os.ReadFile("testdata/ticket-vector.json")
	if err != nil {
		t.Fatal(err)
	}
	var v ticketVector
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func vectorVerifier(t *testing.T, v ticketVector, at time.Time) *TicketVerifier {
	t.Helper()
	keys, err := ParseTicketKeys("test:" + v.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	verifier := NewTicketVerifier(keys, "http://localhost:3000")
	verifier.now = func() time.Time { return at }
	return verifier
}

// The vector was signed by @noble/post-quantum, the library the backend uses.
func TestTicketVectorFromNoble(t *testing.T) {
	v := loadVector(t)
	seed, err := base64.RawURLEncoding.DecodeString(v.Seed)
	if err != nil {
		t.Fatal(err)
	}
	var seedArr [mldsa65.SeedSize]byte
	copy(seedArr[:], seed)
	pk, _ := mldsa65.NewKeyFromSeed(&seedArr)
	packed, _ := pk.MarshalBinary()
	if base64.StdEncoding.EncodeToString(packed) != v.PublicKey {
		t.Fatal("circl derives a different public key from the same seed")
	}

	got, err := vectorVerifier(t, v, time.Unix(v.Payload.IssuedAt+10, 0)).Verify(v.Ticket)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if *got != v.Payload {
		t.Fatalf("payload = %+v, want %+v", *got, v.Payload)
	}
}

func TestTicketRejections(t *testing.T) {
	v := loadVector(t)
	valid := time.Unix(v.Payload.IssuedAt+10, 0)
	payloadPart, sigPart, _ := strings.Cut(v.Ticket, ".")

	flipped := []byte(payloadPart)
	flipped[10] ^= 1

	cases := map[string]struct {
		ticket string
		at     time.Time
	}{
		"expired":          {v.Ticket, time.Unix(v.Payload.Expiry, 0).Add(time.Minute)},
		"not yet valid":    {v.Ticket, time.Unix(v.Payload.IssuedAt, 0).Add(-time.Minute)},
		"tampered payload": {string(flipped) + "." + sigPart, valid},
		"no signature":     {payloadPart, valid},
		"garbage":          {"a.b", valid},
	}
	for name, tc := range cases {
		if _, err := vectorVerifier(t, v, tc.at).Verify(tc.ticket); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}

	other := vectorVerifier(t, v, valid)
	other.audience = "https://www.cryptex-vault.com"
	if _, err := other.Verify(v.Ticket); err == nil {
		t.Error("wrong audience accepted")
	}

	pk, _, _ := mldsa65.GenerateKey(rand.Reader)
	otherKey := vectorVerifier(t, v, valid)
	otherKey.keys = map[string]*mldsa65.PublicKey{"test": pk}
	if _, err := otherKey.Verify(v.Ticket); err == nil {
		t.Error("ticket accepted under another key")
	}
}

func TestParseTicketKeys(t *testing.T) {
	v := loadVector(t)
	if _, err := ParseTicketKeys(""); err == nil {
		t.Error("empty key list accepted")
	}
	if _, err := ParseTicketKeys("nokid"); err == nil {
		t.Error("entry without kid accepted")
	}
	keys, err := ParseTicketKeys("a:" + v.PublicKey + ", b:" + v.PublicKey)
	if err != nil || len(keys) != 2 {
		t.Fatalf("keys = %d, err = %v", len(keys), err)
	}
}
