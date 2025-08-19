import Dexie from "dexie";

import * as VaultUtilTypes from "../proto/vault";
import {
    DecryptDataBlob,
    EncryptDataBlob,
    EncryptedBlob,
    hashSecret,
} from "./encryption";
import {
    EncryptionFormGroupSchemaType,
    NewVaultFormSchemaType,
    VaultEncryptionConfigurationsFormElementType,
} from "./form-schemas";
import { LinkedDevices, TOTP, Vault, VaultCredential } from "./vault";
import { err, ok } from "neverthrow";
import { BACKUP_FILE_EXTENSION } from "@/utils/consts";

export interface VaultMetadataInterface {
    id?: number;
    data: Uint8Array;
}

export class VaultMetadataDatabase extends Dexie {
    public vaults!: Dexie.Table<VaultMetadataInterface, number>;

    constructor() {
        super("vaultDB");
        this.version(1).stores({
            vaults: "++id, data",
        });
    }
}

export const db = new VaultMetadataDatabase();

/**
 * Saves the vault metadata to the database.
 * @param index The index in the database. If null, a new entry will be created.
 * @param data The data to save.
 */
export async function saveVault(
    index: number | undefined,
    data: Uint8Array,
): Promise<void> {
    if (index != null) {
        await db.vaults.update(index, {
            data: data,
        } as VaultMetadataInterface);
    } else {
        await db.vaults.add({
            data: data,
        } as VaultMetadataInterface);
    }

    console.debug("Successfully saved the vault metadata to the database");
}

// export async function loadVault(
//     vaultId: number
// ): Promise<VaultMetadata | null> {
//     const vaultMetadata = await db.vaults.get(vaultId);

//     if (vaultMetadata === undefined) {
//         return null;
//     }

//     const vault = new VaultMetadata();

//     vault.Name = vaultMetadata.name;
//     vault.Description = vaultMetadata.description;
//     vault.CreatedAt = vaultMetadata.created_at;
//     vault.LastUsed = vaultMetadata.last_used;
//     vault.Blob = vaultMetadata.blob;

//     return vault;/
// }

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
    ): Promise<VaultMetadata> {
        const vaultMetadata = new VaultMetadata();

        vaultMetadata.Name = formData.Name;
        vaultMetadata.Description = formData.Description;
        vaultMetadata.CreatedAt = new Date().toISOString();
        vaultMetadata.LastUsed = undefined;

        // Instantiate a new vault to encrypt
        const freshVault = new Vault(
            await hashSecret(encryptionFormData.Secret),
            seedVault,
            seedCount,
        );

        // Serialize the vault instance
        const _vaultBytes = VaultUtilTypes.Vault.encode(freshVault).finish();

        // Encrypt the vault using default encryption
        vaultMetadata.Blob = await EncryptDataBlob(
            _vaultBytes,
            freshVault.Secret,
            encryptionFormData.Encryption,
            encryptionFormData.EncryptionKeyDerivationFunction,
            encryptionFormData.EncryptionConfig, // TODO: Get this TF out of here
            encryptionFormData.EncryptionConfig, // TODO: Move this too
        );

        return vaultMetadata;
    }

    /**
     * Saves the vault manifest to the database.
     * If the vault instance is not null, encrypt it, add it to the blob and save it to the database.
     * If the vault instance is null, just save the existing blob to the database.
     * @param vaultInstance The fresh vault instance to save to the database
     * @param encryptionConfigFormSchema The encryption configuration form schema (in case we're modifying the encryption configuration)
     */
    public async save(
        vaultInstance: Vault | null,
        encryptionConfigFormSchema?: EncryptionFormGroupSchemaType,
    ): Promise<void> {
        if (this.Blob == null) {
            throw new Error("Cannot save, vault blob is null");
        }

        // If the vault instance is not null, encrypt it and save it to the blob
        // Otherwise, just save the blob as is
        if (vaultInstance != null) {
            // Update the last used date only if we're actually updating the vault
            this.LastUsed = new Date().toISOString();

            // If the encryption configuration form schema is provided, update the vault Secret
            if (encryptionConfigFormSchema) {
                vaultInstance.Secret = await hashSecret(
                    encryptionConfigFormSchema.Secret,
                );
            }

            // Serialize the vault instance
            const _vaultBytes =
                VaultUtilTypes.Vault.encode(vaultInstance).finish();

            // Encrypt the vault using the configured encryption
            this.Blob = await EncryptDataBlob(
                _vaultBytes,
                vaultInstance.Secret,
                encryptionConfigFormSchema?.Encryption ?? this.Blob.Algorithm,
                encryptionConfigFormSchema?.EncryptionKeyDerivationFunction ??
                    this.Blob.KeyDerivationFunc,
                (encryptionConfigFormSchema?.EncryptionConfig ??
                    this.Blob
                        .KDFConfigArgon2ID) as VaultUtilTypes.KeyDerivationConfigArgon2ID,
                (encryptionConfigFormSchema?.EncryptionConfig ??
                    this.Blob
                        .KDFConfigPBKDF2) as VaultUtilTypes.KeyDerivationConfigPBKDF2,
            );
        }

        // Serialize the vault metadata and save it to the database
        await saveVault(
            this.DBIndex,
            VaultUtilTypes.VaultMetadata.encode(this).finish(),
        );
    }

    /**
     * Decrypts the vault blob and returns it.
     * @param secret - The secret to decrypt the vault with
     * @param encryptionAlgorithm - The encryption algorithm used to encrypt the vault (taken from the blob or overriden by the user)
     * @returns The decrypted vault object
     */
    public async decryptVault(
        secret: string,
        encryptionAlgorithm: VaultUtilTypes.EncryptionAlgorithm,
        keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
        keyDerivationFuncConfig: VaultEncryptionConfigurationsFormElementType,
    ) {
        if (this.Blob == null) {
            return err("VAULT_BLOB_NULL");
        }

        const blobUpgradeResult = this.Blob.upgrade();

        // Hash the secret
        const hashedSecret = await hashSecret(secret);

        const encryptionData = new Uint8Array(hashedSecret);
        let decryptionData = new Uint8Array(hashedSecret);

        // DELETEME_UPGRADE: Remove this after the upgrade period is over (6 months)
        if (blobUpgradeResult.upgraded && blobUpgradeResult.version === 2) {
            decryptionData = new Uint8Array(new TextEncoder().encode(secret));
        }

        const decryptedVaultStringRes = await DecryptDataBlob(
            this.Blob,
            decryptionData,
            encryptionAlgorithm,
            keyDerivationFunc,
            keyDerivationFuncConfig,
        );

        if (decryptedVaultStringRes.isErr())
            return err(decryptedVaultStringRes.error);

        const vaultRawParsed = VaultUtilTypes.Vault.decode(
            decryptedVaultStringRes.value,
        );

        // Set the decryptionSecret in the session storage
        // Which is then used to encrypt the vault when saving
        const vaultObject: Vault = Object.assign(
            new Vault(encryptionData),
            vaultRawParsed,
        );

        vaultObject.LinkedDevices = LinkedDevices.fromGeneric(
            vaultObject.LinkedDevices,
        );

        // Go through each credential and assign it to a new object
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

        // There is no instantiable class for the Diff object so this is commented out for now
        // vaultObject.Diffs = vaultObject.Diffs.map(
        //     (diff: VaultUtilTypes.Diff) => {
        //         // return Object.assign(new VaultUtilTypes.Diff(), diff);
        //         return diff;
        //     }
        // );

        // TODO: Check if I broke something by making the only class method static :|
        //vaultObject.Configuration = Object.assign(
        //    new Configuration(),
        //    vaultObject.Configuration,
        //);

        // Upgrade the vault object if necessary
        vaultObject.upgrade();

        // Take care of the encrypted blob upgrade
        if (blobUpgradeResult.requiresSave) {
            this.save(vaultObject);
        }

        // Assign the deserialized data to the Vault object
        return ok(vaultObject);
    }

    /**
     * Prepares the vault for linking by cleaning up the metadata and re-encrypting the blob.
     * @param cleanVaultInstance The cleaned up vault instance to encrypt and inject into the metadata
     * @returns A new VaultMetadata object ready to be saved for linking
     */
    public async exportForLinking(
        cleanVaultInstance: Vault,
    ): Promise<Uint8Array> {
        if (this.Blob == null) {
            throw new Error(
                "Cannot export metadata for linking without an encrypted blob.",
            );
        }

        const newMetadata = Object.assign(new VaultMetadata(), this);

        // Reset the DBIndex to undefined because we cannot know what it will be on the other device
        newMetadata.DBIndex = undefined;

        // Serialize the vault instance
        const _vaultBytes =
            VaultUtilTypes.Vault.encode(cleanVaultInstance).finish();

        // Encrypt the vault using the configured encryption
        newMetadata.Blob = await EncryptDataBlob(
            _vaultBytes,
            cleanVaultInstance.Secret,
            this.Blob.Algorithm,
            this.Blob.KeyDerivationFunc,
            this.Blob
                .KDFConfigArgon2ID as VaultUtilTypes.KeyDerivationConfigArgon2ID,
            this.Blob
                .KDFConfigPBKDF2 as VaultUtilTypes.KeyDerivationConfigPBKDF2,
        );

        return VaultUtilTypes.VaultMetadata.encode(newMetadata).finish();
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
            vaultMetadata.Blob = Object.assign(
                EncryptedBlob.CreateDefault(),
                vaultMetadata.Blob,
            );
        }

        return vaultMetadata;
    }
}

/**
 * Serializes the vault instance and returns the raw binary data for creating a backup.
 * TODO: Merge this with the save method on the vault object.
 * @param vaultInstance The vault instance to serialize
 * @param encryptionConfigFormSchema The current encryption configuration
 * @returns The raw binary data of the serialized vault
 */
export const serializeVault = async (
    vaultInstance: Vault,
    existingEncryptedBlob: EncryptedBlob,
) => {
    // Clone the vault instance
    const cleanVault = Object.assign(new Vault(), vaultInstance);

    // Clear the LinkedDevices object
    cleanVault.LinkedDevices = new LinkedDevices();

    // Serialize the vault instance
    const _vaultBytes = VaultUtilTypes.Vault.encode(cleanVault).finish();

    // Encrypt the vault using the configured encryption
    const encryptedBlob = await EncryptDataBlob(
        _vaultBytes,
        cleanVault.Secret,
        existingEncryptedBlob.Algorithm,
        existingEncryptedBlob.KeyDerivationFunc,
        existingEncryptedBlob.KDFConfigArgon2ID as VaultUtilTypes.KeyDerivationConfigArgon2ID,
        existingEncryptedBlob.KDFConfigPBKDF2 as VaultUtilTypes.KeyDerivationConfigPBKDF2,
    );

    const rawData = VaultUtilTypes.EncryptedBlob.encode(encryptedBlob).finish();

    return rawData;
};
