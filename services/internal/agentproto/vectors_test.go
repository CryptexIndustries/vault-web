package agentproto

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
)

// Cross-language vectors. Go writes testdata/go-vectors.json, the vault-core
// Jest suite writes testdata/ts-vectors.json, and both suites check both
// files. Regenerate the Go file with:
//
//	go test ./internal/agentproto -run TestVectors -update
var update = flag.Bool("update", false, "rewrite testdata/go-vectors.json")

type vectorSeeds struct {
	SignSeed []byte `json:"signSeed"`
	KEMSeed  []byte `json:"kemSeed"`
}

type vectorEnvelope struct {
	Name     string `json:"name"`
	From     string `json:"from"`
	Envelope []byte `json:"envelope"`
	Message  []byte `json:"message"`
	// Set on PairingAccept envelopes.
	PairingSecret    []byte `json:"pairingSecret,omitempty"`
	PairingOfferHash []byte `json:"pairingOfferHash,omitempty"`
}

type vectorFile struct {
	Now            int64            `json:"now"`
	Agent          vectorSeeds      `json:"agent"`
	Approver       vectorSeeds      `json:"approver"`
	RevocationSeed []byte           `json:"revocationSeed"`
	Envelopes      []vectorEnvelope `json:"envelopes"`
	PairingCode    struct {
		Text string `json:"text"`
		Code []byte `json:"code"`
	} `json:"pairingCode"`
	Offer []byte `json:"offer"`
	// ConfirmationCode for the pairing code's offer hash and the approver's keys.
	ConfirmationCode string `json:"confirmationCode"`
	Auth             struct {
		Origin    string `json:"origin"`
		Nonce     []byte `json:"nonce"`
		Signature []byte `json:"signature"`
	} `json:"auth"`
	Revoke []byte `json:"revoke"`
}

// Both generators use these inputs, so deterministic outputs (signatures,
// pairing code, offer hash) must match byte for byte.
var vectorNow = time.UnixMilli(1_800_000_000_000)

func seed(label string) []byte {
	sum := sha256.Sum256([]byte("cryptex-agent vectors " + label))
	return sum[:]
}

func vectorIdentity(t *testing.T, s vectorSeeds) *Identity {
	t.Helper()
	id, err := IdentityFromSeeds(s.SignSeed, s.KEMSeed)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func peerOf(id *Identity) Peer {
	return Peer{SignPublicKey: id.ID(), KEMPublicKey: id.KEMPublicKey()}
}

func vectorOffer(agent *Identity) *agentpb.PairingOffer {
	return &agentpb.PairingOffer{
		ProtocolVersion: Version,
		SignPublicKey:   agent.ID(),
		KemPublicKey:    agent.KEMPublicKey(),
		Hostname:        "arch-desktop",
		Os:              "linux",
		Arch:            "amd64",
		AgentVersion:    "0.1.0",
	}
}

func generateGoVectors(t *testing.T) vectorFile {
	t.Helper()
	var f vectorFile
	f.Now = vectorNow.UnixMilli()
	f.Agent = vectorSeeds{seed("agent sign"), seed("agent kem")}
	f.Approver = vectorSeeds{seed("approver sign"), seed("approver kem")}
	f.RevocationSeed = seed("revocation")
	agent := vectorIdentity(t, f.Agent)
	approver := vectorIdentity(t, f.Approver)

	offer, err := proto.Marshal(vectorOffer(agent))
	if err != nil {
		t.Fatal(err)
	}
	f.Offer = offer
	code := &agentpb.PairingCode{
		Version:   Version,
		RelayUrl:  "https://relay.cryptex-vault.com",
		SlotId:    seed("slot")[:16],
		Secret:    seed("pairing secret"),
		OfferHash: OfferHash(offer),
	}
	f.PairingCode.Code, _ = proto.Marshal(code)
	f.PairingCode.Text, err = FormatPairingCode(code)
	if err != nil {
		t.Fatal(err)
	}

	add := func(name, from string, sender *Identity, to Peer, msg *agentpb.Message, opts SealOptions) {
		env, err := Seal(sender, to, msg, opts)
		if err != nil {
			t.Fatal(err)
		}
		v := vectorEnvelope{Name: name, From: from, Envelope: mustMarshal(t, env), Message: mustMarshal(t, msg)}
		if opts.Pairing != nil {
			v.PairingSecret, v.PairingOfferHash = opts.Pairing.Secret, opts.Pairing.OfferHash
		}
		f.Envelopes = append(f.Envelopes, v)
	}
	request := &agentpb.Message{Body: &agentpb.Message_SignRequest{SignRequest: &agentpb.SignRequest{
		PublicKey: []byte("ssh-ed25519 public key blob"),
		Data:      []byte("userauth request bytes"),
		Flags:     4,
		Processes: []*agentpb.Process{
			{Pid: 4242, Uid: 1000, Exe: "/usr/bin/ssh", Args: []string{"ssh", "nas.lan"}, Cwd: "/home/ana"},
			{Pid: 4100, Uid: 1000, Exe: "/usr/bin/zsh", Args: []string{"-zsh"}},
		},
		SessionBinds: []*agentpb.SessionBind{{HostKey: []byte("host key"), SessionId: []byte("session"), Signature: []byte("sig"), Forwarding: true}},
		Hostname:     "arch-desktop",
	}}}
	add("sign request", "agent", agent, peerOf(approver), request, SealOptions{ExpiresAt: vectorNow.Add(time.Minute)})
	add("sign response", "approver", approver, peerOf(agent),
		&agentpb.Message{Body: &agentpb.Message_SignResponse{SignResponse: &agentpb.SignResponse{
			Result: &agentpb.SignResponse_Signature{Signature: []byte("ssh signature blob")},
		}}},
		SealOptions{ExpiresAt: vectorNow.Add(time.Minute), InReplyTo: seed("request id")[:16]})
	add("refusal", "approver", approver, peerOf(agent),
		&agentpb.Message{Body: &agentpb.Message_SignResponse{SignResponse: &agentpb.SignResponse{
			Result: &agentpb.SignResponse_Refusal{Refusal: agentpb.RefusalReason_REFUSAL_REASON_DENIED},
		}}},
		SealOptions{ExpiresAt: vectorNow.Add(time.Minute), InReplyTo: seed("request id")[:16]})
	add("keys update", "approver", approver, peerOf(agent),
		&agentpb.Message{Body: &agentpb.Message_KeysUpdate{KeysUpdate: &agentpb.KeysUpdate{
			Keys:      []*agentpb.GrantedKey{{PublicKey: []byte("key one"), Comment: "GitHub (Cryptex Vault)"}},
			Revision:  7,
			AgentName: "workstation",
		}}},
		SealOptions{ExpiresAt: vectorNow.Add(7 * 24 * time.Hour), Retain: true})
	add("pairing accept", "approver", approver, peerOf(agent),
		&agentpb.Message{Body: &agentpb.Message_PairingAccept{PairingAccept: &agentpb.PairingAccept{
			ApproverSignPublicKey: approver.ID(),
			ApproverKemPublicKey:  approver.KEMPublicKey(),
			ApproverName:          "Pixel 8",
			AgentName:             "workstation",
			Keys:                  []*agentpb.GrantedKey{{PublicKey: []byte("key one"), Comment: "GitHub (Cryptex Vault)"}},
			KeysRevision:          1,
			RelayToken:            "self-hosted token",
		}}},
		SealOptions{ExpiresAt: vectorNow.Add(time.Minute), Pairing: &PairingBinding{Secret: code.Secret, OfferHash: code.OfferHash}})

	f.ConfirmationCode = ConfirmationCode(code.OfferHash, approver.ID(), approver.KEMPublicKey())
	f.Auth.Origin = "https://relay.cryptex-vault.com"
	f.Auth.Nonce = seed("nonce")
	f.Auth.Signature = SignAuth(agent, f.Auth.Origin, f.Auth.Nonce)
	f.Revoke = mustMarshal(t, SignRevoke(ed25519.NewKeyFromSeed(f.RevocationSeed), f.Auth.Origin, agent.ID(), f.Now))
	return f
}

func mustMarshal(t *testing.T, m proto.Message) []byte {
	t.Helper()
	b, err := proto.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestVectors(t *testing.T) {
	goPath := filepath.Join("testdata", "go-vectors.json")
	if *update {
		raw, err := json.MarshalIndent(generateGoVectors(t), "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(goPath, append(raw, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{goPath, filepath.Join("testdata", "ts-vectors.json")} {
		t.Run(filepath.Base(path), func(t *testing.T) {
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var f vectorFile
			if err := json.Unmarshal(raw, &f); err != nil {
				t.Fatal(err)
			}
			checkVectors(t, f)
		})
	}
}

func checkVectors(t *testing.T, f vectorFile) {
	now := time.UnixMilli(f.Now)
	agent := vectorIdentity(t, f.Agent)
	approver := vectorIdentity(t, f.Approver)

	if len(f.Envelopes) == 0 {
		t.Fatal("no envelopes")
	}
	for _, v := range f.Envelopes {
		var env agentpb.Envelope
		if err := proto.Unmarshal(v.Envelope, &env); err != nil {
			t.Fatalf("%s: %v", v.Name, err)
		}
		var want agentpb.Message
		if err := proto.Unmarshal(v.Message, &want); err != nil {
			t.Fatalf("%s: %v", v.Name, err)
		}
		var got *agentpb.Message
		switch {
		case v.PairingSecret != nil:
			accept, peer, err := OpenPairingAccept(agent, PairingBinding{Secret: v.PairingSecret, OfferHash: v.PairingOfferHash}, &env, now)
			if err != nil {
				t.Fatalf("%s: %v", v.Name, err)
			}
			if string(peer.SignPublicKey) != string(approver.ID()) {
				t.Fatalf("%s: approver key not pinned", v.Name)
			}
			got = &agentpb.Message{Body: &agentpb.Message_PairingAccept{PairingAccept: accept}}
		default:
			to, from := agent, approver
			if v.From == "agent" {
				to, from = approver, agent
			}
			opened, err := Open(to, peerOf(from), &env, now)
			if err != nil {
				t.Fatalf("%s: %v", v.Name, err)
			}
			got = opened.Message
		}
		if !proto.Equal(got, &want) {
			t.Fatalf("%s: got %v, want %v", v.Name, got, &want)
		}
	}

	var code agentpb.PairingCode
	if err := proto.Unmarshal(f.PairingCode.Code, &code); err != nil {
		t.Fatal(err)
	}
	parsed, err := ParsePairingCode(f.PairingCode.Text)
	if err != nil || !proto.Equal(parsed, &code) {
		t.Fatalf("pairing code: %v %v", parsed, err)
	}
	if text, _ := FormatPairingCode(&code); text != f.PairingCode.Text {
		t.Fatalf("pairing code text %q, want %q", text, f.PairingCode.Text)
	}
	offer, err := ParseOffer(f.Offer, code.OfferHash)
	if err != nil || !proto.Equal(offer, vectorOffer(agent)) {
		t.Fatalf("offer: %v %v", offer, err)
	}

	if got := ConfirmationCode(code.OfferHash, approver.ID(), approver.KEMPublicKey()); got != f.ConfirmationCode {
		t.Fatalf("confirmation code %q, want %q", got, f.ConfirmationCode)
	}
	if got := SignAuth(agent, f.Auth.Origin, f.Auth.Nonce); string(got) != string(f.Auth.Signature) {
		t.Fatal("auth signature differs")
	}
	var revoke agentpb.RevokeRequest
	if err := proto.Unmarshal(f.Revoke, &revoke); err != nil {
		t.Fatal(err)
	}
	revocationKey := ed25519.NewKeyFromSeed(f.RevocationSeed)
	if !VerifyRevoke(revocationKey.Public().(ed25519.PublicKey), f.Auth.Origin, &revoke) ||
		string(revoke.AgentKey) != string(agent.ID()) || revoke.IssuedAt != f.Now {
		t.Fatal("revoke request does not verify")
	}
	if want := SignRevoke(revocationKey, f.Auth.Origin, agent.ID(), f.Now); !proto.Equal(want, &revoke) {
		t.Fatal("revoke signature differs")
	}
}
