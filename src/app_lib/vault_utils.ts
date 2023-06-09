import { z } from "zod";
import * as sodium from "libsodium-wrappers-sumo";
import Dexie from "dexie";
import * as OTPAuth from "otpauth";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { env } from "../env/client.mjs";

const requiredFieldError = "This is a required field";

//#region Zod Schemas
export const vaultRestoreFormSchema = z.object({
    vaultName: z.string().min(1, requiredFieldError),
});
export type VaultRestoreFormSchema = z.infer<typeof vaultRestoreFormSchema>;
//#endregion

export namespace VaultEncryption {
    export enum KeyDerivationFunction {
        PBKDF2 = "PBKDF2",
        Argon2ID = "Argon2ID",
    }

    export enum EncryptionAlgorithm {
        AES256 = "AES256",
        XChaCha20Poly1305 = "XChaCha20Poly1305",
    }

    export class KeyDerivationConfig_PBKDF2 {
        // Docs: https://security.stackexchange.com/questions/3959/recommended-of-iterations-when-using-pbkdf2-sha256/3993#3993
        // Docs: https://csrc.nist.gov/publications/detail/sp/800-132/final
        // Docs: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

        public static readonly DEFAULT_ITERATIONS = 200_000;

        public iterations: number;

        constructor(
            iterations: number = KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS
        ) {
            this.iterations = iterations;
        }
    }

    export class KeyDerivationConfig_Argon2ID {
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
            opsLimit: number = KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT
        ) {
            this.memLimit = memLimit;
            this.opsLimit = opsLimit;
        }
    }

    export const vaultEncryptionFormElement = z
        .enum([
            VaultEncryption.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultEncryption.EncryptionAlgorithm.AES256,
        ])
        .default(VaultEncryption.EncryptionAlgorithm.XChaCha20Poly1305);
    export const vaultEncryptionKeyDerivationFunctionFormElement = z
        .enum([
            VaultEncryption.KeyDerivationFunction.Argon2ID,
            VaultEncryption.KeyDerivationFunction.PBKDF2,
        ])
        .default(VaultEncryption.KeyDerivationFunction.Argon2ID);
    export const vaultEncryptionConfigurationsFormElement = z.object({
        memLimit: z.coerce
            .number()
            .default(KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT)
            .refine(
                (x) => {
                    return x >= KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT;
                },
                {
                    message: `Memory limit must be above ${KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT}`,
                }
            ),

        opsLimit: z.coerce
            .number()
            .default(KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT)
            .refine(
                (x) => {
                    return (
                        x >= KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT &&
                        x <= KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT
                    );
                },
                {
                    message: `Operation limit must be between ${KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT} and ${KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT}`,
                }
            ),
        iterations: z.coerce
            .number()
            .default(KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS),
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
        vaultSecret: z.string().min(1, requiredFieldError),
        vaultEncryption: vaultEncryptionFormElement,
        vaultEncryptionKeyDerivationFunction:
            vaultEncryptionKeyDerivationFunctionFormElement,
        vaultEncryptionConfig: vaultEncryptionConfigurationsFormElement,
        captchaToken: env.NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA
            ? z.string().nonempty("Captcha is required.")
            : z.string(),
    });
    export type UnlockVaultFormSchemaType = z.infer<
        typeof unlockVaultFormSchema
    >;

    export class EncryptedBlob {
        public algorithm: VaultEncryption.EncryptionAlgorithm;
        public keyDerivationFunc: VaultEncryption.KeyDerivationFunction;
        public keyDerivationFuncConfig:
            | KeyDerivationConfig_Argon2ID
            | KeyDerivationConfig_PBKDF2;
        public blob: string;
        public salt: string;
        public header_iv: string;

        constructor(
            algorithm: VaultEncryption.EncryptionAlgorithm,
            keyDerivationFunc: VaultEncryption.KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2,
            blob: string,
            salt: string,
            header_iv: string
        ) {
            this.algorithm = algorithm;
            this.keyDerivationFunc = keyDerivationFunc;
            this.keyDerivationFuncConfig = keyDerivationFuncConfig;
            this.blob = blob;
            this.salt = salt;
            this.header_iv = header_iv;
        }

        /**
         * Creates a default EncryptedBlob object.
         * @summary This is supposed to be used to create a blank object to be filled in later.
         * @returns A default EncryptedBlob object
         */
        public static CreateDefault(): EncryptedBlob {
            return new EncryptedBlob(
                EncryptionAlgorithm.XChaCha20Poly1305,
                KeyDerivationFunction.Argon2ID,
                new KeyDerivationConfig_Argon2ID(),
                "",
                "",
                ""
            );
        }

        public async toString(): Promise<string> {
            return JSON.stringify(this, null, 0);
        }

        /**
         * Creates an EncryptedBlob object from a JSON string.
         * This is mainly used when restoring a vault from a JSON file.
         * @param data The JSON string to parse
         * @returns An EncryptedBlob object
         * @throws Error if the JSON string is invalid
         */
        public static async FromJSON(data: string): Promise<EncryptedBlob> {
            const obj = JSON.parse(data);

            // Check if the object is valid
            if (
                !obj.hasOwnProperty("algorithm") ||
                !obj.hasOwnProperty("keyDerivationFunc") ||
                !obj.hasOwnProperty("keyDerivationFuncConfig") ||
                !obj.hasOwnProperty("blob") ||
                !obj.hasOwnProperty("salt") ||
                !obj.hasOwnProperty("header_iv")
            ) {
                throw new Error("Invalid object. Parsing failed.");
            }

            // Extract the algorithm
            if (
                obj.algorithm !== EncryptionAlgorithm.AES256 &&
                obj.algorithm !== EncryptionAlgorithm.XChaCha20Poly1305
            ) {
                throw new Error("Invalid algorithm. Parsing failed.");
            }

            // Extract the key derivation function
            if (
                obj.keyDerivationFunc !== KeyDerivationFunction.Argon2ID &&
                obj.keyDerivationFunc !== KeyDerivationFunction.PBKDF2
            ) {
                throw new Error(
                    "Invalid key derivation function. Parsing failed."
                );
            }

            let keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2;

            // Extract the key derivation function config
            if (obj.keyDerivationFunc === KeyDerivationFunction.Argon2ID) {
                keyDerivationFuncConfig = new KeyDerivationConfig_Argon2ID(
                    obj.keyDerivationFuncConfig.memLimit,
                    obj.keyDerivationFuncConfig.opsLimit
                );
            } else {
                keyDerivationFuncConfig = new KeyDerivationConfig_PBKDF2(
                    obj.keyDerivationFuncConfig.iterations
                );
            }

            return new EncryptedBlob(
                obj.algorithm,
                obj.keyDerivationFunc,
                keyDerivationFuncConfig,
                obj.blob,
                obj.salt,
                obj.header_iv
            );
        }
    }

    export const EncryptDataBlob = async (
        blob: string,
        secret: string,
        algorithm: EncryptionAlgorithm,
        keyDerivationFunction: KeyDerivationFunction,
        configuration: KeyDerivationConfig_Argon2ID | KeyDerivationConfig_PBKDF2
    ): Promise<EncryptedBlob> => {
        switch (algorithm) {
            case EncryptionAlgorithm.AES256:
                return await AES.encryptBlobAES256(
                    blob,
                    secret,
                    keyDerivationFunction,
                    configuration
                );
            case EncryptionAlgorithm.XChaCha20Poly1305:
                return await XChaCha20Poly1305.encryptBlob(
                    blob,
                    secret,
                    keyDerivationFunction,
                    configuration
                );
        }
    };

    export const DecryptDataBlob = async (
        blob: EncryptedBlob,
        secret: string,
        algorithm: EncryptionAlgorithm,
        keyDerivationFunction: KeyDerivationFunction,
        configuration: KeyDerivationConfig_Argon2ID | KeyDerivationConfig_PBKDF2
    ): Promise<string> => {
        switch (algorithm) {
            case EncryptionAlgorithm.AES256:
                return await AES.decryptBlobAES256(
                    blob,
                    secret,
                    keyDerivationFunction,
                    configuration
                );
            case EncryptionAlgorithm.XChaCha20Poly1305:
                return await XChaCha20Poly1305.decryptBlob(
                    blob,
                    secret,
                    keyDerivationFunction,
                    configuration
                );
            default:
                throw new Error("Invalid encryption algorithm");
        }
    };

    class KeyDerivation {
        public static async deriveKeyPBKDF2(
            secret: string,
            salt: Uint8Array,
            configuration: KeyDerivationConfig_PBKDF2
        ): Promise<CryptoKey> {
            const key = await crypto.subtle.importKey(
                "raw",
                new TextEncoder().encode(secret),
                { name: "PBKDF2" },
                false,
                ["deriveKey"]
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
                ["encrypt", "decrypt"]
            );

            return derivedKey;
        }

        public static async deriveKeyArgon2ID(
            keyLength: number,
            secret: string,
            salt: Uint8Array,
            configuration: KeyDerivationConfig_Argon2ID
        ): Promise<Uint8Array> {
            await sodium.ready;

            // Convert the memory limit from MiB to bytes
            const memLimitActual = configuration.memLimit * 1048576;

            return sodium.crypto_pwhash(
                keyLength,
                new TextEncoder().encode(secret),
                salt,
                configuration.opsLimit,
                memLimitActual,
                sodium.crypto_pwhash_ALG_ARGON2ID13
            );
        }
    }

    class AES {
        static async encryptBlobAES256(
            blob: string,
            secret: string,
            keyDerivationFunc: KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2
        ): Promise<EncryptedBlob> {
            // Generate a random salt
            const salt = crypto.getRandomValues(new Uint8Array(16));

            // These hold the derived key and the configuration for the key derivation function
            let derivedKey: CryptoKey;

            if (keyDerivationFunc === KeyDerivationFunction.PBKDF2) {
                derivedKey = await KeyDerivation.deriveKeyPBKDF2(
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2
                );
            } else if (
                keyDerivationFunc === KeyDerivationFunction.Argon2ID ||
                true
            ) {
                const key = await KeyDerivation.deriveKeyArgon2ID(
                    32, // Key length in bytes (256 bits) for AES-256
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID
                );

                derivedKey = await crypto.subtle.importKey(
                    "raw",
                    key,
                    { name: "AES-GCM", length: 256 },
                    false,
                    ["encrypt", "decrypt"]
                );
            }

            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encrypted = await crypto.subtle.encrypt(
                {
                    name: "AES-GCM",
                    iv,
                },
                derivedKey,
                new TextEncoder().encode(blob)
            );

            const encryptedBlob = new Uint8Array(encrypted);

            return new EncryptedBlob(
                EncryptionAlgorithm.AES256,
                keyDerivationFunc,
                keyDerivationFuncConfig,
                Buffer.from(encryptedBlob).toString("base64"),
                Buffer.from(salt).toString("base64"),
                Buffer.from(iv).toString("base64")
            );
        }

        static async decryptBlobAES256(
            blob: EncryptedBlob,
            secret: string,
            keyDerivationFunc: KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2
        ): Promise<string> {
            const encryptedBlob = Buffer.from(blob.blob, "base64");
            const salt = Buffer.from(blob.salt, "base64");
            const iv = Buffer.from(blob.header_iv, "base64");

            // These hold the derived key and the configuration for the key derivation function
            let derivedKey: CryptoKey;

            if (keyDerivationFunc === KeyDerivationFunction.PBKDF2) {
                derivedKey = await KeyDerivation.deriveKeyPBKDF2(
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2
                );
            } else if (
                keyDerivationFunc === KeyDerivationFunction.Argon2ID ||
                true
            ) {
                const key = await KeyDerivation.deriveKeyArgon2ID(
                    32, // Key length in bytes (256 bits) for AES-256
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID
                );

                derivedKey = await crypto.subtle.importKey(
                    "raw",
                    key,
                    { name: "AES-GCM", length: 256 },
                    false,
                    ["encrypt", "decrypt"]
                );
            }

            const decrypted = await crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv,
                },
                derivedKey,
                encryptedBlob
            );

            return new TextDecoder().decode(decrypted);
        }
    }

    class XChaCha20Poly1305 {
        static async encryptBlob(
            blob: string,
            secret: string,
            keyDerivationFunc: KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2
        ): Promise<EncryptedBlob> {
            await sodium.ready;

            const salt = sodium.randombytes_buf(
                sodium.crypto_shorthash_KEYBYTES
            );
            let key: Uint8Array;

            if (keyDerivationFunc === KeyDerivationFunction.PBKDF2) {
                const _key = await KeyDerivation.deriveKeyPBKDF2(
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2
                );
                const rawKey = await crypto.subtle.exportKey("raw", _key);

                key = new Uint8Array(rawKey);
            } else if (
                keyDerivationFunc === KeyDerivationFunction.Argon2ID ||
                true
            ) {
                key = await KeyDerivation.deriveKeyArgon2ID(
                    sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES,
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID
                );
            }

            const res =
                sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
            const [state_out, header] = [res.state, res.header];
            const c1 = sodium.crypto_secretstream_xchacha20poly1305_push(
                state_out,
                sodium.from_string(blob),
                null,
                sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE
            );

            return new EncryptedBlob(
                EncryptionAlgorithm.XChaCha20Poly1305,
                keyDerivationFunc,
                keyDerivationFuncConfig,
                Buffer.from(c1).toString("base64"),
                Buffer.from(salt).toString("base64"),
                Buffer.from(header).toString("base64")
            );
        }

        static async decryptBlob(
            encryptedBlob: EncryptedBlob,
            secret: string,
            keyDerivationFunc: KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2
        ): Promise<string> {
            await sodium.ready;

            const c1 = Buffer.from(encryptedBlob.blob, "base64");
            const salt = Buffer.from(encryptedBlob.salt, "base64");
            const header = Buffer.from(encryptedBlob.header_iv, "base64");

            let key: Uint8Array;

            if (keyDerivationFunc === KeyDerivationFunction.PBKDF2) {
                const _key = await KeyDerivation.deriveKeyPBKDF2(
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2
                );
                const rawKey = await crypto.subtle.exportKey("raw", _key);

                key = new Uint8Array(rawKey);
            } else if (
                keyDerivationFunc === KeyDerivationFunction.Argon2ID ||
                true
            ) {
                key = await KeyDerivation.deriveKeyArgon2ID(
                    sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES,
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID
                );
            }

            const state_in =
                sodium.crypto_secretstream_xchacha20poly1305_init_pull(
                    header,
                    key
                );
            const r1 = sodium.crypto_secretstream_xchacha20poly1305_pull(
                state_in,
                c1
            );
            const m1 = Buffer.from(r1.message).toString("utf-8");

            // console.debug(
            //     `Decrypted blob with XChaCha20Poly1305: ${m1.length} bytes`,
            //     m1
            // );

            return m1;
        }
    }
}

export namespace VaultStorage {
    export interface VaultMetadataInterface {
        id?: number;
        name: string;
        description: string;
        created_at: Date;
        last_used: Date | null;
        blob: VaultEncryption.EncryptedBlob;
    }

    export class VaultMetadataDatabase extends Dexie {
        public vaults!: Dexie.Table<VaultMetadataInterface, number>;

        constructor() {
            super("vaultDB");
            this.version(1).stores({
                vaults: "++id, name, description, created_at, last_used, blob",
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
        index: number | null | undefined,
        data: VaultMetadataInterface
    ): Promise<void> {
        if (index != null) {
            await db.vaults.update(index, data);
        } else {
            await db.vaults.add(data);
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

export namespace BackupUtils {
    export enum BackupType {
        Manual,
        // Dropbox,
        // GoogleDrive,
    }

    export const trigger = async (
        type: BackupType,
        vaultBlob: VaultEncryption.EncryptedBlob
    ): Promise<void> => {
        if (type === BackupType.Manual) {
            await manualBackup(await vaultBlob.toString());
        } else {
            throw new Error("Not implemented");
        }
    };

    const manualBackup = async (data: string): Promise<void> => {
        const blob = new Blob([data], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `cryptexvault-bk-${new Date().toISOString()}.cryx`;
        a.click();
        URL.revokeObjectURL(url);
    };
}

export class VaultMetadata {
    public DBIndex?: number | null;

    public Name: string;
    public Description: string;
    public CreatedAt: Date;
    public LastUsed: Date | null;
    public Blob: VaultEncryption.EncryptedBlob | null;

    constructor() {
        this.Name = "";
        this.Description = "";
        this.CreatedAt = new Date();
        this.LastUsed = null;
        this.Blob = null;
    }

    /**
     * Creates a new vault with the given form data then saves it to the database
     * @param formData Form data from the vault creation form
     * @returns A new VaultMetadata object ready to be saved to the database
     */
    public static async createNewVault(
        formData: NewVaultFormSchemaType,
        seedVault = false,
        seedCount = 0
    ): Promise<VaultMetadata> {
        const vaultMetadata = new VaultMetadata();

        vaultMetadata.Name = formData.vaultName;
        vaultMetadata.Description = formData.vaultDescription;
        vaultMetadata.CreatedAt = new Date();
        vaultMetadata.LastUsed = null;

        // Instantiate a new vault to encrypt
        const freshVault = new Vault(
            formData.vaultSecret,
            seedVault,
            seedCount
        );

        // Convert the vault to a JSON string
        const _freshVaultString = JSON.stringify(freshVault);

        // Encrypt the vault using default encryption
        vaultMetadata.Blob = await VaultEncryption.EncryptDataBlob(
            _freshVaultString,
            formData.vaultSecret,
            formData.vaultEncryption,
            formData.vaultEncryptionKeyDerivationFunction,
            formData.vaultEncryptionConfig
        );

        return vaultMetadata;
    }

    /**
     * Saves the vault manifest to the database.
     * If the vault instance is not null, encrypt it, add it to the blob and save it to the database.
     * If the vault instance is null, just save the existing blob to the database.
     * @param vaultInstance The fresh vault instance to save to the database
     */
    public async save(vaultInstance: Vault | null): Promise<void> {
        if (this.Blob === null) {
            throw new Error("Cannot save, vault blob is null");
        }

        // If the vault instance is not null, encrypt it and save it to the blob
        // Otherwise, just save the blob as is
        if (vaultInstance != null) {
            // Update the last used date only if we're actually updating the vault
            this.LastUsed = new Date();

            // Convert the vault to a JSON string
            const _vaultString = JSON.stringify(vaultInstance);

            // Encrypt the vault using the configured encryption
            this.Blob = await VaultEncryption.EncryptDataBlob(
                _vaultString,
                vaultInstance.Secret,
                this.Blob.algorithm,
                this.Blob.keyDerivationFunc,
                this.Blob.keyDerivationFuncConfig
            );
        }

        // Mold the vault metadata into a serializable format
        const serializableData: VaultStorage.VaultMetadataInterface = {
            name: this.Name,
            description: this.Description,
            created_at: this.CreatedAt,
            last_used: this.LastUsed,
            blob: this.Blob,
        };

        await VaultStorage.saveVault(this.DBIndex, serializableData);
    }

    /**
     * Decrypts the vault blob and returns it.
     * @param secret The secret to decrypt the vault with
     * @param encryptionAlgorithm The encryption algorithm used to encrypt the vault (taken from the blob or overriden by the user)
     * @returns The decrypted vault object
     */
    public async decryptVault(
        secret: string,
        encryptionAlgorithm: VaultEncryption.EncryptionAlgorithm,
        keyDerivationFunc: VaultEncryption.KeyDerivationFunction,
        keyDerivationFuncConfig: VaultEncryption.VaultEncryptionConfigurationsFormElementType
    ): Promise<Vault> {
        if (this.Blob === null) {
            throw new Error("Vault blob is null");
        }

        const decryptedVaultString = await VaultEncryption.DecryptDataBlob(
            this.Blob,
            secret,
            encryptionAlgorithm,
            keyDerivationFunc,
            keyDerivationFuncConfig
        );

        const vault = JSON.parse(decryptedVaultString, (key, value) => {
            if (
                key.toLowerCase().includes("date") &&
                value != null &&
                value.length > 0
            ) {
                return new Date(value);
            }

            return value;
        });

        const vaultObject: Vault = Object.assign(new Vault(secret), vault);

        vaultObject.OnlineServices = Object.assign(
            new OnlineServicesAccount(),
            vaultObject.OnlineServices
        );

        // Go through each linked device and assign it to a new object
        vaultObject.OnlineServices.LinkedDevices =
            vaultObject.OnlineServices.LinkedDevices.map(
                (device: LinkedDevice) => {
                    return Object.assign(new LinkedDevice("", ""), device);
                }
            );

        // Go through each credential and assign it to a new object
        vaultObject.Credentials = vaultObject.Credentials.map(
            (credential: Credential.VaultCredential) => {
                if (credential.TOTP) {
                    credential.TOTP = Object.assign(
                        new Credential.TOTP(),
                        credential.TOTP
                    );
                }
                return Object.assign(
                    new Credential.VaultCredential(),
                    credential
                );
            }
        );

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
    public async exportForLinking(cleanVaultInstance: Vault): Promise<this> {
        if (this.Blob === null) {
            throw new Error(
                "Cannot export metadata for linking without an encrypted blob."
            );
        }

        const newMetadata = Object.assign(new VaultMetadata(), this);

        // Convert the vault to a JSON string
        const _vaultString = JSON.stringify(cleanVaultInstance);

        newMetadata.DBIndex = null;

        // Encrypt the vault using the configured encryption
        newMetadata.Blob = await VaultEncryption.EncryptDataBlob(
            _vaultString,
            cleanVaultInstance.Secret,
            this.Blob.algorithm,
            this.Blob.keyDerivationFunc,
            this.Blob.keyDerivationFuncConfig
        );

        return newMetadata;
    }

    /**
     * Parses a JSON formatted string into a VaultMetadata Object while making sure the object is valid.
     * This is used when importing a vault from a JSON file (usually a vault from a linked device).
     * @param data The JSON string to parse
     * @returns A new VaultMetadata object
     */
    public static async parseFromString(data: string): Promise<VaultMetadata> {
        const obj = JSON.parse(data);

        // Check if the object is valid
        if (
            !obj.hasOwnProperty("Name") ||
            !obj.hasOwnProperty("Description") ||
            !obj.hasOwnProperty("CreatedAt") ||
            !obj.hasOwnProperty("LastUsed") ||
            !obj.hasOwnProperty("Blob")
        ) {
            throw new Error("Invalid object. Parsing failed.");
        }

        const vaultMetadata = new VaultMetadata();

        vaultMetadata.Name = obj.Name;
        vaultMetadata.Description = obj.Description;
        vaultMetadata.CreatedAt = new Date(obj.CreatedAt);
        vaultMetadata.LastUsed = new Date(obj.LastUsed);
        vaultMetadata.Blob = Object.assign(
            VaultEncryption.EncryptedBlob.CreateDefault(),
            obj.Blob
        );

        return vaultMetadata;
    }

    /**
     * Parses raw data from the database interface into a proper VaultMetadata object.
     * @param data The raw data from the database
     * @returns A new VaultMetadata object
     */
    public static parseFromDatabase(
        data: VaultStorage.VaultMetadataInterface
    ): VaultMetadata {
        const vaultMetadata = new VaultMetadata();

        vaultMetadata.DBIndex = data.id;
        vaultMetadata.Name = data.name;
        vaultMetadata.Description = data.description;
        vaultMetadata.CreatedAt = data.created_at;
        vaultMetadata.LastUsed = data.last_used;
        vaultMetadata.Blob = Object.assign(
            VaultEncryption.EncryptedBlob.CreateDefault(),
            data.blob
        );

        return vaultMetadata;
    }
}

export const newVaultFormSchema = z.object({
    vaultName: z
        .string()
        .min(1, requiredFieldError)
        .max(255, "Name is too long"),
    vaultDescription: z.string().max(500, "Description is too long"),
    vaultSecret: z.string().min(1, requiredFieldError),
    vaultEncryption: VaultEncryption.vaultEncryptionFormElement,
    vaultEncryptionKeyDerivationFunction:
        VaultEncryption.vaultEncryptionKeyDerivationFunctionFormElement,
    vaultEncryptionConfig:
        VaultEncryption.vaultEncryptionConfigurationsFormElement,
});
export type NewVaultFormSchemaType = z.infer<typeof newVaultFormSchema>;
export namespace Credential {
    export enum TOTPAlgorithm {
        SHA1 = "SHA1",
        SHA256 = "SHA256",
        SHA512 = "SHA512",
    }

    export const totpFormSchema = z.object({
        Label: z
            .string()
            .min(1, requiredFieldError)
            .max(255, "Label is too long"),
        Issuer: z.string(),
        Secret: z.string(),
        Period: z.number().min(1, "Period must be at least 1 second"),
        Digits: z.number().min(1, "Digits must be at least 1"),
        Algorithm: z.enum([
            Credential.TOTPAlgorithm.SHA1,
            Credential.TOTPAlgorithm.SHA256,
            Credential.TOTPAlgorithm.SHA512,
        ]),
    });
    export const credentialFormSchema = z.object({
        id: z.string().nullable(),
        name: z
            .string()
            .min(1, requiredFieldError)
            .max(255, "Name is too long"),
        username: z.string(),
        password: z.string(),
        totp: totpFormSchema.nullable(),
        tags: z.array(z.string()),
        url: z.string(),
        notes: z.string(),
    });
    export type TOTPFormSchemaType = z.infer<typeof totpFormSchema>;
    export type CredentialFormSchemaType = z.infer<typeof credentialFormSchema>;

    export const PERIOD_DEFAULT = 30;
    export const DIGITS_DEFAULT = 6;
    export const ALGORITHM_DEFAULT = TOTPAlgorithm.SHA1;
    export class TOTP {
        public Secret: string;
        public Issuer: string;
        public Period: number;
        public Digits: number;
        public Algorithm: TOTPAlgorithm;

        constructor() {
            this.Secret = "";
            this.Issuer = "";
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
                algorithm: this.Algorithm,
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

    export class VaultCredential {
        public ID: string;
        public Name: string;
        public Username: string;
        public Password: string;
        public TOTP: TOTP | null;
        public Tags: string[];
        public URL: string;
        public Notes: string;
        public DateCreated: Date;
        public DateModified: Date | null;
        public DatePasswordChanged: Date | null;

        constructor(form?: CredentialFormSchemaType) {
            if (process.env.NODE_ENV === "development") {
                this.ID = this.uuidv4_insecurecontexts();
            } else {
                this.ID = crypto.randomUUID();
            }

            this.Name = form?.name ?? "";
            this.Username = form?.username ?? "";
            this.Password = form?.password ?? "";
            this.TOTP = form?.totp
                ? Object.assign(new Credential.TOTP(), form.totp)
                : null;
            this.Tags = form?.tags ?? [];
            this.URL = form?.url ?? "";
            this.Notes = form?.notes ?? "";

            this.DateCreated = new Date();
            this.DateModified = null;
            this.DatePasswordChanged = null;
        }

        /**
         * Override the string representation of the object
         */
        public toString(): string {
            return JSON.stringify(this);
        }

        private uuidv4_insecurecontexts = (): string => {
            if (process.env.NODE_ENV === "development")
                return (1e7 + -1e3 + -4e3 + -8e3 + -1e11)
                    .toString()
                    .replace(/[018]/g, (c: string): string => {
                        const numC = parseInt(c);
                        return (
                            numC ^
                            (crypto.getRandomValues(new Uint8Array(1))[0] ??
                                0 & (15 >> (numC / 4)))
                        ).toString(16);
                    });
            else return "";
        };
    }
}

export interface OnlineServicesAccountInterface {
    UserID: string;
    PublicKey: string;
    PrivateKey: string;
}

export class LinkedDevice {
    public ID: string;
    public Name: string;
    public LastSync: Date | null = null;
    public IsRoot = false;

    constructor(deviceID: string, deviceName: string, isRoot = false) {
        this.ID = deviceID;
        this.Name = deviceName;
        this.IsRoot = isRoot;
    }

    public updateLastSync(): void {
        this.LastSync = new Date();

        console.debug(`Updated last sync for device ${this.Name} (${this.ID})`);
    }
}

export class OnlineServicesAccount {
    public UserID?: string;
    public PublicKey?: string;
    public PrivateKey?: string;

    public LinkedDevices: LinkedDevice[] = [];

    public bindAccount(
        userID: string,
        publicKey: string,
        privateKey: string
    ): void {
        this.UserID = userID;
        this.PublicKey = publicKey;
        this.PrivateKey = privateKey;
    }

    public unbindAccount(): void {
        this.UserID = undefined;
        this.PublicKey = undefined;
        this.PrivateKey = undefined;
    }

    public isBound(): boolean {
        return (
            this.UserID != null &&
            this.PublicKey != null &&
            this.PrivateKey != null
        );
    }

    public addLinkedDevice(
        deviceID: string,
        deviceName: string,
        isRoot = false
    ): void {
        this.LinkedDevices.push(new LinkedDevice(deviceID, deviceName, isRoot));
    }

    public removeLinkedDevice(deviceID: string): void {
        this.LinkedDevices = this.LinkedDevices.filter(
            (device) => device.ID !== deviceID
        );
    }

    public getLinkedDevice(deviceID: string): LinkedDevice | null {
        for (const device of this.LinkedDevices) {
            if (device.ID === deviceID) {
                return device;
            }
        }
        return null;
    }

    /**
     * Decrypts the data that was deserialized for signing in to online services.
     * This is used when
     * @param encryptedData The data to decrypt (as a base64 string)
     * @param secret The secret to decrypt the data with
     * @returns The decrypted data as an OnlineServicesAccountInterface object
     * @throws An error if the decryption fails or the data is invalid
     */
    public static async decryptTransferableData(
        encryptedData: string,
        secret: string
    ): Promise<OnlineServicesAccountInterface> {
        // Convert the encrypted data to a Buffer (from a base64 string)
        const [blob, salt, header_iv] = encryptedData.split(":");

        // Validate the data
        if (blob == null || salt == null || header_iv == null) {
            throw new Error("Invalid data. Parsing failed.");
        }

        // Create a default EncryptedBlob object and assign the encrypted data to it
        const encryptedBlob = VaultEncryption.EncryptedBlob.CreateDefault();
        encryptedBlob.blob = encryptedData.toString();
        encryptedBlob.salt = salt;
        encryptedBlob.header_iv = header_iv;

        const decrypted = await VaultEncryption.DecryptDataBlob(
            encryptedBlob,
            secret,
            encryptedBlob.algorithm,
            encryptedBlob.keyDerivationFunc,
            encryptedBlob.keyDerivationFuncConfig
        );

        const decryptedData: OnlineServicesAccountInterface =
            JSON.parse(decrypted);

        // Some basic validation
        if (
            !decryptedData.hasOwnProperty("UserID") ||
            !decryptedData.hasOwnProperty("PublicKey") ||
            !decryptedData.hasOwnProperty("PrivateKey") ||
            decryptedData.UserID === "" ||
            decryptedData.PublicKey === "" ||
            decryptedData.PrivateKey === ""
        ) {
            throw new Error("Invalid data. Parsing failed.");
        }

        return decryptedData;
    }

    /**
     * Encrypts the data that will be deserialized for signing in to online services on another device.
     * @param userID The generated user ID (account ID)
     * @param publicKey The generated public key
     * @param privateKey The generated private key
     * @returns An object containing the encrypted data and the secret used to encrypt it
     */
    public static async encryptTransferableData(
        userID: string,
        publicKey: string,
        privateKey: string
    ): Promise<{
        encryptedDataB64: string;
        secret: string;
    }> {
        // Even though isBound checks for null, we do the explicit check here to avoid TS errors
        if (!userID.length || !publicKey.length || !privateKey.length) {
            throw new Error(
                "Cannot create transferable data. One or more of the required fields is empty."
            );
        }

        // Generate a random passphrase with which to encrypt the data - 128 bits
        const secret: string = bip39.generateMnemonic(wordlist, 128);

        const newEncryptedBlob: VaultEncryption.EncryptedBlob =
            VaultEncryption.EncryptedBlob.CreateDefault();

        const dataToEncrypt: OnlineServicesAccountInterface = {
            UserID: userID,
            PublicKey: publicKey,
            PrivateKey: privateKey,
        };

        newEncryptedBlob.blob = Buffer.from(
            JSON.stringify(dataToEncrypt, null, 0)
        ).toString();

        // Encrypt the data using the passphrase
        const _encryptedData = await VaultEncryption.EncryptDataBlob(
            newEncryptedBlob.blob,
            secret,
            newEncryptedBlob.algorithm,
            newEncryptedBlob.keyDerivationFunc,
            newEncryptedBlob.keyDerivationFuncConfig
        );

        const encryptedDataB64 = `${_encryptedData.blob}:${_encryptedData.salt}:${_encryptedData.header_iv}`;

        return {
            encryptedDataB64,
            secret,
        };
    }
}

export class Vault {
    public Secret: string;
    public OnlineServices: OnlineServicesAccount;
    public Credentials: Credential.VaultCredential[];

    constructor(secret: string, seedData = false, seedCount = 0) {
        this.Secret = secret;
        this.OnlineServices = new OnlineServicesAccount();
        this.Credentials = seedData ? this.seedVault(seedCount) : [];
    }

    /**
     * Seeds the vault with mock credentials
     * @param num Number of credentials to seed the vault with
     * @returns An array of mock credentials
     */
    private seedVault(num = 100): Credential.VaultCredential[] {
        const creds: Credential.VaultCredential[] = [];

        // This will only be included in development builds
        if (process.env.NODE_ENV === "development") {
            // Generate n mock credentials
            for (let i = 0; i < num; i++) {
                const newCreds = new Credential.VaultCredential();
                newCreds.Name = "Test Credential " + i;
                newCreds.Username = "Test Username " + i;
                newCreds.Password = "Test Password " + i;
                creds.push(newCreds);
            }
        }

        return creds;
    }

    //#region Credential Methods
    /**
     * Upserts a credential. If the credential already exists, it will be updated. If it does not exist, it will be created.
     * @param form The valid form data with which to upsert the credential.
     * @returns void
     */
    public upsertCredential(form: Credential.CredentialFormSchemaType): void {
        const existingCreds = this.Credentials.find((c) => c.ID === form.id);

        if (existingCreds) {
            const today = new Date();

            existingCreds.Name = form.name;
            existingCreds.Username = form.username;

            if (form.password !== existingCreds.Password) {
                existingCreds.DatePasswordChanged = today;
            }

            existingCreds.Password = form.password;
            existingCreds.TOTP = Object.assign(
                new Credential.TOTP(),
                form.totp
            );
            existingCreds.Tags = form.tags;
            existingCreds.URL = form.url;
            existingCreds.Notes = form.notes;
            existingCreds.DateModified = today;
        } else {
            const newCreds = new Credential.VaultCredential(form);
            this.Credentials.push(newCreds);
        }
    }

    /**
     * Deletes a credential from the vault using the credential's ID.
     * We don't throw an error if the credential doesn't exist, because it doesn't matter.
     * @param id The ID of the credential to delete
     */
    public deleteCredential(id: string): void {
        const index = this.Credentials.findIndex((c) => c.ID === id);

        if (index >= 0) {
            this.Credentials.splice(index, 1);
        }
    }
    //#endregion Credential Methods

    /**
     * Packages the vault for linking to another device.
     * This is done by creating a copy of the vault, clearing the online services account and re-binding it with the new account.
     * @throws An error if the vault is not bound to an account
     * @param newOnlineServicesAccount Credentials for the new account to bind to the vault (that will be used on the other device)
     * @returns A new Vault object ready for serialization and transfer
     */
    public packageForLinking(
        newOnlineServicesAccount: OnlineServicesAccountInterface
    ): Vault {
        if (!this.OnlineServices.isBound() || !this.OnlineServices.UserID) {
            throw new Error(
                "Cannot package the vault for linking. The vault is not bound to an account."
            );
        }

        // Create a copy of the vault so we don't modify the original
        const vaultCopy = Object.assign(new Vault(this.Secret), this);

        // Clear the online services account and re-bind it with the new account for the other device
        vaultCopy.OnlineServices = new OnlineServicesAccount();
        vaultCopy.OnlineServices.bindAccount(
            newOnlineServicesAccount.UserID,
            newOnlineServicesAccount.PublicKey,
            newOnlineServicesAccount.PrivateKey
        );

        // Get the name of the computer
        const deviceName = window.navigator.userAgent;

        // Plant this device as a linked device in the new vault
        vaultCopy.OnlineServices.addLinkedDevice(
            this.OnlineServices.UserID,
            deviceName,
            true
        );

        return vaultCopy;
    }
}
