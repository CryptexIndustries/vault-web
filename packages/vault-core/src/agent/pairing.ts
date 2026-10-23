import { ed25519 } from "@noble/curves/ed25519.js";
import { equalBytes } from "@noble/curves/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { base64UrlToUint8, uint8ToBase64Url } from "../encoding";
import { PairingCode, PairingOffer, RevokeRequest } from "../proto/agent";
import {
    PROTOCOL_VERSION,
    SIGN_PUBLIC_KEY_SIZE,
    type AgentIdentity,
} from "./envelope";
import { KEM_PUBLIC_KEY_SIZE } from "./hpke";

/**
 * Pairing codes and relay signatures. Byte-compatible with
 * services/internal/agentproto/pairing.go and relay.go.
 */

/** Starts every pairing code, in the QR code and when pasted. */
export const PAIRING_CODE_PREFIX = "cryptex-pair:";
export const MAX_OFFER_SIZE = 4096;
/** Size of the one-time secret in a pairing code. */
const SECRET_SIZE = 32;

const encoder = new TextEncoder();

export class InvalidPairingCodeError extends Error {
    constructor() {
        super("Invalid pairing code");
    }
}

export function formatPairingCode(code: PairingCode): string {
    return (
        PAIRING_CODE_PREFIX +
        uint8ToBase64Url(PairingCode.encode(code).finish())
    );
}

/** Surrounding whitespace is ignored because people paste the code. */
export function parsePairingCode(text: string): PairingCode {
    const trimmed = text.trim();
    if (!trimmed.startsWith(PAIRING_CODE_PREFIX)) {
        throw new InvalidPairingCodeError();
    }
    let code: PairingCode;
    try {
        code = PairingCode.decode(
            base64UrlToUint8(trimmed.slice(PAIRING_CODE_PREFIX.length)),
        );
    } catch {
        throw new InvalidPairingCodeError();
    }
    if (
        code.version !== PROTOCOL_VERSION ||
        code.relayUrl === "" ||
        code.slotId.length === 0 ||
        code.secret.length !== SECRET_SIZE ||
        code.offerHash.length !== sha256.outputLen
    ) {
        throw new InvalidPairingCodeError();
    }
    return code;
}

export function offerHash(offer: Uint8Array): Uint8Array {
    return sha256(offer);
}

/** Decodes a slot's offer after checking it against the code's hash. */
export function parsePairingOffer(
    offer: Uint8Array,
    expectedHash: Uint8Array,
): PairingOffer {
    if (
        offer.length > MAX_OFFER_SIZE ||
        !equalBytes(offerHash(offer), expectedHash)
    ) {
        throw new InvalidPairingCodeError();
    }
    let parsed: PairingOffer;
    try {
        parsed = PairingOffer.decode(offer);
    } catch {
        throw new InvalidPairingCodeError();
    }
    if (
        parsed.protocolVersion !== PROTOCOL_VERSION ||
        parsed.signPublicKey.length !== SIGN_PUBLIC_KEY_SIZE ||
        parsed.kemPublicKey.length !== KEM_PUBLIC_KEY_SIZE
    ) {
        throw new InvalidPairingCodeError();
    }
    return parsed;
}

/**
 * What a client signs to answer a relay Challenge. The relay origin is bound
 * in so a malicious relay can't pass another relay's challenge through.
 */
export function relayAuthInput(origin: string, nonce: Uint8Array): Uint8Array {
    return concatBytes(
        encoder.encode("cryptex-relay-auth/v1\x00"),
        encoder.encode(origin),
        new Uint8Array([0]),
        nonce,
    );
}

export function signRelayAuth(
    identity: AgentIdentity,
    origin: string,
    nonce: Uint8Array,
): Uint8Array {
    return ed25519.sign(relayAuthInput(origin, nonce), identity.signSeed);
}

/**
 * What a revocation key signs. The relay origin is bound in, as in
 * relayAuthInput, so a request made for one relay can't be replayed at another.
 */
export function revokeInput(
    origin: string,
    agentKey: Uint8Array,
    issuedAt: number,
): Uint8Array {
    const time = new Uint8Array(8);
    new DataView(time.buffer).setBigUint64(0, BigInt(issuedAt));
    return concatBytes(
        encoder.encode("cryptex-relay-revoke/v1\x00"),
        encoder.encode(origin),
        new Uint8Array([0]),
        agentKey,
        time,
    );
}

/** Body of POST /v1/revoke, signed with the agent's revocation key seed. */
export function signRevoke(
    revocationSeed: Uint8Array,
    origin: string,
    agentKey: Uint8Array,
    issuedAt = Date.now(),
): RevokeRequest {
    return {
        agentKey,
        issuedAt,
        signature: ed25519.sign(
            revokeInput(origin, agentKey, issuedAt),
            revocationSeed,
        ),
    };
}

// Crockford's base32: no I, L, O or U, so the code is easy to compare.
const CONFIRMATION_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * The short code ("4F7K-2Q9M") the agent's terminal and the approver both show
 * after the approver answers. The user checks they match, which shows the
 * agent paired with this device and not with someone who saw the QR code
 * first. Same as ConfirmationCode in services/internal/agentproto.
 */
export function confirmationCode(
    offerHash: Uint8Array,
    approverSignPublicKey: Uint8Array,
    approverKemPublicKey: Uint8Array,
): string {
    const sum = sha256(
        concatBytes(
            encoder.encode("cryptex-agent/v1 confirmation code\x00"),
            offerHash,
            approverSignPublicKey,
            approverKemPublicKey,
        ),
    );
    let bits = 0n;
    for (const byte of sum.subarray(0, 5)) bits = (bits << 8n) | BigInt(byte);
    let out = "";
    for (let i = 7; i >= 0; i--) {
        out += CONFIRMATION_ALPHABET[Number((bits >> BigInt(5 * i)) & 31n)];
        if (i === 4) out += "-";
    }
    return out;
}
