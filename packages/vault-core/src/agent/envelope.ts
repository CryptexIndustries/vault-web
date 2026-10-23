import { ed25519 } from "@noble/curves/ed25519.js";
import { equalBytes } from "@noble/curves/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import {
    Envelope,
    EnvelopeHeader,
    Message,
    type PairingAccept,
} from "../proto/agent";
import {
    generateKemSeed,
    hpkeOpen,
    hpkeSeal,
    kemPublicKeyFromSeed,
} from "./hpke";

/**
 * Envelopes between an agent and its approver. Byte-compatible with
 * services/internal/agentproto/envelope.go; the vectors in
 * services/internal/agentproto/testdata check both directions.
 */

export const PROTOCOL_VERSION = 1;
export const MESSAGE_ID_SIZE = 16;
/** Ed25519 public keys identify agents and approvers on the relay. */
export const SIGN_PUBLIC_KEY_SIZE = 32;
const SIGNATURE_SIZE = 64;
/** Largest serialized Envelope the relay accepts (STATUS_TOO_LARGE beyond). */
export const MAX_ENVELOPE_SIZE = 64 * 1024;
/** How long a sign request waits for an answer. */
export const REQUEST_LIFETIME_MS = 90_000;
/** Cap for retained envelopes such as KeysUpdate. */
export const MAX_RETAIN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/** Tolerated difference between agent, relay and approver clocks. */
export const CLOCK_SKEW_MS = 30_000;

const encoder = new TextEncoder();
const MESSAGE_INFO = encoder.encode("cryptex-agent/v1 message");
const PAIRING_INFO = encoder.encode("cryptex-agent/v1 pairing");
const PAIRING_MAC_INFO = encoder.encode("cryptex-agent/v1 pairing mac");
const ENVELOPE_CONTEXT = encoder.encode("cryptex-agent/v1 envelope\x00");

/** Long-term keys, stored as two 32-byte seeds. */
export type AgentIdentity = {
    signSeed: Uint8Array;
    kemSeed: Uint8Array;
};

/** The other side, as pinned at pairing. */
export type AgentPeer = {
    signPublicKey: Uint8Array;
    kemPublicKey: Uint8Array;
};

/** Ties the PairingAccept envelope to one pairing code. */
export type PairingBinding = {
    secret: Uint8Array;
    offerHash: Uint8Array;
};

export class InvalidEnvelopeError extends Error {
    constructor(readonly reason: "invalid" | "expired" = "invalid") {
        super(reason === "expired" ? "Envelope expired" : "Invalid envelope");
    }
}

export function generateAgentIdentity(): AgentIdentity {
    return {
        signSeed: ed25519.utils.randomSecretKey(),
        kemSeed: generateKemSeed(),
    };
}

/** The Ed25519 public key, which identifies the client on the relay. */
export function identityId(identity: AgentIdentity): Uint8Array {
    return ed25519.getPublicKey(identity.signSeed);
}

export function identityPeer(identity: AgentIdentity): AgentPeer {
    return {
        signPublicKey: identityId(identity),
        kemPublicKey: kemPublicKeyFromSeed(identity.kemSeed),
    };
}

export type SealOptions = {
    expiresAt: number;
    inReplyTo?: Uint8Array;
    retain?: boolean;
};

export function sealEnvelope(
    from: AgentIdentity,
    to: AgentPeer,
    message: Message,
    options: SealOptions,
): Envelope {
    return seal(from, to, message, options, MESSAGE_INFO, undefined);
}

/** The answer to a pairing code, sealed by the approver to the agent. */
export function sealPairingAccept(
    approver: AgentIdentity,
    agent: AgentPeer,
    binding: PairingBinding,
    accept: PairingAccept,
    expiresAt: number,
): Envelope {
    return seal(
        approver,
        agent,
        { body: { $case: "pairingAccept", pairingAccept: accept } },
        { expiresAt },
        concatBytes(PAIRING_INFO, binding.offerHash),
        binding,
    );
}

function seal(
    from: AgentIdentity,
    to: AgentPeer,
    message: Message,
    options: SealOptions,
    info: Uint8Array,
    pairing: PairingBinding | undefined,
): Envelope {
    const header = EnvelopeHeader.encode({
        version: PROTOCOL_VERSION,
        sender: identityId(from),
        recipient: to.signPublicKey,
        messageId: crypto.getRandomValues(new Uint8Array(MESSAGE_ID_SIZE)),
        inReplyTo: options.inReplyTo ?? new Uint8Array(0),
        expiresAt: options.expiresAt,
        retain: options.retain ?? false,
    }).finish();
    const { encapsulatedKey, ciphertext } = hpkeSeal(
        to.kemPublicKey,
        info,
        header,
        Message.encode(message).finish(),
    );
    const envelope: Envelope = {
        header,
        encapsulatedKey,
        ciphertext,
        signature: new Uint8Array(0),
        pairingMac: new Uint8Array(0),
    };
    const input = envelopeSigningInput(envelope);
    envelope.signature = ed25519.sign(input, from.signSeed);
    if (pairing) {
        envelope.pairingMac = pairingTag(pairing, input);
    }
    return envelope;
}

/** Decodes an envelope's header and checks its shape. */
export function parseEnvelopeHeader(envelope: Envelope): EnvelopeHeader {
    let header: EnvelopeHeader;
    try {
        header = EnvelopeHeader.decode(envelope.header);
    } catch {
        throw new InvalidEnvelopeError();
    }
    if (
        header.version !== PROTOCOL_VERSION ||
        header.sender.length !== SIGN_PUBLIC_KEY_SIZE ||
        header.recipient.length !== SIGN_PUBLIC_KEY_SIZE ||
        header.messageId.length !== MESSAGE_ID_SIZE ||
        (header.inReplyTo.length !== 0 &&
            header.inReplyTo.length !== MESSAGE_ID_SIZE) ||
        header.expiresAt <= 0
    ) {
        throw new InvalidEnvelopeError();
    }
    return header;
}

/**
 * Verifies an envelope from the pinned peer and decrypts it. Callers still
 * refuse message IDs they have already seen until the envelope expires.
 */
export function openEnvelope(
    to: AgentIdentity,
    from: AgentPeer,
    envelope: Envelope,
    now = Date.now(),
): { header: EnvelopeHeader; message: Message } {
    const header = parseEnvelopeHeader(envelope);
    if (
        !equalBytes(header.sender, from.signPublicKey) ||
        !equalBytes(header.recipient, identityId(to)) ||
        envelope.pairingMac.length !== 0 ||
        envelope.signature.length !== SIGNATURE_SIZE ||
        !ed25519.verify(
            envelope.signature,
            envelopeSigningInput(envelope),
            header.sender,
            { zip215: false },
        )
    ) {
        throw new InvalidEnvelopeError();
    }
    checkExpiry(header, now);
    let message: Message;
    try {
        message = Message.decode(
            hpkeOpen(
                to.kemSeed,
                envelope.encapsulatedKey,
                MESSAGE_INFO,
                envelope.header,
                envelope.ciphertext,
            ),
        );
    } catch {
        throw new InvalidEnvelopeError();
    }
    return { header, message };
}

function checkExpiry(header: EnvelopeHeader, now: number): void {
    const limit = header.retain ? MAX_RETAIN_LIFETIME_MS : REQUEST_LIFETIME_MS;
    if (header.expiresAt + CLOCK_SKEW_MS <= now) {
        throw new InvalidEnvelopeError("expired");
    }
    if (header.expiresAt > now + limit + CLOCK_SKEW_MS) {
        throw new InvalidEnvelopeError();
    }
}

/**
 * What the envelope signature and pairing MAC cover: a context string, then
 * header, encapsulated key and ciphertext, each with a 4-byte big-endian
 * length.
 */
export function envelopeSigningInput(envelope: Envelope): Uint8Array {
    const parts: Uint8Array[] = [ENVELOPE_CONTEXT];
    for (const part of [
        envelope.header,
        envelope.encapsulatedKey,
        envelope.ciphertext,
    ]) {
        const length = new Uint8Array(4);
        new DataView(length.buffer).setUint32(0, part.length);
        parts.push(length, part);
    }
    return concatBytes(...parts);
}

function pairingTag(binding: PairingBinding, input: Uint8Array): Uint8Array {
    const key = hkdf(
        sha256,
        binding.secret,
        binding.offerHash,
        PAIRING_MAC_INFO,
        32,
    );
    return hmac(sha256, key, input);
}
