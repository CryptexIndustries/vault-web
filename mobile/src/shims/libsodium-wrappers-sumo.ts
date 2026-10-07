/**
 * Mobile replacement for libsodium-wrappers-sumo (WASM).
 * - Argon2id / random: Quick Crypto (native OpenSSL)
 * - secretstream: sodium-javascript (pure JS, wire-compatible)
 */
import { argon2Sync, randomBytes } from "react-native-quick-crypto";
// CommonJS pure-JS secretstream (sodium-native API shape)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sj = require("sodium-javascript") as {
    crypto_secretstream_xchacha20poly1305_STATEBYTES: number;
    crypto_secretstream_xchacha20poly1305_ABYTES: number;
    crypto_secretstream_xchacha20poly1305_HEADERBYTES: number;
    crypto_secretstream_xchacha20poly1305_KEYBYTES: number;
    crypto_secretstream_xchacha20poly1305_TAG_MESSAGE: Uint8Array;
    crypto_secretstream_xchacha20poly1305_TAG_PUSH: Uint8Array;
    crypto_secretstream_xchacha20poly1305_TAG_REKEY: Uint8Array;
    crypto_secretstream_xchacha20poly1305_TAG_FINAL: Uint8Array;
    crypto_secretstream_xchacha20poly1305_keygen: (k: Uint8Array) => void;
    crypto_secretstream_xchacha20poly1305_init_push: (
        state: Uint8Array,
        header: Uint8Array,
        key: Uint8Array,
    ) => void;
    crypto_secretstream_xchacha20poly1305_init_pull: (
        state: Uint8Array,
        header: Uint8Array,
        key: Uint8Array,
    ) => void;
    crypto_secretstream_xchacha20poly1305_push: (
        state: Uint8Array,
        out: Uint8Array,
        message: Uint8Array,
        ad: Uint8Array | null,
        tag: Uint8Array,
    ) => number;
    crypto_secretstream_xchacha20poly1305_pull: (
        state: Uint8Array,
        message: Uint8Array,
        tag: Uint8Array,
        cipher: Uint8Array,
        ad: Uint8Array | null,
    ) => number;
};

/** SipHash key size; encryption.ts uses this as salt length for XChaCha blobs. */
export const crypto_shorthash_KEYBYTES = 16;

export const ready = Promise.resolve();
export const crypto_pwhash_ALG_ARGON2ID13 = 2;
export const crypto_pwhash_SALTBYTES = 16;

// Only the byte-input/output API used by vault-core is supported here.
export function crypto_pwhash(
    keyLength: number,
    password: Uint8Array,
    salt: Uint8Array,
    opsLimit: number,
    memLimit: number,
    algorithm: number,
): Uint8Array {
    if (
        algorithm !== crypto_pwhash_ALG_ARGON2ID13 ||
        salt.byteLength !== crypto_pwhash_SALTBYTES ||
        !Number.isSafeInteger(keyLength) ||
        keyLength < 16 ||
        !Number.isSafeInteger(memLimit) ||
        memLimit < 8192
    ) {
        throw new RangeError("Invalid Argon2id parameters");
    }
    // Match libsodium: Argon2 v1.3, one lane, memory bytes rounded down to KiB.
    // Quick Crypto validates the remaining Argon2 bounds before native allocation.
    const result = argon2Sync("argon2id", {
        message: password,
        nonce: salt,
        parallelism: 1,
        tagLength: keyLength,
        memory: Math.floor(memLimit / 1024),
        passes: opsLimit,
        version: 0x13,
    });
    // Keep Uint8Array semantics, including copying .slice(), without a key copy.
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
}

export function randombytes_buf(length: number): Uint8Array {
    const result = randomBytes(length);
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
}

export const crypto_secretstream_xchacha20poly1305_KEYBYTES =
    sj.crypto_secretstream_xchacha20poly1305_KEYBYTES;
export const crypto_secretstream_xchacha20poly1305_HEADERBYTES =
    sj.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
export const crypto_secretstream_xchacha20poly1305_ABYTES =
    sj.crypto_secretstream_xchacha20poly1305_ABYTES;
export const crypto_secretstream_xchacha20poly1305_TAG_MESSAGE =
    sj.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE[0];
export const crypto_secretstream_xchacha20poly1305_TAG_PUSH =
    sj.crypto_secretstream_xchacha20poly1305_TAG_PUSH[0];
export const crypto_secretstream_xchacha20poly1305_TAG_REKEY =
    sj.crypto_secretstream_xchacha20poly1305_TAG_REKEY[0];
export const crypto_secretstream_xchacha20poly1305_TAG_FINAL =
    sj.crypto_secretstream_xchacha20poly1305_TAG_FINAL[0];

function tagByte(tag: number | Uint8Array): Uint8Array {
    if (typeof tag === "number") return new Uint8Array([tag]);
    return tag;
}

export function crypto_secretstream_xchacha20poly1305_keygen(): Uint8Array {
    const key = new Uint8Array(
        sj.crypto_secretstream_xchacha20poly1305_KEYBYTES,
    );
    sj.crypto_secretstream_xchacha20poly1305_keygen(key);
    return key;
}

/** libsodium-wrappers shape: returns { state, header }. */
export function crypto_secretstream_xchacha20poly1305_init_push(
    key: Uint8Array,
): { state: Uint8Array; header: Uint8Array } {
    const state = new Uint8Array(
        sj.crypto_secretstream_xchacha20poly1305_STATEBYTES,
    );
    const header = new Uint8Array(
        sj.crypto_secretstream_xchacha20poly1305_HEADERBYTES,
    );
    sj.crypto_secretstream_xchacha20poly1305_init_push(state, header, key);
    return { state, header };
}

/** libsodium-wrappers shape: returns state. */
export function crypto_secretstream_xchacha20poly1305_init_pull(
    header: Uint8Array,
    key: Uint8Array,
): Uint8Array {
    const state = new Uint8Array(
        sj.crypto_secretstream_xchacha20poly1305_STATEBYTES,
    );
    sj.crypto_secretstream_xchacha20poly1305_init_pull(state, header, key);
    return state;
}

/** libsodium-wrappers shape: returns ciphertext Uint8Array. */
export function crypto_secretstream_xchacha20poly1305_push(
    state: Uint8Array,
    message: Uint8Array,
    ad: Uint8Array | null,
    tag: number | Uint8Array,
): Uint8Array {
    const out = new Uint8Array(
        message.byteLength + sj.crypto_secretstream_xchacha20poly1305_ABYTES,
    );
    sj.crypto_secretstream_xchacha20poly1305_push(
        state,
        out,
        message,
        ad,
        tagByte(tag),
    );
    return out;
}

/**
 * libsodium-wrappers shape: returns { message, tag } or false on auth failure.
 */
export function crypto_secretstream_xchacha20poly1305_pull(
    state: Uint8Array,
    cipher: Uint8Array,
    ad: Uint8Array | null = null,
): { message: Uint8Array; tag: number } | false {
    if (cipher.byteLength < sj.crypto_secretstream_xchacha20poly1305_ABYTES) {
        return false;
    }
    const message = new Uint8Array(
        cipher.byteLength - sj.crypto_secretstream_xchacha20poly1305_ABYTES,
    );
    const tag = new Uint8Array(1);
    try {
        sj.crypto_secretstream_xchacha20poly1305_pull(
            state,
            message,
            tag,
            cipher,
            ad,
        );
        return { message, tag: tag[0]! };
    } catch {
        return false;
    }
}

const sodium = {
    ready,
    crypto_pwhash,
    crypto_pwhash_ALG_ARGON2ID13,
    crypto_pwhash_SALTBYTES,
    randombytes_buf,
    crypto_shorthash_KEYBYTES,
    crypto_secretstream_xchacha20poly1305_KEYBYTES,
    crypto_secretstream_xchacha20poly1305_HEADERBYTES,
    crypto_secretstream_xchacha20poly1305_ABYTES,
    crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
    crypto_secretstream_xchacha20poly1305_TAG_PUSH,
    crypto_secretstream_xchacha20poly1305_TAG_REKEY,
    crypto_secretstream_xchacha20poly1305_TAG_FINAL,
    crypto_secretstream_xchacha20poly1305_keygen,
    crypto_secretstream_xchacha20poly1305_init_push,
    crypto_secretstream_xchacha20poly1305_init_pull,
    crypto_secretstream_xchacha20poly1305_push,
    crypto_secretstream_xchacha20poly1305_pull,
};

export default sodium;
