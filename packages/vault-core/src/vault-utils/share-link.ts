/**
 * One-time share links.
 *
 * The link is `<origin>/s/<id>#<secret>`. The secret never reaches a server.
 * Every key and token below is derived from it (plus an optional passphrase):
 *
 * - encryption key: AES-256-GCM over the JSON payload
 * - peek token: proves the caller holds the link; needed to ask about a share
 * - reveal token: releases and deletes the ciphertext; with a passphrase it
 *   also proves the passphrase, so the server can count wrong guesses
 *
 * The server stores only SHA-256 hashes of the tokens. A separate random
 * manage token, kept in the sender's vault, lets the sender check status and
 * revoke.
 */

import sodium from "libsodium-wrappers-sumo";
import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { base64UrlToUint8, uint8ToBase64Url } from "../encoding";
import { deriveHkdfSha256 } from "./hkdf";

export const SHARE_ENVELOPE_VERSION = 1;
export const SHARE_SECRET_BYTES = 32;
export const SHARE_TOKEN_BYTES = 32;
export const SHARE_PATH_PREFIX = "/s/";
export const SHARE_API_PATH = "/share-api/v1";

/** Argon2id parameters for share passphrases, fixed per envelope version. */
export const SHARE_PASSPHRASE_OPS_LIMIT = 3;
export const SHARE_PASSPHRASE_MEM_LIMIT_MIB = 64;

const SHARE_INFO_PREFIX = "cryptex/share/v1|";
const SHARE_FLAG_PASSPHRASE = 0b0000_0001;
const SHARE_HEADER_BYTES = 2;
const SHARE_NONCE_BYTES = 12;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const SHARE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const SHARE_EXPIRY_OPTIONS = [
    { seconds: 60 * 60, label: "1 hour" },
    { seconds: 24 * 60 * 60, label: "1 day" },
    { seconds: 3 * 24 * 60 * 60, label: "3 days" },
    { seconds: 7 * 24 * 60 * 60, label: "7 days" },
] as const;

export type ShareExpiryOption = { seconds: number; label: string };

const formatMinutes = (seconds: number) => {
    const minutes = Math.max(1, Math.floor(seconds / 60));
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
};

/**
 * Expiry choices the server accepts. A server that keeps links for less than
 * an hour gets a single choice at its limit.
 */
export function shareExpiryOptions(maxTtlSeconds: number): ShareExpiryOption[] {
    const options = SHARE_EXPIRY_OPTIONS.filter(
        (option) => option.seconds <= maxTtlSeconds,
    ).map((option) => ({ ...option }));
    return options.length
        ? options
        : [{ seconds: maxTtlSeconds, label: formatMinutes(maxTtlSeconds) }];
}

/** One day when allowed, otherwise the longest choice. */
export function defaultShareExpiry(options: ShareExpiryOption[]): number {
    const oneDay = 24 * 60 * 60;
    return options.some((option) => option.seconds === oneDay)
        ? oneDay
        : options[options.length - 1]!.seconds;
}

export const shareFieldKindSchema = z.enum([
    "text",
    "secret",
    "url",
    "multiline",
    "totp",
]);
export type ShareFieldKind = z.infer<typeof shareFieldKindSchema>;

export const sharePayloadSchema = z.object({
    v: z.literal(1),
    title: z.string().max(256),
    fields: z
        .array(
            z.object({
                label: z.string().max(256),
                value: z.string().max(60_000),
                kind: shareFieldKindSchema,
            }),
        )
        .min(1)
        .max(64),
});
export type SharePayload = z.infer<typeof sharePayloadSchema>;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const toBufferSource = (bytes: Uint8Array): BufferSource =>
    new Uint8Array(bytes);

const randomBytes = (length: number): Uint8Array =>
    crypto.getRandomValues(new Uint8Array(length));

const info = (label: string): Uint8Array =>
    encoder.encode(`${SHARE_INFO_PREFIX}${label}`);

export function hashShareToken(token: Uint8Array): Uint8Array {
    return sha256(token);
}

export function generateShareSecret(): Uint8Array {
    return randomBytes(SHARE_SECRET_BYTES);
}

export function generateShareManageToken(): Uint8Array {
    return randomBytes(SHARE_TOKEN_BYTES);
}

/** Argon2id over the passphrase, salted from the link secret. */
async function derivePassphraseKey(
    secret: Uint8Array,
    passphrase: string,
): Promise<Uint8Array> {
    await sodium.ready;
    const salt = deriveHkdfSha256(
        secret,
        new Uint8Array(),
        info("passphrase-salt"),
        sodium.crypto_pwhash_SALTBYTES,
    );
    const passphraseBytes = encoder.encode(passphrase.normalize("NFC"));
    try {
        return sodium.crypto_pwhash(
            32,
            passphraseBytes,
            salt,
            SHARE_PASSPHRASE_OPS_LIMIT,
            SHARE_PASSPHRASE_MEM_LIMIT_MIB * 1048576,
            sodium.crypto_pwhash_ALG_ARGON2ID13,
        );
    } finally {
        passphraseBytes.fill(0);
    }
}

export type ShareKeys = {
    encryptionKey: CryptoKey;
    peekToken: Uint8Array;
    revealToken: Uint8Array;
};

/**
 * The peek token depends on the link secret only, so the recipient page can
 * ask whether a passphrase is needed before deriving anything else.
 */
export function deriveSharePeekToken(secret: Uint8Array): Uint8Array {
    assertSecret(secret);
    return deriveHkdfSha256(secret, new Uint8Array(), info("peek"));
}

export async function deriveShareKeys(
    secret: Uint8Array,
    passphrase?: string,
): Promise<ShareKeys> {
    assertSecret(secret);
    const passphraseKey = passphrase
        ? await derivePassphraseKey(secret, passphrase)
        : new Uint8Array();
    try {
        const rawKey = deriveHkdfSha256(secret, passphraseKey, info("enc"));
        const revealToken = deriveHkdfSha256(
            secret,
            passphraseKey,
            info("reveal"),
        );
        try {
            const encryptionKey = await crypto.subtle.importKey(
                "raw",
                toBufferSource(rawKey),
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            );
            return {
                encryptionKey,
                peekToken: deriveSharePeekToken(secret),
                revealToken,
            };
        } finally {
            rawKey.fill(0);
        }
    } finally {
        passphraseKey.fill(0);
    }
}

function assertSecret(secret: Uint8Array): void {
    if (secret.byteLength !== SHARE_SECRET_BYTES) {
        throw new Error("SHARE_SECRET_INVALID");
    }
}

export type SealedShare = {
    /** version || flags || nonce || AES-GCM ciphertext and tag */
    ciphertext: Uint8Array;
    peekTokenHash: Uint8Array;
    revealTokenHash: Uint8Array;
};

export async function sealSharePayload(
    payload: SharePayload,
    secret: Uint8Array,
    passphrase?: string,
): Promise<SealedShare> {
    const parsed = sharePayloadSchema.parse(payload);
    const keys = await deriveShareKeys(secret, passphrase);
    const header = new Uint8Array([
        SHARE_ENVELOPE_VERSION,
        passphrase ? SHARE_FLAG_PASSPHRASE : 0,
    ]);
    const nonce = randomBytes(SHARE_NONCE_BYTES);
    const plaintext = encoder.encode(JSON.stringify(parsed));
    try {
        const encrypted = new Uint8Array(
            await crypto.subtle.encrypt(
                {
                    name: "AES-GCM",
                    iv: toBufferSource(nonce),
                    additionalData: toBufferSource(header),
                },
                keys.encryptionKey,
                toBufferSource(plaintext),
            ),
        );
        const ciphertext = new Uint8Array(
            SHARE_HEADER_BYTES + SHARE_NONCE_BYTES + encrypted.byteLength,
        );
        ciphertext.set(header, 0);
        ciphertext.set(nonce, SHARE_HEADER_BYTES);
        ciphertext.set(encrypted, SHARE_HEADER_BYTES + SHARE_NONCE_BYTES);
        return {
            ciphertext,
            peekTokenHash: hashShareToken(keys.peekToken),
            revealTokenHash: hashShareToken(keys.revealToken),
        };
    } finally {
        plaintext.fill(0);
        keys.revealToken.fill(0);
    }
}

export function shareCiphertextNeedsPassphrase(
    ciphertext: Uint8Array,
): boolean {
    return (
        ciphertext.byteLength > SHARE_HEADER_BYTES &&
        (ciphertext[1]! & SHARE_FLAG_PASSPHRASE) !== 0
    );
}

export async function openSharePayload(
    ciphertext: Uint8Array,
    secret: Uint8Array,
    passphrase?: string,
): Promise<SharePayload> {
    if (
        ciphertext.byteLength <= SHARE_HEADER_BYTES + SHARE_NONCE_BYTES ||
        ciphertext[0] !== SHARE_ENVELOPE_VERSION
    ) {
        throw new Error("SHARE_ENVELOPE_UNSUPPORTED");
    }
    const header = ciphertext.subarray(0, SHARE_HEADER_BYTES);
    const nonce = ciphertext.subarray(
        SHARE_HEADER_BYTES,
        SHARE_HEADER_BYTES + SHARE_NONCE_BYTES,
    );
    const body = ciphertext.subarray(SHARE_HEADER_BYTES + SHARE_NONCE_BYTES);
    const keys = await deriveShareKeys(
        secret,
        shareCiphertextNeedsPassphrase(ciphertext) ? passphrase : undefined,
    );
    keys.revealToken.fill(0);
    let plaintext: Uint8Array;
    try {
        plaintext = new Uint8Array(
            await crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: toBufferSource(nonce),
                    additionalData: toBufferSource(header),
                },
                keys.encryptionKey,
                toBufferSource(body),
            ),
        );
    } catch {
        throw new Error("SHARE_DECRYPT_FAILED");
    }
    try {
        return sharePayloadSchema.parse(JSON.parse(decoder.decode(plaintext)));
    } catch {
        throw new Error("SHARE_PAYLOAD_INVALID");
    } finally {
        plaintext.fill(0);
    }
}

export function formatShareLink(
    origin: string,
    id: string,
    secret: Uint8Array,
): string {
    assertSecret(secret);
    if (!SHARE_ID_PATTERN.test(id)) throw new Error("SHARE_ID_INVALID");
    const base = new URL(origin);
    return `${base.origin}${SHARE_PATH_PREFIX}${id}#${uint8ToBase64Url(secret)}`;
}

export type ParsedShareLink = {
    origin: string;
    id: string;
    secret: Uint8Array;
};

export function parseShareLink(link: string): ParsedShareLink | null {
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return null;
    }
    if (!url.pathname.startsWith(SHARE_PATH_PREFIX)) return null;
    const id = url.pathname.slice(SHARE_PATH_PREFIX.length);
    const fragment = url.hash.slice(1);
    if (!SHARE_ID_PATTERN.test(id) || !SHARE_SECRET_PATTERN.test(fragment)) {
        return null;
    }
    return { origin: url.origin, id, secret: base64UrlToUint8(fragment) };
}

export function isValidShareId(id: string): boolean {
    return SHARE_ID_PATTERN.test(id);
}

export function parseShareSecret(fragment: string): Uint8Array | null {
    const value = fragment.startsWith("#") ? fragment.slice(1) : fragment;
    return SHARE_SECRET_PATTERN.test(value) ? base64UrlToUint8(value) : null;
}
