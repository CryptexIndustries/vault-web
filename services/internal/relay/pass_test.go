package relay

import (
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
)

func TestPassVerify(t *testing.T) {
	pk, sk, err := mldsa65.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0)
	v := &passVerifier{keys: map[string]*mldsa65.PublicKey{"k1": pk}, audience: testOrigin, now: func() time.Time { return now }}
	approverKey := make([]byte, 32)
	approverKey[0] = 7
	base := Pass{Version: 1, KeyID: "k1", Audience: testOrigin, Subject: "sub", Device: "dev",
		IssuedAt: now.Unix(), Expiry: now.Add(7 * 24 * time.Hour).Unix(), ID: "jti", Limits: PassLimits{Agents: 3},
		Key: base64.RawURLEncoding.EncodeToString(approverKey)}

	got, err := v.verify(signPass(t, sk, base))
	if err != nil || *got != base {
		t.Fatalf("valid pass: %+v %v", got, err)
	}
	if !got.boundTo(approverKey) || got.boundTo(make([]byte, 32)) {
		t.Fatal("boundTo doesn't compare the approver key")
	}
	// Reusable for its lifetime.
	if _, err := v.verify(signPass(t, sk, base)); err != nil {
		t.Fatalf("reuse: %v", err)
	}

	cases := map[string]func(*Pass){
		"version 2":         func(p *Pass) { p.Version = 2 },
		"unknown kid":       func(p *Pass) { p.KeyID = "k2" },
		"wrong audience":    func(p *Pass) { p.Audience = "https://relay.example.com.evil" },
		"no subject":        func(p *Pass) { p.Subject = "" },
		"no device":         func(p *Pass) { p.Device = "" },
		"no ID":             func(p *Pass) { p.ID = "" },
		"exp before iat":    func(p *Pass) { p.Expiry = p.IssuedAt },
		"expired":           func(p *Pass) { p.IssuedAt, p.Expiry = now.Add(-time.Hour).Unix(), now.Add(-31*time.Second).Unix() },
		"issued in future":  func(p *Pass) { p.IssuedAt = now.Add(31 * time.Second).Unix() },
		"no agent limit":    func(p *Pass) { p.Limits.Agents = 0 },
		"negative limit":    func(p *Pass) { p.Limits.Agents = -1 },
		"share ticket kind": func(p *Pass) {},
		"no key":            func(p *Pass) { p.Key = "" },
		"short key":         func(p *Pass) { p.Key = base64.RawURLEncoding.EncodeToString(make([]byte, 31)) },
		"long key":          func(p *Pass) { p.Key = base64.RawURLEncoding.EncodeToString(make([]byte, 33)) },
		"padded key":        func(p *Pass) { p.Key = base64.URLEncoding.EncodeToString(approverKey) },
		"standard base64": func(p *Pass) {
			p.Key = base64.StdEncoding.EncodeToString(append([]byte{0xfb}, approverKey[1:]...))[:43]
		},
		"non-canonical key": func(p *Pass) { p.Key = p.Key[:42] + "f" },
	}
	for name, mutate := range cases {
		p := base
		mutate(&p)
		pass := signPass(t, sk, p)
		if name == "share ticket kind" {
			// Same key, but signed under the share ticket prefix.
			part, _, _ := strings.Cut(pass, ".")
			sig := make([]byte, mldsa65.SignatureSize)
			mldsa65.SignTo(sk, []byte("cryptex-share-ticket/v1."+part), nil, true, sig)
			pass = part + "." + b64(sig)
		}
		if _, err := v.verify(pass); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}

	within := base
	within.IssuedAt = now.Add(20 * time.Second).Unix()
	within.Expiry = within.IssuedAt + 3600
	if _, err := v.verify(signPass(t, sk, within)); err != nil {
		t.Errorf("iat within the skew refused: %v", err)
	}
	justExpired := base
	justExpired.IssuedAt, justExpired.Expiry = now.Add(-time.Hour).Unix(), now.Add(-20*time.Second).Unix()
	if _, err := v.verify(signPass(t, sk, justExpired)); err != nil {
		t.Errorf("exp within the skew refused: %v", err)
	}

	valid := signPass(t, sk, base)
	part, sig, _ := strings.Cut(valid, ".")
	flipped := []byte(part)
	flipped[5] ^= 1
	for name, pass := range map[string]string{
		"tampered payload": string(flipped) + "." + sig,
		"no signature":     part,
		"empty signature":  part + ".",
		"short signature":  part + "." + sig[:40],
		"garbage":          "a.b",
		"empty":            "",
	} {
		if _, err := v.verify(pass); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
