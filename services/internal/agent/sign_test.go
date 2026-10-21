package agent

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

// The largest request the agent builds (capped chain, the most binds ssh
// sends, big RSA host keys) still fits in an envelope.
func TestLargestSignRequestFits(t *testing.T) {
	agentID, _ := agentproto.NewIdentity()
	approverID, _ := agentproto.NewIdentity()
	var chain []*agentpb.Process
	for i := range maxParents + 1 {
		p := &agentpb.Process{Pid: int32(1000 - i), Uid: 1000, Exe: strings.Repeat("e", 4096), Cwd: strings.Repeat("c", 4096)}
		for range maxArgs {
			p.Args = append(p.Args, strings.Repeat("a", maxArgLength))
		}
		chain = append(chain, p)
	}
	var binds []*agentpb.SessionBind
	for range maxSessionBinds {
		// An 8192-bit RSA host key and its signature.
		binds = append(binds, &agentpb.SessionBind{
			HostKey: make([]byte, 1100), SessionId: make([]byte, maxSessionIDSize), Signature: make([]byte, 1100),
		})
	}
	env, err := agentproto.Seal(agentID, agentproto.Peer{SignPublicKey: approverID.ID(), KEMPublicKey: approverID.KEMPublicKey()},
		&agentpb.Message{Body: &agentpb.Message_SignRequest{SignRequest: &agentpb.SignRequest{
			PublicKey: make([]byte, 1100), Data: make([]byte, 2048), Flags: 4,
			Processes: capChain(chain), SessionBinds: binds, Hostname: strings.Repeat("h", 255),
		}}}, agentproto.SealOptions{ExpiresAt: time.Now().Add(time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	if n := proto.Size(env); n > agentproto.MaxEnvelopeSize {
		t.Fatalf("envelope of %d bytes, the limit is %d", n, agentproto.MaxEnvelopeSize)
	}
}

func TestFinishSignChecksTheSignature(t *testing.T) {
	rk, _ := rsa.GenerateKey(rand.Reader, 2048)
	rsaSigner, _ := ssh.NewSignerFromKey(rk)
	rsaAlgo := rsaSigner.(ssh.AlgorithmSigner)
	_, ek, _ := ed25519.GenerateKey(rand.Reader)
	edSigner, _ := ssh.NewSignerFromKey(ek)
	s := newTestService(t)
	data := []byte("user auth request")
	answer := func(sig *ssh.Signature) *agentpb.SignResponse {
		return &agentpb.SignResponse{Result: &agentpb.SignResponse_Signature{Signature: ssh.Marshal(sig)}}
	}
	rsaSig := func(algo string, signed []byte) *ssh.Signature {
		sig, err := rsaAlgo.SignWithAlgorithm(rand.Reader, signed, algo)
		if err != nil {
			t.Fatal(err)
		}
		return sig
	}
	sha256, sha512 := agent.SignatureFlagRsaSha256, agent.SignatureFlagRsaSha512
	edSig, _ := edSigner.Sign(rand.Reader, data)
	cases := []struct {
		name  string
		key   ssh.PublicKey
		flags agent.SignatureFlags
		sig   *ssh.Signature
		ok    bool
	}{
		{"sha-512 as asked", rsaSigner.PublicKey(), sha512, rsaSig(ssh.KeyAlgoRSASHA512, data), true},
		{"sha-256 as asked", rsaSigner.PublicKey(), sha256, rsaSig(ssh.KeyAlgoRSASHA256, data), true},
		{"sha-1 without flags", rsaSigner.PublicKey(), 0, rsaSig(ssh.KeyAlgoRSA, data), true},
		{"either sha-2 with both flags", rsaSigner.PublicKey(), sha256 | sha512, rsaSig(ssh.KeyAlgoRSASHA512, data), true},
		{"sha-1 for sha-512", rsaSigner.PublicKey(), sha512, rsaSig(ssh.KeyAlgoRSA, data), false},
		{"sha-256 for sha-512", rsaSigner.PublicKey(), sha512, rsaSig(ssh.KeyAlgoRSASHA256, data), false},
		{"sha-512 without flags", rsaSigner.PublicKey(), 0, rsaSig(ssh.KeyAlgoRSASHA512, data), false},
		{"other data", rsaSigner.PublicKey(), sha512, rsaSig(ssh.KeyAlgoRSASHA512, []byte("something else")), false},
		{"another key's signature", edSigner.PublicKey(), 0, rsaSig(ssh.KeyAlgoRSA, data), false},
		{"ed25519 ignores rsa flags", edSigner.PublicKey(), sha512, edSig, true},
	}
	for _, c := range cases {
		sig, err := s.finishSign(c.key, data, c.flags, nil, answer(c.sig), "Pixel 8")
		if c.ok != (err == nil) {
			t.Errorf("%s: %v", c.name, err)
		}
		if err == nil && sig.Format != c.sig.Format {
			t.Errorf("%s: format %s", c.name, sig.Format)
		}
	}
	if _, err := s.finishSign(edSigner.PublicKey(), data, 0, nil, &agentpb.SignResponse{
		Result: &agentpb.SignResponse_Signature{Signature: []byte("junk")},
	}, "Pixel 8"); err == nil {
		t.Error("accepted a malformed signature")
	}
}
