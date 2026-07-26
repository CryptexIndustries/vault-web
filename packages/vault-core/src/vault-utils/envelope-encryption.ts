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
import { base64ToUint8, uint8ToBase64 } from "../encoding";
import { KeyDerivationConfig_Argon2ID, type EncryptedBlob } from "./encryption";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { getEnvelopeCrypto } from "../runtime";
import type { VaultHkdfKey, VaultKek } from "../envelope-crypto";

export const ENVELOPE_VERSION = 3;
export const KEK_INFO_PREFIX = "cryptex/kek/v1|";
export const DEK_ALGO = "AES-GCM-256";
export const WRAP_ALGO = "AES-KW";
export const AES_256_KEY_BYTES = 32;
export const AES_256_WRAPPED_KEY_BYTES = 40;
const PLATFORM_CRYPTO_UNAVAILABLE = "VAULT_PLATFORM_CRYPTO_UNAVAILABLE";

export type EnvelopeKdfConfig = KeyDerivationConfig_Argon2ID;

/** Copy bytes for Web Crypto BufferSource typing (libsodium Uint8Array) */
const toBufferSource = (bytes: Uint8Array): BufferSource =>
    new Uint8Array(bytes);

const defaultKdfConfig = (): EnvelopeKdfConfig =>
    new KeyDerivationConfig_Argon2ID();

function assertByteLength(
    value: Uint8Array,
    expected: number,
    errorCode: string,
): void {
    if (value.byteLength !== expected) {
        throw new Error(errorCode);
    }
}

function assertDek(dek: CryptoKey): void {
    const algorithm = dek.algorithm as AesKeyAlgorithm;
    if (
        dek.type !== "secret" ||
        algorithm.name !== "AES-GCM" ||
        algorithm.length !== 256
    ) {
        throw new Error("VAULT_DEK_INVALID");
    }
}

function isPlatformCryptoUnavailable(error: unknown): boolean {
    return (
        error instanceof Error && error.message === PLATFORM_CRYPTO_UNAVAILABLE
    );
}

/** Argon2id over UTF-8 password */
export async function derivePasswordKey(
    masterPassword: string,
    salt: Uint8Array,
    config: EnvelopeKdfConfig = defaultKdfConfig(),
): Promise<Uint8Array> {
    await sodium.ready;

    // Convert the memory limit from MiB to bytes
    const memLimitActual = config.memLimit * 1048576;
    const passwordBytes = new TextEncoder().encode(masterPassword);
    try {
        return sodium.crypto_pwhash(
            32,
            passwordBytes,
            salt,
            config.opsLimit,
            memLimitActual,
            sodium.crypto_pwhash_ALG_ARGON2ID13,
        );
    } finally {
        passwordBytes.fill(0);
    }
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
): Promise<VaultHkdfKey> {
    assertByteLength(
        rawKeyMaterial,
        AES_256_KEY_BYTES,
        "VAULT_HKDF_IKM_INVALID",
    );
    return getEnvelopeCrypto().importHkdfKey(new Uint8Array(rawKeyMaterial));
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
    secondFactorHkdfBase: VaultHkdfKey | null,
    hkdfSaltWhenNoSecondFactor: Uint8Array | null,
): Promise<VaultKek> {
    assertByteLength(pwKey, AES_256_KEY_BYTES, "VAULT_PASSWORD_KEY_INVALID");
    const info = new TextEncoder().encode(kekInfo);
    if (info.byteLength === 0) {
        throw new Error("VAULT_HKDF_INFO_REQUIRED");
    }

    if (secondFactorHkdfBase) {
        return getEnvelopeCrypto().deriveKek(
            secondFactorHkdfBase,
            new Uint8Array(pwKey),
            info,
        );
    }

    if (!hkdfSaltWhenNoSecondFactor) {
        throw new Error("HKDF salt required when second factor is absent");
    }

    const pwHkdfBase = await importHkdfBaseKey(pwKey);
    try {
        return await getEnvelopeCrypto().deriveKek(
            pwHkdfBase,
            new Uint8Array(hkdfSaltWhenNoSecondFactor),
            info,
        );
    } finally {
        getEnvelopeCrypto().disposeHkdfKey(pwHkdfBase);
    }
}

/** Recovery KEK: Argon2id(recoveryCode) imported as AES-KW */
export async function deriveRecoveryKEK(
    recoveryCode: string,
    salt: Uint8Array,
    config: EnvelopeKdfConfig = defaultKdfConfig(),
): Promise<VaultKek> {
    const material = await derivePasswordKey(recoveryCode, salt, config);
    try {
        assertByteLength(
            material,
            AES_256_KEY_BYTES,
            "VAULT_KEK_MATERIAL_INVALID",
        );
        return await getEnvelopeCrypto().importKek(new Uint8Array(material));
    } finally {
        material.fill(0);
    }
}

export async function generateExtractableDEK(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
        "encrypt",
        "decrypt",
    ]);
}

export async function wrapDEK(
    dek: CryptoKey,
    kek: VaultKek,
): Promise<Uint8Array> {
    assertDek(dek);
    if (!dek.extractable) {
        throw new Error("VAULT_DEK_NOT_EXTRACTABLE");
    }
    const wrapped = await getEnvelopeCrypto().wrapDek(dek, kek);
    assertByteLength(
        wrapped,
        AES_256_WRAPPED_KEY_BYTES,
        "VAULT_WRAPPED_DEK_INVALID",
    );
    return wrapped;
}

export async function unwrapDEK(
    wrapped: Uint8Array,
    kek: VaultKek,
    extractable = false,
): Promise<CryptoKey> {
    assertByteLength(
        wrapped,
        AES_256_WRAPPED_KEY_BYTES,
        "VAULT_WRAPPED_DEK_INVALID",
    );
    const dek = await getEnvelopeCrypto().unwrapDek(
        new Uint8Array(wrapped),
        kek,
        extractable,
    );
    assertDek(dek);
    return dek;
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
    assertByteLength(
        wrapped,
        AES_256_WRAPPED_KEY_BYTES,
        "VAULT_WRAPPED_DEK_INVALID",
    );
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
    kek: VaultKek,
    extractable = false,
): Promise<Result<CryptoKey, string>> {
    try {
        const dek = await unwrapDEK(slot.WrappedDEK, kek, extractable);
        return ok(dek);
    } catch (error) {
        if (isPlatformCryptoUnavailable(error)) {
            return err(PLATFORM_CRYPTO_UNAVAILABLE);
        }
        return err("DEK_UNWRAP_FAILED");
    }
}

export async function openPrimarySlot(
    slot: VaultUtilTypes.KeySlot & { Kind: VaultUtilTypes.KeySlotKind.PRIMARY },
    masterPassword: string,
    vaultId: string,
    secondFactorHkdfBase: VaultHkdfKey | null,
    extractable = false,
): Promise<Result<CryptoKey, string>> {
    const salt = base64ToUint8(slot.Salt);
    const kdfConfig = new KeyDerivationConfig_Argon2ID(
        slot.KDFConfigArgon2ID?.memLimit ??
            KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
        slot.KDFConfigArgon2ID?.opsLimit ??
            KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
    );

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

    const pwKey = await derivePasswordKey(masterPassword, salt, kdfConfig);
    let kek: VaultKek;
    try {
        kek = await deriveKEK(pwKey, kekInfo, secondFactorHkdfBase, hkdfSalt);
    } catch (error) {
        if (isPlatformCryptoUnavailable(error)) {
            return err(PLATFORM_CRYPTO_UNAVAILABLE);
        }
        return err("KEK_DERIVATION_FAILED");
    } finally {
        pwKey.fill(0);
    }

    try {
        return await unwrapDEKFromSlot(slot, kek, extractable);
    } finally {
        getEnvelopeCrypto().disposeKek(kek);
    }
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

    let kek: VaultKek;
    try {
        kek = await deriveRecoveryKEK(recoveryCode, salt, kdfConfig);
    } catch (error) {
        if (isPlatformCryptoUnavailable(error)) {
            return err(PLATFORM_CRYPTO_UNAVAILABLE);
        }
        return err("RECOVERY_KEK_FAILED");
    }

    try {
        return await unwrapDEKFromSlot(slot, kek, extractable);
    } finally {
        getEnvelopeCrypto().disposeKek(kek);
    }
}
