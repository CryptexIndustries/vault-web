import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { expand, extract } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { ml_kem768_x25519 } from "@noble/post-quantum/hybrid.js";

/**
 * Single-shot HPKE (RFC 9180) base mode with one fixed suite:
 * MLKEM768-X25519 (X-Wing, KEM 0x647a), HKDF-SHA256 (0x0001) and
 * ChaCha20-Poly1305 (0x0003). Matches Go's crypto/hpke with
 * hpke.MLKEM768X25519(), HKDFSHA256() and ChaCha20Poly1305() for the first
 * Seal/Open of a context, which is all the agent protocol uses.
 */

const encoder = new TextEncoder();

const SUITE_ID = concatBytes(
    encoder.encode("HPKE"),
    new Uint8Array([0x64, 0x7a, 0x00, 0x01, 0x00, 0x03]),
);
const VERSION_LABEL = encoder.encode("HPKE-v1");
const MODE_BASE = 0;
const KEY_SIZE = 32;
const NONCE_SIZE = 12;

export const KEM_PUBLIC_KEY_SIZE = ml_kem768_x25519.lengths.publicKey!;
export const KEM_SEED_SIZE = ml_kem768_x25519.lengths.secretKey!;
export const KEM_ENCAPSULATED_KEY_SIZE = ml_kem768_x25519.lengths.cipherText!;

export function kemPublicKeyFromSeed(seed: Uint8Array): Uint8Array {
    return ml_kem768_x25519.getPublicKey(seed);
}

export function generateKemSeed(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(KEM_SEED_SIZE));
}

export function hpkeSeal(
    recipientPublicKey: Uint8Array,
    info: Uint8Array,
    aad: Uint8Array,
    plaintext: Uint8Array,
): { encapsulatedKey: Uint8Array; ciphertext: Uint8Array } {
    const { cipherText, sharedSecret } =
        ml_kem768_x25519.encapsulate(recipientPublicKey);
    const { key, nonce } = keySchedule(sharedSecret, info);
    return {
        encapsulatedKey: cipherText,
        ciphertext: chacha20poly1305(key, nonce, aad).encrypt(plaintext),
    };
}

/** Throws when the ciphertext doesn't authenticate. */
export function hpkeOpen(
    recipientSeed: Uint8Array,
    encapsulatedKey: Uint8Array,
    info: Uint8Array,
    aad: Uint8Array,
    ciphertext: Uint8Array,
): Uint8Array {
    if (encapsulatedKey.length !== KEM_ENCAPSULATED_KEY_SIZE) {
        throw new Error("Invalid encapsulated key");
    }
    const sharedSecret = ml_kem768_x25519.decapsulate(
        encapsulatedKey,
        recipientSeed,
    );
    const { key, nonce } = keySchedule(sharedSecret, info);
    return chacha20poly1305(key, nonce, aad).decrypt(ciphertext);
}

function keySchedule(
    sharedSecret: Uint8Array,
    info: Uint8Array,
): { key: Uint8Array; nonce: Uint8Array } {
    const empty = new Uint8Array(0);
    const pskIdHash = labeledExtract(empty, "psk_id_hash", empty);
    const infoHash = labeledExtract(empty, "info_hash", info);
    const context = concatBytes(
        new Uint8Array([MODE_BASE]),
        pskIdHash,
        infoHash,
    );
    const secret = labeledExtract(sharedSecret, "secret", empty);
    return {
        key: labeledExpand(secret, "key", context, KEY_SIZE),
        // Sequence number 0, so the nonce is base_nonce itself.
        nonce: labeledExpand(secret, "base_nonce", context, NONCE_SIZE),
    };
}

function labeledExtract(
    salt: Uint8Array,
    label: string,
    ikm: Uint8Array,
): Uint8Array {
    return extract(
        sha256,
        concatBytes(VERSION_LABEL, SUITE_ID, encoder.encode(label), ikm),
        salt,
    );
}

function labeledExpand(
    prk: Uint8Array,
    label: string,
    info: Uint8Array,
    length: number,
): Uint8Array {
    const labeledInfo = concatBytes(
        new Uint8Array([length >> 8, length & 0xff]),
        VERSION_LABEL,
        SUITE_ID,
        encoder.encode(label),
        info,
    );
    return expand(sha256, prk, labeledInfo, length);
}
