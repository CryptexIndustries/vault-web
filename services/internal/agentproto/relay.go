package agentproto

import (
	"crypto/ed25519"
	"encoding/binary"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

// authInput is what a client signs to prove its key to the relay. Binding the
// relay origin stops a malicious relay from passing another relay's challenge
// through.
func authInput(origin string, nonce []byte) []byte {
	out := []byte("cryptex-relay-auth/v1\x00")
	out = append(out, origin...)
	out = append(out, 0)
	return append(out, nonce...)
}

// SignAuth answers a relay Challenge.
func SignAuth(id *Identity, origin string, nonce []byte) []byte {
	return ed25519.Sign(id.Sign, authInput(origin, nonce))
}

// VerifyAuth checks an Auth signature.
func VerifyAuth(publicKey []byte, origin string, nonce, signature []byte) bool {
	return len(publicKey) == ed25519.PublicKeySize && len(signature) == ed25519.SignatureSize &&
		ed25519.Verify(publicKey, authInput(origin, nonce), signature)
}

// revokeInput is what a revocation key signs in a RevokeRequest. The relay
// origin is bound in, like in authInput, so a request made for one relay can't
// be replayed at another.
func revokeInput(origin string, agentKey []byte, issuedAtMillis int64) []byte {
	out := []byte("cryptex-relay-revoke/v1\x00")
	out = append(out, origin...)
	out = append(out, 0)
	out = append(out, agentKey...)
	return binary.BigEndian.AppendUint64(out, uint64(issuedAtMillis))
}

// SignRevoke builds a RevokeRequest signed with the agent's revocation key.
func SignRevoke(revocationKey ed25519.PrivateKey, origin string, agentKey []byte, issuedAtMillis int64) *agentpb.RevokeRequest {
	return &agentpb.RevokeRequest{
		AgentKey:  agentKey,
		IssuedAt:  issuedAtMillis,
		Signature: ed25519.Sign(revocationKey, revokeInput(origin, agentKey, issuedAtMillis)),
	}
}

// VerifyRevoke checks a RevokeRequest against the registered revocation key.
func VerifyRevoke(revocationKey []byte, origin string, req *agentpb.RevokeRequest) bool {
	return len(revocationKey) == ed25519.PublicKeySize && len(req.GetSignature()) == ed25519.SignatureSize &&
		ed25519.Verify(revocationKey, revokeInput(origin, req.GetAgentKey(), req.GetIssuedAt()), req.GetSignature())
}
