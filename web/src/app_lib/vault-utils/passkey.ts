/**
 * ECDSA P-256 key pair for vault-stored "passkey" (not browser WebAuthn).
 * Private key is stored as JWK inside the encrypted vault.
 */

const ALGORITHM = "ECDSA" as const;
const NAMED_CURVE = "P-256" as const;

export async function generateKeyPair(): Promise<{
    publicKey: JsonWebKey;
    privateKey: JsonWebKey;
}> {
    const keyPair = await crypto.subtle.generateKey(
        {
            name: "ECDSA",
            namedCurve: NAMED_CURVE,
        },
        true,
        ["sign", "verify"],
    );

    const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

    return { publicKey, privateKey };
}

export function publicKeyJwkToString(jwk: JsonWebKey): string {
    return JSON.stringify(jwk);
}

export function privateKeyJwkToString(jwk: JsonWebKey): string {
    return JSON.stringify(jwk);
}

export function parseJwkFromString(s: string): JsonWebKey {
    return JSON.parse(s) as JsonWebKey;
}

/**
 * Sign challenge bytes with ECDSA (SHA-256). Returns base64url-encoded signature.
 * Web Crypto uses IEEE P1363 fixed-length encoding (not DER); server-side
 * verification uses the same encoding (see cloud `auth/challenge.ts`).
 */
export async function signChallenge(
    privateKeyJwk: JsonWebKey | string,
    challenge: Uint8Array,
): Promise<string> {
    const jwk =
        typeof privateKeyJwk === "string"
            ? parseJwkFromString(privateKeyJwk)
            : privateKeyJwk;

    const privateKey = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: ALGORITHM, namedCurve: NAMED_CURVE },
        false,
        ["sign"],
    );

    const signature = await crypto.subtle.sign(
        { name: ALGORITHM, hash: "SHA-256" },
        privateKey,
        new Uint8Array(challenge),
    );

    const bytes = new Uint8Array(signature);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

export function base64UrlToUint8Array(b64url: string): Uint8Array {
    const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const b64 = pad ? padded + "=".repeat(4 - pad) : padded;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
}
