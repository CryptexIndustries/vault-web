import { ed25519 } from "@noble/curves/ed25519.js";
import { p256, p384, p521 } from "@noble/curves/nist.js";

import { uint8ToBase64Url } from "../encoding";
import {
    bigIntToBytes,
    bytesEqual,
    bytesToBigInt,
    SSHWriter,
} from "../internal/ssh/wire";
import type { SSHKeyData } from "../proto/vault";
import { readStoredSSHPrivateKey, type SSHPrivateKeyMaterial } from "./ssh-key";
import { SSH_AGENT_RSA_SHA2_256, SSH_AGENT_RSA_SHA2_512 } from "./ssh-key-info";

/**
 * Signs for cryptex-agent with a stored SSH key item, producing the SSH wire
 * signature ssh-agent would return (RFC 4253 section 6.6, RFC 8332, RFC 5656).
 * Ed25519 and ECDSA use noble; RSA uses WebCrypto (the browser, or
 * react-native-quick-crypto on Android) because BigInt RSA is slow on Hermes.
 */

export class SSHSignError extends Error {}

/** signal aborted (the vault started locking): no signature is made. */
export class SSHSignAbortedError extends SSHSignError {
    constructor() {
        super("Signing was cancelled");
    }
}

export type SignOptions = { signal?: AbortSignal };

const checkSignal = (signal?: AbortSignal) => {
    if (signal?.aborted) throw new SSHSignAbortedError();
};

const ECDSA = {
    nistp256: { curve: p256, size: 32 },
    nistp384: { curve: p384, size: 48 },
    nistp521: { curve: p521, size: 66 },
} as const;

/**
 * Signs data with key, which must be the key whose public blob the request
 * names. Returns the SSH wire signature (algorithm name and signature blob).
 * Throws SSHSignAbortedError once options.signal aborts, also between RSA
 * key import and signing.
 */
export const signSSH = async (
    key: SSHKeyData,
    publicBlob: Uint8Array,
    data: Uint8Array,
    flags: number,
    options: SignOptions = {},
): Promise<Uint8Array> => {
    checkSignal(options.signal);
    const stored = readStoredSSHPrivateKey(key);
    if (!bytesEqual(stored.publicBlob, publicBlob)) {
        throw new SSHSignError("The request names a different key");
    }
    return signWith(stored.key, data, flags, options.signal);
};

const signWith = async (
    key: SSHPrivateKeyMaterial,
    data: Uint8Array,
    flags: number,
    signal?: AbortSignal,
): Promise<Uint8Array> => {
    switch (key.algorithm) {
        case "ssh-ed25519":
            return wireSignature(key.algorithm, ed25519.sign(data, key.seed));
        case "ssh-rsa":
            return signRSA(key, data, flags, signal);
        default: {
            const { curve, size } = ECDSA[key.curve];
            // noble hashes with the curve's hash (SHA-256/384/512), which is
            // what each ecdsa-sha2-nistpN algorithm uses.
            const compact = curve.sign(data, bigIntToBytes(key.d, size));
            const r = bytesToBigInt(compact.subarray(0, size));
            const s = bytesToBigInt(compact.subarray(size));
            const blob = new SSHWriter().mpint(r).mpint(s).toBytes();
            return wireSignature(key.algorithm, blob);
        }
    }
};

const signRSA = async (
    key: Extract<SSHPrivateKeyMaterial, { algorithm: "ssh-rsa" }>,
    data: Uint8Array,
    flags: number,
    signal?: AbortSignal,
): Promise<Uint8Array> => {
    // ssh-agent picks SHA-512 when both flags are set.
    const [algorithm, hash] =
        flags & SSH_AGENT_RSA_SHA2_512
            ? ["rsa-sha2-512", "SHA-512"]
            : flags & SSH_AGENT_RSA_SHA2_256
              ? ["rsa-sha2-256", "SHA-256"]
              : ["ssh-rsa", "SHA-1"];
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new SSHSignError("RSA signing isn't available here");
    const b64 = (value: bigint) => uint8ToBase64Url(bigIntToBytes(value));
    const cryptoKey = await subtle.importKey(
        "jwk",
        {
            kty: "RSA",
            n: b64(key.n),
            e: b64(key.e),
            d: b64(key.d),
            p: b64(key.p),
            q: b64(key.q),
            dp: b64(key.d % (key.p - 1n)),
            dq: b64(key.d % (key.q - 1n)),
            qi: b64(key.iqmp),
        },
        { name: "RSASSA-PKCS1-v1_5", hash },
        false,
        ["sign"],
    );
    // The import is asynchronous (native on Android): look again first.
    checkSignal(signal);
    const signature = new Uint8Array(
        await subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new Uint8Array(data)),
    );
    return wireSignature(algorithm, signature);
};

const wireSignature = (algorithm: string, blob: Uint8Array): Uint8Array =>
    new SSHWriter().string(algorithm).string(blob).toBytes();
