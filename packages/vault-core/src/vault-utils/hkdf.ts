import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";

/**
 * Some React Native WebCrypto implementations support AES but not HKDF
 * CryptoKeys. Keep the raw IKM only inside this module and expose a
 * CryptoKey-shaped, non-extractable handle to existing callers.
 */
const portableHkdfMaterial = new WeakMap<object, Uint8Array>();

const toBufferSource = (bytes: Uint8Array): BufferSource =>
    new Uint8Array(bytes);

export async function importPortableHkdfKey(
    rawKeyMaterial: Uint8Array,
    extractable: boolean,
): Promise<CryptoKey> {
    try {
        return await crypto.subtle.importKey(
            "raw",
            toBufferSource(rawKeyMaterial),
            { name: "HKDF" },
            extractable,
            ["deriveKey"],
        );
    } catch {
        const handle = Object.freeze({
            type: "secret",
            extractable,
            algorithm: Object.freeze({ name: "HKDF" }),
            usages: Object.freeze(["deriveKey"]),
        }) as unknown as CryptoKey;
        portableHkdfMaterial.set(handle, new Uint8Array(rawKeyMaterial));
        return handle;
    }
}

export function getPortableHkdfMaterial(
    key: CryptoKey,
): Uint8Array | undefined {
    const material = portableHkdfMaterial.get(key);
    return material ? new Uint8Array(material) : undefined;
}

/** RFC 5869 HKDF-SHA-256, returning a fresh output buffer. */
export function deriveHkdfSha256(
    ikm: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length = 32,
): Uint8Array {
    return new Uint8Array(hkdf(sha256, ikm, salt, info, length));
}
