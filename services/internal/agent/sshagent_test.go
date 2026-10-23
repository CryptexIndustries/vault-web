package agent

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"testing"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

func testSessionBind(t *testing.T, forwarding bool) (ssh.Signer, []byte) {
	t.Helper()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	host, _ := ssh.NewSignerFromKey(priv)
	return host, hostBind(t, host, forwarding, false)
}

// hostBind is a session-bind body for host over a random session ID, with
// a broken signature if forged.
func hostBind(t *testing.T, host ssh.Signer, forwarding, forged bool) []byte {
	t.Helper()
	sid := make([]byte, 32)
	rand.Read(sid)
	sig, err := host.Sign(rand.Reader, sid)
	if err != nil {
		t.Fatal(err)
	}
	if forged {
		sig.Blob[0] ^= 1
	}
	return ssh.Marshal(struct {
		HostKey, SessionID, Signature []byte
		Forwarding                    bool
	}{host.PublicKey().Marshal(), sid, ssh.Marshal(sig), forwarding})
}

func TestSessionBindExtension(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	sess := &session{svc: &Service{}}
	go agent.ServeAgent(sess, server)
	ag := agent.NewClient(client)

	host, bind := testSessionBind(t, true)
	if _, err := ag.Extension(sessionBindExtension, bind); err != nil {
		t.Fatalf("valid bind: %v", err)
	}
	// ssh may repeat a bind; it's kept once.
	if _, err := ag.Extension(sessionBindExtension, bind); err != nil {
		t.Fatal(err)
	}
	if _, err := ag.Extension("query", nil); err != agent.ErrExtensionUnsupported {
		t.Fatalf("unknown extension: %v", err)
	}
	malformed := [][]byte{
		nil,
		append(bytes.Clone(bind), 0),            // trailing data
		bind[:len(bind)-1],                      // no forwarding flag
		ssh.Marshal(struct{ A, B, C []byte }{}), // empty fields
	}
	for i, m := range malformed {
		if _, err := ag.Extension(sessionBindExtension, m); err == nil || err == agent.ErrExtensionUnsupported {
			t.Errorf("malformed bind %d: %v", i, err)
		}
	}
	// A bind whose signature doesn't verify is refused and not kept.
	if _, err := ag.Extension(sessionBindExtension, hostBind(t, host, false, true)); err == nil {
		t.Error("took a session-bind with a forged signature")
	}
	if len(sess.binds) != 1 || !sess.binds[0].Forwarding || !bytes.Equal(sess.binds[0].HostKey, host.PublicKey().Marshal()) {
		t.Fatalf("binds = %v", sess.binds)
	}
	for i := len(sess.binds); i < maxSessionBinds; i++ {
		_, b := testSessionBind(t, false)
		if _, err := ag.Extension(sessionBindExtension, b); err != nil {
			t.Fatal(err)
		}
	}
	_, extra := testSessionBind(t, false)
	if _, err := ag.Extension(sessionBindExtension, extra); err == nil {
		t.Fatal("accepted more binds than OpenSSH sends")
	}

	// Key-holding operations are refused; the agent never has keys.
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	if err := ag.Add(agent.AddedKey{PrivateKey: priv}); err == nil {
		t.Error("Add worked")
	}
	if err := ag.RemoveAll(); err == nil {
		t.Error("RemoveAll worked")
	}
	if err := ag.Lock([]byte("x")); err == nil {
		t.Error("Lock worked")
	}
}

func TestKeyOrder(t *testing.T) {
	keys := []GrantedKey{{PublicKey: []byte("a")}, {PublicKey: []byte("b")}, {PublicKey: []byte("c")}}
	host, bind := testSessionBind(t, false)
	parsed, _ := parseSessionBind(bind)
	_, other := testSessionBind(t, false)
	otherParsed, _ := parseSessionBind(other)
	hosts := Hosts{ssh.FingerprintSHA256(host.PublicKey()): []byte("c")}
	order := func(binds ...*agentpb.SessionBind) string {
		var s string
		for _, k := range orderKeys(keys, binds, hosts) {
			s += string(k.PublicKey)
		}
		return s
	}
	if got := order(); got != "abc" {
		t.Errorf("no bind: %s", got)
	}
	if got := order(parsed); got != "cab" {
		t.Errorf("known host: %s", got)
	}
	// Only the last bind (the server being logged in to) counts.
	if got := order(parsed, otherParsed); got != "abc" {
		t.Errorf("unknown last host: %s", got)
	}
	if got := order(otherParsed, parsed); got != "cab" {
		t.Errorf("known last host: %s", got)
	}
	// Through a forwarded agent the last host is whatever the far side
	// says, so it doesn't reorder.
	_, fwd := testSessionBind(t, true)
	fwdParsed, _ := parseSessionBind(fwd)
	if got := order(fwdParsed, parsed); got != "abc" {
		t.Errorf("forwarded chain: %s", got)
	}
	if _, ok := lastHost([]*agentpb.SessionBind{fwdParsed, parsed}); ok {
		t.Error("a forwarded chain has a last host to remember")
	}
	if string(keys[0].PublicKey) != "a" {
		t.Error("orderKeys changed its input")
	}
}
