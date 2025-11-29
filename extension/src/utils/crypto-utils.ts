import { err, ok, Result } from "neverthrow";
import { ulid } from "ulidx";

/**
 * Generates a new ECDH key pair for the service worker.
 * @returns Promise resolving to the key pair and metadata
 */
export async function generateECDHKeyPair(): Promise<{
    keyId: string;
    createdAt: string;
    privateKey: CryptoKey;
    publicKey: CryptoKey;
    publicKeyJwk: JsonWebKey;
}> {
    const keyPair = await crypto.subtle.generateKey(
        {
            name: "ECDH",
            namedCurve: "P-256",
        },
        false, // extractable: false for private key
        ["deriveKey", "deriveBits"],
    );

    const publicKeyJwk = await crypto.subtle.exportKey(
        "jwk",
        keyPair.publicKey,
    );

    return {
        keyId: ulid(),
        createdAt: new Date().toISOString(),
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey,
        publicKeyJwk,
    };
}

/**
 * Derives a shared secret using ECDH and then derives an AES-GCM key using HKDF.
 * @param privateKey The private key from the key pair
 * @param publicKey The ephemeral public key from the client
 * @param salt Random 16-byte salt
 * @param info HKDF info parameter
 * @returns Promise resolving to the AES-GCM key
 */
export async function deriveSessionKey(
    privateKey: CryptoKey,
    publicKey: CryptoKey,
    salt: Uint8Array,
    info: string,
): Promise<CryptoKey> {
    // Derive shared secret using ECDH
    const sharedSecret = await crypto.subtle.deriveBits(
        {
            name: "ECDH",
            public: publicKey,
        },
        privateKey,
        256,
    );

    // Derive AES-GCM key using HKDF
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        sharedSecret,
        "HKDF",
        false,
        ["deriveKey"],
    );

    const sessionKey = await crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: salt,
            info: new TextEncoder().encode(info),
        },
        keyMaterial,
        {
            name: "AES-GCM",
            length: 256,
        },
        false,
        ["encrypt", "decrypt"],
    );

    return sessionKey;
}

/**
 * Encrypts data using AES-GCM.
 * @param key The AES-GCM key
 * @param data The data to encrypt
 * @returns Promise resolving to IV and ciphertext
 */
export async function encryptWithAESGCM(
    key: CryptoKey,
    data: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM

    const ciphertext = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv,
        },
        key,
        data,
    );

    return {
        iv: iv,
        ciphertext: new Uint8Array(ciphertext),
    };
}

/**
 * Decrypts data using AES-GCM.
 * @param key The AES-GCM key
 * @param iv The initialization vector
 * @param ciphertext The encrypted data
 * @returns Promise resolving to the decrypted data
 */
export async function decryptWithAESGCM(
    key: CryptoKey,
    iv: Uint8Array,
    ciphertext: Uint8Array,
): Promise<
    Result<
        Uint8Array,
        "DECRYPTION_FAILED" | "INVALID_ACCESS_ERROR" | "UNKNOWN_ERROR"
    >
> {
    try {
        const decrypted = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: iv,
            },
            key,
            ciphertext,
        );

        return ok(new Uint8Array(decrypted));
    } catch (error) {
        if (
            error instanceof DOMException &&
            error.name === "InvalidAccessError"
        ) {
            return err("INVALID_ACCESS_ERROR");
        }

        if (error instanceof DOMException && error.name === "OperationError") {
            return err("DECRYPTION_FAILED");
        }

        return err("UNKNOWN_ERROR");
    }
}

/**
 * Generates a random salt for HKDF.
 * @returns 16-byte random salt
 */
export function generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * Encodes a Uint8Array to base64url format.
 * @param data The data to encode
 * @returns Base64url encoded string
 */
export function base64UrlEncode(data: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...data));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Decodes a base64url string to Uint8Array.
 * @param str The base64url string to decode
 * @returns Decoded Uint8Array
 */
export function base64UrlDecode(str: string): Uint8Array {
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
