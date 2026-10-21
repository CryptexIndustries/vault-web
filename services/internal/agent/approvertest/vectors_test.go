package approvertest

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"flag"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agent/termsafe"
	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

// Request-check vectors for the TypeScript approver
// (packages/vault-core/src/agent/request-check.ts). Go writes
// testdata/request-vectors.json with what this package decides for each
// request; the Jest suite agent-request-check.test.ts must decide the same.
// Regenerate with:
//
//	go test ./internal/agent/approvertest -run TestRequestVectors -update-vectors
var updateVectors = flag.Bool("update-vectors", false, "rewrite testdata/request-vectors.json")

const vectorsFile = "testdata/request-vectors.json"

// Caps the TypeScript side applies to strings from the agent machine.
const (
	hostNameLength = 255
	maxHostNames   = 16
)

type vectorHost struct {
	Fingerprint string   `json:"fingerprint"`
	Names       []string `json:"names"`
}

type requestVector struct {
	Name    string `json:"name"`
	Request []byte `json:"request"`
	// Invalid means the approver refuses REFUSAL_REASON_INVALID.
	Invalid            bool         `json:"invalid"`
	Kind               string       `json:"kind,omitempty"`
	Namespace          string       `json:"namespace,omitempty"`
	User               string       `json:"user,omitempty"`
	DestinationUnknown bool         `json:"destinationUnknown"`
	VerifiedHost       *vectorHost  `json:"verifiedHost,omitempty"`
	ForwardedVia       []vectorHost `json:"forwardedVia"`
}

// expectVector is what the app shows for req, derived from classify and
// VerifySessionBind.
func expectVector(name string, req *agentpb.SignRequest) requestVector {
	raw, _ := proto.Marshal(req)
	v := requestVector{Name: name, Request: raw, ForwardedVia: []vectorHost{}}
	for _, b := range req.SessionBinds {
		if agentproto.VerifySessionBind(b) != nil {
			v.Invalid = true
			return v
		}
	}
	kind, namespace, unknown, err := classify(req)
	if err != nil {
		v.Invalid = true
		return v
	}
	v.DestinationUnknown = unknown
	hosts := make([]vectorHost, len(req.SessionBinds))
	for i, b := range req.SessionBinds {
		hosts[i] = hostOf(b)
	}
	switch kind {
	case KindSSHSig:
		v.Kind, v.Namespace = "signature", termsafe.Name(namespace)
	case KindOther:
		v.Kind = "other"
	case KindUserauth:
		v.Kind, v.User = "login", termsafe.Name(userOf(req.Data))
		if !unknown {
			last := hosts[len(hosts)-1]
			v.VerifiedHost = &last
			hosts = hosts[:len(hosts)-1]
		}
	}
	v.ForwardedVia = append(v.ForwardedVia, hosts...)
	return v
}

func hostOf(b *agentpb.SessionBind) vectorHost {
	key, _ := ssh.ParsePublicKey(b.HostKey)
	// ssh-keygen -l fingerprints a certificate by the key it certifies.
	if cert, ok := key.(*ssh.Certificate); ok {
		key = cert.Key
	}
	names := []string{}
	for i, n := range b.HostNames {
		if i == maxHostNames {
			break
		}
		names = append(names, termsafe.String(n, hostNameLength))
	}
	return vectorHost{Fingerprint: ssh.FingerprintSHA256(key), Names: names}
}

func userOf(data []byte) string {
	r := &wireReader{b: data, ok: true}
	r.string()
	r.byte()
	return string(r.string())
}

type hostSigner struct {
	signer ssh.Signer
	algo   string // "" for the key's default
}

func (h hostSigner) sign(t *testing.T, sid []byte) *ssh.Signature {
	t.Helper()
	var sig *ssh.Signature
	var err error
	if h.algo != "" {
		sig, err = h.signer.(ssh.AlgorithmSigner).SignWithAlgorithm(rand.Reader, sid, h.algo)
	} else {
		sig, err = h.signer.Sign(rand.Reader, sid)
	}
	if err != nil {
		t.Fatal(err)
	}
	return sig
}

func vectorBind(t *testing.T, h hostSigner, sid []byte, forwarding bool, names ...string) *agentpb.SessionBind {
	t.Helper()
	return &agentpb.SessionBind{
		HostKey:    h.signer.PublicKey().Marshal(),
		SessionId:  sid,
		Signature:  ssh.Marshal(h.sign(t, sid)),
		Forwarding: forwarding,
		HostNames:  names,
	}
}

func signerOf(t *testing.T, key any) ssh.Signer {
	t.Helper()
	s, err := ssh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func login(sid []byte, user string, key []byte, hostKey []byte) []byte {
	if hostKey == nil {
		return ssh.Marshal(struct {
			SessionID             []byte
			Type                  byte
			User, Service, Method string
			HasSig                bool
			Algo                  string
			Key                   []byte
		}{sid, msgUserauthRequest, user, "ssh-connection", "publickey", true, "ssh-ed25519", key})
	}
	return ssh.Marshal(struct {
		SessionID             []byte
		Type                  byte
		User, Service, Method string
		HasSig                bool
		Algo                  string
		Key, HostKey          []byte
	}{sid, msgUserauthRequest, user, "ssh-connection", hostboundMethod, true, "ssh-ed25519", key, hostKey})
}

func generateRequestVectors(t *testing.T) []requestVector {
	t.Helper()
	_, edKey, _ := ed25519.GenerateKey(rand.Reader)
	ed := hostSigner{signer: signerOf(t, edKey)}
	ec := map[string]hostSigner{}
	ecKeys := map[string]*ecdsa.PrivateKey{}
	for name, curve := range map[string]elliptic.Curve{"p256": elliptic.P256(), "p384": elliptic.P384(), "p521": elliptic.P521()} {
		k, err := ecdsa.GenerateKey(curve, rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		ecKeys[name] = k
		ec[name] = hostSigner{signer: signerOf(t, k)}
	}
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	rsaSigner := signerOf(t, rsaKey)
	rsa256 := hostSigner{signer: rsaSigner, algo: ssh.KeyAlgoRSASHA256}
	rsa512 := hostSigner{signer: rsaSigner, algo: ssh.KeyAlgoRSASHA512}
	rsa1 := hostSigner{signer: rsaSigner, algo: ssh.KeyAlgoRSA}

	userKey := newSigner(t).PublicKey().Marshal()
	otherKey := newSigner(t).PublicKey().Marshal()
	sid := []byte("session id of the login, 32 byte")
	jumpSID := []byte("session id of the first hop, 32b")

	var out []requestVector
	add := func(name string, data []byte, key []byte, binds ...*agentpb.SessionBind) {
		out = append(out, expectVector(name, &agentpb.SignRequest{
			PublicKey: key, Data: data, Flags: 0, SessionBinds: binds, Hostname: "arch-desktop",
		}))
	}
	direct := func(h hostSigner, names ...string) *agentpb.SessionBind {
		return vectorBind(t, h, sid, false, names...)
	}

	add("login, ed25519 host", login(sid, "git", userKey, nil), userKey, direct(ed, "github.com", "140.82.121.4"))
	add("hostbound login, ecdsa p256 host", login(sid, "ana", userKey, ec["p256"].signer.PublicKey().Marshal()), userKey, direct(ec["p256"], "nas.lan"))
	add("login, ecdsa p384 host", login(sid, "ana", userKey, nil), userKey, direct(ec["p384"]))
	add("login, ecdsa p521 host", login(sid, "ana", userKey, nil), userKey, direct(ec["p521"]))
	add("login, rsa-sha2-256 host", login(sid, "root", userKey, nil), userKey, direct(rsa256))
	add("login, rsa-sha2-512 host", login(sid, "root", userKey, nil), userKey, direct(rsa512))
	add("login, ssh-rsa (SHA-1) host signature", login(sid, "root", userKey, nil), userKey, direct(rsa1))

	// x/crypto/ssh pads RSA signatures that lost their leading zero bytes.
	for i := 0; ; i++ {
		shortSID := []byte(strings.Repeat("s", 31) + string(rune('a'+i%26)) + strings.Repeat("x", i/26))
		sig := rsa512.sign(t, shortSID)
		if sig.Blob[0] != 0 {
			continue
		}
		sig.Blob = sig.Blob[1:]
		b := &agentpb.SessionBind{HostKey: rsaSigner.PublicKey().Marshal(), SessionId: shortSID, Signature: ssh.Marshal(sig)}
		add("rsa signature missing its leading zero", login(shortSID, "root", userKey, nil), userKey, b)
		long := rsa512.sign(t, shortSID)
		long.Blob = append([]byte{0}, long.Blob...)
		b = &agentpb.SessionBind{HostKey: rsaSigner.PublicKey().Marshal(), SessionId: shortSID, Signature: ssh.Marshal(long)}
		add("rsa signature longer than the key", login(shortSID, "root", userKey, nil), userKey, b)
		break
	}

	// Go accepts high-S ECDSA signatures.
	{
		sig := ec["p256"].sign(t, sid)
		var rs struct{ R, S *big.Int }
		if err := ssh.Unmarshal(sig.Blob, &rs); err != nil {
			t.Fatal(err)
		}
		rs.S = new(big.Int).Sub(ecKeys["p256"].Curve.Params().N, rs.S)
		sig.Blob = ssh.Marshal(rs)
		b := &agentpb.SessionBind{HostKey: ec["p256"].signer.PublicKey().Marshal(), SessionId: sid, Signature: ssh.Marshal(sig)}
		add("ecdsa signature with the other S", login(sid, "ana", userKey, nil), userKey, b)
		rs.R = big.NewInt(0)
		sig.Blob = ssh.Marshal(rs)
		b = &agentpb.SessionBind{HostKey: b.HostKey, SessionId: sid, Signature: ssh.Marshal(sig)}
		add("ecdsa signature with r = 0", login(sid, "ana", userKey, nil), userKey, b)
	}

	// Host certificates verify with the certified key.
	certHost := func(name string, hostKey ssh.Signer, ca ssh.Signer) {
		cert := &ssh.Certificate{
			Key: hostKey.PublicKey(), CertType: ssh.HostCert, KeyId: "host",
			ValidPrincipals: []string{"build.example.com"}, ValidBefore: ssh.CertTimeInfinity,
			Permissions: ssh.Permissions{Extensions: map[string]string{"a": "", "b": "x"}},
		}
		if err := cert.SignCert(rand.Reader, ca); err != nil {
			t.Fatal(err)
		}
		certSigner, err := ssh.NewCertSigner(cert, hostKey)
		if err != nil {
			t.Fatal(err)
		}
		add(name, login(sid, "ci", userKey, nil), userKey, vectorBind(t, hostSigner{signer: certSigner}, sid, false, "build.example.com"))
	}
	certHost("ed25519 host certificate", ed.signer, newSigner(t))
	certHost("ecdsa host certificate signed by an rsa ca", ec["p384"].signer, rsaSigner)

	jumpBind := vectorBind(t, ec["p256"], jumpSID, true, "jump.example.com")
	add("second hop through a forwarded agent", login(sid, "ana", userKey, nil), userKey, jumpBind, direct(ed, "inner.lan"))
	add("login without a bind", login(sid, "ana", userKey, nil), userKey)
	add("last bind forwarding", login(sid, "ana", userKey, nil), userKey, vectorBind(t, ed, sid, true, "jump.example.com"))
	add("unbound login with another key", login(sid, "ana", otherKey, nil), userKey)
	add("other session", login(jumpSID, "ana", userKey, nil), userKey, direct(ed))
	add("session of an earlier bind", login(jumpSID, "ana", userKey, nil), userKey, jumpBind, direct(ed))
	add("other key in the data", login(sid, "ana", otherKey, nil), userKey, direct(ed))
	add("hostbound to another host", login(sid, "ana", userKey, rsaSigner.PublicKey().Marshal()), userKey, direct(ed))
	add("trailing userauth data", append(login(sid, "ana", userKey, nil), 0), userKey, direct(ed))
	add("userauth cut short", login(sid, "ana", userKey, nil)[:60], userKey, direct(ed))
	{
		data := login(sid, "ana", userKey, nil)
		// has-signature is the byte before the algorithm string.
		i := len(data) - (4 + len("ssh-ed25519")) - (4 + len(userKey)) - 1
		noSig := append([]byte{}, data...)
		noSig[i] = 0
		add("userauth without the signature flag", noSig, userKey, direct(ed))
	}
	add("userauth with another method", ssh.Marshal(struct {
		SessionID             []byte
		Type                  byte
		User, Service, Method string
	}{sid, msgUserauthRequest, "ana", "ssh-connection", "password"}), userKey, direct(ed))

	add("git signature through a forwarded agent", sshsig("git", "sha512"), userKey, jumpBind)
	add("file signature", sshsig("file", "sha256"), userKey)
	add("sshsig without a namespace", sshsig("", "sha512"), userKey)
	add("sshsig with an odd hash", sshsig("git", "md5"), userKey)
	add("sshsig with trailing data", append(sshsig("git", "sha512"), 1), userKey)
	add("other data", []byte("x"), userKey)
	add("empty data", nil, userKey)
	add("other data with a bind", []byte("not a login"), userKey, direct(ed))

	// Binds that don't verify make every request invalid.
	wrongSID := vectorBind(t, ed, jumpSID, false)
	wrongSID.SessionId = sid
	add("bind signed over another session", login(sid, "ana", userKey, nil), userKey, wrongSID)
	wrongKey := direct(ed)
	wrongKey.HostKey = ec["p256"].signer.PublicKey().Marshal()
	add("bind with another host key", login(sid, "ana", userKey, nil), userKey, wrongKey)
	formatMismatch := direct(rsa512)
	var sig ssh.Signature
	_ = ssh.Unmarshal(formatMismatch.Signature, &sig)
	sig.Format = "ssh-ed25519"
	formatMismatch.Signature = ssh.Marshal(sig)
	add("bind signature of another type", login(sid, "ana", userKey, nil), userKey, formatMismatch)
	junk := direct(ed)
	junk.Signature = []byte("junk")
	add("bind with a junk signature", sshsig("git", "sha512"), userKey, junk)
	trailing := direct(ed)
	trailing.HostKey = append(trailing.HostKey, 0)
	add("bind host key with trailing data", []byte("x"), userKey, trailing)
	compressed := direct(ec["p256"])
	pub := ecKeys["p256"].PublicKey
	compressed.HostKey = ssh.Marshal(struct {
		Name, Curve string
		Key         []byte
	}{
		"ecdsa-sha2-nistp256", "nistp256", elliptic.MarshalCompressed(pub.Curve, pub.X, pub.Y)})
	add("bind with a compressed ecdsa point", login(sid, "ana", userKey, nil), userKey, compressed)
	add("bind with no host key", login(sid, "ana", userKey, nil), userKey, &agentpb.SessionBind{SessionId: sid})
	sigRest := direct(ed)
	sigRest.Signature = append(sigRest.Signature, 9, 9)
	add("bind signature with trailing data", login(sid, "ana", userKey, nil), userKey, sigRest)

	// Strings from the machine are made safe to show.
	add("control characters in the user", login(sid, "git\x1b[2J\u202e", userKey, nil), userKey, direct(ed))
	manyNames := []string{"evil\u202egnp.exe", strings.Repeat("a", 300)}
	for i := range 20 {
		manyNames = append(manyNames, "host"+string(rune('a'+i)))
	}
	add("unsafe and too many host names", login(sid, "ana", userKey, nil), userKey, direct(ed, manyNames...))
	add("long namespace", sshsig(strings.Repeat("n", 100), "sha512"), userKey)
	return out
}

func TestRequestVectors(t *testing.T) {
	if *updateVectors {
		vectors := generateRequestVectors(t)
		data, err := json.MarshalIndent(map[string]any{"cases": vectors}, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(vectorsFile), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(vectorsFile, append(data, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(vectorsFile)
	if err != nil {
		t.Fatalf("%v (regenerate with -update-vectors)", err)
	}
	var file struct {
		Cases []requestVector `json:"cases"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Cases) < 40 {
		t.Fatalf("only %d vectors", len(file.Cases))
	}
	for _, want := range file.Cases {
		var req agentpb.SignRequest
		if err := proto.Unmarshal(want.Request, &req); err != nil {
			t.Fatalf("%s: %v", want.Name, err)
		}
		got := expectVector(want.Name, &req)
		gotJSON, _ := json.Marshal(got)
		wantJSON, _ := json.Marshal(want)
		if string(gotJSON) != string(wantJSON) {
			t.Errorf("%s:\n got %s\nwant %s", want.Name, gotJSON, wantJSON)
		}
	}
}
