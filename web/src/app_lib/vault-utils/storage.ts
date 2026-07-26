import Dexie from "dexie";

import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import type { VaultHkdfKey } from "@cryptex-industries/vault-core/envelope-crypto";
import {
    DecryptDataBlob,
    EncryptedBlob,
    hashSecret,
    KeyDerivationConfig_Argon2ID,
} from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    ENVELOPE_VERSION,
    isEnvelopeBlob,
} from "@cryptex-industries/vault-core/vault-utils/envelope-encryption";
import {
    createEnvelopeEncryptedBlob,
    migrateLegacyBlobToEnvelope,
    openEnvelopeBlob,
    reconfigurePrimaryFactor,
    reencryptVaultBytesWithDEK,
    rotateRecoveryCode,
} from "@cryptex-industries/vault-core/vault-utils/vault-envelope-ops";
import {
    enrollSecondFactor,
    makeWebAuthnUnlockFromSlot,
    resolveSecondFactorForUnlock,
    type SecondFactorEnrollmentResult,
    type SecondFactorSource,
} from "@cryptex-industries/vault-core/vault-utils/second-factor";
import { clearDeviceSecondFactor } from "./vault-key-store";
import { setDeviceSecondFactorKey } from "./vault-key-store";
import type {
    VaultCreateSecondFactorOptions,
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

export type {
    VaultCreateSecondFactorOptions,
    VaultDecryptSuccess,
    VaultRevealSecrets,
    VaultUnlockParams,
} from "@cryptex-industries/vault-core/vault-utils/vault-unlock-types";

export interface VaultMetadataInterface {
    id?: number;
    data: Uint8Array;
}

export interface KeyPairInterface {
    keyId: string;
    createdAt: string;
    status: "active" | "decommission";
    privateKey: CryptoKey;
    publicKeyJwk: JsonWebKey;
}

export class VaultMetadataDatabase extends Dexie {
    public vaults!: Dexie.Table<VaultMetadataInterface, number>;
    public keyPairs!: Dexie.Table<KeyPairInterface, string>;

    constructor() {
        super("vaultDB");
        this.version(2).stores({
            vaults: "++id, data",
            keyPairs: "keyId, createdAt, status",
        });
    }
}

export const db = new VaultMetadataDatabase();

function isSessionDekKey(value: CryptoKey | Uint8Array): value is CryptoKey {
    return (
        typeof value === "object" &&
        value !== null &&
        "type" in value &&
        (value as CryptoKey).type === "secret"
    );
}

/**
 * Saves the vault metadata to the database.
 * @param index The index in the database. If null, a new entry will be created.
 * @param data The data to save.
 */
export async function saveVault(
    index: number | undefined,
    data: Uint8Array,
): Promise<number> {
    if (index != null) {
        await db.vaults.update(index, {
            data: data,
        } as VaultMetadataInterface);
        return index;
    }
    const id = await db.vaults.add({
        data: data,
    } as VaultMetadataInterface);
    console.debug("Successfully saved the vault metadata to the database");
    return id;
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
        // This is the schema version that this vault was created with
        // This changes when the vault schema changes
        this.Version = 1;
        this.Name = "";
        this.Description = "";
        this.CreatedAt = new Date().toISOString();
        this.LastUsed = undefined;
        this.Blob = undefined;
        this.Icon = "";
        this.Color = "";
    }

    /**
     * Creates a new vault with the given form data then saves it to the database
     * @param formData Form data from the vault creation form
     * @returns A new VaultMetadata object ready to be saved to the database
     */
    public static async createNewVault(
        formData: NewVaultFormSchemaType,
        encryptionFormData: EncryptionFormGroupSchemaType,
        seedVault = false,
        seedCount = 0,
        options?: VaultCreateSecondFactorOptions,
        initialImport?: ImportResult,
    ): Promise<{
        metadata: VaultMetadata;
        revealSecrets: VaultRevealSecrets;
        dek: CryptoKey;
        vault: Vault;
        enrolledFactor: SecondFactorEnrollmentResult;
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

        const secondFactorSource: SecondFactorSource =
            options?.secondFactor ?? {
                kind: VaultUtilTypes.SecondFactorKind.NONE,
            };

        const primaryFactor: SecondFactorEnrollmentResult =
            secondFactorSource.kind === VaultUtilTypes.SecondFactorKind.NONE
                ? {
                      kind: VaultUtilTypes.SecondFactorKind.NONE,
                      hkdfBaseKey: null,
                  }
                : await enrollSecondFactor(secondFactorSource, vaultId);

        const envelopeResult = await createEnvelopeEncryptedBlob(
            _vaultBytes,
            encryptionFormData.Secret,
            vaultId,
            primaryFactor,
            new KeyDerivationConfig_Argon2ID(
                encryptionFormData.EncryptionConfig.memLimit,
                encryptionFormData.EncryptionConfig.opsLimit,
            ),
        );

        vaultMetadata.Blob = envelopeResult.blob;

        const revealSecrets: VaultRevealSecrets = {
            recoveryCode: envelopeResult.recoveryCode,
            secondFactorPassphrase: envelopeResult.secondFactorDisplaySecret,
            secondFactorKind: secondFactorSource.kind,
        };

        const dek = await openEnvelopeBlob(envelopeResult.blob, vaultId, {
            masterPassword: encryptionFormData.Secret,
            secondFactorHkdfBase: primaryFactor.hkdfBaseKey,
        });
        if (dek.isErr()) {
            throw new Error(`Post-create unlock failed: ${dek.error}`);
        }

        return {
            metadata: vaultMetadata,
            revealSecrets,
            dek: dek.value.dek,
            vault: vaultToEncrypt,
            enrolledFactor: primaryFactor,
        };
    }

    /**
     * Saves the vault manifest to the database.
     * If the vault instance is not null, encrypt it, add it to the blob and save it to the database.
     * If the vault instance is null, just save the existing blob to the database.
     * FIXME: Remove the reliance on the vault instance
     * @param vaultInstance The fresh vault instance to save to the database
     * @param dek The DEK to encrypt the vault with
     */
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

    /** Persist device-bound 2FA after metadata has a DB index. */
    public async persistSecondFactorEnrollment(
        enrollment: SecondFactorEnrollmentResult,
    ): Promise<void> {
        if (
            this.DBIndex == null ||
            enrollment.kind === VaultUtilTypes.SecondFactorKind.NONE
        ) {
            return;
        }

        if (enrollment.kind === VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF) {
            // WebAuthn PRF metadata (credId + PRF salt) lives in the synced
            // envelope primary slot, so there is nothing device-local to
            // persist. The PRF-derived key is never stored. Validate that the
            // enrollment carried the metadata that createEnvelopeEncryptedBlob
            // should have written into the slot.
            if (
                !enrollment.webauthnCredentialId ||
                !enrollment.webauthnPrfSalt
            ) {
                throw new Error("WEBAUTHN_ENROLLMENT_METADATA_MISSING");
            }
            return;
        }

        if (enrollment.hkdfBaseKey) {
            await setDeviceSecondFactorKey(
                this.DBIndex,
                enrollment.hkdfBaseKey,
                enrollment.kind,
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

    private async resolveCurrentSecondFactor(
        passphrase?: string,
    ): Promise<VaultHkdfKey | null> {
        if (!this.Blob?.Envelope) return null;

        const kind = this.Blob.Envelope.PrimaryFactorKind;

        // If the primary factor is none, return null
        if (kind === VaultUtilTypes.SecondFactorKind.NONE) return null;

        const primarySlot = this.getPrimarySlot();

        // If the primary factor is a WebAuthn PRF, we need to resolve the WebAuthn unlock callback
        let resolvedWebAuthnUnlock: (() => Promise<VaultHkdfKey>) | undefined;
        if (
            kind === VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF &&
            primarySlot?.WebauthnCredentialId &&
            primarySlot?.WebauthnPrfSalt
        )
            resolvedWebAuthnUnlock = makeWebAuthnUnlockFromSlot(
                primarySlot.WebauthnCredentialId,
                primarySlot.WebauthnPrfSalt,
            );

        return resolveSecondFactorForUnlock(this.DBIndex, kind, {
            passphrase: passphrase?.trim() || undefined,
            passphraseSaltB64: primarySlot?.SecondFactorSalt,
            passphraseKdfConfig: this.slotKdfConfig(primarySlot),
            webAuthnUnlock: resolvedWebAuthnUnlock,
        });
    }

    private envelopeKdfConfig(): KeyDerivationConfig_Argon2ID {
        return new KeyDerivationConfig_Argon2ID(
            this.Blob?.KDFConfigArgon2ID?.memLimit ??
                KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
            this.Blob?.KDFConfigArgon2ID?.opsLimit ??
                KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
        );
    }

    /**
     * Re-keys an envelope vault: change master password and/or second factor.
     * The DEK is unchanged, so the current session DEK stays valid and no vault
     * re-encryption happens. The caller must supply the current master password
     * (proof of ownership) used to unwrap the DEK before re-wrapping it.
     *
     * @returns A reveal payload when a new device-bound secret was generated
     * (passphrase 2FA), otherwise null.
     */
    public async reconfigureSecurity(params: {
        currentMasterPassword: string;
        currentSecondFactorPassphrase?: string;
        newMasterPassword?: string;
        secondFactor: SecondFactorSource;
        kdfConfig?: KeyDerivationConfig_Argon2ID;
    }): Promise<Result<VaultRevealSecrets | null, string>> {
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
        const vaultId = this.requireVaultID();

        let currentSecondFactor: VaultHkdfKey | null;
        try {
            currentSecondFactor = await this.resolveCurrentSecondFactor(
                params.currentSecondFactorPassphrase,
            );
        } catch {
            return err("CURRENT_SECOND_FACTOR_FAILED");
        }

        let enrolled: SecondFactorEnrollmentResult;
        try {
            enrolled =
                params.secondFactor.kind ===
                VaultUtilTypes.SecondFactorKind.NONE
                    ? {
                          kind: VaultUtilTypes.SecondFactorKind.NONE,
                          hkdfBaseKey: null,
                      }
                    : await enrollSecondFactor(
                          params.secondFactor,
                          vaultId,
                          undefined,
                          kdfConfig,
                      );
        } catch {
            return err("SECOND_FACTOR_ENROLL_FAILED");
        }

        const newPassword =
            params.newMasterPassword && params.newMasterPassword.length > 0
                ? params.newMasterPassword
                : params.currentMasterPassword;

        const blobRes = await reconfigurePrimaryFactor(
            this.Blob,
            vaultId,
            {
                masterPassword: params.currentMasterPassword,
                secondFactorHkdfBase: currentSecondFactor,
            },
            { masterPassword: newPassword, primaryFactor: enrolled },
            kdfConfig,
        );
        if (blobRes.isErr()) return err(blobRes.error);

        this.Blob = blobRes.value;
        await this.save(null, new Uint8Array(0));
        await clearDeviceSecondFactor(this.DBIndex);
        await this.persistSecondFactorEnrollment(enrolled);

        if (enrolled.displaySecret) {
            return ok({
                recoveryCode: "",
                secondFactorPassphrase: enrolled.displaySecret,
                secondFactorKind: enrolled.kind,
            });
        }
        if (enrolled.kind === VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF) {
            return ok({ recoveryCode: "", secondFactorKind: enrolled.kind });
        }
        return ok(null);
    }

    /**
     * Generates a new recovery code and re-wraps the DEK into the recovery slot.
     * The previous recovery code is invalidated. Requires the current master
     * password (or the current recovery code) to unwrap the DEK first.
     */
    public async resetRecoveryCode(params: {
        currentMasterPassword: string;
        currentRecoveryCode?: string;
        currentSecondFactorPassphrase?: string;
    }): Promise<Result<{ recoveryCode: string }, string>> {
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

        let currentSecondFactor: VaultHkdfKey | null = null;
        if (!useRecovery) {
            try {
                currentSecondFactor = await this.resolveCurrentSecondFactor(
                    params.currentSecondFactorPassphrase,
                );
            } catch {
                return err("CURRENT_SECOND_FACTOR_FAILED");
            }
        }

        const res = await rotateRecoveryCode(
            this.Blob,
            vaultId,
            {
                masterPassword: params.currentMasterPassword,
                secondFactorHkdfBase: currentSecondFactor,
                useRecovery,
                recoveryCode: params.currentRecoveryCode,
            },
            kdfConfig,
        );
        if (res.isErr()) return err(res.error);

        this.Blob = res.value.blob;
        await this.save(null, new Uint8Array(0));

        return ok({ recoveryCode: res.value.recoveryCode });
    }

    /**
     * Decrypts the vault blob and returns it.
     * @param secret - The secret to decrypt the vault with
     * @param encryptionAlgorithm - The encryption algorithm used to encrypt the vault (taken from the blob or overriden by the user)
     * @returns The decrypted vault object and the encryption data used to encrypt the vault
     */
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
            // Prefer WebAuthn metadata stored in the (synced) primary slot; fall
            // back to any caller-provided callback (legacy device-local path).
            let resolvedWebAuthnUnlock = webAuthnUnlock;
            if (
                !resolvedWebAuthnUnlock &&
                this.Blob.Envelope.PrimaryFactorKind ===
                    VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF
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

            let sfKey: VaultHkdfKey | null = null;
            if (!useRecovery) {
                try {
                    sfKey = await resolveSecondFactorForUnlock(
                        this.DBIndex,
                        this.Blob.Envelope.PrimaryFactorKind,
                        {
                            passphrase:
                                unlockParams?.secondFactorPassphrase?.trim() ||
                                undefined,
                            passphraseSaltB64: primarySlot?.SecondFactorSalt,
                            passphraseKdfConfig:
                                this.slotKdfConfig(primarySlot),
                            webAuthnUnlock: resolvedWebAuthnUnlock,
                        },
                    );
                } catch (error) {
                    return err(
                        error instanceof Error
                            ? error.message
                            : "SECOND_FACTOR_RESOLVE_FAILED",
                    );
                }
            }

            const opened = await openEnvelopeBlob(this.Blob, vaultId, {
                masterPassword,
                useRecovery,
                recoveryCode,
                secondFactorHkdfBase: sfKey,
            });
            if (opened.isErr()) return err(opened.error);
            dek = opened.value.dek;
            plaintext = opened.value.plaintext;
        } else {
            // NOTE: This is the legacy path for non-envelope vaults
            // TODO: Remove this after December 31st 2026. We'll provide a separate tool for migrating old backup files to the new format.

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
                        kind: VaultUtilTypes.SecondFactorKind.NONE,
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

        vaultObject.Credentials = vaultObject.Credentials.map(
            (credential: VaultCredential) => {
                if (credential.TOTP) {
                    credential.TOTP = Object.assign(
                        new TOTP(),
                        credential.TOTP,
                    );
                }
                return Object.assign(new VaultCredential(), credential);
            },
        );
        vaultObject.Directories = vaultObject.Directories.map((directory) =>
            Object.assign(new Directory(), directory),
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

    /**
     * Serializes a cleaned vault instance for device linking.
     * @param cleanVaultInstance The cleaned up vault instance to send to the other device
     * @returns Serialized vault bytes (not encrypted)
     */
    public exportForLinking(cleanVaultInstance: Vault): Uint8Array {
        return VaultUtilTypes.Vault.encode(cleanVaultInstance).finish();
    }

    public static deserializeMetadataBinary(
        data: Uint8Array,
        dbIndex?: number,
    ): VaultMetadata {
        const rawData = VaultUtilTypes.VaultMetadata.decode(data);

        console.debug(
            `Metadata [${rawData.Name}] version: ${rawData.Version} || encrypted blob version: ${rawData.Blob?.Version} || DB Index: ${dbIndex}`,
        );

        const vaultMetadata = Object.assign(new VaultMetadata(), rawData);

        if (dbIndex != null) vaultMetadata.DBIndex = dbIndex;

        // Make sure that the Blob object is not a vanilla object
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

/**
 * Serializes the vault instance and returns the raw binary data for creating a backup.
 * TODO: Merge this with the save method on the vault object.
 * @param vaultInstance The vault instance to serialize
 * @param existingEncryptedBlob The current encrypted vault blob
 * @param dek The DEK to encrypt the vault with
 * @returns The raw binary data of the serialized vault
 */
export const serializeVault = async (
    vaultInstance: Vault,
    existingEncryptedBlob: EncryptedBlob,
    dek: CryptoKey,
) => {
    // Clone the vault instance
    const cleanVault = Object.assign(new Vault(), vaultInstance);

    // Clear the LinkedDevices object
    cleanVault.LinkedDevices = new LinkedDevices();

    // Serialize the vault instance
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
