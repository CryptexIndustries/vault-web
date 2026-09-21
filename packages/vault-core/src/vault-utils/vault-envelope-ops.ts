/**
 * High-level envelope create / open / persist operations.
 */

import * as VaultUtilTypes from "../proto/vault";
import { err, ok, type Result } from "neverthrow";
import {
    EncryptedBlob,
    isPrimarySlot,
    KeyDerivationConfig_Argon2ID,
} from "./encryption";
import {
    buildKekInfo,
    buildKeyEnvelope,
    deriveKEK,
    derivePasswordKey,
    deriveRecoveryKEK,
    encryptWithDEK,
    decryptWithDEK,
    ENVELOPE_VERSION,
    encodeSlot,
    generateExtractableDEK,
    generateRandomSalt,
    generateRecoveryCode,
    isEnvelopeBlob,
    openPrimarySlot,
    openRecoverySlot,
    wrapDEK,
    type EnvelopeKdfConfig,
} from "./envelope-encryption";
import type { AdditionalKeyProtectionEnrollmentResult } from "./additional-key-protection";
import { uint8ToBase64 } from "../encoding";
import type { VaultHkdfKey, VaultKek } from "../envelope-crypto";
import { getEnvelopeCrypto } from "../runtime";

export type EnvelopeCreateResult = {
    blob: EncryptedBlob;
    recoveryCode: string;
    protectionPhrase?: string;
};

export type EnvelopeDekRotationResult = {
    blob: EncryptedBlob;
    recoveryCode: string;
    /** Fresh, non-extractable DEK to publish only after persistence succeeds. */
    dek: CryptoKey;
};

export type VaultUnlockOptions = {
    masterPassword: string;
    useRecovery?: boolean;
    recoveryCode?: string;
    additionalKeyProtectionHkdfBase?: VaultHkdfKey | null;
};

/** Current credentials needed to re-derive the (extractable) DEK before re-wrapping. */
export type RewrapCredentials = {
    masterPassword: string;
    additionalKeyProtectionHkdfBase: VaultHkdfKey | null;
    useRecovery?: boolean;
    recoveryCode?: string;
};

async function wrapAndDisposeKek(
    dek: CryptoKey,
    kek: VaultKek,
): Promise<Uint8Array> {
    try {
        return await wrapDEK(dek, kek);
    } finally {
        getEnvelopeCrypto().disposeKek(kek);
    }
}

function cloneEncryptedBlob(blob: EncryptedBlob): EncryptedBlob {
    return EncryptedBlob.fromBinary(
        VaultUtilTypes.EncryptedBlob.encode(blob).finish(),
    );
}

async function copyAsNonExtractableDEK(dek: CryptoKey): Promise<CryptoKey> {
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", dek));
    try {
        return await crypto.subtle.importKey(
            "raw",
            raw,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        );
    } finally {
        raw.fill(0);
    }
}

async function createPrimarySlot(
    dek: CryptoKey,
    masterPassword: string,
    vaultId: string,
    additionalKeyProtection: AdditionalKeyProtectionEnrollmentResult,
    kdfConfig: EnvelopeKdfConfig,
): Promise<{ slot: VaultUtilTypes.KeySlot; primarySalt: Uint8Array }> {
    const primarySalt = generateRandomSalt();
    const hkdfSaltWithoutProtection =
        additionalKeyProtection.kind ===
        VaultUtilTypes.AdditionalKeyProtectionKind.NONE
            ? generateRandomSalt()
            : null;
    const pwKey = await derivePasswordKey(
        masterPassword,
        primarySalt,
        kdfConfig,
    );
    let primaryKek: VaultKek;
    try {
        primaryKek = await deriveKEK(
            pwKey,
            buildKekInfo(vaultId),
            additionalKeyProtection.hkdfBaseKey,
            hkdfSaltWithoutProtection,
        );
    } finally {
        pwKey.fill(0);
    }

    const wrappedPrimary = await wrapAndDisposeKek(dek, primaryKek);
    return {
        primarySalt,
        slot: encodeSlot(
            VaultUtilTypes.KeySlotKind.PRIMARY,
            additionalKeyProtection.kind,
            wrappedPrimary,
            primarySalt,
            kdfConfig,
            hkdfSaltWithoutProtection,
            vaultId,
            {
                webauthn: webauthnSlotMetaFromProtection(
                    additionalKeyProtection,
                ),
                protectionPhraseSalt:
                    additionalKeyProtection.protectionPhraseSalt,
            },
        ),
    };
}

async function createRecoverySlot(
    dek: CryptoKey,
    vaultId: string,
    kdfConfig: EnvelopeKdfConfig,
): Promise<{ slot: VaultUtilTypes.KeySlot; recoveryCode: string }> {
    const recoverySalt = generateRandomSalt();
    const recoveryCode = generateRecoveryCode();
    const recoveryKek = await deriveRecoveryKEK(
        recoveryCode,
        recoverySalt,
        kdfConfig,
    );
    const wrappedRecovery = await wrapAndDisposeKek(dek, recoveryKek);

    return {
        recoveryCode,
        slot: encodeSlot(
            VaultUtilTypes.KeySlotKind.RECOVERY,
            VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            wrappedRecovery,
            recoverySalt,
            kdfConfig,
            null,
            vaultId,
        ),
    };
}

export async function createEnvelopeEncryptedBlob(
    vaultBytes: Uint8Array,
    masterPassword: string,
    vaultId: string,
    additionalKeyProtection: AdditionalKeyProtectionEnrollmentResult,
    kdfConfig: EnvelopeKdfConfig = new KeyDerivationConfig_Argon2ID(),
): Promise<EnvelopeCreateResult> {
    const dekExtractable = await generateExtractableDEK();
    const primary = await createPrimarySlot(
        dekExtractable,
        masterPassword,
        vaultId,
        additionalKeyProtection,
        kdfConfig,
    );
    const recovery = await createRecoverySlot(
        dekExtractable,
        vaultId,
        kdfConfig,
    );

    const { ciphertext, iv } = await encryptWithDEK(dekExtractable, vaultBytes);
    const slots = [primary.slot, recovery.slot];

    const envelope = buildKeyEnvelope(
        slots,
        additionalKeyProtection.kind,
        vaultId,
    );

    const blob = EncryptedBlob.CreateDefault();
    blob.Version = ENVELOPE_VERSION;
    blob.CurrentVersion = ENVELOPE_VERSION;
    blob.Algorithm = VaultUtilTypes.EncryptionAlgorithm.AES256;
    blob.KeyDerivationFunc = VaultUtilTypes.KeyDerivationFunction.Argon2ID;
    blob.KDFConfigArgon2ID = {
        memLimit: kdfConfig.memLimit,
        opsLimit: kdfConfig.opsLimit,
    };
    blob.Blob = ciphertext;
    blob.Salt = uint8ToBase64(primary.primarySalt);
    blob.HeaderIV = iv;
    blob.Envelope = envelope;

    return {
        blob,
        recoveryCode: recovery.recoveryCode,
        protectionPhrase: additionalKeyProtection.protectionPhrase,
    };
}

export async function openEnvelopeBlob(
    blob: EncryptedBlob,
    vaultId: string | undefined,
    options: VaultUnlockOptions,
): Promise<Result<{ dek: CryptoKey; plaintext: Uint8Array }, string>> {
    if (!blob.Envelope || !isEnvelopeBlob(blob)) {
        return err("NOT_ENVELOPE_BLOB");
    }

    let dekRes: Result<CryptoKey, string>;
    if (options.useRecovery && options.recoveryCode) {
        dekRes = await openRecoverySlot(blob.Envelope, options.recoveryCode);
    } else {
        const primarySlot = blob.Envelope.Slots.find(isPrimarySlot);
        if (!primarySlot || !isPrimarySlot(primarySlot))
            return err("PRIMARY_SLOT_MISSING");

        const fallbackVaultId = vaultId ?? blob.Envelope.VaultID;
        if (!fallbackVaultId) return err("VAULT_ID_MISSING");

        dekRes = await openPrimarySlot(
            primarySlot,
            options.masterPassword,
            fallbackVaultId,
            options.additionalKeyProtectionHkdfBase ?? null,
        );
    }

    if (dekRes.isErr()) return err(dekRes.error);

    const plainRes = await decryptWithDEK(
        dekRes.value,
        blob.Blob,
        blob.HeaderIV,
    );
    if (plainRes.isErr()) return err(plainRes.error);

    return ok({ dek: dekRes.value, plaintext: plainRes.value });
}

export async function reencryptVaultBytesWithDEK(
    vaultBytes: Uint8Array,
    dek: CryptoKey,
    existing: EncryptedBlob,
    envelope: VaultUtilTypes.KeyEnvelope,
    kdfConfig: EnvelopeKdfConfig,
): Promise<EncryptedBlob> {
    const { ciphertext, iv } = await encryptWithDEK(dek, vaultBytes);
    return Object.assign(cloneEncryptedBlob(existing), {
        Version: ENVELOPE_VERSION,
        CurrentVersion: ENVELOPE_VERSION,
        Algorithm: VaultUtilTypes.EncryptionAlgorithm.AES256,
        KeyDerivationFunc: VaultUtilTypes.KeyDerivationFunction.Argon2ID,
        KDFConfigArgon2ID: {
            memLimit: kdfConfig.memLimit,
            opsLimit: kdfConfig.opsLimit,
        },
        Blob: ciphertext,
        HeaderIV: iv,
        Envelope: envelope,
    }) as EncryptedBlob;
}

/** Re-derive the DEK as an extractable key so it can be re-wrapped into new slots. */
async function openExtractableDEK(
    blob: EncryptedBlob,
    vaultId: string | undefined,
    creds: RewrapCredentials,
): Promise<Result<CryptoKey, string>> {
    if (creds.useRecovery && creds.recoveryCode) {
        return openRecoverySlot(blob.Envelope!, creds.recoveryCode, true);
    }

    const primarySlot = blob.Envelope!.Slots.find(isPrimarySlot);
    if (!primarySlot || !isPrimarySlot(primarySlot))
        return err("PRIMARY_SLOT_MISSING");

    const fallbackVaultId = vaultId ?? blob.Envelope!.VaultID;
    if (!fallbackVaultId) return err("VAULT_ID_MISSING");

    return openPrimarySlot(
        primarySlot,
        creds.masterPassword,
        fallbackVaultId,
        creds.additionalKeyProtectionHkdfBase,
        true,
    );
}

function webauthnSlotMetaFromProtection(
    protection: AdditionalKeyProtectionEnrollmentResult,
): { credentialId: string; prfSalt: string } | undefined {
    return protection.kind ===
        VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF &&
        protection.webauthnCredentialId &&
        protection.webauthnPrfSalt
        ? {
              credentialId: protection.webauthnCredentialId,
              prfSalt: protection.webauthnPrfSalt,
          }
        : undefined;
}

/**
 * Rebuilds the PRIMARY slot with a new master password and/or additional key protection.
 * The DEK (and therefore the encrypted vault ciphertext) is unchanged; only the
 * key-wrapping changes. Requires current credentials to unwrap the DEK first.
 */
export async function reconfigureAdditionalKeyProtection(
    blob: EncryptedBlob,
    vaultId: string,
    currentCreds: RewrapCredentials,
    next: {
        masterPassword: string;
        additionalKeyProtection: AdditionalKeyProtectionEnrollmentResult;
    },
    kdfConfig: EnvelopeKdfConfig = new KeyDerivationConfig_Argon2ID(),
): Promise<Result<EncryptedBlob, string>> {
    if (!blob.Envelope || !isEnvelopeBlob(blob)) {
        return err("NOT_ENVELOPE_BLOB");
    }

    const dekRes = await openExtractableDEK(blob, vaultId, currentCreds);
    if (dekRes.isErr()) return err(dekRes.error);
    const dek = dekRes.value;

    const primary = await createPrimarySlot(
        dek,
        next.masterPassword,
        vaultId,
        next.additionalKeyProtection,
        kdfConfig,
    );

    const slots = blob.Envelope.Slots.map((slot) =>
        slot.Kind === VaultUtilTypes.KeySlotKind.PRIMARY ? primary.slot : slot,
    );
    const envelope = buildKeyEnvelope(
        slots,
        next.additionalKeyProtection.kind,
        vaultId,
    );

    const updated = Object.assign(cloneEncryptedBlob(blob), {
        Envelope: envelope,
        Salt: uint8ToBase64(primary.primarySalt),
        KDFConfigArgon2ID: {
            memLimit: kdfConfig.memLimit,
            opsLimit: kdfConfig.opsLimit,
        },
    }) as EncryptedBlob;

    return ok(updated);
}

/**
 * Generates a fresh recovery code and re-wraps the DEK into the RECOVERY slot.
 * The previous recovery code stops working immediately.
 */
export async function rotateRecoveryCode(
    blob: EncryptedBlob,
    vaultId: string,
    currentCreds: RewrapCredentials,
    kdfConfig: EnvelopeKdfConfig = new KeyDerivationConfig_Argon2ID(),
): Promise<Result<{ blob: EncryptedBlob; recoveryCode: string }, string>> {
    if (!blob.Envelope || !isEnvelopeBlob(blob)) {
        return err("NOT_ENVELOPE_BLOB");
    }

    const dekRes = await openExtractableDEK(blob, vaultId, currentCreds);
    if (dekRes.isErr()) return err(dekRes.error);
    const dek = dekRes.value;

    const recovery = await createRecoverySlot(dek, vaultId, kdfConfig);

    const hasRecovery = blob.Envelope.Slots.some(
        (slot) => slot.Kind === VaultUtilTypes.KeySlotKind.RECOVERY,
    );
    const slots = hasRecovery
        ? blob.Envelope.Slots.map((slot) =>
              slot.Kind === VaultUtilTypes.KeySlotKind.RECOVERY
                  ? recovery.slot
                  : slot,
          )
        : [...blob.Envelope.Slots, recovery.slot];

    const envelope = buildKeyEnvelope(
        slots,
        blob.Envelope.PrimaryProtectionKind,
        vaultId,
    );
    const updated = Object.assign(cloneEncryptedBlob(blob), {
        Envelope: envelope,
    }) as EncryptedBlob;

    return ok({ blob: updated, recoveryCode: recovery.recoveryCode });
}

/**
 * Generates a fresh DEK, re-encrypts the vault bytes, and rebuilds both key
 * slots. The returned DEK becomes active only after the caller persists the
 * returned blob.
 */
export async function rotateVaultDataKey(
    blob: EncryptedBlob,
    vaultId: string,
    currentCreds: RewrapCredentials,
    next: {
        masterPassword: string;
        additionalKeyProtection: AdditionalKeyProtectionEnrollmentResult;
    },
    kdfConfig: EnvelopeKdfConfig = new KeyDerivationConfig_Argon2ID(),
): Promise<Result<EnvelopeDekRotationResult, string>> {
    if (!blob.Envelope || !isEnvelopeBlob(blob)) {
        return err("NOT_ENVELOPE_BLOB");
    }

    const currentDekRes = await openExtractableDEK(blob, vaultId, currentCreds);
    if (currentDekRes.isErr()) return err(currentDekRes.error);

    const plaintextRes = await decryptWithDEK(
        currentDekRes.value,
        blob.Blob,
        blob.HeaderIV,
    );
    if (plaintextRes.isErr()) return err(plaintextRes.error);

    const plaintext = plaintextRes.value;
    try {
        const dek = await generateExtractableDEK();
        const primary = await createPrimarySlot(
            dek,
            next.masterPassword,
            vaultId,
            next.additionalKeyProtection,
            kdfConfig,
        );
        const recovery = await createRecoverySlot(dek, vaultId, kdfConfig);
        const encrypted = await encryptWithDEK(dek, plaintext);
        const envelope = buildKeyEnvelope(
            [primary.slot, recovery.slot],
            next.additionalKeyProtection.kind,
            vaultId,
        );

        const updated = Object.assign(cloneEncryptedBlob(blob), {
            Version: ENVELOPE_VERSION,
            CurrentVersion: ENVELOPE_VERSION,
            Algorithm: VaultUtilTypes.EncryptionAlgorithm.AES256,
            KeyDerivationFunc: VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            KDFConfigArgon2ID: {
                memLimit: kdfConfig.memLimit,
                opsLimit: kdfConfig.opsLimit,
            },
            Blob: encrypted.ciphertext,
            Salt: uint8ToBase64(primary.primarySalt),
            HeaderIV: encrypted.iv,
            Envelope: envelope,
        }) as EncryptedBlob;
        const sessionDek = await copyAsNonExtractableDEK(dek);

        return ok({
            blob: updated,
            recoveryCode: recovery.recoveryCode,
            dek: sessionDek,
        });
    } finally {
        plaintext.fill(0);
    }
}

export async function migrateLegacyBlobToEnvelope(
    vaultBytes: Uint8Array,
    masterPassword: string,
    vaultId: string,
    additionalKeyProtection: AdditionalKeyProtectionEnrollmentResult,
): Promise<EnvelopeCreateResult> {
    return createEnvelopeEncryptedBlob(
        vaultBytes,
        masterPassword,
        vaultId,
        additionalKeyProtection,
    );
}
