package agentproto

import (
	"crypto/ed25519"
	"crypto/rand"
	"testing"

	"golang.org/x/crypto/ssh"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

func TestVerifySessionBind(t *testing.T) {
	_, hk, _ := ed25519.GenerateKey(rand.Reader)
	host, _ := ssh.NewSignerFromKey(hk)
	_, ok, _ := ed25519.GenerateKey(rand.Reader)
	other, _ := ssh.NewSignerFromKey(ok)
	sid := []byte("0123456789abcdef0123456789abcdef")
	sig, _ := host.Sign(rand.Reader, sid)
	good := &agentpb.SessionBind{HostKey: host.PublicKey().Marshal(), SessionId: sid, Signature: ssh.Marshal(sig)}
	if err := VerifySessionBind(good); err != nil {
		t.Fatal(err)
	}
	bad := []*agentpb.SessionBind{
		{HostKey: other.PublicKey().Marshal(), SessionId: sid, Signature: good.Signature},
		{HostKey: good.HostKey, SessionId: []byte("another session"), Signature: good.Signature},
		{HostKey: good.HostKey, SessionId: sid, Signature: []byte("junk")},
		{HostKey: []byte("junk"), SessionId: sid, Signature: good.Signature},
		{},
	}
	for i, b := range bad {
		if VerifySessionBind(b) == nil {
			t.Errorf("bad bind %d verified", i)
		}
	}
}
