package approvertest

import (
	"bytes"
	"encoding/binary"
	"errors"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

// Kind is what a sign request's data is, as far as the approver can tell.
type Kind string

const (
	// KindUserauth is an SSH login (RFC 4252 publickey authentication).
	KindUserauth Kind = "userauth"
	// KindSSHSig is an SSHSIG signature (git commits, ssh-keygen -Y sign).
	KindSSHSig Kind = "sshsig"
	// KindOther is anything else; refused unless Options.AllowOther.
	KindOther Kind = "other"
)

const (
	msgUserauthRequest = 50
	sshsigMagic        = "SSHSIG"
	hostboundMethod    = "publickey-hostbound-v00@openssh.com"
)

var errInvalidData = errors.New("the signed data doesn't match the session-bind")

// wireReader reads SSH wire encoding (RFC 4251).
type wireReader struct {
	b  []byte
	ok bool
}

func (r *wireReader) byte() byte {
	if !r.ok || len(r.b) < 1 {
		r.ok = false
		return 0
	}
	v := r.b[0]
	r.b = r.b[1:]
	return v
}

func (r *wireReader) string() []byte {
	if !r.ok || len(r.b) < 4 {
		r.ok = false
		return nil
	}
	n := binary.BigEndian.Uint32(r.b)
	if uint64(n) > uint64(len(r.b)-4) {
		r.ok = false
		return nil
	}
	v := r.b[4 : 4+n]
	r.b = r.b[4+n:]
	return v
}

func (r *wireReader) done() bool { return r.ok && len(r.b) == 0 }

// classify works out what req signs and checks it the way the app must.
// A login names the key the request names. If ssh bound the connection, the
// login has to be for the session it bound last; a mismatch is a lie and an
// error. Without a bind (OpenSSH before 8.9, Paramiko, libssh2 and other
// clients never send one), or when the last bind comes through a forwarded
// agent, nothing says where the login goes: destUnknown is set and the app
// asks with a "destination unknown" warning, never from a remembered
// approval. namespace is the SSHSIG namespace.
func classify(req *agentpb.SignRequest) (kind Kind, namespace string, destUnknown bool, err error) {
	data := req.GetData()
	if rest, ok := bytes.CutPrefix(data, []byte(sshsigMagic)); ok {
		r := &wireReader{b: rest, ok: true}
		ns := r.string()
		r.string() // reserved
		hash := r.string()
		r.string() // H(message)
		if !r.done() || len(ns) == 0 || (string(hash) != "sha256" && string(hash) != "sha512") {
			return KindSSHSig, "", false, errors.New("malformed SSHSIG data")
		}
		return KindSSHSig, string(ns), false, nil
	}

	r := &wireReader{b: data, ok: true}
	sessionID := r.string()
	if r.byte() != msgUserauthRequest || !r.ok {
		return KindOther, "", false, nil
	}
	r.string() // user
	r.string() // service
	method := string(r.string())
	hasSig := r.byte()
	r.string() // algorithm
	key := r.string()
	var hostKey []byte
	if method == hostboundMethod {
		hostKey = r.string()
	}
	if !r.done() || (method != "publickey" && method != hostboundMethod) || hasSig != 1 {
		return KindUserauth, "", false, errors.New("malformed userauth data")
	}
	if !bytes.Equal(key, req.GetPublicKey()) {
		return KindUserauth, "", false, errInvalidData
	}

	binds := req.GetSessionBinds()
	if len(binds) == 0 || binds[len(binds)-1].GetForwarding() {
		return KindUserauth, "", true, nil
	}
	last := binds[len(binds)-1]
	if !bytes.Equal(sessionID, last.GetSessionId()) {
		return KindUserauth, "", false, errInvalidData
	}
	// The hostbound method names the server's key too; it has to be the
	// bound one.
	if hostKey != nil && !bytes.Equal(hostKey, last.GetHostKey()) {
		return KindUserauth, "", false, errInvalidData
	}
	return KindUserauth, "", false, nil
}
