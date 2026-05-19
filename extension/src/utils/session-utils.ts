import { ulid } from "ulidx";
import {
    EncryptedEnvelope,
    EnvelopeOrigin,
    PlaintextEnvelope,
    MessageType,
} from "../types/sw-messaging";
import {
    generateECDHKeyPair,
    deriveSessionKey,
    encryptWithAESGCM,
    decryptWithAESGCM,
    generateSalt,
    base64UrlEncode,
    base64UrlDecode,
} from "./crypto-utils";
import { err, Err } from "neverthrow";

const sessionKeyCache = new Map<string, CryptoKey>();

type DecryptedEnvelope<T> =
    | {
          ok: true;
          payload: T;
      }
    | {
          ok: false;
          error: Err<
              never,
              | "SESSION_KEY_NOT_FOUND"
              | "DECRYPTION_FAILED"
              | "IV_NOT_FOUND"
              | "CIPHERTEXT_NOT_FOUND"
              | string
          >;
      };

/**
 * Creates an encrypted envelope for a message.
 * @param messageType The type of message
 * @param payload The message payload to encrypt
 * @param serverPublicKey The server's public key JWK
 * @param serverKeyId The server's key ID
 * @param origin The origin of the message
 * @returns Promise resolving to the encrypted envelope
 */
export async function createEncryptedEnvelope(
    messageType: MessageType,
    payload: object | null,
    serverPublicKey: JsonWebKey,
    serverKeyId: string,
    origin: EnvelopeOrigin,
): Promise<EncryptedEnvelope> {
    // Generate ephemeral key pair for this session
    const ephemeralKeyPair = await generateECDHKeyPair();

    // Import server's public key
    const serverPublicKeyCrypto = await crypto.subtle.importKey(
        "jwk",
        serverPublicKey,
        {
            name: "ECDH",
            namedCurve: "P-256",
        },
        false,
        [],
    );

    // Generate salt for HKDF
    const salt = generateSalt();

    // Derive session key
    const sessionKey = await deriveSessionKey(
        ephemeralKeyPair.privateKey,
        serverPublicKeyCrypto,
        salt,
        "cryptex-extension-session",
    );

    // Serialize payload
    const plaintext = JSON.stringify(payload);

    let plaintextBytes: Uint8Array = new Uint8Array(0);

    // If the plaintext is empty, don't encrypt it
    if (plaintext.length > 0) {
        plaintextBytes = new TextEncoder().encode(plaintext);
    }

    let iv: Uint8Array = new Uint8Array(0);
    let ciphertext: Uint8Array = new Uint8Array(0);

    // Encrypt payload
    if (plaintextBytes.length > 0) {
        const result = await encryptWithAESGCM(sessionKey, plaintextBytes);
        iv = result.iv;
        ciphertext = result.ciphertext;
    }

    const requestId = ulid();

    const envelope: EncryptedEnvelope = {
        type: messageType,
        requestId,
        origin,
        keyId: serverKeyId,
        timestamp: new Date().toISOString(),
        payload: {
            wrappedKey: base64UrlEncode(
                new Uint8Array(
                    await crypto.subtle.exportKey(
                        "raw",
                        ephemeralKeyPair.publicKey,
                    ),
                ),
            ),
            ephemeralPub: ephemeralKeyPair.publicKeyJwk,
            salt: base64UrlEncode(salt),
            ciphertext:
                ciphertext.length > 0 ? base64UrlEncode(ciphertext) : null,
            iv: iv.length > 0 ? base64UrlEncode(iv) : null,
        },
    };

    sessionKeyCache.set(requestId, sessionKey);

    return envelope;
}

/**
 * Creates a plaintext envelope for non-sensitive messages.
 * This is used only for GetPublicKey messages, and error responses.
 * @param messageType The type of message
 * @param payload Optional message payload
 * @param origin The origin of the message
 * @returns The plaintext envelope
 */
export function createPlaintextEnvelope(
    messageType: MessageType,
    payload: ({ ok: boolean } & any) | null,
    origin: EnvelopeOrigin,
): PlaintextEnvelope {
    return {
        type: messageType,
        requestId: ulid(),
        origin,
        timestamp: new Date().toISOString(),
        payload,
    };
}

/**
 * Decrypts an encrypted envelope using the server's private key.
 * @param envelope The encrypted envelope
 * @param serverPrivateKey The server's private key
 * @returns Promise resolving to the decrypted payload
 */
export async function decryptEnvelope<T>(
    envelope: EncryptedEnvelope,
    serverPrivateKey: CryptoKey,
): Promise<DecryptedEnvelope<T | null>> {
    if (!envelope.payload.iv) {
        return {
            ok: false,
            error: err("IV_NOT_FOUND"),
        };
    }

    if (!envelope.payload.ciphertext) {
        return {
            ok: false,
            error: err("CIPHERTEXT_NOT_FOUND"),
        };
    }

    // Import client's ephemeral public key
    const ephemeralPublicKey = await crypto.subtle.importKey(
        "jwk",
        envelope.payload.ephemeralPub,
        {
            name: "ECDH",
            namedCurve: "P-256",
        },
        false,
        [],
    );

    // Decode salt and derive session key
    const salt = base64UrlDecode(envelope.payload.salt);
    const sessionKey = await deriveSessionKey(
        serverPrivateKey,
        ephemeralPublicKey,
        salt,
        "cryptex-extension-session",
    );

    // Decode IV and ciphertext
    const iv = base64UrlDecode(envelope.payload.iv);
    const ciphertext = base64UrlDecode(envelope.payload.ciphertext);

    // Decrypt payload
    const decryptedBytes = await decryptWithAESGCM(sessionKey, iv, ciphertext);

    if (decryptedBytes.isErr()) {
        return {
            ok: false,
            error: err("DECRYPTION_FAILED: " + decryptedBytes.error),
        };
    }

    // Parse JSON payload
    const decryptedText = new TextDecoder().decode(decryptedBytes.value);

    // In case the decrypted text is empty, return null
    if (decryptedText?.length === 0) {
        return {
            ok: true,
            payload: null,
        };
    }

    return {
        ok: true,
        payload: JSON.parse(decryptedText) as T,
    };
}

/**
 * Creates an encrypted response envelope.
 * @param requestEnvelope The original request envelope
 * @param responsePayload The response payload to encrypt
 * @param serverPrivateKey The server's private key for the session
 * @param ephemeralPublicKey The ephemeral public key from the request
 * @param salt The salt from the request
 * @returns Promise resolving to the encrypted response envelope
 */
export async function createEncryptedResponseEnvelope(
    requestEnvelope: EncryptedEnvelope,
    responsePayload: any,
    sessionKey: CryptoKey,
): Promise<EncryptedEnvelope> {
    // Serialize response payload
    const plaintext = JSON.stringify(responsePayload);
    const plaintextBytes = new TextEncoder().encode(plaintext);

    // Encrypt response payload
    const { iv, ciphertext } = await encryptWithAESGCM(
        sessionKey,
        plaintextBytes,
    );

    return {
        type: requestEnvelope.type,
        requestId: requestEnvelope.requestId,
        origin: "worker", // responses come from worker
        keyId: requestEnvelope.keyId,
        timestamp: new Date().toISOString(),
        payload: {
            wrappedKey: requestEnvelope.payload.wrappedKey, // reuse from request
            ephemeralPub: requestEnvelope.payload.ephemeralPub, // reuse from request
            salt: requestEnvelope.payload.salt, // reuse from request
            ciphertext: base64UrlEncode(ciphertext),
            iv: base64UrlEncode(iv),
        },
    };
}

/**
 * Type guard to check if a message is an encrypted envelope.
 */
export function isEncryptedEnvelope(
    message: any,
): message is EncryptedEnvelope {
    const payload = message?.payload;

    return (
        message &&
        typeof message.type === "number" &&
        typeof message.requestId === "string" &&
        typeof message.origin === "string" &&
        typeof message.keyId === "string" &&
        typeof message.timestamp === "string" &&
        payload &&
        typeof payload.wrappedKey === "string" &&
        payload.ephemeralPub &&
        typeof payload.salt === "string" &&
        (payload.ciphertext === null ||
            typeof payload.ciphertext === "string") &&
        (payload.iv === null || typeof payload.iv === "string")
    );
}

/**
 * Type guard to check if a message is a plaintext envelope.
 */
export function isPlaintextEnvelope(
    message: any,
): message is PlaintextEnvelope {
    if (!message || typeof message !== "object") {
        return false;
    }

    return (
        typeof message.type === "number" &&
        typeof message.requestId === "string" &&
        typeof message.origin === "string" &&
        typeof message.timestamp === "string" &&
        !("keyId" in message)
    ); // Plaintext doesn't have ciphertext
}

/**
 * Removes the cached session key for the provided request ID.
 */
export function discardSessionKey(requestId: string): void {
    sessionKeyCache.delete(requestId);
}

/**
 * Decrypts an encrypted envelope using the cached session key derived during the request.
 * @param envelope The encrypted envelope returned by the service worker
 * @returns The decrypted payload
 */
export async function decryptResponseEnvelope<T>(
    envelope: EncryptedEnvelope,
): Promise<DecryptedEnvelope<T>> {
    const sessionKey = sessionKeyCache.get(envelope.requestId);

    if (!sessionKey) {
        return {
            ok: false,
            error: err("SESSION_KEY_NOT_FOUND"),
        };
    }

    if (!envelope.payload.iv) {
        return {
            ok: false,
            error: err("IV_NOT_FOUND"),
        };
    }

    if (!envelope.payload.ciphertext) {
        return {
            ok: false,
            error: err("CIPHERTEXT_NOT_FOUND"),
        };
    }

    const iv = base64UrlDecode(envelope.payload.iv);
    const ciphertext = base64UrlDecode(envelope.payload.ciphertext);

    try {
        const decryptedBytes = await decryptWithAESGCM(
            sessionKey,
            iv,
            ciphertext,
        );

        if (decryptedBytes.isErr()) {
            return {
                ok: false,
                error: err("ENVELOPE_DECRYPTION_FAILED: " + decryptedBytes.error),
            };
        }

        const decryptedText = new TextDecoder().decode(decryptedBytes.value);

        // if (decryptedText?.length === 0) {
        //     return {
        //         ok: true,
        //         payload: null,
        //     };
        // }

        return {
            ok: true,
            payload: JSON.parse(decryptedText) as T,
        };
    } catch (error) {
        return {
            ok: false,
            error: err("ENVELOPE_DECRYPTION_FAILED_UNKNOWN: " + error),
        };
    } finally {
        sessionKeyCache.delete(envelope.requestId);
    }
}
