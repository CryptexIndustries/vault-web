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
import type { SecondFactorEnrollmentResult } from "./second-factor";
import { uint8ToBase64 } from "../encoding";
import type { VaultHkdfKey, VaultKek } from "../envelope-crypto";
import { getEnvelopeCrypto } from "../runtime";

export type EnvelopeCreateResult = {
    blob: EncryptedBlob;
    recoveryCode: string;
    secondFactorDisplaySecret?: string;
};

export type VaultUnlockOptions = {
    masterPassword: string;
    useRecovery?: boolean;
    recoveryCode?: string;
    secondFactorHkdfBase?: VaultHkdfKey | null;
};

/** Current credentials needed to re-derive the (extractable) DEK before re-wrapping. */
export type RewrapCredentials = {
    masterPassword: string;
    secondFactorHkdfBase: VaultHkdfKey | null;
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

export async function createEnvelopeEncryptedBlob(
    vaultBytes: Uint8Array,
    masterPassword: string,
    vaultId: string,
    primaryFactor: SecondFactorEnrollmentResult,
    kdfConfig: EnvelopeKdfConfig = new KeyDerivationConfig_Argon2ID(),
): Promise<EnvelopeCreateResult> {
    const primarySalt = generateRandomSalt();
    const recoverySalt = generateRandomSalt();
    const hkdfSaltNo2fa =
        primaryFactor.kind === VaultUtilTypes.SecondFactorKind.NONE
            ? generateRandomSalt()
            : null;

    const dekExtractable = await generateExtractableDEK();
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
            primaryFactor.hkdfBaseKey,
            hkdfSaltNo2fa,
        );
    } finally {
        pwKey.fill(0);
    }
    const wrappedPrimary = await wrapAndDisposeKek(dekExtractable, primaryKek);

    const recoveryCode = generateRecoveryCode();
    const recoveryKek = await deriveRecoveryKEK(
        recoveryCode,
        recoverySalt,
        kdfConfig,
    );
    const wrappedRecovery = await wrapAndDisposeKek(
        dekExtractable,
        recoveryKek,
    );

    const { ciphertext, iv } = await encryptWithDEK(dekExtractable, vaultBytes);

    const webauthnSlotMeta =
        primaryFactor.kind === VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF &&
        primaryFactor.webauthnCredentialId &&
        primaryFactor.webauthnPrfSalt
            ? {
                  credentialId: primaryFactor.webauthnCredentialId,
                  prfSalt: primaryFactor.webauthnPrfSalt,
              }
            : undefined;

    const slots = [
        encodeSlot(
            VaultUtilTypes.KeySlotKind.PRIMARY,
            primaryFactor.kind,
            wrappedPrimary,
            primarySalt,
            kdfConfig,
            hkdfSaltNo2fa,
            vaultId,
            {
                webauthn: webauthnSlotMeta,
                secondFactorSalt: primaryFactor.passphraseSalt,
            },
        ),
        encodeSlot(
            VaultUtilTypes.KeySlotKind.RECOVERY,
            VaultUtilTypes.SecondFactorKind.NONE,
            wrappedRecovery,
            recoverySalt,
            kdfConfig,
            null,
            vaultId,
        ),
    ];

    const envelope = buildKeyEnvelope(slots, primaryFactor.kind, vaultId);

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
    blob.Salt = uint8ToBase64(primarySalt);
    blob.HeaderIV = iv;
    blob.Envelope = envelope;

    return {
        blob,
        recoveryCode,
        secondFactorDisplaySecret: primaryFactor.displaySecret,
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
            options.secondFactorHkdfBase ?? null,
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
    return Object.assign(existing, {
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
        creds.secondFactorHkdfBase,
        true,
    );
}

function webauthnSlotMetaFromFactor(
    factor: SecondFactorEnrollmentResult,
): { credentialId: string; prfSalt: string } | undefined {
    return factor.kind === VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF &&
        factor.webauthnCredentialId &&
        factor.webauthnPrfSalt
        ? {
              credentialId: factor.webauthnCredentialId,
              prfSalt: factor.webauthnPrfSalt,
          }
        : undefined;
}

/**
 * Rebuilds the PRIMARY slot with a new master password and/or second factor.
 * The DEK (and therefore the encrypted vault ciphertext) is unchanged; only the
 * key-wrapping changes. Requires current credentials to unwrap the DEK first.
 */
export async function reconfigurePrimaryFactor(
    blob: EncryptedBlob,
    vaultId: string,
    currentCreds: RewrapCredentials,
    next: {
        masterPassword: string;
        primaryFactor: SecondFactorEnrollmentResult;
    },
    kdfConfig: EnvelopeKdfConfig = new KeyDerivationConfig_Argon2ID(),
): Promise<Result<EncryptedBlob, string>> {
    if (!blob.Envelope || !isEnvelopeBlob(blob)) {
        return err("NOT_ENVELOPE_BLOB");
    }

    const dekRes = await openExtractableDEK(blob, vaultId, currentCreds);
    if (dekRes.isErr()) return err(dekRes.error);
    const dek = dekRes.value;

    const primarySalt = generateRandomSalt();
    const hkdfSaltNo2fa =
        next.primaryFactor.kind === VaultUtilTypes.SecondFactorKind.NONE
            ? generateRandomSalt()
            : null;

    const pwKey = await derivePasswordKey(
        next.masterPassword,
        primarySalt,
        kdfConfig,
    );
    let primaryKek: VaultKek;
    try {
        primaryKek = await deriveKEK(
            pwKey,
            buildKekInfo(vaultId),
            next.primaryFactor.hkdfBaseKey,
            hkdfSaltNo2fa,
        );
    } finally {
        pwKey.fill(0);
    }
    const wrappedPrimary = await wrapAndDisposeKek(dek, primaryKek);

    const newPrimarySlot = encodeSlot(
        VaultUtilTypes.KeySlotKind.PRIMARY,
        next.primaryFactor.kind,
        wrappedPrimary,
        primarySalt,
        kdfConfig,
        hkdfSaltNo2fa,
        vaultId,
        {
            webauthn: webauthnSlotMetaFromFactor(next.primaryFactor),
            secondFactorSalt: next.primaryFactor.passphraseSalt,
        },
    );

    const slots = blob.Envelope.Slots.map((slot) =>
        slot.Kind === VaultUtilTypes.KeySlotKind.PRIMARY
            ? newPrimarySlot
            : slot,
    );
    const envelope = buildKeyEnvelope(slots, next.primaryFactor.kind, vaultId);

    const updated = Object.assign(blob, {
        Envelope: envelope,
        Salt: uint8ToBase64(primarySalt),
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

    const recoverySalt = generateRandomSalt();
    const recoveryCode = generateRecoveryCode();
    const recoveryKek = await deriveRecoveryKEK(
        recoveryCode,
        recoverySalt,
        kdfConfig,
    );
    const wrappedRecovery = await wrapAndDisposeKek(dek, recoveryKek);

    const newRecoverySlot = encodeSlot(
        VaultUtilTypes.KeySlotKind.RECOVERY,
        VaultUtilTypes.SecondFactorKind.NONE,
        wrappedRecovery,
        recoverySalt,
        kdfConfig,
        null,
        vaultId,
    );

    const hasRecovery = blob.Envelope.Slots.some(
        (slot) => slot.Kind === VaultUtilTypes.KeySlotKind.RECOVERY,
    );
    const slots = hasRecovery
        ? blob.Envelope.Slots.map((slot) =>
              slot.Kind === VaultUtilTypes.KeySlotKind.RECOVERY
                  ? newRecoverySlot
                  : slot,
          )
        : [...blob.Envelope.Slots, newRecoverySlot];

    const envelope = buildKeyEnvelope(
        slots,
        blob.Envelope.PrimaryFactorKind,
        vaultId,
    );
    const updated = Object.assign(blob, {
        Envelope: envelope,
    }) as EncryptedBlob;

    return ok({ blob: updated, recoveryCode });
}

export async function migrateLegacyBlobToEnvelope(
    vaultBytes: Uint8Array,
    masterPassword: string,
    vaultId: string,
    primaryFactor: SecondFactorEnrollmentResult,
): Promise<EnvelopeCreateResult> {
    return createEnvelopeEncryptedBlob(
        vaultBytes,
        masterPassword,
        vaultId,
        primaryFactor,
    );
}
