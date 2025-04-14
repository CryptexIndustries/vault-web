import { z } from "zod";
import * as sodium from "libsodium-wrappers-sumo";
import Dexie from "dexie";
import * as OTPAuth from "otpauth";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

import Papa from "papaparse";
import { ulid } from "ulidx";
import * as VaultUtilTypes from "./proto/vault";
import { ONLINE_SERVICES_SELECTION_ID } from "../utils/consts";

const requiredFieldError = "This is a required field";

export namespace VaultEncryption {
    export class KeyDerivationConfig_PBKDF2
        implements VaultUtilTypes.KeyDerivationConfigPBKDF2
    {
        // Docs: https://security.stackexchange.com/questions/3959/recommended-of-iterations-when-using-pbkdf2-sha256/3993#3993
        // Docs: https://csrc.nist.gov/publications/detail/sp/800-132/final
        // Docs: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

        public static readonly DEFAULT_ITERATIONS = 200_000;

        public iterations: number;

        constructor(
            iterations: number = KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
        ) {
            this.iterations = iterations;
        }
    }

    export class KeyDerivationConfig_Argon2ID
        implements VaultUtilTypes.KeyDerivationConfigArgon2ID
    {
        // Docs for params: https://libsodium.gitbook.io/doc/password_hashing/default_phf#key-derivation

        public static readonly DEFAULT_OPS_LIMIT = 3; // sodium.crypto_pwhash_OPSLIMIT_MODERATE;
        public static readonly DEFAULT_MEM_LIMIT = 256; // sodium.crypto_pwhash_MEMLIMIT_MODERATE;

        public static readonly MIN_MEM_LIMIT = 1; // sodium.crypto_pwhash_MEMLIMIT_MIN;
        public static readonly MAX_MEM_LIMIT = 4024; // sodium.crypto_pwhash_MEMLIMIT_MAX;

        public static readonly MIN_OPS_LIMIT = 1; // sodium.crypto_pwhash_OPSLIMIT_MIN;
        public static readonly MAX_OPS_LIMIT = 4; // sodium.crypto_pwhash_OPSLIMIT_MAX;

        public memLimit: number;
        public opsLimit: number;

        constructor(
            memLimit: number = KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
            opsLimit: number = KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
        ) {
            this.memLimit = memLimit;
            this.opsLimit = opsLimit;
        }
    }

    export class EncryptedBlob implements VaultUtilTypes.EncryptedBlob {
        /*
         * NOTE: This property is **not** serialized and saved in the vault
         */
        private LATEST_VERSION = 2;
        public Version: number;
        public CurrentVersion = 0;
        public Algorithm: VaultUtilTypes.EncryptionAlgorithm;
        public KeyDerivationFunc: VaultUtilTypes.KeyDerivationFunction;
        public KDFConfigArgon2ID:
            | VaultUtilTypes.KeyDerivationConfigArgon2ID
            | undefined;
        public KDFConfigPBKDF2:
            | VaultUtilTypes.KeyDerivationConfigPBKDF2
            | undefined;
        public Blob: Uint8Array;
        public Salt: string;
        public HeaderIV: string;

        constructor(
            algorithm: VaultUtilTypes.EncryptionAlgorithm,
            keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
            kdfConfigArgon2ID: VaultUtilTypes.KeyDerivationConfigArgon2ID | null,
            kdfConfigPBKDF2: VaultUtilTypes.KeyDerivationConfigPBKDF2 | null,
            blob: Uint8Array,
            salt: string,
            headerIV: string,
        ) {
            this.Version = this.LATEST_VERSION;
            this.Algorithm = algorithm;
            this.KeyDerivationFunc = keyDerivationFunc;
            this.KDFConfigArgon2ID = kdfConfigArgon2ID ?? undefined;
            this.KDFConfigPBKDF2 = kdfConfigPBKDF2 ?? undefined;
            this.Blob = blob;
            this.Salt = salt;
            this.HeaderIV = headerIV;
        }

        /**
         * Upgrades the encrypted blob object to the latest version.
         * @returns An object containing the following:
         * - upgraded: Whether the vault was upgraded or not.
         * - version: The new version of the vault.
         * - requiresSave: Whether the vault needs to be saved in order to persist the changes.
         */
        public upgrade(): {
            /**
             * Whether the vault was upgraded or not.
             */
            upgraded: boolean;
            /**
             * The new version of the vault.
             */
            version: number;
            /**
             * Whether the vault needs to be saved in order to persist the changes.
             */
            requiresSave: boolean;
        } {
            // NOTE: Only CurrentVersion changes during upgrades, Version stays the same as it was when the Blob object was created
            /**
             * Version 2
             *  - Upgrade reasons:
             *      - The vault is no longer decrypted using the clear-text secret, it is decrypted using a hashed version of the secret
             *      - Since the old version of the blob is encrypted using the clear-text secret, we need to re-encrypt it using the hashed secret next time the vault is saved
             *  - Other bigger changes (no upgrade needed):
             *      - The vault secret is no longer saved in the vault itself, it is saved in some other place
             */

            const result = {
                upgraded: false,
                version: this.CurrentVersion,
                requiresSave: false,
            };

            // NOTE: Check for the current version first, then for the version at vault creation (so we don't trigger on vault create)
            if (this.CurrentVersion < 2 && this.Version < 2) {
                console.warn(
                    `Upgrading encrypted blob object to version 2 (from version ${this.CurrentVersion}) ...`,
                );

                // NOTE: There are no steps that need to be taken to upgrade to version 2, just set the current version to 2

                // Set the current version to 2
                this.CurrentVersion = 2;

                console.warn("Upgraded encrypted blob object to version 2.");

                result.upgraded = true;
                result.version = this.CurrentVersion;
                result.requiresSave = true;
            }

            return result;
        }

        /**
         * Creates a default EncryptedBlob object.
         * @summary This is supposed to be used to create a blank object to be filled in later.
         * @returns A default EncryptedBlob object
         */
        public static CreateDefault(): EncryptedBlob {
            return new EncryptedBlob(
                VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
                VaultUtilTypes.KeyDerivationFunction.Argon2ID,
                new KeyDerivationConfig_Argon2ID(),
                null,
                new Uint8Array(),
                "",
                "",
            );
        }

        public static fromBinary(data: Uint8Array): EncryptedBlob {
            const obj = VaultUtilTypes.EncryptedBlob.decode(data);

            return new EncryptedBlob(
                obj.Algorithm,
                obj.KeyDerivationFunc,
                obj.KeyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
                    ? (obj.KDFConfigArgon2ID as VaultUtilTypes.KeyDerivationConfigArgon2ID)
                    : null,
                obj.KeyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.PBKDF2
                    ? (obj.KDFConfigPBKDF2 as VaultUtilTypes.KeyDerivationConfigPBKDF2)
                    : null,
                obj.Blob,
                obj.Salt,
                obj.HeaderIV,
            );
        }
    }

    export const EncryptDataBlob = async (
        blob: Uint8Array,
        secret: Uint8Array,
        algorithm: VaultUtilTypes.EncryptionAlgorithm,
        keyDerivationFunction: VaultUtilTypes.KeyDerivationFunction,
        kdfConfigArgon2ID: KeyDerivationConfig_Argon2ID,
        kdfConfigPBKDF2: KeyDerivationConfig_PBKDF2,
    ): Promise<EncryptedBlob> => {
        // FIXME: This is a temporary fix to prevent the compiler from complaining about the union type
        const configuration:
            | KeyDerivationConfig_Argon2ID
            | KeyDerivationConfig_PBKDF2 =
            keyDerivationFunction ===
            VaultUtilTypes.KeyDerivationFunction.Argon2ID
                ? kdfConfigArgon2ID
                : kdfConfigPBKDF2;

        switch (algorithm) {
            case VaultUtilTypes.EncryptionAlgorithm.AES256:
                return await AES.encryptBlobAES256(
                    blob,
                    secret,
                    keyDerivationFunction,
                    configuration,
                );
            case VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305:
                return await XChaCha20Poly1305.encryptBlob(
                    blob,
                    secret,
                    keyDerivationFunction,
                    configuration,
                );
        }
    };

    export const DecryptDataBlob = async (
        blob: EncryptedBlob,
        secret: Uint8Array,
        algorithm: VaultUtilTypes.EncryptionAlgorithm,
        keyDerivationFunction: VaultUtilTypes.KeyDerivationFunction,
        configuration:
            | KeyDerivationConfig_Argon2ID
            | KeyDerivationConfig_PBKDF2,
    ): Promise<Uint8Array> => {
        // Verify that the blob is an Uint8Array
        if (!(blob.Blob instanceof Uint8Array)) {
            throw new Error("Blob is not an Uint8Array");
        }

        switch (algorithm) {
            case VaultUtilTypes.EncryptionAlgorithm.AES256:
                return await AES.decryptBlobAES256(
                    blob,
                    secret,
                    keyDerivationFunction,
                    configuration,
                );
            case VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305:
                return await XChaCha20Poly1305.decryptBlob(
                    blob,
                    secret,
                    keyDerivationFunction,
                    configuration,
                );
            default:
                throw new Error("Invalid encryption algorithm");
        }
    };

    /**
     * Hashes the provided data using the SHA-256 algorithm.
     * @param data - The data to hash
     * @returns The hashed data
     */
    export const hashSecret = async (data: string): Promise<Uint8Array> => {
        return new Uint8Array(
            await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(data),
            ),
        );
    };

    class KeyDerivation {
        public static async deriveKeyPBKDF2(
            secret: Uint8Array,
            salt: Uint8Array,
            configuration: KeyDerivationConfig_PBKDF2,
        ): Promise<CryptoKey> {
            const key = await crypto.subtle.importKey(
                "raw",
                secret,
                { name: "PBKDF2" },
                false,
                ["deriveKey"],
            );

            const derivedKey = await crypto.subtle.deriveKey(
                {
                    name: "PBKDF2",
                    salt,
                    iterations: configuration.iterations,
                    hash: "SHA-512",
                },
                key,
                { name: "AES-GCM", length: 256 },
                true,
                ["encrypt", "decrypt"],
            );

            return derivedKey;
        }

        public static async deriveKeyArgon2ID(
            keyLength: number,
            secret: Uint8Array,
            salt: Uint8Array,
            configuration: KeyDerivationConfig_Argon2ID,
        ): Promise<Uint8Array> {
            await sodium.ready;

            // Convert the memory limit from MiB to bytes
            const memLimitActual = configuration.memLimit * 1048576;

            return sodium.crypto_pwhash(
                keyLength,
                secret,
                salt,
                configuration.opsLimit,
                memLimitActual,
                sodium.crypto_pwhash_ALG_ARGON2ID13,
            );
        }
    }

    class AES {
        static async encryptBlobAES256(
            blob: Uint8Array,
            secret: Uint8Array,
            keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2,
        ): Promise<EncryptedBlob> {
            if (keyDerivationFuncConfig == undefined) {
                throw new Error("Key derivation function config is undefined");
            }

            // Generate a random salt
            const salt = crypto.getRandomValues(new Uint8Array(16));

            // These hold the derived key and the configuration for the key derivation function
            let derivedKey: CryptoKey;

            if (
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.PBKDF2
            ) {
                derivedKey = await KeyDerivation.deriveKeyPBKDF2(
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2,
                );
            } else if (
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
            ) {
                const key = await KeyDerivation.deriveKeyArgon2ID(
                    32, // Key length in bytes (256 bits) for AES-256
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID,
                );

                derivedKey = await crypto.subtle.importKey(
                    "raw",
                    key,
                    { name: "AES-GCM", length: 256 },
                    false,
                    ["encrypt", "decrypt"],
                );
            } else {
                throw new Error("Invalid key derivation function");
            }

            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encrypted = await crypto.subtle.encrypt(
                {
                    name: "AES-GCM",
                    iv,
                },
                derivedKey,
                blob,
            );

            const encryptedBlob = new Uint8Array(encrypted);

            return new EncryptedBlob(
                VaultUtilTypes.EncryptionAlgorithm.AES256,
                keyDerivationFunc,
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
                    ? (keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID)
                    : null,
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.PBKDF2
                    ? (keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2)
                    : null,
                encryptedBlob,
                Buffer.from(salt).toString("base64"),
                Buffer.from(iv).toString("base64"),
            );
        }

        static async decryptBlobAES256(
            blob: EncryptedBlob,
            secret: Uint8Array,
            keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2,
        ): Promise<Uint8Array> {
            if (keyDerivationFuncConfig == undefined) {
                throw new Error("Key derivation function config is undefined");
            }

            const encryptedBlob = blob.Blob;
            const salt = Buffer.from(blob.Salt, "base64");
            const iv = Buffer.from(blob.HeaderIV, "base64");

            // These hold the derived key and the configuration for the key derivation function
            let derivedKey: CryptoKey;

            if (
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.PBKDF2
            ) {
                derivedKey = await KeyDerivation.deriveKeyPBKDF2(
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2,
                );
            } else if (
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
            ) {
                const key = await KeyDerivation.deriveKeyArgon2ID(
                    32, // Key length in bytes (256 bits) for AES-256
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID,
                );

                derivedKey = await crypto.subtle.importKey(
                    "raw",
                    key,
                    { name: "AES-GCM", length: 256 },
                    false,
                    ["encrypt", "decrypt"],
                );
            } else {
                throw new Error("Invalid key derivation function");
            }

            const decrypted = await crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv,
                },
                derivedKey,
                encryptedBlob,
            );

            // return new TextDecoder().decode(decrypted);
            return new Uint8Array(decrypted);
        }
    }

    class XChaCha20Poly1305 {
        static async encryptBlob(
            blob: Uint8Array,
            secret: Uint8Array,
            keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2,
        ): Promise<EncryptedBlob> {
            if (keyDerivationFuncConfig == undefined) {
                throw new Error("Key derivation function config is undefined");
            }

            await sodium.ready;

            const salt = sodium.randombytes_buf(
                sodium.crypto_shorthash_KEYBYTES,
            );
            let key: Uint8Array;

            if (
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.PBKDF2
            ) {
                const _key = await KeyDerivation.deriveKeyPBKDF2(
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2,
                );
                const rawKey = await crypto.subtle.exportKey("raw", _key);

                key = new Uint8Array(rawKey);
            } else if (
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
            ) {
                key = await KeyDerivation.deriveKeyArgon2ID(
                    sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES,
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID,
                );
            } else {
                throw new Error("Invalid key derivation function");
            }

            const res =
                sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
            const [state_out, header] = [res.state, res.header];
            const c1 = sodium.crypto_secretstream_xchacha20poly1305_push(
                state_out,
                blob,
                null,
                sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
            );

            return new EncryptedBlob(
                VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
                keyDerivationFunc,
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
                    ? (keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID)
                    : null,
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.PBKDF2
                    ? (keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2)
                    : null,
                c1,
                Buffer.from(salt).toString("base64"),
                Buffer.from(header).toString("base64"),
            );
        }

        static async decryptBlob(
            encryptedBlob: EncryptedBlob,
            secret: Uint8Array,
            keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2,
        ): Promise<Uint8Array> {
            if (keyDerivationFuncConfig == undefined) {
                throw new Error("Key derivation function config is undefined");
            }

            await sodium.ready;

            const c1 = encryptedBlob.Blob;
            const salt = Buffer.from(encryptedBlob.Salt, "base64");
            const header = Buffer.from(encryptedBlob.HeaderIV, "base64");

            let key: Uint8Array;

            if (
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.PBKDF2
            ) {
                const _key = await KeyDerivation.deriveKeyPBKDF2(
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2,
                );
                const rawKey = await crypto.subtle.exportKey("raw", _key);

                key = new Uint8Array(rawKey);
            } else if (
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
            ) {
                key = await KeyDerivation.deriveKeyArgon2ID(
                    sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES,
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID,
                );
            } else {
                throw new Error("Invalid key derivation function");
            }

            const state_in =
                sodium.crypto_secretstream_xchacha20poly1305_init_pull(
                    header,
                    key,
                );
            const r1 = sodium.crypto_secretstream_xchacha20poly1305_pull(
                state_in,
                c1,
            );

            if (typeof r1 === "boolean" && r1 === false) {
                throw new Error("Decryption failed");
            }

            // Convert the byte array to a string
            // const m1 = Buffer.from(r1.message).toString("utf-8");
            // console.debug(
            //     `Decrypted blob with XChaCha20Poly1305: ${m1.length} bytes`,
            //     m1
            // );

            // Return the decrypted byte array
            return r1.message;
        }
    }
}

export namespace VaultStorage {
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

    /**
     * Deletes the vault metadata from the database using the provided index.
     * @param index The index of the vault to delete.
     */
    export async function terminateVault(index: number): Promise<void> {
        await db.vaults.delete(index);
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
}

export namespace Backup {
    export enum Type {
        Manual,
        // Dropbox,
        // GDrive,
    }

    export const trigger = async (
        type: Type,
        vaultInstance: Vault,
        existingEncryptedBlob: VaultEncryption.EncryptedBlob,
    ): Promise<void> => {
        // Clone the vault instance and remove the online services
        // NOTE: Need to clone the OnlineServicesAccount object too because it still has a reference to the vault instance
        const cleanVault = Object.assign(new Vault(), vaultInstance);
        const cleanOnlineServices = Object.assign(
            new LinkedDevices(),
            vaultInstance.LinkedDevices,
        );
        cleanVault.LinkedDevices = cleanOnlineServices;

        LinkedDevices.unbindAccount(cleanVault.LinkedDevices);

        // Serialize the vault instance
        const _vaultBytes = VaultUtilTypes.Vault.encode(cleanVault).finish();

        // Encrypt the vault using the configured encryption
        const encryptedBlob = await VaultEncryption.EncryptDataBlob(
            _vaultBytes,
            cleanVault.Secret,
            existingEncryptedBlob.Algorithm,
            existingEncryptedBlob.KeyDerivationFunc,
            existingEncryptedBlob.KDFConfigArgon2ID as VaultUtilTypes.KeyDerivationConfigArgon2ID,
            existingEncryptedBlob.KDFConfigPBKDF2 as VaultUtilTypes.KeyDerivationConfigPBKDF2,
        );

        if (type === Type.Manual) {
            // Serialize the encrypted blob and trigger the manual backup
            await manualBackup(encryptedBlob);
        } else {
            throw new Error("Not implemented");
        }
    };

    const manualBackup = async (
        encryptedBlob: VaultEncryption.EncryptedBlob,
    ) => {
        const data =
            VaultUtilTypes.EncryptedBlob.encode(encryptedBlob).finish();

        const blob = new Blob([data], { type: "application/octet-stream" });

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");

        a.href = url;
        a.download = `cryptexvault-bk-${Date.now()}.cryx`;
        a.click();
        URL.revokeObjectURL(url);
    };
}

export namespace Export {
    export const vaultToJSON = (vaultInstance: Vault) => {
        // Make sure to remove all unnecessary properties from the vault by manually creating a new object
        const sanitizedVault = {
            Groups: vaultInstance.Groups,
            Credentials: vaultInstance.Credentials,
        };

        const stringifiedData = JSON.stringify(sanitizedVault, null, 4);

        console.debug("Deserialized vault: ", stringifiedData);

        // Trigger data download
        const blob = new Blob([stringifiedData], {
            type: "application/json",
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");

        a.href = url;
        a.download = `cryptexvault-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };
}

export namespace Import {
    export enum Type {
        GenericCSV = 0,
        Bitwarden = 1,
        KeePass2 = 2,
    }

    export type Fields =
        | "Name"
        | "Username"
        | "Password"
        | "TOTP"
        | "Tags"
        | "URL"
        | "Notes"
        | "DateCreated"
        | "DateModified"
        | "DatePasswordChanged";
    export const PossibleFields: Array<{ fieldText: string; field: Fields }> = [
        { fieldText: "Name", field: "Name" },
        { fieldText: "Username", field: "Username" },
        { fieldText: "Password", field: "Password" },
        { fieldText: "2FA Secret", field: "TOTP" },
        { fieldText: "Tags", field: "Tags" },
        { fieldText: "URL", field: "URL" },
        { fieldText: "Notes", field: "Notes" },
        { fieldText: "DateCreated", field: "DateCreated" },
        { fieldText: "DateModified", field: "DateModified" },
        { fieldText: "DatePasswordChanged", field: "DatePasswordChanged" },
    ];

    export const FieldsSchema = z.object({
        Name: z.string().nullable(),
        Username: z.string().nullable(),
        Password: z.string().nullable(),
        TOTP: z.string().nullable(),
        Tags: z.string().nullable(),
        URL: z.string().nullable(),
        Notes: z.string().nullable(),
        DateCreated: z.string().nullable(),
        DateModified: z.string().nullable(),
        DatePasswordChanged: z.string().nullable(),
        TagDelimiter: z.string().nullable(),
    });
    export type FieldsSchemaType = z.infer<typeof FieldsSchema>;

    //#region Bitwarden
    interface BitwardenFolder {
        id: string;
        name: string;
    }
    interface BitwardenItem {
        id: string;
        folderId: string;
        name: string;
        notes: string;
        type: number;
        login: {
            username: string;
            password: string;
            totp: string;
            uris: {
                match: string;
                uri: string;
            }[];
        };
        revisionDate: string;
        passwordRevisionDate: string;
        passwordHistory: {
            password: string;
            lastUsedDate: string;
        }[];
        card: {
            cardholderName: string;
            brand: string;
            number: string;
            expMonth: number;
            expYear: number;
            code: string;
        };
        fields: {
            name: string;
            value: string;
            type: number;
        }[];
    }

    interface BitwardenJSON {
        folders: BitwardenFolder[];
        items: BitwardenItem[];
    }
    //#endregion Bitwarden

    export const CSVGetColNames = (
        file: File,
        onSuccess: (columnNames: string[]) => void,
        onFailure: (error: Error) => void,
    ): void => {
        // const Papa = dynamic(() => import("papaparse"));

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            download: false,
            // worker: true,
            step: function (_, parser) {
                parser.abort();
            },
            complete: function (results: Papa.ParseResult<unknown> | null) {
                // Call the onSuccess callback
                onSuccess(results?.meta?.fields ?? []);

                results = null; //Attempting to clear the results from memory
            },
            error: function (error) {
                // Call the onFailure callback
                onFailure(error);
            },
        });
    };

    export const CSV = async (
        file: File,
        fields: FieldsSchemaType,
        onSuccess: (
            credentials: VaultUtilTypes.PartialCredential[],
        ) => Promise<void>,
        onFailure: (error: Error) => void,
    ): Promise<void> => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            download: false,
            worker: true,
            complete: async function (
                results: Papa.ParseResult<unknown> | null,
            ) {
                if (!results) return;

                const extractValue = (
                    row: object,
                    field: Fields,
                    defaultValue?: string,
                ): string | undefined => {
                    const key = (fields[field] ?? field) as keyof typeof row;
                    const value = row[key] ?? defaultValue;
                    if (value == undefined || value === "") return undefined;
                    return value;
                };

                const parseTags = (
                    tags: string | undefined,
                ): string | undefined => {
                    if (tags == undefined || tags === "") return undefined;
                    return tags
                        .split(fields.TagDelimiter ?? ",")
                        .join(Credential.TAG_SEPARATOR);
                };

                const tryParseNumber = (
                    value: string | undefined,
                ): string | number | undefined => {
                    if (value == undefined || value === "") return undefined;
                    // Try to parse the value as a number
                    const parsed = Number(value);
                    // If we failed to parse the number, return the original value
                    if (isNaN(parsed)) return value;
                    // Otherwise, return the parsed number
                    return parsed;
                };

                const parseDate = (
                    date: string | number | undefined,
                ): string | undefined => {
                    if (date == undefined || date === "") return undefined;
                    try {
                        return new Date(date).toISOString();
                    } catch (error) {
                        console.error(
                            "Failed to parse value as a date.",
                            error,
                        );
                        throw error;
                    }
                };

                const createTOTP = (
                    secret: string | undefined,
                ): Credential.TOTP | undefined => {
                    if (secret == undefined || secret === "") return undefined;
                    const totp = new Credential.TOTP();
                    totp.Secret = String(secret);
                    return totp;
                };

                const credentials: VaultUtilTypes.PartialCredential[] = [];

                try {
                    for (const row of results.data as object[]) {
                        const credential: VaultUtilTypes.PartialCredential = {
                            ID: undefined,
                            Name: extractValue(row, "Name", "Import"),
                            Username: extractValue(row, "Username"),
                            Password: extractValue(row, "Password"),
                            Tags: parseTags(extractValue(row, "Tags")),
                            URL: extractValue(row, "URL"),
                            Notes: extractValue(row, "Notes"),
                            DateCreated: parseDate(
                                tryParseNumber(
                                    extractValue(row, "DateCreated"),
                                ),
                            ),
                            DateModified: parseDate(
                                tryParseNumber(
                                    extractValue(row, "DateModified"),
                                ),
                            ),
                            DatePasswordChanged: parseDate(
                                tryParseNumber(
                                    extractValue(row, "DatePasswordChanged"),
                                ),
                            ),
                            TOTP: createTOTP(extractValue(row, "TOTP")),
                            CustomFields: [],
                        };
                        credentials.push(credential);
                    }

                    // Call the onSuccess callback
                    await onSuccess(credentials);
                } catch (error) {
                    onFailure(error as Error);
                }
            },
            error: function (error) {
                // Call the onFailure callback
                onFailure(error);
            },
        });
    };

    export const BitwardenJSON = (
        file: File,
    ): Promise<{
        credentials: VaultUtilTypes.PartialCredential[];
        groups: Group[];
    }> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => {
                const credentials: VaultUtilTypes.PartialCredential[] = [];
                const groups: Group[] = [];

                // NOTE: The whole thing is wrapped in a try-catch block because we need to reject the promise if something goes wrong
                try {
                    const json = reader.result as string;
                    const parsed = JSON.parse(json) as BitwardenJSON;

                    for (const item of parsed.items) {
                        const credential: VaultUtilTypes.PartialCredential = {
                            ID: undefined,
                            Type: item.type,
                            GroupID: item.folderId,
                            CustomFields: [],
                        };

                        // TODO: Set fields based on type (mainly type 4 - identity)

                        credential.Name = item.name ?? "Import";

                        if (item.login) {
                            credential.Username =
                                item.login.username ?? undefined;
                            credential.Password =
                                item.login.password ?? undefined;
                            if (item.login.uris)
                                credential.URL =
                                    item.login.uris[0]?.uri ?? undefined;
                        }

                        // No data to fill - credential.Tags

                        credential.Notes = item.notes ?? undefined;

                        // Use the DateCreated field if it exists (fall back to today) but set it to undefined if it doesn't
                        credential.DateCreated = item.revisionDate
                            ? new Date(item.revisionDate).toISOString()
                            : undefined;

                        credential.DateModified = item.passwordRevisionDate
                            ? new Date(item.passwordRevisionDate).toISOString()
                            : undefined;

                        credential.DatePasswordChanged =
                            item.passwordHistory && item.passwordHistory[0]
                                ? new Date(
                                      item.passwordHistory[0].lastUsedDate,
                                  ).toISOString()
                                : undefined;

                        if (item.login?.totp) {
                            credential.TOTP = new Credential.TOTP();
                            credential.TOTP.Secret = item.login.totp;
                        }

                        // Set custom fields
                        item.fields?.forEach((field) => {
                            if (!credential.CustomFields)
                                credential.CustomFields = [];

                            // Only import text, masked text and boolean fields
                            // The 3 type is for something called "linked fields" for which we don't have an equivalent
                            if (field.type < 3) {
                                const customField =
                                    new Credential.CustomField();
                                customField.Name = field.name;
                                customField.Value = field.value;
                                customField.Type = field.type;

                                credential.CustomFields.push(customField);
                            }
                        });

                        credentials.push(credential);
                    }

                    if (parsed.folders) {
                        parsed.folders.forEach((folder) => {
                            groups.push({
                                ID: folder.id,
                                Name: folder.name,
                                Icon: "",
                                Color: "",
                            });
                        });
                    }
                } catch (error) {
                    reject(error);
                }

                resolve({
                    credentials,
                    groups,
                });
            };

            reader.onerror = () => {
                reject(reader.error);
            };

            reader.readAsText(file);
        });
    };
}

export class VaultMetadata implements VaultUtilTypes.VaultMetadata {
    public Version: number;
    public DBIndex?: number;

    public Name: string;
    public Description: string;
    public CreatedAt: string;
    public LastUsed: string | undefined;
    public Blob: VaultEncryption.EncryptedBlob | undefined;

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
        formData: FormSchemas.NewVaultFormSchemaType,
        encryptionFormData: FormSchemas.EncryptionFormGroupSchemaType,
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
            await VaultEncryption.hashSecret(encryptionFormData.Secret),
            seedVault,
            seedCount,
        );

        // Serialize the vault instance
        const _vaultBytes = VaultUtilTypes.Vault.encode(freshVault).finish();

        // Encrypt the vault using default encryption
        vaultMetadata.Blob = await VaultEncryption.EncryptDataBlob(
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
        encryptionConfigFormSchema?: FormSchemas.EncryptionFormGroupSchemaType,
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
                vaultInstance.Secret = await VaultEncryption.hashSecret(
                    encryptionConfigFormSchema.Secret,
                );
            }

            // Serialize the vault instance
            const _vaultBytes =
                VaultUtilTypes.Vault.encode(vaultInstance).finish();

            // Encrypt the vault using the configured encryption
            this.Blob = await VaultEncryption.EncryptDataBlob(
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
        await VaultStorage.saveVault(
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
        keyDerivationFuncConfig: FormSchemas.VaultEncryptionConfigurationsFormElementType,
    ): Promise<Vault> {
        if (this.Blob == null) {
            throw new Error("Vault blob is null");
        }

        const blobUpgradeResult = this.Blob.upgrade();

        // Hash the secret
        const hashedSecret = await VaultEncryption.hashSecret(secret);

        const encryptionData = new Uint8Array(hashedSecret);
        let decryptionData = new Uint8Array(hashedSecret);

        // DELETEME_UPGRADE: Remove this after the upgrade period is over (6 months)
        if (blobUpgradeResult.upgraded && blobUpgradeResult.version === 2) {
            decryptionData = new Uint8Array(new TextEncoder().encode(secret));
        }

        const decryptedVaultString = await VaultEncryption.DecryptDataBlob(
            this.Blob,
            decryptionData,
            encryptionAlgorithm,
            keyDerivationFunc,
            keyDerivationFuncConfig,
        );

        const vaultRawParsed =
            VaultUtilTypes.Vault.decode(decryptedVaultString);

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
            (credential: Credential.VaultCredential) => {
                if (credential.TOTP) {
                    credential.TOTP = Object.assign(
                        new Credential.TOTP(),
                        credential.TOTP,
                    );
                }
                return Object.assign(
                    new Credential.VaultCredential(),
                    credential,
                );
            },
        );

        // There is no instantiable class for the Diff object so this is commented out for now
        // vaultObject.Diffs = vaultObject.Diffs.map(
        //     (diff: VaultUtilTypes.Diff) => {
        //         // return Object.assign(new VaultUtilTypes.Diff(), diff);
        //         return diff;
        //     }
        // );

        vaultObject.Configuration = Object.assign(
            new Configuration(),
            vaultObject.Configuration,
        );

        // Upgrade the vault object if necessary
        vaultObject.upgrade();

        // Take care of the encrypted blob upgrade
        if (blobUpgradeResult.requiresSave) {
            this.save(vaultObject);
        }

        // Assign the deserialized data to the Vault object
        return vaultObject;
    }

    /**
     * Deletes the vault from the database.
     */
    public async terminate(): Promise<void> {
        if (this.DBIndex == null) {
            throw new Error("Cannot terminate a vault without a valid index.");
        }

        await VaultStorage.terminateVault(this.DBIndex);
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
        newMetadata.Blob = await VaultEncryption.EncryptDataBlob(
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
                VaultEncryption.EncryptedBlob.CreateDefault(),
                vaultMetadata.Blob,
            );
        }

        return vaultMetadata;
    }
}

export namespace Credential {
    export const totpFormSchema = z.object({
        Label: z.string().max(255, "Label is too long"),
        Secret: z.string(),
        Period: z.number().min(1, "Period must be at least 1 second"),
        Digits: z.number().min(1, "Digits must be at least 1"),
        Algorithm: z.nativeEnum(VaultUtilTypes.TOTPAlgorithm),
    });
    export type TOTPFormSchemaType = z.infer<typeof totpFormSchema>;

    export const PERIOD_DEFAULT = 30;
    export const DIGITS_DEFAULT = 6;
    export const ALGORITHM_DEFAULT = VaultUtilTypes.TOTPAlgorithm.SHA1;
    export class TOTP implements VaultUtilTypes.TOTP, TOTPFormSchemaType {
        public Label: string;
        public Secret: string;
        public Period: number;
        public Digits: number;
        public Algorithm: VaultUtilTypes.TOTPAlgorithm;

        constructor() {
            this.Label = "";
            this.Secret = "";
            this.Period = PERIOD_DEFAULT;
            this.Digits = DIGITS_DEFAULT;
            this.Algorithm = ALGORITHM_DEFAULT;
        }

        public calculate(): {
            code: string;
            timeRemaining: number;
        } {
            const code = OTPAuth.TOTP.generate({
                secret: OTPAuth.Secret.fromBase32(this.Secret),
                algorithm: VaultUtilTypes.TOTPAlgorithm[this.Algorithm],
                digits: this.Digits,
                period: this.Period,
            });

            const timeRemaining =
                this.Period - (new Date().getSeconds() % this.Period);

            return {
                code,
                timeRemaining,
            };
        }
    }

    export class CustomField implements VaultUtilTypes.CustomField {
        public ID: string;
        public Name: string;
        public Type: VaultUtilTypes.CustomFieldType;
        public Value: string;

        constructor() {
            this.ID = "-1";
            this.Name = "";
            this.Type = VaultUtilTypes.CustomFieldType.Text;
            this.Value = "";
        }
    }

    export const TAG_SEPARATOR = ",|.|,";
    export const credentialFormSchema = z.object({
        ID: z.string().nullable(),
        Type: z.nativeEnum(VaultUtilTypes.ItemType),
        GroupID: z.string(),
        Name: z
            .string()
            .min(1, requiredFieldError)
            .max(255, "Name is too long"),
        Username: z.string(),
        Password: z.string(),
        TOTP: totpFormSchema.optional().nullable(), // This has to be nullable because of the way the form works
        Tags: z.string(),
        URL: z.string(),
        Notes: z.string(),
        DateCreated: z.string().optional(), // Used only in diffing
        DateModified: z.string().optional(), // Used only in diffing
        DatePasswordChanged: z.string().optional(), // Used only in diffing
        CustomFields: z.array(
            z.object({
                ID: z.string(),
                Name: z.string(),
                Type: z.nativeEnum(VaultUtilTypes.CustomFieldType),
                Value: z.string(),
            }),
        ),
    });
    export type CredentialFormSchemaType = z.infer<typeof credentialFormSchema>;
    export class VaultCredential
        implements VaultUtilTypes.Credential, CredentialFormSchemaType
    {
        public ID: string;
        public Type: VaultUtilTypes.ItemType;
        public GroupID: string;
        public Name: string;
        public Username: string;
        public Password: string;
        public TOTP: TOTP | undefined;
        public Tags: string;
        public URL: string;
        public Notes: string;
        public DateCreated: string;
        public DateModified: string | undefined;
        public DatePasswordChanged: string | undefined;
        public CustomFields: CustomField[];
        public Hash: string | undefined;

        constructor(
            form?: CredentialFormSchemaType | VaultUtilTypes.PartialCredential,
        ) {
            this.ID = form?.ID ? String(form.ID).trim() : ulid();

            this.Type = form?.Type ?? VaultUtilTypes.ItemType.Credentials;
            this.GroupID = form?.GroupID ? String(form.GroupID).trim() : "";

            this.Name = form?.Name ? String(form.Name).trim() : "Unnamed item";
            this.Username = form?.Username ? String(form.Username).trim() : "";
            this.Password = form?.Password ? String(form.Password).trim() : "";
            this.TOTP = form?.TOTP
                ? Object.assign(new Credential.TOTP(), form.TOTP)
                : undefined;
            this.Tags = form?.Tags ? String(form.Tags).trim() : "";
            this.URL = form?.URL ? String(form.URL).trim() : "";
            this.Notes = form?.Notes ? String(form.Notes).trim() : "";

            this.DateCreated = form?.DateCreated ?? new Date().toISOString();
            this.DateModified = form?.DateModified ?? undefined;
            this.DatePasswordChanged = form?.DatePasswordChanged ?? undefined;

            this.CustomFields = form?.CustomFields ?? [];
        }

        public update(
            form?: CredentialFormSchemaType,
            diff?: VaultUtilTypes.DiffChange,
        ) {
            if (diff && diff.Props && diff.Props.ChangeFlags) {
                if (diff.Props.ChangeFlags.TypeHasChanged)
                    this.Type = diff.Props.Type ?? this.Type;

                if (diff.Props.ChangeFlags.GroupIDHasChanged)
                    this.GroupID = diff.Props.GroupID ?? this.GroupID;

                if (diff.Props.ChangeFlags.NameHasChanged)
                    this.Name = diff.Props.Name ?? this.Name;

                if (diff.Props.ChangeFlags.UsernameHasChanged)
                    this.Username = diff.Props.Username ?? this.Username;

                if (diff.Props.ChangeFlags.PasswordHasChanged)
                    this.Password = diff.Props.Password ?? this.Password;

                if (diff.Props.ChangeFlags.TOTPHasChanged)
                    this.TOTP = diff.Props.TOTP
                        ? Object.assign(new Credential.TOTP(), diff.Props.TOTP)
                        : undefined;

                if (diff.Props.ChangeFlags.TagsHasChanged)
                    this.Tags = diff.Props.Tags ?? this.Tags;

                if (diff.Props.ChangeFlags.URLHasChanged)
                    this.URL = diff.Props.URL ?? this.URL;

                if (diff.Props.ChangeFlags.NotesHasChanged)
                    this.Notes = diff.Props.Notes ?? this.Notes;

                if (diff.Props.ChangeFlags.DateCreatedHasChanged)
                    this.DateCreated =
                        diff.Props.DateCreated ?? this.DateCreated;

                if (diff.Props.ChangeFlags.DateModifiedHasChanged)
                    this.DateModified =
                        diff.Props.DateModified ?? this.DateModified;

                if (diff.Props.ChangeFlags.DatePasswordChangedHasChanged)
                    this.DatePasswordChanged =
                        diff.Props.DatePasswordChanged ??
                        this.DatePasswordChanged;

                if (diff.Props.ChangeFlags.CustomFieldsHasChanged)
                    this.CustomFields =
                        diff.Props.CustomFields ?? this.CustomFields;
            } else if (form) {
                const today = new Date().toISOString();

                // The ID cannot be changed, so we don't check for it
                // this.ID = form.ID ?? this.ID;

                this.Type = form.Type ?? this.Type;
                this.GroupID = form.GroupID ?? this.GroupID;

                this.Name = form.Name ?? this.Name;
                this.Username = form.Username ?? this.Username;

                // Only update the DatePasswordChanged if the password has changed
                // This only takes a non nullish value of the password into account
                if (this.Password !== (form.Password ?? this.Password)) {
                    this.Password = form.Password ?? this.Password;
                    this.DatePasswordChanged = today;
                }

                this.TOTP = form.TOTP
                    ? Object.assign(new Credential.TOTP(), form.TOTP)
                    : undefined;
                this.Tags = form.Tags ?? this.Tags;
                this.URL = form.URL ?? this.URL;
                this.Notes = form.Notes ?? this.Notes;

                // The date created cannot be changed, so we don't check for it
                // this.DateCreated = form.DateCreated ?? this.DateCreated;

                this.DateModified = today;

                this.CustomFields = form.CustomFields ?? this.CustomFields;
            }

            // Reset the hash - it will be recalculated when needed
            this.Hash = undefined;

            return this;
        }

        private prepareForHashing(): string {
            // NOTE: When adding new fields, make sure to add them to the includedFields array
            // The excluded fields are also listed here (commented out) for reference
            const includedFields: (keyof VaultCredential)[] = [
                "ID",
                "Type",
                "GroupID",
                "Name",
                "Username",
                "Password",
                // "TOTP",
                "Tags",
                "URL",
                "Notes",
                "DateCreated",
                "DateModified",
                "DatePasswordChanged",
                "CustomFields",
                // "Hash",
            ];

            // These are the fields we don't want to blindly concatenate, so we exclude them and handle them separately (if needed)
            const excludedFields: (keyof VaultCredential)[] = ["TOTP", "Hash"];

            let concatenatedValues = "";

            includedFields.forEach((key) => {
                // NOTE: Ran some performance test on this check; it's faster than actually checking
                //  if the key is of the value we're looking for
                if (!excludedFields.includes(key)) {
                    // Concatenate the value of the field to the string
                    concatenatedValues += String(this[key] ?? "");
                }
            });

            // Handle the TOTP field separately
            concatenatedValues += String(this.TOTP?.Label ?? "");
            concatenatedValues += String(this.TOTP?.Algorithm ?? "");
            concatenatedValues += String(this.TOTP?.Digits ?? "");
            concatenatedValues += String(this.TOTP?.Period ?? "");
            concatenatedValues += this.TOTP?.Secret ?? "";

            return concatenatedValues;
        }

        /**
         * Calculates the hash of the credential and returns it.
         * If the hash has already been calculated, it is returned instead.
         * NOTE: This also sets the Hash property of the credential to the calculated hash - inplace.
         * @returns The hash of the credential
         */
        public async hash(): Promise<string> {
            // If the hash has already been calculated, return it
            // The thing gets calculated every time the credential is updated, so we don't want to do it again
            if (this.Hash) return this.Hash;

            const data = this.prepareForHashing();

            const hash = await crypto.subtle.digest(
                "SHA-1",
                new TextEncoder().encode(data),
            );

            this.Hash = Buffer.from(hash).toString("hex");

            return this.Hash;
        }
    }

    /**
     * Determines the changes done to a credential and returns them in the form of a DiffChange object.
     * @param prevCredential - The previous credential object
     * @param nextCredential - The new credential object
     * @returns The nextCredential object if it's a new credential (prevCredential is undefined)
     * @returns The changes done to the credential in the form of a DiffChange object
     * @returns null if no changes were done to the credential
     */
    export const getChanges = (
        prevCredential: VaultCredential | undefined,
        nextCredential: VaultCredential,
    ): VaultUtilTypes.DiffChange | null => {
        // If the previous credential doesn't exist, then this is a new credential
        if (!prevCredential) {
            const partialCredential = Object.assign({}, nextCredential);

            // Remove the Hash property from the partial credential (since it doesn't exist in the PartialCredential type, and we're not syncing it)
            delete partialCredential.Hash;

            return {
                Type: VaultUtilTypes.DiffType.Add,
                ID: nextCredential.ID,
                Props: partialCredential,
            };
        }

        // Normalize the previous and next credentials objects
        prevCredential = Object.assign({}, prevCredential);
        nextCredential = Object.assign({}, nextCredential);

        const changeFlags: VaultUtilTypes.PartialCredentialChanges = {
            TypeHasChanged: false,
            GroupIDHasChanged: false,
            NameHasChanged: false,
            UsernameHasChanged: false,
            PasswordHasChanged: false,
            TOTPHasChanged: false,
            TagsHasChanged: false,
            URLHasChanged: false,
            NotesHasChanged: false,
            DateCreatedHasChanged: false,
            DateModifiedHasChanged: false,
            DatePasswordChangedHasChanged: false,
            CustomFieldsHasChanged: false,
        };

        const craftedCredentials: VaultUtilTypes.PartialCredential = {
            CustomFields: [],
        };

        // Note: Don't diff the credential type, we won't support that for now

        if (prevCredential.GroupID !== nextCredential.GroupID) {
            craftedCredentials.GroupID = nextCredential.GroupID;
            changeFlags.GroupIDHasChanged = true;
        }

        if (prevCredential.Name !== nextCredential.Name) {
            craftedCredentials.Name = nextCredential.Name;
            changeFlags.NameHasChanged = true;
        }

        if (prevCredential.Username !== nextCredential.Username) {
            craftedCredentials.Username = nextCredential.Username;
            changeFlags.UsernameHasChanged = true;
        }

        if (prevCredential.Password !== nextCredential.Password) {
            craftedCredentials.Password = nextCredential.Password;
            changeFlags.PasswordHasChanged = true;
        }

        if (
            JSON.stringify(prevCredential.TOTP) !==
            JSON.stringify(nextCredential.TOTP)
        ) {
            craftedCredentials.TOTP = nextCredential.TOTP
                ? Object.assign({}, nextCredential.TOTP)
                : undefined;
            changeFlags.TOTPHasChanged = true;
        }

        if (prevCredential.Tags !== nextCredential.Tags) {
            craftedCredentials.Tags = nextCredential.Tags;
            changeFlags.TagsHasChanged = true;
        }

        if (prevCredential.URL !== nextCredential.URL) {
            craftedCredentials.URL = nextCredential.URL;
            changeFlags.URLHasChanged = true;
        }

        if (prevCredential.Notes !== nextCredential.Notes) {
            craftedCredentials.Notes = nextCredential.Notes;
            changeFlags.NotesHasChanged = true;
        }

        if (prevCredential.DateCreated !== nextCredential.DateCreated) {
            craftedCredentials.DateCreated = nextCredential.DateCreated;
            changeFlags.DateCreatedHasChanged = true;
        }

        if (prevCredential.DateModified !== nextCredential.DateModified) {
            craftedCredentials.DateModified = nextCredential.DateModified;
            changeFlags.DateModifiedHasChanged = true;
        }

        if (
            prevCredential.DatePasswordChanged !==
            nextCredential.DatePasswordChanged
        ) {
            craftedCredentials.DatePasswordChanged =
                nextCredential.DatePasswordChanged;
            changeFlags.DatePasswordChangedHasChanged = true;
        }

        // Check if any of the fields have changed
        if (
            Object.keys(changeFlags).some(
                (key) =>
                    changeFlags[
                        key as keyof VaultUtilTypes.PartialCredentialChanges
                    ] as boolean,
            )
        ) {
            return {
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: {
                    ...craftedCredentials,
                    ChangeFlags: changeFlags,
                },
            };
        }

        return null;
    };
}

// export const LinkedDevicesSchema = z.object({
//     ID: z.string(),
//     Name: z.string(),
//     LastSync: z.string().optional(),
//     IsRoot: z.boolean(),
//     LinkedAtTimestamp: z.number(),
//     AutoConnect: z.boolean(),
//     SyncTimeout: z.boolean(),
//     SyncTimeoutPeriod: z.number(),
// });
// export type LinkedDeviceSchemaType = z.infer<typeof LinkedDevicesSchema>;
export class LinkedDevice implements VaultUtilTypes.LinkedDevice {
    //, LinkedDeviceSchemaType
    public ID: string;
    public Name: string;
    public LastSync: string | undefined;
    public IsRoot = false;
    public LinkedAtTimestamp = Date.now();
    public AutoConnect: boolean;
    public SyncTimeout: boolean;
    public SyncTimeoutPeriod: number;

    public STUNServerIDs: string[] = [];
    public TURNServerIDs: string[] = [];
    public SignalingServerID = ONLINE_SERVICES_SELECTION_ID;

    constructor(
        deviceID = "",
        deviceName = "",
        isRoot = false,
        linkedAtTimestamp = Date.now(),
        autoConnect = true,
        syncTimeout = false,
        syncTimeoutPeriod = 30,
        stunServerIDs: string[] = [],
        turnServerIDs: string[] = [],
        signalingServerID = ONLINE_SERVICES_SELECTION_ID,
    ) {
        this.ID = deviceID;
        this.Name = deviceName;
        this.IsRoot = isRoot;
        this.LinkedAtTimestamp = linkedAtTimestamp;
        this.AutoConnect = autoConnect;
        this.SyncTimeout = syncTimeout;
        this.SyncTimeoutPeriod = syncTimeoutPeriod;
        this.STUNServerIDs = stunServerIDs;
        this.TURNServerIDs = turnServerIDs;
        this.SignalingServerID = signalingServerID;
    }

    public updateLastSync(): void {
        this.LastSync = new Date().toISOString();

        console.debug(`Updated last sync for device ${this.Name} (${this.ID})`);
    }

    public set setName(name: string) {
        if (name.trim().length > 0) {
            this.Name = name;
        }
    }

    public set setAutoConnect(autoConnect: boolean) {
        this.AutoConnect = autoConnect;
    }

    public set setSyncTimeout(syncTimeout: boolean) {
        this.SyncTimeout = syncTimeout;
    }

    public set setSyncTimeoutPeriod(syncTimeoutPeriod: number) {
        this.SyncTimeoutPeriod = Math.abs(syncTimeoutPeriod);
    }

    public set setSTUNServers(ids: string[]) {
        this.STUNServerIDs = ids;
    }

    public set setTURNServers(ids: string[]) {
        this.TURNServerIDs = ids;
    }

    public set setSignalingServer(id: string) {
        this.SignalingServerID = id;
    }
}

export class STUNServerConfiguration
    implements VaultUtilTypes.STUNServerConfiguration
{
    Version: number = 1;

    ID: string;
    Name: string;
    Host: string;

    constructor(name = "", host = "") {
        this.ID = ulid();
        this.Name = name;
        this.Host = host;
    }
}

export class TURNServerConfiguration
    implements VaultUtilTypes.TURNServerConfiguration
{
    Version: number = 1;

    ID: string;
    Name: string;
    Host: string;
    Username: string;
    Password: string;

    constructor(name = "", host = "", username = "", password = "") {
        this.ID = ulid();
        this.Name = name;
        this.Host = host;
        this.Username = username;
        this.Password = password;
    }
}

export class SignalingServerConfiguration
    implements VaultUtilTypes.SignalingServerConfiguration
{
    Version: number = 1;

    ID: string;
    Name: string;
    AppID: string;
    Key: string;
    Secret: string;
    Host: string;
    ServicePort: string;
    SecureServicePort: string;

    constructor(
        name = "",
        appID = "",
        key = "",
        secret = "",
        host = "",
        servicePort = "",
        secureServicePort = "",
    ) {
        this.ID = ulid();
        this.Name = name;
        this.AppID = appID;
        this.Key = key;
        this.Secret = secret;
        this.Host = host;
        this.ServicePort = servicePort;
        this.SecureServicePort = secureServicePort;
    }
}

export class LinkedDevices implements VaultUtilTypes.LinkedDevices {
    public ID: string = ulid();
    public APIKey?: string;
    public CreationTimestamp = Date.now();

    public Devices: LinkedDevice[] = [];

    public STUNServers: STUNServerConfiguration[] = [];
    public TURNServers: TURNServerConfiguration[] = [];
    public SignalingServers: SignalingServerConfiguration[] = [];

    public static fromGeneric(rawOnlineServices: VaultUtilTypes.LinkedDevices) {
        const newInstance = Object.assign(
            new LinkedDevices(),
            rawOnlineServices,
        );

        newInstance.Devices = rawOnlineServices.Devices.map((ld) =>
            Object.assign(new LinkedDevice(), ld),
        );
        newInstance.STUNServers = rawOnlineServices.STUNServers.map((stun) =>
            Object.assign(new STUNServerConfiguration(), stun),
        );
        newInstance.TURNServers = rawOnlineServices.TURNServers.map((turn) =>
            Object.assign(new TURNServerConfiguration(), turn),
        );
        newInstance.SignalingServers = rawOnlineServices.SignalingServers.map(
            (signaling) =>
                Object.assign(new SignalingServerConfiguration(), signaling),
        );

        return newInstance;
    }

    public static bindAccount(instance: LinkedDevices, apiKey: string): void {
        instance.ID = apiKey.slice(36);
        instance.APIKey = apiKey;
        instance.CreationTimestamp = Date.now();
    }

    public static unbindAccount(instance: LinkedDevices): void {
        // NOTE: Don't reset the ID, if there are any devices linked (not using Cryptex Vault Online Service) to this account
        // - they will be unable to sync
        // instance.ID = ulid();
        instance.APIKey = undefined;
        instance.CreationTimestamp = Date.now();

        // Remove all devices that are using the Cryptex Vault Online Services
        // instance.Devices = instance.Devices.filter(
        //     (d) =>
        //         d.STUNServerIDs.length > 0 &&
        //         d.TURNServerIDs.length > 0 &&
        //         d.SignalingServerID != ONLINE_SERVICES_SELECTION_ID,
        // );
    }

    public static isBound(instance: LinkedDevices): boolean {
        return instance.APIKey != null;
    }

    public static addLinkedDevice(
        instance: LinkedDevices,
        deviceID: string,
        deviceName: string,
        isRoot = false,
        stunServerIDs: string[] = [],
        turnServerIDs: string[] = [],
        signalingServerID: string = ONLINE_SERVICES_SELECTION_ID,
        linkedAtTimestamp = Date.now(),
        autoConnect?: boolean,
        syncTimeout?: boolean,
        syncTimeoutPeriod?: number,
    ): void {
        instance.Devices.push(
            new LinkedDevice(
                deviceID,
                deviceName,
                isRoot,
                linkedAtTimestamp,
                autoConnect,
                syncTimeout,
                syncTimeoutPeriod,
                stunServerIDs,
                turnServerIDs,
                signalingServerID ?? ONLINE_SERVICES_SELECTION_ID,
            ),
        );
    }

    public static generateNewDeviceID(): string {
        return ulid();
    }

    public static removeLinkedDevice(
        list: LinkedDevice[],
        deviceID: string,
    ): LinkedDevice[] {
        return list.filter((device) => device.ID !== deviceID);
    }
}

export class LinkingPackage implements VaultUtilTypes.LinkingPackage {
    Blob: Uint8Array;
    Salt: string;
    HeaderIV: string;

    constructor(blob: Uint8Array, salt: string, headerIV: string) {
        this.Blob = blob;
        this.Salt = salt;
        this.HeaderIV = headerIV;
    }

    public static async createNewPackage(
        blob: VaultUtilTypes.LinkingPackageBlob,
    ): Promise<{
        mnemonic: string;
        linkingPackage: LinkingPackage;
    }> {
        const mnemonic = bip39.generateMnemonic(wordlist, 256);
        const secret = await VaultEncryption.hashSecret(mnemonic);

        const newEncryptedBlob: VaultEncryption.EncryptedBlob =
            VaultEncryption.EncryptedBlob.CreateDefault();

        newEncryptedBlob.Blob = Buffer.from(
            VaultUtilTypes.LinkingPackageBlob.encode(blob).finish(),
        );

        const _encryptedData = await VaultEncryption.EncryptDataBlob(
            newEncryptedBlob.Blob,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            newEncryptedBlob.KDFConfigArgon2ID as VaultUtilTypes.KeyDerivationConfigArgon2ID,
            newEncryptedBlob.KDFConfigPBKDF2 as VaultUtilTypes.KeyDerivationConfigPBKDF2,
        );

        const linkingPackage = new LinkingPackage(
            _encryptedData.Blob,
            _encryptedData.Salt,
            _encryptedData.HeaderIV,
        );

        return {
            mnemonic,
            linkingPackage,
        };
    }

    public async decryptPackage(
        secret: string,
    ): Promise<VaultUtilTypes.LinkingPackageBlob> {
        // Create a default EncryptedBlob object and assign the encrypted data to it
        const encryptedBlob = VaultEncryption.EncryptedBlob.CreateDefault();
        encryptedBlob.Blob = this.Blob;
        encryptedBlob.Salt = this.Salt;
        encryptedBlob.HeaderIV = this.HeaderIV;

        const decrypted = await VaultEncryption.DecryptDataBlob(
            encryptedBlob,
            await VaultEncryption.hashSecret(secret),
            encryptedBlob.Algorithm,
            encryptedBlob.KeyDerivationFunc,
            encryptedBlob.KeyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
                ? (encryptedBlob.KDFConfigArgon2ID as VaultUtilTypes.KeyDerivationConfigArgon2ID)
                : (encryptedBlob.KDFConfigPBKDF2 as VaultUtilTypes.KeyDerivationConfigPBKDF2),
        );

        return VaultUtilTypes.LinkingPackageBlob.decode(decrypted);
    }

    public toBinary(): Uint8Array {
        const serializedVault =
            VaultUtilTypes.LinkingPackage.encode(this).finish();
        return serializedVault;
    }

    public toBase64(): string {
        const serializedVault = this.toBinary();

        // Same logic as in VaultEncryption.encryptBlob for the string output
        const b64Blob = Buffer.from(serializedVault).toString("base64");

        return `${b64Blob}:${this.Salt}:${this.HeaderIV}`;
    }

    public static fromBinary(binary: Uint8Array): LinkingPackage {
        const deserialized = VaultUtilTypes.LinkingPackage.decode(binary);

        return new LinkingPackage(
            deserialized.Blob,
            deserialized.Salt,
            deserialized.HeaderIV,
        );
    }

    public static fromBase64(base64: string): LinkingPackage {
        const [blob, salt, headerIV] = base64.split(":");

        // Validate the data
        if (blob == null || salt == null || headerIV == null) {
            throw new Error("Invalid data. Parsing failed.");
        }

        const newInstance = new LinkingPackage(
            Buffer.from(blob, "base64"),
            salt,
            headerIV,
        );

        return newInstance;
    }
}

/**
 * Configuration options for the vault.
 */
class Configuration implements VaultUtilTypes.Configuration {
    /**
     * The maximum number of diffs to store in the vault.
     * This is used to minimize the amount of user interaction required when syncing.
     * It is set to a fixed number in order to prevent the vault from growing too large.
     * NOTE: This is serialized and saved in the vault, so changing the value here will not affect existing vaults.
     * @default 500
     */
    public MaxDiffCount = 500;

    /**
     * Whether or not to save only the latest diff when no linked devices are available.
     * This is used to minimize the amount of storage space used by the vault when there are no linked devices.
     * @default true
     */
    public SaveOnlyLatestDiffWhenNoLinked = true;

    /**
     * Whether or not to inhibit diff generation.
     * This is mainly used when testing to ease the load on the CPU.
     * @default false
     */
    public InhibitDiffGeneration = false;

    public setMaxDiffCount(count: number): void {
        this.MaxDiffCount = Math.abs(count);
    }
}

class Group implements VaultUtilTypes.Group, FormSchemas.GroupSchemaType {
    public ID: string;
    public Name: string;
    public Icon: string;
    public Color: string;

    constructor(name = "", icon = "", color = "") {
        this.ID = "-1";
        this.Name = name;
        this.Icon = icon;
        this.Color = color;
    }
}

export class Vault implements VaultUtilTypes.Vault {
    /*
     * NOTE: This property is **not** serialized and saved in the vault
     */
    private LATEST_VERSION = 2;

    /**
     * NOTE: This property is **not** serialized and saved in the vault
     * The secret used to encrypt the vault while it's in memory.
     * It is also use to decrypt the vault data (if it's encrypted using symmetric encryption).
     */
    public Secret = new Uint8Array();

    public Version: number;
    public CurrentVersion = 0;
    public Configuration: Configuration = new Configuration();
    public LinkedDevices: LinkedDevices;
    public Groups: Group[] = [];
    public Credentials: Credential.VaultCredential[];
    public Diffs: VaultUtilTypes.Diff[] = [];

    constructor(secret = new Uint8Array(), seedData = false, seedCount = 0) {
        this.Version = this.LATEST_VERSION;
        this.Secret = secret;

        this.LinkedDevices = new LinkedDevices();
        this.Credentials = seedData ? this.seedVault(seedCount) : [];
    }

    /**
     * Upgrades the vault to the latest version. Makes changes to the vault in place - if the vault is not in the latest version, it will be upgraded.
     * @param oldVersion - The version of the vault to upgrade from. Usually the value of the CurrentVersion property but from the clean-deserialized vault.
     */
    public upgrade(): void {
        // NOTE: Only CurrentVersion changes during upgrades, Version stays the same as it was when the vault was created
        /**
         * Version 2
         *  - Upgrade reasons:
         *      - Introduced new schema for Diff objects, revamped the way diffs are stored
         *  - Other bigger changes (no upgrade needed):
         *      - Changed the backup output to be more compact (binary instead of B64 data encoded in a JSON blob)
         *      - Changed the way the synchronization messsages are serialized and deserialized (to be more compact and efficient)
         */
        // NOTE: Check for the current version first, then for the version at vault creation (so we don't trigger on vault create)
        if (this.CurrentVersion < 2 && this.Version < 2) {
            console.warn(
                `Upgrading Vault object to version 2 (from version ${this.CurrentVersion})...`,
            );
            // Clear the list of diffs
            this.Diffs = [];

            // Set the current version to 2
            this.CurrentVersion = 2;

            console.warn("Upgraded Vault object to version 2.");
        }
    }

    /**
     * Seeds the vault with mock credentials
     * @param num - Number of credentials to seed the vault with
     * @returns An array of mock credentials
     */
    private seedVault(num: number): Credential.VaultCredential[] {
        const creds: Credential.VaultCredential[] = [];

        // This will only be included in development builds
        if (process.env.NODE_ENV === "development") {
            // Generate n mock credentials
            for (let i = 0; i < num; i++) {
                const newCreds = new Credential.VaultCredential();
                newCreds.ID = `TestCreds-${i}`;
                newCreds.Name = `Test Credential ${i}`;
                newCreds.Username = `Test Username ${i}`;
                newCreds.Password = `Test Password ${i}`;
                creds.push(newCreds);
            }
        }

        return creds;
    }

    /**
     * Returns the sorted list of credentials in the vault.
     * The credentials are sorted by ID (ULID) in lexicographic order.
     */
    public getSortedCredentials(): Credential.VaultCredential[] {
        return this.Credentials.sort((a, b) => a.ID.localeCompare(b.ID));
    }

    //#region Diffing
    /**
     * Clear the list of diffs. This is usually used to remedy a failure to sync.
     * NOTE: This has to be done on all linked devices in order to prevent the vaults from diverging.
     */
    public purgeDiffList(): void {
        // Leave the last diff in the list
        this.Diffs = this.Diffs.slice(this.Diffs.length - 1);
    }

    /**
     * Hashes the vault's credentials and returns the hash as a hex string.
     * This is used to when computing diffs between changes to the vault credentials.
     * It also sorts the credentials to ensure that the hash is consistent - by using ULIDs.
     * Each credential is hashed individually, and the hashes are concatenated and hashed again.
     * @remarks The hash is generated using the SHA-1 algorithm.
     * @remarks If there are no credentials, an empty string will get hashed. Which will result in the following hash: da39a3ee5e6b4b0d3255bfef95601890afd80709
     * @returns A hash in the form of a hex string
     */
    private async hashCredentials(): Promise<string> {
        // Credentials sorted by ID (ULIDs) by lexicographic order
        const sortedCreds = this.getSortedCredentials();
        // console.debug(
        //     "Hashing credentials IDs: ",
        //     sortedCreds.map((c) => c.ID)
        // );

        console.debug("Hashing credentials: ", sortedCreds);

        let concatedHashes = "";
        for (const cred of sortedCreds) {
            concatedHashes += await cred.hash();
        }

        // Generate a hash of the credentials hashes
        const credentialsHash = await crypto.subtle.digest(
            "SHA-1",
            Buffer.from(concatedHashes),
        );

        // Return the hash as a hex string
        return Buffer.from(credentialsHash).toString("hex");
    }

    /**
     * Gets the hash from the latest diff, or calculates the hash from the credentials if there are no diffs.
     * @returns The hash from the latest diff, or the credentials hash if there are no diffs
     * @returns An empty string if there are diffs but we can't get the hash from the latest (last) diff - this shouldn't, and can't, happen
     */
    public async getLatestHash(): Promise<string> {
        if (this.Diffs.length === 0) {
            return await this.hashCredentials();
        }

        // NOTE: Don't worry about the empty string, it shouldn't happen - since we did a check for the length of the diffs array above
        return this.Diffs.at(-1)?.Hash ?? "";
    }

    /**
     * Gets the hashes from the latest diff to the first diff.
     * @returns If there are diffs, an array of hashes from the latest diff to the first diff (in that order)
     * @returns An empty array if there are no diffs
     */
    public getAllHashes(): string[] {
        return this.Diffs.map((diff) => diff.Hash).reverse();
    }

    /**
     * Gets the diffs for the vault from the specified hash to the latest diff.
     * @param hash - The hash to start from
     * @returns An array of diffs from the specified hash to the latest diff (in that order)
     * @returns An array of existing credentials (as additions) if the hash is null or the vault has no diffs
     */
    public async getDiffsSinceHash(
        hash: string | null,
    ): Promise<VaultUtilTypes.Diff[]> {
        // If the hash is null, return the credentials as additions
        if (hash === null) {
            const clonedVault = new Vault();
            clonedVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

            for (const cred of this.getSortedCredentials()) {
                await clonedVault.createCredential(cred);
            }

            return clonedVault.Diffs;
        }

        const startIndex = this.Diffs.findIndex((diff) => diff.Hash === hash);

        // If the hash is not found, return an empty array
        if (startIndex === -1) {
            return [];
        }

        // If the hash is found, return the diffs from that index to the end of the array
        return this.Diffs.slice(startIndex + 1);
    }

    /**
     * Processes the given changes and crafts a diff object.
     * If the changes are null, no diff is created.
     * First a hash of the current credentials list is generated. Then a diff object is created and added to the vault's Diffs array.
     * If there are linked devices or the configuration flag "SaveOnlyLatestDiffWhenNoLinked" is set to true, the diff is added to the array.
     * Otherwise, the diff list is cleared and only the current diff is saved.
     * NOTE: if the configuration flag "InhibitDiffGeneration" is set to true, no diff is created - this is to prevent unnecessary resource usage.
     * @param changes The changes to Process
     * @returns Nothing
     */
    private async createDiff(changes: VaultUtilTypes.DiffChange | null) {
        if (this.Configuration.InhibitDiffGeneration) {
            console.debug(
                "Diff generation inhibited. Early return from createDiff.",
            );
            return;
        }

        if (!changes) {
            console.debug("No changes to create diff for... Early return.");
            return;
        }

        console.time("createDiff-getCredentialsHash");
        // Get the hash of the current credentials
        const newHash = await this.hashCredentials();
        console.timeEnd("createDiff-getCredentialsHash");

        console.time("createDiff-pushDiff");
        const diff: VaultUtilTypes.Diff = {
            Hash: newHash,
            Changes: changes,
        };

        // If the diff array size is greater than the max diff count, remove the oldest diff
        if (this.Diffs.length >= this.Configuration.MaxDiffCount) {
            // Slice the array to remove the overflowing diffs
            // Example: this.Diffs.length = 286, this.Configuration.MaxDiffCount = 95
            // - Result: 286 - 95 + 1 = 192 -> 192 diffs from the start of the array are removed
            // - Amount of diffs currently: 286 - 192 = 94 (diffs saved)
            this.Diffs = this.Diffs.slice(
                this.Diffs.length - this.Configuration.MaxDiffCount + 1,
            );
        }

        // If there are no linked devices and the configuration flag is set to false, clear the diff list
        // If there are no linked devices, only the latest diff is saved to ensure that linked
        //  devices can sync even if they diverged right after linking
        if (
            this.LinkedDevices.Devices.length <= 0 &&
            this.Configuration.SaveOnlyLatestDiffWhenNoLinked
        ) {
            // Make sure that only this diff is saved when there are no linked devices
            this.Diffs = [];
        }

        // Add the new diff to the array
        this.Diffs.push(diff);
        console.timeEnd("createDiff-pushDiff");

        console.debug("Current diff list:", this.Diffs);
    }

    public async applyDiffs(diffs: VaultUtilTypes.Diff[]) {
        console.time("applyDiffs");

        // If there are no diffs, return
        if (diffs.length === 0) {
            console.timeEnd("applyDiffs");
            return;
        }

        // Apply the diffs in order
        for (const diff of diffs) {
            if (
                diff.Changes?.Type === VaultUtilTypes.DiffType.Add &&
                diff.Changes?.Props
            ) {
                await this.createCredential(diff.Changes.Props);
            } else if (
                diff.Changes?.Type === VaultUtilTypes.DiffType.Update &&
                diff.Changes?.Props
            ) {
                await this.updateCredential(undefined, diff.Changes);
            } else if (diff.Changes?.Type === VaultUtilTypes.DiffType.Delete) {
                // Use the built-in delete method to delete the credential
                await this.deleteCredential(diff.Changes.ID);
            }
        }

        console.timeEnd("applyDiffs");
    }

    //#endregion Diffing

    //#region Credential Methods
    /**
     * Inserts the given credential into the vault. After creation, a diff is generated and added to the vault's diff list.
     * @param data The form data with which to create the credential. The data can come from the frontend or from a diff we're applying.
     * @returns A reference to the new credential
     */
    public async createCredential(
        data:
            | Credential.CredentialFormSchemaType
            | VaultUtilTypes.PartialCredential,
    ): Promise<Credential.VaultCredential | null> {
        console.time("createCredential");

        console.timeLog("createCredential", "Creating new credential...");
        const newCreds = new Credential.VaultCredential(data);
        console.timeLog("createCredential", "New credential created.");

        if (!this.Configuration.InhibitDiffGeneration) {
            // Recalculate the hash, since the credential has been updated
            await newCreds.hash();
        }

        // TODO: We could add a check here to make sure that the credentials hash matches the hash from the given diff (if we're applying from a diff)
        this.Credentials.push(newCreds);

        // This creates an 'Add' type diff - because the credential didn't exist before
        const change = Credential.getChanges(undefined, newCreds);

        console.timeLog("createCredential", "Creating diff...");
        await this.createDiff(change);
        console.timeLog("createCredential", "Diff created.");

        console.timeEnd("createCredential");

        return newCreds;
    }

    /**
     * Updates a credential in the vault using the credential's ID.
     * @param formData - The form data with which to update the credential (not undefined if the update is coming from the frontend)
     * @param diff - The diff with which to update the credential (not undefined if the update is coming from a diff)
     * @returns A reference to the updated credential
     * @returns Null if the credential ID is missing
     */
    public async updateCredential(
        formData?: Credential.CredentialFormSchemaType,
        diff?: VaultUtilTypes.DiffChange,
    ): Promise<Credential.VaultCredential | null> {
        console.time("updateCredential");
        // If the ID is missing, throw an error (this covers the case where we receive form data or a diff)
        if (
            (formData && (formData.ID == null || !formData.ID?.length)) ||
            (diff && (diff.ID == null || !diff.ID?.length))
        ) {
            console.timeEnd("updateCredential");

            // throw new Error(
            //     "Cannot update credential. The credential ID is missing."
            // );

            return null;
        }

        // Extract the ID from the data or diff
        const credentialId = formData?.ID ?? diff?.ID;

        // NOTE: The data.ID will never be null or empty here because we check for it in the if statement above
        const existingCreds: Credential.VaultCredential | undefined =
            this.Credentials.find(
                (i) => i.ID.toLowerCase() === credentialId?.toLowerCase(),
            );

        if (!existingCreds) {
            console.timeLog(
                "updateCredential",
                "Credential not found. Early return.",
            );
            console.timeEnd("updateCredential");

            // throw new Error(
            //     "Cannot update credential. The credential was not found."
            // );

            return null;
        }

        const originalCredentials = Object.assign({}, existingCreds);

        const moddedCredentials = existingCreds.update(formData, diff);

        if (!this.Configuration.InhibitDiffGeneration) {
            // Recalculate the hash, since the credential has been updated
            await moddedCredentials.hash();
        }

        const changes = Credential.getChanges(
            originalCredentials,
            moddedCredentials,
        );

        if (changes) {
            await this.createDiff(changes);
        }

        console.timeEnd("updateCredential");

        return moddedCredentials;
    }

    /**
     * Deletes a credential from the vault using the credential's ID.
     * We don't throw an error if the credential doesn't exist, because it doesn't matter.
     * @param id The ID of the credential to delete
     */
    public async deleteCredential(id: string) {
        console.time("deleteCredential");

        console.time("deleteCredential-findIndex");
        const index = this.Credentials.findIndex((c) => c.ID === id);
        console.timeEnd("deleteCredential-findIndex");

        if (index >= 0) {
            const change: VaultUtilTypes.DiffChange = {
                Type: VaultUtilTypes.DiffType.Delete,
                ID: id,
            };

            console.time("deleteCredential-splice");
            this.Credentials.splice(index, 1);
            console.timeEnd("deleteCredential-splice");

            await this.createDiff(change);
        }

        console.timeEnd("deleteCredential");
    }
    //#endregion Credential Methods

    //#region Group Methods
    public upsertGroup(form: FormSchemas.GroupSchemaType): void {
        const existingGroup: Group | undefined = this.Groups.find(
            (g) => g.ID === form.ID,
        );

        // let changes: Credential.DiffChange | null = null;
        if (existingGroup) {
            // const originalGroup = Object.assign({}, existingGroup);

            if (form.Name) existingGroup.Name = form.Name;
            if (form.Icon) existingGroup.Icon = form.Icon;
            if (form.Color) existingGroup.Color = form.Color;

            // changes = Credential.getChanges(originalGroup, existingGroup);
        } else {
            const newGroup = new Group(form.Name, form.Icon, form.Color);

            newGroup.ID = form?.ID ?? ulid();

            if (form.ID) newGroup.ID = form.ID;

            this.Groups.push(newGroup);
            // changes = Credential.getChanges(undefined, newGroup);
        }
        // this.createDiff(changes);
    }

    public deleteGroup(id: string): void {
        const index = this.Groups.findIndex((g) => g.ID === id);

        if (index >= 0) {
            this.Groups.splice(index, 1);
        }
    }
    //#endregion Group Methods

    /**
     * Packages the vault for linking to another device.
     * This is done by creating a copy of the vault, clearing the online services account and re-binding it with the new account.
     * @throws An error if the vault is not bound to an account
     * @param newOnlineServicesAccount Credentials for the new account to bind to the vault (that will be used on the other device)
     * @returns A new Vault object ready for serialization and transfer
     */
    public static packageForLinking(
        instance: Vault,
        deviceID: string,
        apiKey: string | undefined,
        stunServerIDs: string[],
        turnServerIDs: string[],
        signalingServerID: string,
    ): Vault {
        // Create a copy of the vault so we don't modify the original
        const vaultCopy = Object.assign(new Vault(instance.Secret), instance);

        // NOTE: Even if this vault never had any linked devices, it will always have at least on diff in the diff list
        // This is to ensure that both devices can synchronize with each other even if they diverge right after linking

        // Clear the online services account and re-bind it with the new account for the other device
        vaultCopy.LinkedDevices = new LinkedDevices();

        // Make sure the device has the same Linking configuration as the original vault
        vaultCopy.LinkedDevices.STUNServers =
            instance.LinkedDevices.STUNServers;
        vaultCopy.LinkedDevices.TURNServers =
            instance.LinkedDevices.TURNServers;
        vaultCopy.LinkedDevices.SignalingServers =
            instance.LinkedDevices.SignalingServers;

        // In case this linked device uses the Cryptex Vault Online Services (API key exists), we need to bind the account
        if (apiKey) {
            LinkedDevices.bindAccount(vaultCopy.LinkedDevices, apiKey);
        } else {
            vaultCopy.LinkedDevices.ID = deviceID;
        }

        // Since this device is the one linking, we can call it the root device
        const deviceName = "Root Device";

        // Plant this device as a linked device in the new vault
        LinkedDevices.addLinkedDevice(
            vaultCopy.LinkedDevices,
            instance.LinkedDevices.ID,
            deviceName,
            true,
            stunServerIDs,
            turnServerIDs,
            signalingServerID,
            instance.LinkedDevices.CreationTimestamp,
        );

        // Make sure we add all the other linked devices to this vault
        instance.LinkedDevices.Devices.forEach((device) => {
            LinkedDevices.addLinkedDevice(
                vaultCopy.LinkedDevices,
                device.ID,
                device.Name,
                device.IsRoot,
                device.STUNServerIDs,
                device.TURNServerIDs,
                device.SignalingServerID,
                device.LinkedAtTimestamp,
                device.AutoConnect,
                device.SyncTimeout,
                device.SyncTimeoutPeriod,
            );
        });

        return vaultCopy;
    }
}

export const calculateMockedVaultHash = async (
    vault: Vault,
    diffs: VaultUtilTypes.Diff[],
) => {
    const newVault = new Vault();

    for (const cred of vault.Credentials) {
        await newVault.createCredential(cred);
    }

    await newVault.applyDiffs(diffs);
    return await newVault.getLatestHash();
};

// TODO: Clean up
export namespace Synchronization {
    // Reexport the VaultUtil.SynchronizationCommand enum as Command for convenience
    // export import Command = VaultUtilTypes.SynchronizationMessageCommand;
    // export class Message implements VaultUtilTypes.SynchronizationMessage {
    //     Command: VaultUtilTypes.SynchronizationMessageCommand;
    //     Hash?: string;
    //     /**
    //      * The hash from which the divergence occurred.
    //      * This is sent from the ResponseSyncAllHashes command if it detects a divergence.
    //      * This is only used in the SyncResponse command if it has been set by the ResponseSyncAllHashes command.
    //      */
    //     DivergenceHash?: string;
    //     Diffs: VaultUtilTypes.Diff[];
    //     LinkedDevices: VaultUtilTypes.LinkedDevice[];
    //     constructor(
    //         command: VaultUtilTypes.SynchronizationMessageCommand,
    //         hash?: string,
    //         divergenceHash?: string,
    //         diffs?: VaultUtilTypes.Diff[],
    //         linkedDevices?: VaultUtilTypes.LinkedDevice[],
    //     ) {
    //         this.Command = command;
    //         this.Hash = hash;
    //         this.DivergenceHash = divergenceHash;
    //         this.Diffs = diffs ?? [];
    //         this.LinkedDevices = linkedDevices ?? [];
    //     }
    //     public static prepare(
    //         command: VaultUtilTypes.SynchronizationMessageCommand,
    //         hash: string | undefined,
    //         divergenceHash: string | undefined,
    //         diffs: VaultUtilTypes.Diff[],
    //         linkedDevices?: VaultUtilTypes.LinkedDevice[],
    //     ): Message {
    //         return new Message(
    //             command,
    //             hash,
    //             divergenceHash,
    //             diffs,
    //             linkedDevices,
    //         );
    //     }
    //     public static parse(data: Uint8Array): Message {
    //         const decoded = VaultUtilTypes.SynchronizationMessage.decode(data);
    //         return new Message(
    //             decoded.Command,
    //             decoded.Hash,
    //             decoded.DivergenceHash,
    //             decoded.Diffs,
    //             decoded.LinkedDevices,
    //         );
    //     }
    //     public setCommand(command: Command): void {
    //         this.Command = command;
    //     }
    //     public setHash(hash: string | null): void {
    //         this.Hash = hash ?? undefined;
    //     }
    //     public setDivergenceHash(hash: string | null): void {
    //         this.DivergenceHash = hash ?? undefined;
    //     }
    //     public setDiffList(diffList: VaultUtilTypes.Diff[]): void {
    //         this.Diffs = diffList;
    //     }
    //     public setLinkedDevicesList(linkedDevicesList: LinkedDevice[]): void {
    //         this.LinkedDevices = linkedDevicesList;
    //     }
    //     public serialize(): Uint8Array {
    //         return VaultUtilTypes.SynchronizationMessage.encode(this).finish();
    //     }
    // }
    // export enum LinkStatus {
    //     Connected,
    //     Connecting,
    //     Disconnected,
    //     WaitingForDevice,
    //     Failure,
    // }
    // export type WebRTCConnection = {
    //     ID: string;
    //     Connection: RTCPeerConnection | null;
    //     DataChannel: RTCDataChannel | null;
    //     State: LinkStatus;
    //     ManualDisconnect: boolean;
    // };
    // export class WebRTCConnections {
    //     public connections: Map<string, WebRTCConnection> = new Map<
    //         string,
    //         WebRTCConnection
    //     >();
    //     private initForDevice(id: string): WebRTCConnection {
    //         const newConn = {
    //             ID: id,
    //             Connection: null,
    //             DataChannel: null,
    //             State: LinkStatus.Disconnected,
    //             ManualDisconnect: false,
    //         };
    //         this.connections.set(id, newConn);
    //         return newConn;
    //     }
    //     public get(id: string): WebRTCConnection {
    //         const connection = this.connections.get(id);
    //         if (connection) {
    //             return connection;
    //         }
    //         return this.initForDevice(id);
    //     }
    //     public upsert(
    //         id: string,
    //         connection: RTCPeerConnection,
    //         dataChannel: RTCDataChannel,
    //         state: LinkStatus,
    //     ): void {
    //         // Make sure the connection doesn't already exist
    //         if (this.connections.has(id)) {
    //             // Update the connection
    //             const conn = this.connections.get(id);
    //             if (conn) {
    //                 conn.Connection = connection;
    //                 conn.DataChannel = dataChannel;
    //                 conn.State = state;
    //                 // conn.ManualDisconnect = false;
    //             }
    //         } else {
    //             // Add the connection
    //             const newConn = {
    //                 ID: id,
    //                 Connection: connection,
    //                 DataChannel: dataChannel,
    //                 State: state,
    //                 ManualDisconnect: false,
    //             };
    //             this.connections.set(id, newConn);
    //         }
    //     }
    //     public remove(id: string): void {
    //         // Close the connection
    //         const connection = this.connections.get(id);
    //         if (connection) {
    //             connection.DataChannel?.close();
    //             connection.Connection?.close();
    //             // Clear the connection
    //             connection.Connection = null;
    //             connection.DataChannel = null;
    //             connection.State = LinkStatus.Disconnected;
    //         }
    //     }
    //     public setState(id: string, state: LinkStatus): void {
    //         const connection = this.connections.get(id);
    //         if (connection) {
    //             connection.State = state;
    //         } else {
    //             console.debug(
    //                 "Tried to set state for non-existent connection.",
    //                 id,
    //                 state,
    //             );
    //         }
    //     }
    //     public setManualDisconnect(id: string, state: boolean): void {
    //         const connection = this.connections.get(id);
    //         if (connection) {
    //             connection.ManualDisconnect = state;
    //         } else {
    //             console.debug(
    //                 "Tried to set manual disconnect for non-existent connection.",
    //                 id,
    //                 state,
    //             );
    //         }
    //     }
    //     public cleanup(): void {
    //         // const numConnections = this.connections.map(
    //         //     (c) => c.Connection && c.DataChannel
    //         // ).length;
    //         const numConnections = this.connections.size;
    //         this.connections.forEach((c) => {
    //             c.DataChannel?.close();
    //             c.Connection?.close();
    //         });
    //         this.connections.clear();
    //         console.debug(`Cleaned up ${numConnections} WebRTC connections.`);
    //     }
    // }
    /**
     * A class that handles the synchronization process.
     */
    // export class Process {
    //     /**
    //      * Handles the divergence solving process, when the user confirms the solution.
    //      * @param unlockedVault - A reference to the unlocked vault.
    //      * @param diffsToApply - An array of diffs to apply to the vault.
    //      */
    //     public static async divergenceSolveConfirm(
    //         unlockedVault: Vault,
    //         diffsToApply: VaultUtilTypes.Diff[],
    //     ) {
    //         // Apply the diffsToApply to the vault
    //         await unlockedVault.applyDiffs(diffsToApply);
    //     }
    //     /**
    //      * Handles the device list synchronization. We receive a list of devices from the other device and compare it to our own list.
    //      * NOTE: A security check needs to be performed to ensure that the other device is a Root device.
    //      * @param unlockedVault - A reference to the unlocked vault.
    //      * @param message - An incoming message from another device.
    //      * @param deviceId - The ID of the current device.
    //      * @returns True if changes were made to the vault, false otherwise.
    //      */
    //     public static linkedDevicesList(
    //         unlockedVault: Vault,
    //         message: Message,
    //         deviceId: string,
    //     ) {
    //         if (!message.LinkedDevices.length) return false;
    //         let changesOccured = false;
    //         const devicesInReceivedList = message.LinkedDevices.map(
    //             (d) => d.ID,
    //         );
    //         const devicesInCurrentList =
    //             unlockedVault.LinkedDevices.Devices.map((d) => d.ID);
    //         const currentDeviceCount = devicesInCurrentList.length;
    //         const intersection = devicesInReceivedList.filter((d) =>
    //             devicesInCurrentList.includes(d),
    //         );
    //         // Update the IsRoot property of the devices that are in both lists
    //         intersection.forEach((d) => {
    //             if (message.LinkedDevices) {
    //                 const existingLinkedDevice =
    //                     unlockedVault.LinkedDevices.Devices.find(
    //                         (ld) => ld.ID === d,
    //                     );
    //                 const receivedLinkedDevice = message.LinkedDevices.find(
    //                     (ld) => ld.ID === d,
    //                 );
    //                 if (
    //                     existingLinkedDevice != null &&
    //                     receivedLinkedDevice != null
    //                 ) {
    //                     changesOccured ||=
    //                         existingLinkedDevice.IsRoot !==
    //                         receivedLinkedDevice.IsRoot;
    //                     existingLinkedDevice.IsRoot =
    //                         receivedLinkedDevice.IsRoot;
    //                 }
    //             }
    //         });
    //         // Remove devices that are not in the received list
    //         unlockedVault.LinkedDevices.Devices =
    //             unlockedVault.LinkedDevices.Devices.filter(
    //                 (d) =>
    //                     devicesInReceivedList.includes(d.ID) ||
    //                     d.ID === deviceId,
    //             );
    //         changesOccured ||=
    //             currentDeviceCount !==
    //             unlockedVault.LinkedDevices.Devices.length;
    //         // Add devices that are in the received list but not in the current list
    //         message.LinkedDevices.forEach((d) => {
    //             if (
    //                 !unlockedVault.LinkedDevices.Devices.find(
    //                     (ld) => ld.ID === d.ID,
    //                 )
    //             ) {
    //                 changesOccured = true;
    //                 unlockedVault.LinkedDevices.addLinkedDevice(
    //                     d.ID,
    //                     d.Name,
    //                     d.IsRoot,
    //                     d.STUNServerIDs,
    //                     d.TURNServerIDs,
    //                     d.SignalingServerID,
    //                     d.LinkedAtTimestamp,
    //                     d.AutoConnect,
    //                     d.SyncTimeout,
    //                     d.SyncTimeoutPeriod,
    //                 );
    //             }
    //         });
    //         return changesOccured;
    //     }
    // }
}

export namespace FormSchemas {
    export const vaultEncryptionFormElement = z
        .nativeEnum(VaultUtilTypes.EncryptionAlgorithm)
        .default(VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305);

    export const vaultEncryptionKeyDerivationFunctionFormElement = z
        .nativeEnum(VaultUtilTypes.KeyDerivationFunction)
        .default(VaultUtilTypes.KeyDerivationFunction.Argon2ID);

    export const vaultEncryptionConfigurationsFormElement = z.object({
        memLimit: z.coerce
            .number()
            .default(
                VaultEncryption.KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
            )
            .refine(
                (x) => {
                    return (
                        x >=
                        VaultEncryption.KeyDerivationConfig_Argon2ID
                            .MIN_MEM_LIMIT
                    );
                },
                {
                    message: `Memory limit must be above ${VaultEncryption.KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT}`,
                },
            ),
        opsLimit: z.coerce
            .number()
            .default(
                VaultEncryption.KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
            )
            .refine(
                (x) => {
                    return (
                        x >=
                            VaultEncryption.KeyDerivationConfig_Argon2ID
                                .MIN_OPS_LIMIT &&
                        x <=
                            VaultEncryption.KeyDerivationConfig_Argon2ID
                                .MAX_OPS_LIMIT
                    );
                },
                {
                    message: `Operation limit must be between ${VaultEncryption.KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT} and ${VaultEncryption.KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT}`,
                },
            ),
        iterations: z.coerce
            .number()
            .default(
                VaultEncryption.KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
            ),
    });
    export type VaultEncryptionConfigurationsFormElementType = z.infer<
        typeof vaultEncryptionConfigurationsFormElement
    >;

    // export const vaultEncryptionDescriptions = {
    //     XChaCha20Poly1305:
    //         "Uses Argon2ID under the hood - resistant to GPU and ASIC attacks (more secure), slower, and requires more memory.",
    //     AES256: "Uses PBKDF2 under the hood - faster, not resistant to GPU and ASIC attacks (less secure).",
    // };

    export const unlockVaultFormSchema = z.object({
        CaptchaToken: z.string(),
    });
    export const unlockVaultWCaptchaFormSchema = unlockVaultFormSchema.extend({
        CaptchaToken: z.string().nonempty("Captcha is required."),
    });

    export const encryptionFormGroupSchema = z.object({
        Secret: z.string().min(1, requiredFieldError),
        Encryption: vaultEncryptionFormElement,
        EncryptionKeyDerivationFunction:
            vaultEncryptionKeyDerivationFunctionFormElement,
        EncryptionConfig: vaultEncryptionConfigurationsFormElement,
    });
    export type EncryptionFormGroupSchemaType = z.infer<
        typeof encryptionFormGroupSchema
    >;

    export const newVaultFormSchema = z.object({
        Name: z
            .string()
            .min(1, requiredFieldError)
            .max(255, "Name is too long"),
        Description: z.string().max(500, "Description is too long"),
    });
    export type NewVaultFormSchemaType = z.infer<typeof newVaultFormSchema>;

    export const vaultRestoreFormSchema = z.object({
        Name: z.string().min(1, requiredFieldError),
    });
    export type VaultRestoreFormSchema = z.infer<typeof vaultRestoreFormSchema>;

    export const GroupSchema = z.object({
        ID: z.string().nullable(),
        Name: z.string(),
        Icon: z.string(),
        Color: z.string(),
    });
    export type GroupSchemaType = z.infer<typeof GroupSchema>;

    export const SynchronizationSignalingUpsertSchema = z.object({
        ID: z.string(),
        Name: z
            .string()
            .min(1, "Name is required")
            .max(50, "Name can not be longer than 50 characters"),
        AppID: z.string().min(1, "Application ID is required"),
        Key: z.string().min(1, "Key is required"),
        Secret: z.string().min(1, "The secret is required"),
        Host: z.string().min(1, "Host is required"),
        ServicePort: z.string().min(1, "Service Port is required"),
        SecureServicePort: z.string().min(1, "Secure Service Port is required"),
    });
    export type SynchronizationSignalingUpsertSchemaType = z.infer<
        typeof SynchronizationSignalingUpsertSchema
    >;

    export const SynchronizationSTUNUpsertSchema = z.object({
        ID: z.string(),
        Name: z
            .string()
            .min(1, "Name is required")
            .max(50, "Name can not be longer than 50 characters"),
        Host: z.string().min(1, "Host is required"),
    });
    export type SynchronizationSTUNUpsertSchemaType = z.infer<
        typeof SynchronizationSTUNUpsertSchema
    >;

    export const SynchronizationTURNUpsertSchema = z.object({
        ID: z.string(),
        Name: z
            .string()
            .min(1, "Name is required")
            .max(50, "Name can not be longer than 50 characters"),
        Host: z.string().min(1, "Host is required"),
        Username: z.string().min(1, "Username is required"),
        Password: z.string().min(1, "Password is required"),
    });
    export type SynchronizationTURNUpsertSchemaType = z.infer<
        typeof SynchronizationTURNUpsertSchema
    >;
}
