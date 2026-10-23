/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64ToUint8, uint8ToBase64 } from "../encoding";
import {
    Envelope,
    EnvelopeHeader,
    Message,
    PairingCode,
    PairingOffer,
    RefusalReason,
    RevokeRequest,
    type SignResponse,
} from "../proto/agent";
import {
    envelopeSigningInput,
    identityId,
    identityPeer,
    InvalidEnvelopeError,
    openEnvelope,
    sealEnvelope,
    sealPairingAccept,
    type AgentIdentity,
    type PairingBinding,
} from "../agent/envelope";
import {
    formatPairingCode,
    offerHash,
    parsePairingCode,
    parsePairingOffer,
    confirmationCode,
    revokeInput,
    signRelayAuth,
    signRevoke,
} from "../agent/pairing";

// Cross-language vectors shared with services/internal/agentproto. Go writes
// go-vectors.json, this suite writes ts-vectors.json, and both suites check
// both files. Regenerate this side with:
//   UPDATE_AGENT_VECTORS=1 pnpm jest packages/vault-core/src/tests/agent-protocol.test.ts
const TESTDATA = join(
    __dirname,
    "../../../../services/internal/agentproto/testdata",
);

type Seeds = { signSeed: string; kemSeed: string };
type VectorEnvelope = {
    name: string;
    from: "agent" | "approver";
    envelope: string;
    message: string;
    pairingSecret?: string;
    pairingOfferHash?: string;
};
type VectorFile = {
    now: number;
    agent: Seeds;
    approver: Seeds;
    revocationSeed: string;
    envelopes: VectorEnvelope[];
    pairingCode: { text: string; code: string };
    offer: string;
    confirmationCode: string;
    auth: { origin: string; nonce: string; signature: string };
    revoke: string;
};

// Same inputs as the Go generator, so deterministic outputs match exactly.
const NOW = 1_800_000_000_000;
const seed = (label: string) =>
    sha256(new TextEncoder().encode(`cryptex-agent vectors ${label}`));
const b64 = uint8ToBase64;
const bytes = base64ToUint8;
const text = (value: string) => new TextEncoder().encode(value);

function identity(seeds: Seeds): AgentIdentity {
    return { signSeed: bytes(seeds.signSeed), kemSeed: bytes(seeds.kemSeed) };
}

function vectorOffer(agent: AgentIdentity): PairingOffer {
    const peer = identityPeer(agent);
    return {
        protocolVersion: 1,
        signPublicKey: peer.signPublicKey,
        kemPublicKey: peer.kemPublicKey,
        hostname: "arch-desktop",
        os: "linux",
        arch: "amd64",
        agentVersion: "0.1.0",
    };
}

function generateTsVectors(): VectorFile {
    const agentSeeds = {
        signSeed: b64(seed("agent sign")),
        kemSeed: b64(seed("agent kem")),
    };
    const approverSeeds = {
        signSeed: b64(seed("approver sign")),
        kemSeed: b64(seed("approver kem")),
    };
    const agent = identity(agentSeeds);
    const approver = identity(approverSeeds);
    const offer = PairingOffer.encode(vectorOffer(agent)).finish();
    const code: PairingCode = {
        version: 1,
        relayUrl: "https://relay.cryptex-vault.com",
        slotId: seed("slot").slice(0, 16),
        secret: seed("pairing secret"),
        offerHash: offerHash(offer),
    };
    const envelopes: VectorEnvelope[] = [];
    const add = (
        name: string,
        from: "agent" | "approver",
        envelope: Envelope,
        message: Message,
        pairing?: PairingBinding,
    ) =>
        envelopes.push({
            name,
            from,
            envelope: b64(Envelope.encode(envelope).finish()),
            message: b64(Message.encode(message).finish()),
            ...(pairing && {
                pairingSecret: b64(pairing.secret),
                pairingOfferHash: b64(pairing.offerHash),
            }),
        });

    const request: Message = {
        body: {
            $case: "signRequest",
            signRequest: {
                publicKey: text("ssh-ed25519 public key blob"),
                data: text("userauth request bytes"),
                flags: 4,
                processes: [
                    {
                        pid: 4242,
                        uid: 1000,
                        exe: "/usr/bin/ssh",
                        args: ["ssh", "nas.lan"],
                        cwd: "/home/ana",
                    },
                ],
                sessionBinds: [
                    {
                        hostKey: text("host key"),
                        sessionId: text("session"),
                        signature: text("sig"),
                        forwarding: false,
                        hostNames: [],
                    },
                ],
                hostname: "arch-desktop",
            },
        },
    };
    add(
        "sign request",
        "agent",
        sealEnvelope(agent, identityPeer(approver), request, {
            expiresAt: NOW + 60_000,
        }),
        request,
    );
    const reply = (result: SignResponse["result"]): Message => ({
        body: { $case: "signResponse", signResponse: { result } },
    });
    const replies: [string, Message][] = [
        [
            "sign response",
            reply({
                $case: "signature",
                signature: text("ssh signature blob"),
            }),
        ],
        [
            "refusal",
            reply({
                $case: "refusal",
                refusal: RefusalReason.REFUSAL_REASON_KEY_NOT_GRANTED,
            }),
        ],
    ];
    for (const [name, message] of replies)
        add(
            name,
            "approver",
            sealEnvelope(approver, identityPeer(agent), message, {
                expiresAt: NOW + 60_000,
                inReplyTo: seed("request id").slice(0, 16),
            }),
            message,
        );
    const keysUpdate: Message = {
        body: {
            $case: "keysUpdate",
            keysUpdate: {
                keys: [
                    {
                        publicKey: text("key two"),
                        comment: "Homelab (Cryptex Vault)",
                    },
                ],
                revision: 3,
                agentName: "build-box",
            },
        },
    };
    add(
        "keys update",
        "approver",
        sealEnvelope(approver, identityPeer(agent), keysUpdate, {
            expiresAt: NOW + 7 * 24 * 60 * 60 * 1000,
            retain: true,
        }),
        keysUpdate,
    );
    const approverPeer = identityPeer(approver);
    const accept = {
        approverSignPublicKey: approverPeer.signPublicKey,
        approverKemPublicKey: approverPeer.kemPublicKey,
        approverName: "Web dashboard",
        agentName: "workstation",
        keys: [
            { publicKey: text("key one"), comment: "GitHub (Cryptex Vault)" },
        ],
        keysRevision: 1,
        relayToken: "",
    };
    const binding: PairingBinding = {
        secret: code.secret,
        offerHash: code.offerHash,
    };
    add(
        "pairing accept",
        "approver",
        sealPairingAccept(
            approver,
            identityPeer(agent),
            binding,
            accept,
            NOW + 60_000,
        ),
        { body: { $case: "pairingAccept", pairingAccept: accept } },
        binding,
    );

    const origin = "https://relay.cryptex-vault.com";
    const nonce = seed("nonce");
    return {
        now: NOW,
        agent: agentSeeds,
        approver: approverSeeds,
        revocationSeed: b64(seed("revocation")),
        envelopes,
        pairingCode: {
            text: formatPairingCode(code),
            code: b64(PairingCode.encode(code).finish()),
        },
        offer: b64(offer),
        confirmationCode: confirmationCode(
            code.offerHash,
            approverPeer.signPublicKey,
            approverPeer.kemPublicKey,
        ),
        auth: {
            origin,
            nonce: b64(nonce),
            signature: b64(signRelayAuth(agent, origin, nonce)),
        },
        revoke: b64(
            RevokeRequest.encode(
                signRevoke(seed("revocation"), origin, identityId(agent), NOW),
            ).finish(),
        ),
    };
}

if (process.env.UPDATE_AGENT_VECTORS === "1") {
    writeFileSync(
        join(TESTDATA, "ts-vectors.json"),
        JSON.stringify(generateTsVectors(), null, 2) + "\n",
    );
}

function readVectors(name: string): VectorFile {
    return JSON.parse(readFileSync(join(TESTDATA, name), "utf8")) as VectorFile;
}

describe.each(["go-vectors.json", "ts-vectors.json"])(
    "agent protocol vectors in %s",
    (file) => {
        const f = readVectors(file);
        const agent = identity(f.agent);
        const approver = identity(f.approver);

        it("opens every envelope sealed for an approver or agent", () => {
            const envelopes = f.envelopes.filter((v) => !v.pairingSecret);
            expect(envelopes.length).toBeGreaterThan(0);
            for (const v of envelopes) {
                const [to, from] =
                    v.from === "agent" ? [approver, agent] : [agent, approver];
                const opened = openEnvelope(
                    to,
                    identityPeer(from),
                    Envelope.decode(bytes(v.envelope)),
                    f.now,
                );
                expect(opened.message).toEqual(
                    Message.decode(bytes(v.message)),
                );
            }
        });

        it("parses and re-encodes the pairing code and offer", () => {
            const code = parsePairingCode(f.pairingCode.text);
            expect(code).toEqual(PairingCode.decode(bytes(f.pairingCode.code)));
            expect(formatPairingCode(code)).toBe(f.pairingCode.text);
            expect(parsePairingOffer(bytes(f.offer), code.offerHash)).toEqual(
                vectorOffer(agent),
            );
            const approverPeer = identityPeer(approver);
            expect(
                confirmationCode(
                    code.offerHash,
                    approverPeer.signPublicKey,
                    approverPeer.kemPublicKey,
                ),
            ).toBe(f.confirmationCode);
        });

        it("produces the same relay auth and revoke signatures", () => {
            expect(
                b64(signRelayAuth(agent, f.auth.origin, bytes(f.auth.nonce))),
            ).toBe(f.auth.signature);
            const revoke = RevokeRequest.decode(bytes(f.revoke));
            expect(revoke).toEqual(
                signRevoke(
                    bytes(f.revocationSeed),
                    f.auth.origin,
                    identityId(agent),
                    f.now,
                ),
            );
            expect(
                ed25519.verify(
                    revoke.signature,
                    revokeInput(
                        f.auth.origin,
                        revoke.agentKey,
                        revoke.issuedAt,
                    ),
                    ed25519.getPublicKey(bytes(f.revocationSeed)),
                ),
            ).toBe(true);
        });
    },
);

describe("agent envelopes", () => {
    const agent = { signSeed: seed("agent sign"), kemSeed: seed("agent kem") };
    const approver = {
        signSeed: seed("approver sign"),
        kemSeed: seed("approver kem"),
    };
    const message: Message = {
        body: {
            $case: "pairingConfirm",
            pairingConfirm: { agentVersion: "0.1.0" },
        },
    };
    const sealed = () =>
        sealEnvelope(agent, identityPeer(approver), message, {
            expiresAt: NOW + 60_000,
        });
    const open = (envelope: Envelope, now = NOW) =>
        openEnvelope(approver, identityPeer(agent), envelope, now);

    it("refuses tampered parts", () => {
        for (const part of [
            "header",
            "encapsulatedKey",
            "ciphertext",
            "signature",
        ] as const) {
            const envelope = sealed();
            const tampered = envelope[part].slice();
            tampered[tampered.length - 1]! ^= 1;
            expect(() => open({ ...envelope, [part]: tampered })).toThrow(
                InvalidEnvelopeError,
            );
        }
    });

    it("refuses envelopes from anyone but the pinned peer", () => {
        const stranger = {
            signSeed: seed("stranger sign"),
            kemSeed: seed("stranger kem"),
        };
        const envelope = sealEnvelope(
            stranger,
            identityPeer(approver),
            message,
            {
                expiresAt: NOW + 60_000,
            },
        );
        expect(() => open(envelope)).toThrow(InvalidEnvelopeError);
        // Sealed to someone else: wrong recipient even with a valid signature.
        const elsewhere = sealEnvelope(agent, identityPeer(stranger), message, {
            expiresAt: NOW + 60_000,
        });
        expect(() => open(elsewhere)).toThrow(InvalidEnvelopeError);
    });

    it("refuses expired envelopes and deadlines past the protocol limit", () => {
        expect(() => open(sealed(), NOW + 60_000 + 30_000)).toThrow(
            new InvalidEnvelopeError("expired"),
        );
        const tooLong = sealEnvelope(agent, identityPeer(approver), message, {
            expiresAt: NOW + 10 * 60_000,
        });
        expect(() => open(tooLong)).toThrow(
            new InvalidEnvelopeError("invalid"),
        );
        const retained = sealEnvelope(agent, identityPeer(approver), message, {
            expiresAt: NOW + 10 * 60_000,
            retain: true,
        });
        expect(open(retained).header.retain).toBe(true);
    });

    it("never opens a pairing envelope as an ordinary message", () => {
        const envelope = sealPairingAccept(
            approver,
            identityPeer(agent),
            { secret: seed("secret"), offerHash: seed("offer") },
            {
                approverSignPublicKey: identityId(approver),
                approverKemPublicKey: identityPeer(approver).kemPublicKey,
                approverName: "",
                agentName: "",
                keys: [],
                keysRevision: 0,
                relayToken: "",
            },
            NOW + 60_000,
        );
        expect(() =>
            openEnvelope(agent, identityPeer(approver), envelope, NOW),
        ).toThrow(InvalidEnvelopeError);
        expect(() =>
            openEnvelope(
                agent,
                identityPeer(approver),
                { ...envelope, pairingMac: new Uint8Array(0) },
                NOW,
            ),
        ).toThrow(InvalidEnvelopeError);
    });

    it("binds the ciphertext to the header", () => {
        const envelope = sealed();
        const header = EnvelopeHeader.decode(envelope.header);
        // The sender re-signs a changed header; decryption must still fail
        // because the header is the AEAD's associated data.
        const changed = {
            ...envelope,
            header: EnvelopeHeader.encode({
                ...header,
                expiresAt: header.expiresAt + 1,
            }).finish(),
        };
        changed.signature = ed25519.sign(
            envelopeSigningInput(changed),
            agent.signSeed,
        );
        expect(() => open(changed)).toThrow(InvalidEnvelopeError);
    });
});

describe("pairing codes", () => {
    it("refuses other QR codes and offers that don't match the hash", () => {
        expect(() => parsePairingCode("https://example.com")).toThrow(
            "Invalid pairing code",
        );
        expect(() => parsePairingCode("cryptex-pair:not base64!")).toThrow(
            "Invalid pairing code",
        );
        const f = readVectors("go-vectors.json");
        const offer = bytes(f.offer);
        expect(() => parsePairingOffer(offer, sha256(text("other")))).toThrow(
            "Invalid pairing code",
        );
        // Pasted codes often carry whitespace.
        expect(parsePairingCode(`  ${f.pairingCode.text}\n`)).toEqual(
            PairingCode.decode(bytes(f.pairingCode.code)),
        );
    });
});
