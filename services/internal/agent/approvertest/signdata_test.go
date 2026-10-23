package approvertest

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

func newSigner(t *testing.T) ssh.Signer {
	t.Helper()
	_, k, _ := ed25519.GenerateKey(rand.Reader)
	return signerOf(t, k)
}

func sshsig(namespace, hash string) []byte {
	return append([]byte(sshsigMagic), ssh.Marshal(struct {
		Namespace, Reserved, Hash string
		H                         []byte
	}{namespace, "", hash, make([]byte, 64)})...)
}

// decide refuses what classify rejects before the policy sees it, and
// "other" data unless allowed.
func TestDecideChecksTheData(t *testing.T) {
	user, host := newSigner(t), hostSigner{signer: newSigner(t)}
	key := user.PublicKey().Marshal()
	sid := []byte("session id of the login, 32 byte")
	a := &Approver{ctx: context.Background()}
	ag := &PairedAgent{signers: []ssh.Signer{user}}
	h := &agentpb.EnvelopeHeader{ExpiresAt: time.Now().Add(time.Minute).UnixMilli()}
	asked := 0
	policy := func(context.Context, *Request) Decision { asked++; return Approve }
	decide := func(data []byte, binds ...*agentpb.SessionBind) (*Request, *agentpb.SignResponse) {
		req := &Request{Sign: &agentpb.SignRequest{PublicKey: key, Data: data, SessionBinds: binds}}
		resp, _, _ := a.decide(ag, h, req, policy)
		return req, resp
	}

	req, resp := decide(login(sid, "git", key, nil), vectorBind(t, host, sid, false))
	if resp.GetSignature() == nil || req.Kind != KindUserauth || asked != 1 {
		t.Fatalf("matching login: %v, kind %s", resp, req.Kind)
	}
	if _, resp := decide(login([]byte("another session"), "git", key, nil), vectorBind(t, host, sid, false)); resp.GetRefusal() != agentpb.RefusalReason_REFUSAL_REASON_INVALID {
		t.Errorf("mismatched session: %v", resp)
	}
	// No usable bind: the policy decides, told the destination is unknown.
	if req, resp := decide(login(sid, "git", key, nil), vectorBind(t, host, sid, true)); resp.GetSignature() == nil || !req.DestinationUnknown {
		t.Errorf("forwarded: %v, destination unknown %v", resp, req.DestinationUnknown)
	}
	if req, resp := decide(login(sid, "git", key, nil)); resp.GetSignature() == nil || !req.DestinationUnknown {
		t.Errorf("unbound: %v, destination unknown %v", resp, req.DestinationUnknown)
	}
	if _, resp := decide([]byte("x")); resp.GetRefusal() != agentpb.RefusalReason_REFUSAL_REASON_INVALID {
		t.Errorf("other data: %v", resp)
	}
	if asked != 3 {
		t.Errorf("the policy saw %d requests, want the 3 valid ones", asked)
	}
	req, resp = decide(sshsig("git", "sha512"))
	if resp.GetSignature() == nil || req.Kind != KindSSHSig || req.Namespace != "git" {
		t.Errorf("sshsig: %v, %s %q", resp, req.Kind, req.Namespace)
	}
	a.opts.AllowOther = true
	if req, resp := decide([]byte("x")); resp.GetSignature() == nil || req.Kind != KindOther {
		t.Errorf("allowed other data: %v", resp)
	}
}
