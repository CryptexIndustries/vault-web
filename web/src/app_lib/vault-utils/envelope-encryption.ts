/**
 * KEK/DEK envelope encryption (v3 vault blobs).
 *
 * - DEK: random AES-256-GCM key encrypts vault protobuf bytes.
 * - KEK: wraps DEK via AES-KW; derived from master password (+ optional 2FA).
 * - Recovery slot: separate KEK from recovery code only.
 */

import sodium from "libsodium-wrappers-sumo";
import * as VaultUtilTypes from "../proto/vault";
import { err, ok, type Result } from "neverthrow";
import { base64ToUint8, uint8ToBase64 } from "@/lib/utils";
import { KeyDerivationConfig_Argon2ID, type EncryptedBlob } from "./encryption";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export const ENVELOPE_VERSION = 3;
export const KEK_INFO_PREFIX = "cryptex/kek/v1|";
export const DEK_ALGO = "AES-GCM-256";
export const WRAP_ALGO = "AES-KW";

export type EnvelopeKdfConfig = KeyDerivationConfig_Argon2ID;

/** Copy bytes for Web Crypto BufferSource typing (libsodium Uint8Array) */
const toBufferSource = (bytes: Uint8Array): BufferSource =>
    new Uint8Array(bytes);

const defaultKdfConfig = (): EnvelopeKdfConfig =>
    new KeyDerivationConfig_Argon2ID();

/** Argon2id over UTF-8 password */
export async function derivePasswordKey(
    masterPassword: string,
    salt: Uint8Array,
    config: EnvelopeKdfConfig = defaultKdfConfig(),
): Promise<Uint8Array> {
    await sodium.ready;

    // Convert the memory limit from MiB to bytes
    const memLimitActual = config.memLimit * 1048576;

    return sodium.crypto_pwhash(
        32,
        new TextEncoder().encode(masterPassword),
        salt,
        config.opsLimit,
        memLimitActual,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
}

/** Argon2id over raw second-factor secret bytes */
export async function deriveSecondFactorKeyMaterial(
    secretBytes: Uint8Array,
    salt: Uint8Array,
    config: EnvelopeKdfConfig = defaultKdfConfig(),
): Promise<Uint8Array> {
    await sodium.ready;

    // Convert the memory limit from MiB to bytes
    const memLimitActual = config.memLimit * 1048576;

    return sodium.crypto_pwhash(
        32,
        secretBytes,
        salt,
        config.opsLimit,
        memLimitActual,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
}

export async function importHkdfBaseKey(
    rawKeyMaterial: Uint8Array,
    extractable: boolean,
): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        "raw",
        toBufferSource(rawKeyMaterial),
        { name: "HKDF" },
        extractable,
        ["deriveKey"],
    );
}

export function buildKekInfo(vaultId: string): string {
    return `${KEK_INFO_PREFIX}${vaultId}`;
}

/**
 * KEK with 2FA: HKDF(IKM = secondFactorKey, salt = pwKey).
 * KEK without 2FA: HKDF(IKM = imported pwKey, salt = stored random salt).
 */
export async function deriveKEK(
    pwKey: Uint8Array,
    kekInfo: string,
    secondFactorHkdfBase: CryptoKey | null,
    hkdfSaltWhenNoSecondFactor: Uint8Array | null,
): Promise<CryptoKey> {
    const info = new TextEncoder().encode(kekInfo);

    if (secondFactorHkdfBase) {
        return crypto.subtle.deriveKey(
            {
                name: "HKDF",
                hash: "SHA-256",
                salt: toBufferSource(pwKey),
                info,
            },
            secondFactorHkdfBase,
            { name: "AES-KW", length: 256 },
            false,
            ["wrapKey", "unwrapKey"],
        );
    }

    if (!hkdfSaltWhenNoSecondFactor) {
        throw new Error("HKDF salt required when second factor is absent");
    }

    const pwHkdfBase = await importHkdfBaseKey(pwKey, false);
    return crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: toBufferSource(hkdfSaltWhenNoSecondFactor),
            info,
        },
        pwHkdfBase,
        { name: "AES-KW", length: 256 },
        false,
        ["wrapKey", "unwrapKey"],
    );
}

/** Recovery KEK: Argon2id(recoveryCode) imported as AES-KW */
export async function deriveRecoveryKEK(
    recoveryCode: string,
    salt: Uint8Array,
    config: EnvelopeKdfConfig = defaultKdfConfig(),
): Promise<CryptoKey> {
    const material = await derivePasswordKey(recoveryCode, salt, config);
    return crypto.subtle.importKey(
        "raw",
        toBufferSource(material),
        { name: "AES-KW" },
        false,
        ["wrapKey", "unwrapKey"],
    );
}

export async function generateExtractableDEK(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
        "encrypt",
        "decrypt",
    ]);
}

export async function wrapDEK(
    dek: CryptoKey,
    kek: CryptoKey,
): Promise<Uint8Array> {
    const wrapped = await crypto.subtle.wrapKey("raw", dek, kek, "AES-KW");
    return new Uint8Array(wrapped);
}

export async function unwrapDEK(
    wrapped: Uint8Array,
    kek: CryptoKey,
    extractable = false,
): Promise<CryptoKey> {
    return crypto.subtle.unwrapKey(
        "raw",
        toBufferSource(wrapped),
        kek,
        "AES-KW",
        { name: "AES-GCM", length: 256 },
        extractable,
        ["encrypt", "decrypt"],
    );
}

export async function encryptWithDEK(
    dek: CryptoKey,
    plaintext: Uint8Array,
): Promise<{ ciphertext: Uint8Array; iv: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        dek,
        toBufferSource(plaintext),
    );
    return {
        ciphertext: new Uint8Array(encrypted),
        iv: uint8ToBase64(iv),
    };
}

export async function decryptWithDEK(
    dek: CryptoKey,
    ciphertext: Uint8Array,
    ivB64: string,
): Promise<Result<Uint8Array, "DECRYPTION_FAILED">> {
    try {
        const iv = toBufferSource(base64ToUint8(ivB64));
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            dek,
            toBufferSource(ciphertext),
        );
        return ok(new Uint8Array(decrypted));
    } catch {
        return err("DECRYPTION_FAILED");
    }
}

export function isEnvelopeBlob(blob: EncryptedBlob): boolean {
    return (
        blob.Version >= ENVELOPE_VERSION &&
        blob.Envelope != null &&
        blob.Envelope.Version >= ENVELOPE_VERSION
    );
}

export function generateRandomSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * Generate a 256-bit recovery code using BIP39.
 * @returns A 256-bit mnemonic that can be used as a recovery code
 */
export function generateRecoveryCode(): string {
    return generateMnemonic(wordlist, 256);
}

export function encodeSlot(
    kind: VaultUtilTypes.KeySlotKind,
    factorKind: VaultUtilTypes.SecondFactorKind,
    wrapped: Uint8Array,
    salt: Uint8Array,
    kdfConfig: EnvelopeKdfConfig,
    hkdfSalt: Uint8Array | null,
    vaultId: string,
    metadata?: {
        webauthn?: { credentialId: string; prfSalt: string };
        secondFactorSalt?: string;
    },
): VaultUtilTypes.KeySlot {
    return {
        Kind: kind,
        WrappedDEK: wrapped,
        WrapAlgo: WRAP_ALGO,
        Salt: uint8ToBase64(salt),
        KDFConfigArgon2ID: {
            memLimit: kdfConfig.memLimit,
            opsLimit: kdfConfig.opsLimit,
        },
        HKDFSalt: hkdfSalt ? uint8ToBase64(hkdfSalt) : "",
        HKDFInfo: buildKekInfo(vaultId),
        FactorKind: factorKind,
        WebauthnCredentialId: metadata?.webauthn?.credentialId ?? "",
        WebauthnPrfSalt: metadata?.webauthn?.prfSalt ?? "",
        SecondFactorSalt: metadata?.secondFactorSalt ?? "",
    };
}

export function buildKeyEnvelope(
    slots: VaultUtilTypes.KeySlot[],
    primaryFactorKind: VaultUtilTypes.SecondFactorKind,
    vaultId: string,
): VaultUtilTypes.KeyEnvelope {
    return {
        Version: ENVELOPE_VERSION,
        DEKAlgo: DEK_ALGO,
        Slots: slots,
        PrimaryFactorKind: primaryFactorKind,
        VaultID: vaultId,
    };
}

export async function unwrapDEKFromSlot(
    slot: VaultUtilTypes.KeySlot,
    kek: CryptoKey,
    extractable = false,
): Promise<Result<CryptoKey, string>> {
    try {
        const dek = await unwrapDEK(slot.WrappedDEK, kek, extractable);
        return ok(dek);
    } catch {
        return err("DEK_UNWRAP_FAILED");
    }
}

export async function openPrimarySlot(
    slot: VaultUtilTypes.KeySlot & { Kind: VaultUtilTypes.KeySlotKind.PRIMARY },
    masterPassword: string,
    vaultId: string,
    secondFactorHkdfBase: CryptoKey | null,
    extractable = false,
): Promise<Result<CryptoKey, string>> {
    const salt = base64ToUint8(slot.Salt);
    const kdfConfig = new KeyDerivationConfig_Argon2ID(
        slot.KDFConfigArgon2ID?.memLimit ??
            KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
        slot.KDFConfigArgon2ID?.opsLimit ??
            KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
    );

    const pwKey = await derivePasswordKey(masterPassword, salt, kdfConfig);
    const hkdfSalt =
        slot.HKDFSalt && slot.HKDFSalt.length > 0
            ? base64ToUint8(slot.HKDFSalt)
            : null;

    // Use the info bound to the slot at creation. Recomputing from DB-local
    // state breaks backup/restore when the local IndexedDB id changes.
    const kekInfo =
        slot.HKDFInfo && slot.HKDFInfo.length > 0
            ? slot.HKDFInfo
            : buildKekInfo(vaultId);

    let kek: CryptoKey;
    try {
        kek = await deriveKEK(pwKey, kekInfo, secondFactorHkdfBase, hkdfSalt);
    } catch {
        return err("KEK_DERIVATION_FAILED");
    }

    return unwrapDEKFromSlot(slot, kek, extractable);
}

export async function openRecoverySlot(
    envelope: VaultUtilTypes.KeyEnvelope,
    recoveryCode: string,
    extractable = false,
): Promise<Result<CryptoKey, string>> {
    const slot = envelope.Slots.find(
        (s) => s.Kind === VaultUtilTypes.KeySlotKind.RECOVERY,
    );
    if (!slot) return err("RECOVERY_SLOT_MISSING");

    const salt = base64ToUint8(slot.Salt);
    const kdfConfig = new KeyDerivationConfig_Argon2ID(
        slot.KDFConfigArgon2ID?.memLimit ??
            KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
        slot.KDFConfigArgon2ID?.opsLimit ??
            KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
    );

    let kek: CryptoKey;
    try {
        kek = await deriveRecoveryKEK(recoveryCode, salt, kdfConfig);
    } catch {
        return err("RECOVERY_KEK_FAILED");
    }

    return unwrapDEKFromSlot(slot, kek, extractable);
}
