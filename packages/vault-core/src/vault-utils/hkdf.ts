import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** RFC 5869 HKDF-SHA-256, returning a fresh output buffer. */
export function deriveHkdfSha256(
    ikm: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length = 32,
): Uint8Array {
    return new Uint8Array(hkdf(sha256, ikm, salt, info, length));
}
