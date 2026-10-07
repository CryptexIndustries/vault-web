import { MMKV } from "react-native-mmkv";

import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import type { VaultHkdfKey } from "@cryptex-industries/vault-core/envelope-crypto";
import {
    DecryptDataBlob,
    EncryptedBlob,
    hashSecret,
    isPrimarySlot,
    KeyDerivationConfig_Argon2ID,
} from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    deriveAdditionalKeyProtectionKeyMaterial,
    ENVELOPE_VERSION,
    isEnvelopeBlob,
    openPrimarySlot,
} from "@cryptex-industries/vault-core/vault-utils/envelope-encryption";
import {
    createEnvelopeEncryptedBlob,
    migrateLegacyBlobToEnvelope,
    openEnvelopeBlob,
    reconfigureAdditionalKeyProtection,
    reencryptVaultBytesWithDEK,
    rotateRecoveryCode,
    rotateVaultDataKey,
} from "@cryptex-industries/vault-core/vault-utils/vault-envelope-ops";
import {
    enrollAdditionalKeyProtection,
    makeWebAuthnUnlockFromSlot,
    resolveAdditionalKeyProtectionForUnlock,
    type AdditionalKeyProtectionEnrollmentResult,
    type AdditionalKeyProtectionSource,
} from "@cryptex-industries/vault-core/vault-utils/additional-key-protection";
import {
    clearDeviceAdditionalKeyProtection,
    setDeviceAdditionalKeyProtectionRawKey,
} from "@/app_lib/vault-utils/vault-key-store";
import type {
    VaultCreateAdditionalKeyProtectionOptions,
    VaultDecryptSuccess,
    VaultRevealSecrets,
    VaultUnlockParams,
} from "@cryptex-industries/vault-core/vault-utils/vault-unlock-types";
import {
    EncryptionFormGroupSchemaType,
    NewVaultFormSchemaType,
    VaultEncryptionConfigurationsFormElementType,
} from "@cryptex-industries/vault-core/vault-utils/form-schemas";
import { ensureSyncKemKeypair } from "@cryptex-industries/vault-core/vault-utils/post-quantum-kem";
import { ensureSyncSigningKeypair } from "@cryptex-industries/vault-core/vault-utils/sync-signing";
import {
    Directory,
    LinkedDevices,
    TOTP,
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { err, ok, Result } from "neverthrow";
import { ulid } from "ulidx";
import {
    applyImportToVault,
    type ImportResult,
} from "@cryptex-industries/vault-core/vault-utils/import-export";
import {
    base64ToUint8,
    uint8ToBase64,
} from "@cryptex-industries/vault-core/encoding";

export type {
    VaultCreateAdditionalKeyProtectionOptions,
    VaultDecryptSuccess,
    VaultRevealSecrets,
    VaultUnlockParams,
} from "@cryptex-industries/vault-core/vault-utils/vault-unlock-types";

export type VaultSecurityUpdate = VaultRevealSecrets & {
    dataKeyRotated: boolean;
    deviceKeyProtectionCached: boolean;
    sessionDek?: CryptoKey;
};

/** Mobile-friendly defaults; still accepts web vaults with 256 MiB Argon2. */
const MOBILE_DEFAULT_MEM_LIMIT = 128;
const MOBILE_DEFAULT_OPS_LIMIT = 3;

function isProtectionPhrase(
    kind: VaultUtilTypes.AdditionalKeyProtectionKind,
): boolean {
    return (
        kind ===
            VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128 ||
        kind ===
            VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_256
    );
}

async function cacheDeviceProtectionPhrase(
    vaultDbIndex: number,
    kind: VaultUtilTypes.AdditionalKeyProtectionKind,
    protectionPhrase: string,
    saltB64: string,
    kdfConfig: KeyDerivationConfig_Argon2ID,
): Promise<void> {
    const secretBytes = new TextEncoder().encode(protectionPhrase);
    let ikm: Uint8Array | null = null;
    try {
        ikm = await deriveAdditionalKeyProtectionKeyMaterial(
            secretBytes,
            base64ToUint8(saltB64),
            kdfConfig,
        );
        await setDeviceAdditionalKeyProtectionRawKey(vaultDbIndex, ikm, kind);
    } finally {
        secretBytes.fill(0);
        ikm?.fill(0);
    }
}

function isValidArgon2idConfig(config: KeyDerivationConfig_Argon2ID): boolean {
    return (
        Number.isInteger(config.memLimit) &&
        Number.isInteger(config.opsLimit) &&
        config.memLimit >= KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT &&
        config.memLimit <= KeyDerivationConfig_Argon2ID.MAX_MEM_LIMIT &&
        config.opsLimit >= KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT &&
        config.opsLimit <= KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT
    );
}

const mmkv = new MMKV({ id: "cryptex-vault-db" });

const VAULT_IDS_KEY = "vaults:ids";
const VAULT_NEXT_ID_KEY = "vaults:nextId";
const vaultDataKey = (id: number) => `vault:data:${id}`;
const platformCryptoErrorOr = (error: unknown, fallback: string): string =>
    error instanceof Error &&
    error.message === "VAULT_PLATFORM_CRYPTO_UNAVAILABLE"
        ? error.message
        : fallback;

function readVaultIds(): number[] {
    const raw = mmkv.getString(VAULT_IDS_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as number[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeVaultIds(ids: number[]): void {
    mmkv.set(VAULT_IDS_KEY, JSON.stringify(ids));
}

function nextVaultId(): number {
    const current = mmkv.getNumber(VAULT_NEXT_ID_KEY) ?? 1;
    mmkv.set(VAULT_NEXT_ID_KEY, current + 1);
    return current;
}

function isSessionDekKey(value: CryptoKey | Uint8Array): value is CryptoKey {
    return (
        typeof value === "object" &&
        value !== null &&
        "type" in value &&
        (value as CryptoKey).type === "secret"
    );
}

export async function loadVault(id: number): Promise<Uint8Array | undefined> {
    const b64 = mmkv.getString(vaultDataKey(id));
    return b64 == null ? undefined : base64ToUint8(b64);
}

/** Saves existing metadata, or creates a row when no index is provided. */
export async function saveVault(
    index: number | undefined,
    data: Uint8Array,
): Promise<number> {
    if (index != null) {
        if (await loadVault(index)) {
            mmkv.set(vaultDataKey(index), uint8ToBase64(data));
        }
        return index;
    }
    const id = nextVaultId();
    mmkv.set(vaultDataKey(id), uint8ToBase64(data));
    const ids = readVaultIds();
    ids.push(id);
    writeVaultIds(ids);
    return id;
}

export async function deleteVault(id: number): Promise<void> {
    mmkv.delete(vaultDataKey(id));
    writeVaultIds(readVaultIds().filter((storedId) => storedId !== id));
}

export async function listVaults(): Promise<VaultMetadata[]> {
    const vaults: VaultMetadata[] = [];
    for (const id of readVaultIds()) {
        const data = await loadVault(id);
        if (data) {
            vaults.push(VaultMetadata.deserializeMetadataBinary(data, id));
        }
    }
    return vaults;
}

export class VaultMetadata implements VaultUtilTypes.VaultMetadata {
    public Version: number;
    public DBIndex?: number;

    public Name: string;
    public Description: string;
    public CreatedAt: string;
    public LastUsed: string | undefined;
    public Blob: EncryptedBlob | undefined;

    public Icon: string;
    public Color: string;

    constructor() {
        this.Version = 1;
        this.Name = "";
        this.Description = "";
        this.CreatedAt = new Date().toISOString();
        this.LastUsed = undefined;
        this.Blob = undefined;
        this.Icon = "";
        this.Color = "";
    }

    public static async createNewVault(
        formData: NewVaultFormSchemaType,
        encryptionFormData: EncryptionFormGroupSchemaType,
        seedVault = false,
        seedCount = 0,
        options?: VaultCreateAdditionalKeyProtectionOptions,
        initialImport?: ImportResult,
    ): Promise<{
        metadata: VaultMetadata;
        revealSecrets: VaultRevealSecrets;
        dek: CryptoKey;
        vault: Vault;
        enrolledProtection: AdditionalKeyProtectionEnrollmentResult;
    }> {
        const vaultMetadata = new VaultMetadata();
        const vaultId = ulid();

        vaultMetadata.Name = formData.Name;
        vaultMetadata.Description = formData.Description;
        vaultMetadata.CreatedAt = new Date().toISOString();
        vaultMetadata.LastUsed = undefined;

        const freshVault = new Vault(seedVault, seedCount);
        await ensureSyncSigningKeypair(freshVault.LinkedDevices);
        await ensureSyncKemKeypair(freshVault.LinkedDevices);
        const vaultToEncrypt = initialImport
            ? (await applyImportToVault(freshVault, initialImport)).vault
            : freshVault;
        const _vaultBytes =
            VaultUtilTypes.Vault.encode(vaultToEncrypt).finish();

        const additionalKeyProtectionSource: AdditionalKeyProtectionSource =
            options?.additionalKeyProtection ?? {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            };

        const requestedMem = encryptionFormData.EncryptionConfig.memLimit;
        const requestedOps = encryptionFormData.EncryptionConfig.opsLimit;
        const memLimit =
            requestedMem === KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT
                ? MOBILE_DEFAULT_MEM_LIMIT
                : requestedMem;
        const opsLimit =
            requestedOps === KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT
                ? MOBILE_DEFAULT_OPS_LIMIT
                : requestedOps;
        const effectiveKdfConfig = new KeyDerivationConfig_Argon2ID(
            memLimit,
            opsLimit,
        );

        const primaryProtection: AdditionalKeyProtectionEnrollmentResult =
            additionalKeyProtectionSource.kind ===
            VaultUtilTypes.AdditionalKeyProtectionKind.NONE
                ? {
                      kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
                      hkdfBaseKey: null,
                  }
                : await enrollAdditionalKeyProtection(
                      additionalKeyProtectionSource,
                      vaultId,
                      undefined,
                      effectiveKdfConfig,
                  );

        const envelopeResult = await createEnvelopeEncryptedBlob(
            _vaultBytes,
            encryptionFormData.Secret,
            vaultId,
            primaryProtection,
            effectiveKdfConfig,
        );

        vaultMetadata.Blob = envelopeResult.blob;

        const revealSecrets: VaultRevealSecrets = {
            recoveryCode: envelopeResult.recoveryCode,
            protectionPhrase: envelopeResult.protectionPhrase,
            additionalKeyProtectionKind: additionalKeyProtectionSource.kind,
        };

        const dek = await openEnvelopeBlob(envelopeResult.blob, vaultId, {
            masterPassword: encryptionFormData.Secret,
            additionalKeyProtectionHkdfBase: primaryProtection.hkdfBaseKey,
        });
        if (dek.isErr()) {
            throw new Error(`Post-create unlock failed: ${dek.error}`);
        }

        return {
            metadata: vaultMetadata,
            revealSecrets,
            dek: dek.value.dek,
            vault: vaultToEncrypt,
            enrolledProtection: primaryProtection,
        };
    }

    public async save(
        vaultInstance: VaultUtilTypes.Vault | null,
        dek: CryptoKey | Uint8Array,
    ): Promise<void> {
        if (this.Blob == null) {
            throw new Error("Cannot save, vault blob is null");
        }

        if (vaultInstance != null) {
            this.LastUsed = new Date().toISOString();
            const _vaultBytes =
                VaultUtilTypes.Vault.encode(vaultInstance).finish();

            if (
                !isSessionDekKey(dek) ||
                !this.Blob.Envelope ||
                !isEnvelopeBlob(this.Blob)
            ) {
                throw new Error("Invalid encryption key type for save");
            }

            const kdfConfig = new KeyDerivationConfig_Argon2ID(
                this.Blob.KDFConfigArgon2ID?.memLimit ??
                    KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                this.Blob.KDFConfigArgon2ID?.opsLimit ??
                    KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
            );
            this.Blob = await reencryptVaultBytesWithDEK(
                _vaultBytes,
                dek,
                this.Blob,
                this.Blob.Envelope,
                kdfConfig,
            );
        }

        const id = await saveVault(
            this.DBIndex,
            VaultUtilTypes.VaultMetadata.encode(this).finish(),
        );
        this.DBIndex = id;
    }

    public async persistAdditionalKeyProtectionEnrollment(
        enrollment: AdditionalKeyProtectionEnrollmentResult,
    ): Promise<void> {
        if (
            this.DBIndex == null ||
            enrollment.kind === VaultUtilTypes.AdditionalKeyProtectionKind.NONE
        ) {
            return;
        }

        if (
            enrollment.kind ===
            VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF
        ) {
            if (
                !enrollment.webauthnCredentialId ||
                !enrollment.webauthnPrfSalt
            ) {
                throw new Error("WEBAUTHN_ENROLLMENT_METADATA_MISSING");
            }
            return;
        }

        // Re-derive IKM from one-time display secret so we can persist raw bytes
        // (enrollment CryptoKeys are non-extractable).
        if (enrollment.protectionPhrase && enrollment.protectionPhraseSalt) {
            await cacheDeviceProtectionPhrase(
                this.DBIndex,
                enrollment.kind,
                enrollment.protectionPhrase,
                enrollment.protectionPhraseSalt,
                this.slotKdfConfig(this.getPrimarySlot()),
            );
        }
    }

    private requireVaultID(): string {
        if (!this.Blob || !this.Blob.Envelope) {
            throw new Error("Vault blob or envelope is null");
        }

        if (!this.Blob.Envelope.VaultID) {
            throw new Error("Vault ID is missing");
        }

        return this.Blob.Envelope.VaultID;
    }

    private backfillVaultID(): void {
        if (!this.Blob?.Envelope) return;
        if (!this.Blob.Envelope.VaultID) {
            this.Blob.Envelope.VaultID = ulid();
        }
    }

    private getPrimarySlot(): VaultUtilTypes.KeySlot | undefined {
        return this.Blob?.Envelope?.Slots.find(
            (s) => s.Kind === VaultUtilTypes.KeySlotKind.PRIMARY,
        );
    }

    private slotKdfConfig(
        slot: VaultUtilTypes.KeySlot | undefined,
    ): KeyDerivationConfig_Argon2ID {
        return new KeyDerivationConfig_Argon2ID(
            slot?.KDFConfigArgon2ID?.memLimit ??
                KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
            slot?.KDFConfigArgon2ID?.opsLimit ??
                KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
        );
    }

    private async resolveCurrentAdditionalKeyProtection(
        passphrase?: string,
    ): Promise<VaultHkdfKey | null> {
        if (!this.Blob?.Envelope) return null;

        const kind = this.Blob.Envelope.PrimaryProtectionKind;

        if (kind === VaultUtilTypes.AdditionalKeyProtectionKind.NONE)
            return null;

        const primarySlot = this.getPrimarySlot();

        let resolvedWebAuthnUnlock: (() => Promise<VaultHkdfKey>) | undefined;
        if (
            kind === VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF &&
            primarySlot?.WebauthnCredentialId &&
            primarySlot?.WebauthnPrfSalt
        )
            resolvedWebAuthnUnlock = makeWebAuthnUnlockFromSlot(
                primarySlot.WebauthnCredentialId,
                primarySlot.WebauthnPrfSalt,
            );

        return resolveAdditionalKeyProtectionForUnlock(this.DBIndex, kind, {
            protectionPhrase: passphrase?.trim() || undefined,
            protectionPhraseSaltB64: primarySlot?.ProtectionPhraseSalt,
            protectionPhraseKdfConfig: this.slotKdfConfig(primarySlot),
            webAuthnUnlock: resolvedWebAuthnUnlock,
        });
    }

    private currentProtectionEnrollment(
        hkdfBaseKey: VaultHkdfKey | null,
    ): AdditionalKeyProtectionEnrollmentResult {
        if (!this.Blob?.Envelope) {
            return {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
                hkdfBaseKey: null,
            };
        }

        const slot = this.getPrimarySlot();
        return {
            kind: this.Blob.Envelope.PrimaryProtectionKind,
            hkdfBaseKey,
            protectionPhraseSalt: slot?.ProtectionPhraseSalt || undefined,
            webauthnCredentialId: slot?.WebauthnCredentialId || undefined,
            webauthnPrfSalt: slot?.WebauthnPrfSalt || undefined,
        };
    }

    private envelopeKdfConfig(): KeyDerivationConfig_Argon2ID {
        return new KeyDerivationConfig_Argon2ID(
            this.Blob?.KDFConfigArgon2ID?.memLimit ??
                KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
            this.Blob?.KDFConfigArgon2ID?.opsLimit ??
                KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
        );
    }

    /** Reauthenticate solely to wrap this key for biometric enrollment. */
    public async prepareBiometricUnlock(
        masterPassword: string,
        protectionPhrase?: string,
    ): Promise<Result<CryptoKey, string>> {
        if (!this.Blob?.Envelope || !isEnvelopeBlob(this.Blob)) {
            return err("NOT_ENVELOPE_BLOB");
        }
        const slot = this.getPrimarySlot();
        if (!slot || !isPrimarySlot(slot)) return err("PRIMARY_SLOT_MISSING");
        try {
            const additionalKeyProtection =
                await this.resolveCurrentAdditionalKeyProtection(
                    protectionPhrase,
                );
            return await openPrimarySlot(
                slot,
                masterPassword,
                this.requireVaultID(),
                additionalKeyProtection,
                true,
            );
        } catch {
            return err("BIOMETRIC_CREDENTIALS_FAILED");
        }
    }

    public async reconfigureSecurity(params: {
        currentMasterPassword: string;
        currentProtectionPhrase?: string;
        /** When set, unwrap DEK via recovery slot (forgot-password path). */
        currentRecoveryCode?: string;
        newMasterPassword?: string;
        additionalKeyProtection: AdditionalKeyProtectionSource;
        kdfConfig?: KeyDerivationConfig_Argon2ID;
        rotateDataKey?: boolean;
        /** Current unlocked payload for a single atomic envelope + vault save. */
        unlockedVault?: Vault;
        unlockedVaultDEK?: CryptoKey;
    }): Promise<Result<VaultSecurityUpdate, string>> {
        if (
            this.Blob == null ||
            !this.Blob.Envelope ||
            !isEnvelopeBlob(this.Blob)
        ) {
            return err("NOT_ENVELOPE_BLOB");
        }
        if (this.DBIndex == null) {
            return err("VAULT_DB_INDEX_MISSING");
        }

        const kdfConfig = params.kdfConfig ?? this.envelopeKdfConfig();
        if (!isValidArgon2idConfig(kdfConfig)) {
            return err("INVALID_KDF_CONFIG");
        }
        const vaultId = this.requireVaultID();
        const useRecovery =
            !!params.currentRecoveryCode &&
            params.currentRecoveryCode.length > 0;

        if (
            params.additionalKeyProtection.kind ===
            VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF
        ) {
            return err("WEBAUTHN_PRF_UNSUPPORTED");
        }

        let currentAdditionalKeyProtection: VaultHkdfKey | null = null;
        if (!useRecovery) {
            if (!params.currentMasterPassword.trim()) {
                return err("CURRENT_PASSWORD_REQUIRED");
            }
            try {
                currentAdditionalKeyProtection =
                    await this.resolveCurrentAdditionalKeyProtection(
                        params.currentProtectionPhrase,
                    );
            } catch (error) {
                return err(
                    platformCryptoErrorOr(
                        error,
                        "CURRENT_ADDITIONAL_KEY_PROTECTION_FAILED",
                    ),
                );
            }
        }

        let enrolled: AdditionalKeyProtectionEnrollmentResult;
        try {
            enrolled =
                params.additionalKeyProtection.kind ===
                VaultUtilTypes.AdditionalKeyProtectionKind.NONE
                    ? {
                          kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
                          hkdfBaseKey: null,
                      }
                    : await enrollAdditionalKeyProtection(
                          params.additionalKeyProtection,
                          vaultId,
                          undefined,
                          kdfConfig,
                      );
        } catch (error) {
            return err(
                platformCryptoErrorOr(
                    error,
                    "ADDITIONAL_KEY_PROTECTION_ENROLL_FAILED",
                ),
            );
        }

        const newPassword =
            params.newMasterPassword && params.newMasterPassword.length > 0
                ? params.newMasterPassword
                : useRecovery
                  ? undefined
                  : params.currentMasterPassword;

        if (!newPassword) {
            return err("NEW_PASSWORD_REQUIRED");
        }

        const previousBlob = this.Blob;
        let workingBlob = Object.assign(
            Object.create(EncryptedBlob.prototype) as EncryptedBlob,
            VaultUtilTypes.EncryptedBlob.decode(
                VaultUtilTypes.EncryptedBlob.encode(previousBlob).finish(),
            ),
        );
        if (
            params.rotateDataKey &&
            params.unlockedVault &&
            params.unlockedVaultDEK
        ) {
            workingBlob = await reencryptVaultBytesWithDEK(
                VaultUtilTypes.Vault.encode(params.unlockedVault).finish(),
                params.unlockedVaultDEK,
                workingBlob,
                workingBlob.Envelope!,
                kdfConfig,
            );
        }
        const currentCredentials = {
            masterPassword: useRecovery ? "" : params.currentMasterPassword,
            additionalKeyProtectionHkdfBase: currentAdditionalKeyProtection,
            useRecovery,
            recoveryCode: params.currentRecoveryCode,
        };
        let candidate: EncryptedBlob;
        let recoveryCode = "";
        let sessionDek: CryptoKey | undefined;
        if (params.rotateDataKey) {
            const rotated = await rotateVaultDataKey(
                workingBlob,
                vaultId,
                currentCredentials,
                {
                    masterPassword: newPassword,
                    additionalKeyProtection: enrolled,
                },
                kdfConfig,
            );
            if (rotated.isErr()) return err(rotated.error);
            candidate = rotated.value.blob;
            recoveryCode = rotated.value.recoveryCode;
            sessionDek = rotated.value.dek;
        } else {
            const reconfigured = await reconfigureAdditionalKeyProtection(
                workingBlob,
                vaultId,
                currentCredentials,
                {
                    masterPassword: newPassword,
                    additionalKeyProtection: enrolled,
                },
                kdfConfig,
            );
            if (reconfigured.isErr()) return err(reconfigured.error);
            candidate = reconfigured.value;
        }

        this.Blob = candidate;
        try {
            await this.save(
                params.rotateDataKey ? null : (params.unlockedVault ?? null),
                params.rotateDataKey
                    ? new Uint8Array(0)
                    : (params.unlockedVaultDEK ?? new Uint8Array(0)),
            );
        } catch (error) {
            this.Blob = previousBlob;
            throw error;
        }
        let deviceKeyProtectionCached = true;
        try {
            await clearDeviceAdditionalKeyProtection(this.DBIndex);
            await this.persistAdditionalKeyProtectionEnrollment(enrolled);
        } catch {
            // The encrypted vault is already committed. A generated phrase
            // remains sufficient to unlock even if this device cache cannot
            // be refreshed, so return it to the user instead of losing it.
            deviceKeyProtectionCached = false;
        }

        return ok({
            recoveryCode,
            protectionPhrase: enrolled.protectionPhrase,
            additionalKeyProtectionKind: enrolled.kind,
            dataKeyRotated: !!params.rotateDataKey,
            deviceKeyProtectionCached,
            sessionDek,
        });
    }

    public async resetRecoveryCode(params: {
        currentMasterPassword: string;
        currentRecoveryCode?: string;
        currentProtectionPhrase?: string;
        rotateDataKey?: boolean;
        /** Current unlocked payload for a single atomic envelope + vault save. */
        unlockedVault?: Vault;
        unlockedVaultDEK?: CryptoKey;
    }): Promise<Result<VaultSecurityUpdate, string>> {
        if (
            this.Blob == null ||
            !this.Blob.Envelope ||
            !isEnvelopeBlob(this.Blob)
        ) {
            return err("NOT_ENVELOPE_BLOB");
        }
        if (this.DBIndex == null) {
            return err("VAULT_DB_INDEX_MISSING");
        }

        const kdfConfig = this.envelopeKdfConfig();
        const vaultId = this.requireVaultID();
        const useRecovery =
            !!params.currentRecoveryCode &&
            params.currentRecoveryCode.length > 0;

        let currentAdditionalKeyProtection: VaultHkdfKey | null = null;
        if (!useRecovery || params.rotateDataKey) {
            try {
                currentAdditionalKeyProtection =
                    await this.resolveCurrentAdditionalKeyProtection(
                        params.currentProtectionPhrase,
                    );
            } catch (error) {
                return err(
                    platformCryptoErrorOr(
                        error,
                        "CURRENT_ADDITIONAL_KEY_PROTECTION_FAILED",
                    ),
                );
            }
        }
        if (
            params.rotateDataKey &&
            this.Blob.Envelope.PrimaryProtectionKind !==
                VaultUtilTypes.AdditionalKeyProtectionKind.NONE &&
            !currentAdditionalKeyProtection
        ) {
            return err("CURRENT_ADDITIONAL_KEY_PROTECTION_FAILED");
        }

        const previousBlob = this.Blob;
        let workingBlob = Object.assign(
            Object.create(EncryptedBlob.prototype) as EncryptedBlob,
            VaultUtilTypes.EncryptedBlob.decode(
                VaultUtilTypes.EncryptedBlob.encode(previousBlob).finish(),
            ),
        );
        if (
            params.rotateDataKey &&
            params.unlockedVault &&
            params.unlockedVaultDEK
        ) {
            workingBlob = await reencryptVaultBytesWithDEK(
                VaultUtilTypes.Vault.encode(params.unlockedVault).finish(),
                params.unlockedVaultDEK,
                workingBlob,
                workingBlob.Envelope!,
                kdfConfig,
            );
        }
        const currentCredentials = {
            masterPassword: params.currentMasterPassword,
            additionalKeyProtectionHkdfBase: currentAdditionalKeyProtection,
            useRecovery,
            recoveryCode: params.currentRecoveryCode,
        };
        let candidate: EncryptedBlob;
        let recoveryCode: string;
        let sessionDek: CryptoKey | undefined;
        if (params.rotateDataKey) {
            if (!params.currentMasterPassword) {
                return err("MASTER_PASSWORD_REQUIRED_FOR_DEK_ROTATION");
            }
            const rotated = await rotateVaultDataKey(
                workingBlob,
                vaultId,
                currentCredentials,
                {
                    masterPassword: params.currentMasterPassword,
                    additionalKeyProtection: this.currentProtectionEnrollment(
                        currentAdditionalKeyProtection,
                    ),
                },
                kdfConfig,
            );
            if (rotated.isErr()) return err(rotated.error);
            candidate = rotated.value.blob;
            recoveryCode = rotated.value.recoveryCode;
            sessionDek = rotated.value.dek;
        } else {
            const rotated = await rotateRecoveryCode(
                workingBlob,
                vaultId,
                currentCredentials,
                kdfConfig,
            );
            if (rotated.isErr()) return err(rotated.error);
            candidate = rotated.value.blob;
            recoveryCode = rotated.value.recoveryCode;
        }

        this.Blob = candidate;
        try {
            await this.save(
                params.rotateDataKey ? null : (params.unlockedVault ?? null),
                params.rotateDataKey
                    ? new Uint8Array(0)
                    : (params.unlockedVaultDEK ?? new Uint8Array(0)),
            );
        } catch (error) {
            this.Blob = previousBlob;
            throw error;
        }

        return ok({
            recoveryCode,
            additionalKeyProtectionKind:
                this.Blob.Envelope?.PrimaryProtectionKind,
            dataKeyRotated: !!params.rotateDataKey,
            deviceKeyProtectionCached: true,
            sessionDek,
        });
    }

    public async decryptVault(
        secret: string,
        encryptionAlgorithm: VaultUtilTypes.EncryptionAlgorithm,
        keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
        keyDerivationFuncConfig: VaultEncryptionConfigurationsFormElementType,
        unlockParams?: VaultUnlockParams,
        webAuthnUnlock?: () => Promise<VaultHkdfKey>,
    ): Promise<Result<VaultDecryptSuccess, string>> {
        if (this.Blob == null) {
            return err("VAULT_BLOB_NULL");
        }

        const blobUpgradeResult = this.Blob.upgrade();
        let revealSecrets: VaultRevealSecrets | undefined;
        let dek: CryptoKey;
        let plaintext: Uint8Array;

        const masterPassword = unlockParams?.masterPassword ?? secret;
        const useRecovery = unlockParams?.useRecovery ?? false;
        const recoveryCode = unlockParams?.recoveryCode;

        if (this.Blob.Envelope && isEnvelopeBlob(this.Blob)) {
            const vaultId = this.requireVaultID();
            const primarySlot = this.getPrimarySlot();
            let resolvedWebAuthnUnlock = webAuthnUnlock;
            if (
                !resolvedWebAuthnUnlock &&
                this.Blob.Envelope.PrimaryProtectionKind ===
                    VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF
            ) {
                if (
                    primarySlot?.WebauthnCredentialId &&
                    primarySlot?.WebauthnPrfSalt
                ) {
                    resolvedWebAuthnUnlock = makeWebAuthnUnlockFromSlot(
                        primarySlot.WebauthnCredentialId,
                        primarySlot.WebauthnPrfSalt,
                    );
                }
            }

            let additionalProtectionKey: VaultHkdfKey | null = null;
            if (!useRecovery) {
                try {
                    additionalProtectionKey =
                        await resolveAdditionalKeyProtectionForUnlock(
                            this.DBIndex,
                            this.Blob.Envelope.PrimaryProtectionKind,
                            {
                                protectionPhrase:
                                    unlockParams?.protectionPhrase?.trim() ||
                                    undefined,
                                protectionPhraseSaltB64:
                                    primarySlot?.ProtectionPhraseSalt,
                                protectionPhraseKdfConfig:
                                    this.slotKdfConfig(primarySlot),
                                webAuthnUnlock: resolvedWebAuthnUnlock,
                            },
                        );
                } catch (error) {
                    return err(
                        error instanceof Error
                            ? error.message
                            : "ADDITIONAL_KEY_PROTECTION_RESOLVE_FAILED",
                    );
                }
            }

            const opened = await openEnvelopeBlob(this.Blob, vaultId, {
                masterPassword,
                useRecovery,
                recoveryCode,
                additionalKeyProtectionHkdfBase: additionalProtectionKey,
            });
            if (opened.isErr()) return err(opened.error);
            const enteredProtectionPhrase =
                unlockParams?.protectionPhrase?.trim();
            if (
                enteredProtectionPhrase &&
                this.DBIndex != null &&
                primarySlot?.ProtectionPhraseSalt &&
                isProtectionPhrase(this.Blob.Envelope.PrimaryProtectionKind)
            ) {
                // Cache only after the phrase has opened the envelope. Restore
                // needs it once; later unlocks on this device can use the cache.
                await cacheDeviceProtectionPhrase(
                    this.DBIndex,
                    this.Blob.Envelope.PrimaryProtectionKind,
                    enteredProtectionPhrase,
                    primarySlot.ProtectionPhraseSalt,
                    this.slotKdfConfig(primarySlot),
                ).catch(() => undefined);
            }
            dek = opened.value.dek;
            plaintext = opened.value.plaintext;
        } else {
            const hashedSecret = await hashSecret(secret);
            const decryptedVaultStringRes = await DecryptDataBlob(
                this.Blob,
                hashedSecret,
                encryptionAlgorithm,
                keyDerivationFunc,
                keyDerivationFuncConfig,
            );
            if (decryptedVaultStringRes.isErr()) {
                return err(decryptedVaultStringRes.error);
            }
            plaintext = decryptedVaultStringRes.value;

            if (this.Blob.Version < ENVELOPE_VERSION) {
                const vaultId = ulid();
                const migrated = await migrateLegacyBlobToEnvelope(
                    plaintext,
                    masterPassword,
                    vaultId,
                    {
                        kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
                        hkdfBaseKey: null,
                    },
                );
                this.Blob = migrated.blob;
                revealSecrets = {
                    recoveryCode: migrated.recoveryCode,
                };

                const reopened = await openEnvelopeBlob(this.Blob, vaultId, {
                    masterPassword,
                });
                if (reopened.isErr()) return err(reopened.error);
                dek = reopened.value.dek;
                plaintext = reopened.value.plaintext;
                blobUpgradeResult.requiresSave = true;
            } else {
                return err("INVALID_VAULT_VERSION");
            }
        }

        const vaultRawParsed = VaultUtilTypes.Vault.decode(plaintext);
        const vaultObject: Vault = Object.assign(new Vault(), vaultRawParsed);

        vaultObject.LinkedDevices = LinkedDevices.fromGeneric(
            vaultObject.LinkedDevices,
        );

        // Protobuf decoding supplies field defaults. Restore prototypes without
        // running creation constructors (and generating IDs we would overwrite).
        vaultObject.Credentials = vaultObject.Credentials.map(
            (credential: VaultCredential) => {
                if (credential.TOTP) {
                    credential.TOTP = Object.assign(
                        Object.create(TOTP.prototype) as TOTP,
                        credential.TOTP,
                    );
                }
                return Object.assign(
                    Object.create(VaultCredential.prototype) as VaultCredential,
                    credential,
                );
            },
        );
        vaultObject.Directories = vaultObject.Directories.map((directory) =>
            Object.assign(
                Object.create(Directory.prototype) as Directory,
                directory,
            ),
        );

        const vaultNeedsUpgrade =
            vaultObject.CurrentVersion < 4 && vaultObject.Version < 4;
        await vaultObject.upgrade();
        if (vaultNeedsUpgrade) {
            blobUpgradeResult.requiresSave = true;
        }

        const generatedSyncKeys = await ensureSyncSigningKeypair(
            vaultObject.LinkedDevices,
        );
        const generatedSyncKemKeys = await ensureSyncKemKeypair(
            vaultObject.LinkedDevices,
        );
        if (generatedSyncKeys || generatedSyncKemKeys) {
            blobUpgradeResult.requiresSave = true;
        }

        if (blobUpgradeResult.requiresSave && this.DBIndex != null) {
            await this.save(vaultObject, dek);
        }

        return ok({
            vault: vaultObject,
            dek,
            revealSecrets,
        });
    }

    public exportForLinking(cleanVaultInstance: Vault): Uint8Array {
        return VaultUtilTypes.Vault.encode(cleanVaultInstance).finish();
    }

    public static deserializeMetadataBinary(
        data: Uint8Array,
        dbIndex?: number,
    ): VaultMetadata {
        const rawData = VaultUtilTypes.VaultMetadata.decode(data);

        const vaultMetadata = Object.assign(new VaultMetadata(), rawData);

        if (dbIndex != null) vaultMetadata.DBIndex = dbIndex;

        if (vaultMetadata.Blob != null) {
            const restored = Object.assign(
                EncryptedBlob.CreateDefault(),
                vaultMetadata.Blob,
            );
            if (rawData.Blob?.Envelope) {
                restored.Envelope = rawData.Blob.Envelope;
            }
            vaultMetadata.Blob = restored;
        }
        vaultMetadata.backfillVaultID();

        return vaultMetadata;
    }
}

export const serializeVault = async (
    vaultInstance: Vault,
    existingEncryptedBlob: EncryptedBlob,
    dek: CryptoKey,
) => {
    const cleanVault = Object.assign(new Vault(), vaultInstance);
    cleanVault.LinkedDevices = new LinkedDevices();

    const _vaultBytes = VaultUtilTypes.Vault.encode(cleanVault).finish();

    if (
        !existingEncryptedBlob.Envelope ||
        !isEnvelopeBlob(existingEncryptedBlob)
    ) {
        throw new Error("Invalid key for serializeVault");
    }

    const kdfConfig = new KeyDerivationConfig_Argon2ID(
        existingEncryptedBlob.KDFConfigArgon2ID?.memLimit ??
            KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
        existingEncryptedBlob.KDFConfigArgon2ID?.opsLimit ??
            KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
    );
    const encryptedBlob = await reencryptVaultBytesWithDEK(
        _vaultBytes,
        dek,
        existingEncryptedBlob,
        existingEncryptedBlob.Envelope,
        kdfConfig,
    );

    const rawData = new Uint8Array(
        VaultUtilTypes.EncryptedBlob.encode(encryptedBlob).finish(),
    );

    return rawData;
};
