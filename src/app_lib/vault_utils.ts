import { z } from "zod";
import * as sodium from "libsodium-wrappers-sumo";
import Dexie from "dexie";
import * as OTPAuth from "otpauth";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { env } from "../env/client.mjs";

import * as VaultUtilTypes from "./proto/vault";
import Papa from "papaparse";

const requiredFieldError = "This is a required field";

/**
 * Generates a random string. Used only for development purposes, in insecure contexts.
 * The check in the function is used to prevend the bundler from including this function in the production build.
 * @returns A random string
 */
const uuidv4_insecurecontexts = (): string => {
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
            iterations: number = KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS
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
            opsLimit: number = KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT
        ) {
            this.memLimit = memLimit;
            this.opsLimit = opsLimit;
        }
    }

    export const vaultEncryptionFormElement = z
        .nativeEnum(VaultUtilTypes.EncryptionAlgorithm)
        .default(VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305);

    export const vaultEncryptionKeyDerivationFunctionFormElement = z
        .nativeEnum(VaultUtilTypes.KeyDerivationFunction)
        .default(VaultUtilTypes.KeyDerivationFunction.Argon2ID);

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
        Secret: z.string().min(1, requiredFieldError),
        Encryption: vaultEncryptionFormElement,
        EncryptionKeyDerivationFunction:
            vaultEncryptionKeyDerivationFunctionFormElement,
        EncryptionConfig: vaultEncryptionConfigurationsFormElement,
        // EncryptionConfigArgon2ID:
        CaptchaToken: env.NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA
            ? z.string().nonempty("Captcha is required.")
            : z.string(),
    });
    export type UnlockVaultFormSchemaType = z.infer<
        typeof unlockVaultFormSchema
    >;

    export class EncryptedBlob implements VaultEncryption.EncryptedBlob {
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
            headerIV: string
        ) {
            this.Algorithm = algorithm;
            this.KeyDerivationFunc = keyDerivationFunc;
            this.KDFConfigArgon2ID = kdfConfigArgon2ID ?? undefined;
            this.KDFConfigPBKDF2 = kdfConfigPBKDF2 ?? undefined;
            this.Blob = blob;
            this.Salt = salt;
            this.HeaderIV = headerIV;
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
                ""
            );
        }

        /**
         * Seralizes the EncryptedBlob object into a JSON string.
         * This is used when creating a backup of the vault.
         * @returns A JSON string representation of the EncryptedBlob object
         */
        public async toString(): Promise<string> {
            return JSON.stringify({
                Version: 1,
                Algorithm: this.Algorithm,
                KeyDerivationFunc: this.KeyDerivationFunc,
                KeyDerivationFuncConfig:
                    this.KeyDerivationFunc ===
                    VaultUtilTypes.KeyDerivationFunction.Argon2ID
                        ? this.KDFConfigArgon2ID
                        : this.KDFConfigPBKDF2,
                Blob: Buffer.from(this.Blob).toString("base64"),
                Salt: this.Salt,
                HeaderIV: this.HeaderIV,
            });
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
                !obj.hasOwnProperty("Algorithm") ||
                !obj.hasOwnProperty("KeyDerivationFunc") ||
                !obj.hasOwnProperty("KeyDerivationFuncConfig") ||
                !obj.hasOwnProperty("Blob") ||
                !obj.hasOwnProperty("Salt") ||
                !obj.hasOwnProperty("HeaderIV")
            ) {
                throw new Error("Invalid object. Parsing failed.");
            }

            // Extract the algorithm
            if (
                obj.Algorithm !== VaultUtilTypes.EncryptionAlgorithm.AES256 &&
                obj.Algorithm !==
                    VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305
            ) {
                throw new Error("Invalid algorithm. Parsing failed.");
            }

            // Extract the key derivation function
            if (
                obj.KeyDerivationFunc !==
                    VaultUtilTypes.KeyDerivationFunction.Argon2ID &&
                obj.KeyDerivationFunc !==
                    VaultUtilTypes.KeyDerivationFunction.PBKDF2
            ) {
                throw new Error(
                    "Invalid key derivation function. Parsing failed."
                );
            }

            let keyDerivationFuncConfig:
                | VaultUtilTypes.KeyDerivationConfigArgon2ID
                | VaultUtilTypes.KeyDerivationConfigPBKDF2;

            // Extract the key derivation function config
            if (
                obj.KeyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
            ) {
                keyDerivationFuncConfig = new KeyDerivationConfig_Argon2ID(
                    obj.KeyDerivationFuncConfig.memLimit,
                    obj.KeyDerivationFuncConfig.opsLimit
                );
            } else {
                keyDerivationFuncConfig = new KeyDerivationConfig_PBKDF2(
                    obj.keyDerivationFuncConfig.iterations
                );
            }

            // Base64 decode the blob
            const blob = Buffer.from(obj.Blob, "base64");

            return new EncryptedBlob(
                obj.Algorithm,
                obj.KeyDerivationFunc,
                obj.KeyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
                    ? (keyDerivationFuncConfig as VaultUtilTypes.KeyDerivationConfigArgon2ID)
                    : null,
                obj.KeyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.PBKDF2
                    ? (keyDerivationFuncConfig as VaultUtilTypes.KeyDerivationConfigPBKDF2)
                    : null,
                blob,
                obj.Salt,
                obj.HeaderIV
            );
        }
    }

    export const EncryptDataBlob = async (
        blob: Uint8Array,
        secret: string,
        algorithm: VaultUtilTypes.EncryptionAlgorithm,
        keyDerivationFunction: VaultUtilTypes.KeyDerivationFunction,
        kdfConfigArgon2ID: KeyDerivationConfig_Argon2ID,
        kdfConfigPBKDF2: KeyDerivationConfig_PBKDF2
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
                    configuration
                );
            case VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305:
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
        algorithm: VaultUtilTypes.EncryptionAlgorithm,
        keyDerivationFunction: VaultUtilTypes.KeyDerivationFunction,
        configuration: KeyDerivationConfig_Argon2ID | KeyDerivationConfig_PBKDF2
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
                    configuration
                );
            case VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305:
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
            blob: Uint8Array,
            secret: string,
            keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2
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
                    keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2
                );
            } else if (
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
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
                blob
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
                Buffer.from(iv).toString("base64")
            );
        }

        static async decryptBlobAES256(
            blob: EncryptedBlob,
            secret: string,
            keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2
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
                    keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2
                );
            } else if (
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
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
            } else {
                throw new Error("Invalid key derivation function");
            }

            const decrypted = await crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv,
                },
                derivedKey,
                encryptedBlob
            );

            // return new TextDecoder().decode(decrypted);
            return new Uint8Array(decrypted);
        }
    }

    class XChaCha20Poly1305 {
        static async encryptBlob(
            blob: Uint8Array,
            secret: string,
            keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2
        ): Promise<EncryptedBlob> {
            if (keyDerivationFuncConfig == undefined) {
                throw new Error("Key derivation function config is undefined");
            }

            await sodium.ready;

            const salt = sodium.randombytes_buf(
                sodium.crypto_shorthash_KEYBYTES
            );
            let key: Uint8Array;

            if (
                keyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.PBKDF2
            ) {
                const _key = await KeyDerivation.deriveKeyPBKDF2(
                    secret,
                    salt,
                    keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2
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
                    keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID
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
                sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE
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
                Buffer.from(header).toString("base64")
            );
        }

        static async decryptBlob(
            encryptedBlob: EncryptedBlob,
            secret: string,
            keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
            keyDerivationFuncConfig:
                | KeyDerivationConfig_Argon2ID
                | KeyDerivationConfig_PBKDF2
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
                    keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2
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
                    keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID
                );
            } else {
                throw new Error("Invalid key derivation function");
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
        data: Uint8Array
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
        // GoogleDrive,
    }

    export const trigger = async (
        type: Type,
        vaultBlob: VaultEncryption.EncryptedBlob
    ): Promise<void> => {
        if (type === Type.Manual) {
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
        a.download = `cryptexvault-bk-${Date.now()}.cryx`;
        a.click();
        URL.revokeObjectURL(url);
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
        formData: NewVaultFormSchemaType,
        seedVault = false,
        seedCount = 0
    ): Promise<VaultMetadata> {
        const vaultMetadata = new VaultMetadata();

        vaultMetadata.Name = formData.Name;
        vaultMetadata.Description = formData.Description;
        vaultMetadata.CreatedAt = new Date().toISOString();
        vaultMetadata.LastUsed = undefined;

        // Instantiate a new vault to encrypt
        const freshVault = new Vault(formData.Secret, seedVault, seedCount);

        // Serialize the vault instance
        const _vaultBytes = VaultUtilTypes.Vault.encode(freshVault).finish();

        // Encrypt the vault using default encryption
        vaultMetadata.Blob = await VaultEncryption.EncryptDataBlob(
            _vaultBytes,
            formData.Secret,
            formData.Encryption,
            formData.EncryptionKeyDerivationFunction,
            formData.EncryptionConfig, // TODO: Get this TF out of here
            formData.EncryptionConfig // TODO: Move this too
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
        if (this.Blob == null) {
            throw new Error("Cannot save, vault blob is null");
        }

        // If the vault instance is not null, encrypt it and save it to the blob
        // Otherwise, just save the blob as is
        if (vaultInstance != null) {
            // Update the last used date only if we're actually updating the vault
            this.LastUsed = new Date().toISOString();

            // Serialize the vault instance
            const _vaultBytes =
                VaultUtilTypes.Vault.encode(vaultInstance).finish();

            // Encrypt the vault using the configured encryption
            this.Blob = await VaultEncryption.EncryptDataBlob(
                _vaultBytes,
                vaultInstance.Secret,
                this.Blob.Algorithm,
                this.Blob.KeyDerivationFunc,
                this.Blob
                    .KDFConfigArgon2ID as VaultUtilTypes.KeyDerivationConfigArgon2ID,
                this.Blob
                    .KDFConfigPBKDF2 as VaultUtilTypes.KeyDerivationConfigPBKDF2
            );
        }

        // Serialize the vault metadata and save it to the database
        await VaultStorage.saveVault(
            this.DBIndex,
            VaultUtilTypes.VaultMetadata.encode(this).finish()
        );
    }

    /**
     * Decrypts the vault blob and returns it.
     * @param secret The secret to decrypt the vault with
     * @param encryptionAlgorithm The encryption algorithm used to encrypt the vault (taken from the blob or overriden by the user)
     * @returns The decrypted vault object
     */
    public async decryptVault(
        secret: string,
        encryptionAlgorithm: VaultUtilTypes.EncryptionAlgorithm,
        keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
        keyDerivationFuncConfig: VaultEncryption.VaultEncryptionConfigurationsFormElementType
    ): Promise<Vault> {
        if (this.Blob == null) {
            throw new Error("Vault blob is null");
        }

        const decryptedVaultString = await VaultEncryption.DecryptDataBlob(
            this.Blob,
            secret,
            encryptionAlgorithm,
            keyDerivationFunc,
            keyDerivationFuncConfig
        );

        const vaultRawParsed =
            VaultUtilTypes.Vault.decode(decryptedVaultString);

        const vaultObject: Vault = Object.assign(
            new Vault(secret),
            vaultRawParsed
        );

        vaultObject.OnlineServices = Object.assign(
            new OnlineServicesAccount(),
            vaultObject.OnlineServices
        );

        // Go through each linked device and assign it to a new object
        // This is done to ensure that the LinkedDevice class is used instead of the generic object
        vaultObject.OnlineServices.LinkedDevices =
            vaultObject.OnlineServices.LinkedDevices.map(
                (device: LinkedDevice) => {
                    return Object.assign(new LinkedDevice(), device);
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

        vaultObject.Diffs = vaultObject.Diffs.map((diff: Credential.Diff) => {
            return Object.assign(new Credential.Diff(), diff);
        });

        vaultObject.Configuration = Object.assign(
            new Configuration(),
            vaultObject.Configuration
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
    public async exportForLinking(
        cleanVaultInstance: Vault
    ): Promise<Uint8Array> {
        if (this.Blob == null) {
            throw new Error(
                "Cannot export metadata for linking without an encrypted blob."
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
                .KDFConfigPBKDF2 as VaultUtilTypes.KeyDerivationConfigPBKDF2
        );

        return VaultUtilTypes.VaultMetadata.encode(newMetadata).finish();
    }

    public static decodeMetadataBinary(
        data: Uint8Array,
        dbIndex?: number
    ): VaultMetadata {
        const rawData = VaultUtilTypes.VaultMetadata.decode(data);

        const vaultMetadata = Object.assign(new VaultMetadata(), rawData);

        if (dbIndex != null) vaultMetadata.DBIndex = dbIndex;

        // Make sure that the Blob object is not a vanilla object
        if (vaultMetadata.Blob != null) {
            vaultMetadata.Blob = Object.assign(
                VaultEncryption.EncryptedBlob.CreateDefault(),
                vaultMetadata.Blob
            );
        }

        return vaultMetadata;
    }
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
    export const PossibleFields: Fields[] = [
        "Name",
        "Username",
        "Password",
        "TOTP",
        "Tags",
        "URL",
        "Notes",
        "DateCreated",
        "DateModified",
        "DatePasswordChanged",
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
        onFailure: (error: Error) => void
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

    export const CSV = (
        file: File,
        fields: FieldsSchemaType,
        onSuccess: (credentials: Credential.CredentialFormSchemaType[]) => void,
        onFailure: (error: Error) => void
    ): void => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            download: false,
            // worker: true,
            complete: function (results: Papa.ParseResult<unknown> | null) {
                if (!results) return;

                const credentials: Credential.CredentialFormSchemaType[] = [];

                for (const row of results.data as FieldsSchemaType[]) {
                    const credential: Credential.CredentialFormSchemaType = {
                        ID: null,
                    };

                    credential.Name =
                        row[(fields.Name as keyof FieldsSchemaType) ?? ""] ??
                        "Import";
                    credential.Username =
                        row[
                            (fields.Username as keyof FieldsSchemaType) ?? ""
                        ] ?? undefined;
                    credential.Password =
                        row[
                            (fields.Password as keyof FieldsSchemaType) ?? ""
                        ] ?? undefined;

                    credential.Tags = (
                        row[(fields.Tags as keyof FieldsSchemaType) ?? ""] ?? ""
                    )
                        .split(fields.TagDelimiter ?? ",")
                        .join(Credential.TAG_SEPARATOR);

                    credential.URL =
                        row[(fields.URL as keyof FieldsSchemaType) ?? ""] ??
                        undefined;

                    credential.Notes =
                        row[(fields.Notes as keyof FieldsSchemaType) ?? ""] ??
                        undefined;

                    // Use the DateCreated field if it exists (fall back to today) but set it to undefined if it doesn't
                    credential.DateCreated = fields.DateCreated
                        ? new Date(
                              row[
                                  fields.DateCreated as keyof FieldsSchemaType
                              ] ?? Date.now()
                          ).toISOString()
                        : undefined;

                    credential.DateModified = fields.DateModified
                        ? new Date(
                              row[
                                  (fields.DateModified as keyof FieldsSchemaType) ??
                                      ""
                              ] ?? ""
                          ).toISOString()
                        : undefined;

                    credential.DatePasswordChanged = fields.DatePasswordChanged
                        ? new Date(
                              row[
                                  (fields.DatePasswordChanged as keyof FieldsSchemaType) ??
                                      ""
                              ] ?? ""
                          ).toISOString()
                        : undefined;

                    if (
                        fields.TOTP &&
                        row[fields.TOTP as keyof FieldsSchemaType]
                    ) {
                        credential.TOTP = new Credential.TOTP();
                        credential.TOTP.Secret =
                            row[fields.TOTP as keyof FieldsSchemaType] ?? "";
                    }

                    credentials.push(credential);
                }

                // Call the onSuccess callback
                onSuccess(credentials);
            },
            error: function (error) {
                // Call the onFailure callback
                onFailure(error);
            },
        });
    };

    export const BitwardenJSON = (
        file: File
    ): Promise<{
        credentials: Credential.CredentialFormSchemaType[];
        groups: Group[];
    }> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => {
                const json = reader.result as string;
                const parsed = JSON.parse(json) as BitwardenJSON;

                const credentials: Credential.CredentialFormSchemaType[] = [];

                for (const item of parsed.items) {
                    const credential: Credential.CredentialFormSchemaType = {
                        ID: null,
                        Type: item.type,
                        GroupID: item.folderId,
                    };

                    // TODO: Set fields based on type (mainly type 4 - identity)

                    credential.Name = item.name ?? "Import";

                    if (item.login) {
                        credential.Username = item.login.username ?? undefined;
                        credential.Password = item.login.password ?? undefined;
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
                                  item.passwordHistory[0].lastUsedDate
                              ).toISOString()
                            : undefined;

                    if (item.login?.totp) {
                        credential.TOTP = new Credential.TOTP();
                        credential.TOTP.Secret = item.login.totp;
                    }

                    // Set custom fields
                    item.fields.forEach((field) => {
                        if (!credential.CustomFields)
                            credential.CustomFields = [];

                        // Only import text, masked text and boolean fields
                        // The 3 type is for something called "linked fields" for which we don't have an equivalent
                        if (field.type < 3) {
                            const customField = new Credential.CustomField();
                            customField.Name = field.name;
                            customField.Value = field.value;
                            customField.Type = field.type;

                            credential.CustomFields.push(customField);
                        }
                    });
                }

                // Return folders
                const groups: Group[] = [];

                parsed.folders?.forEach((folder) => {
                    groups.push({
                        ID: folder.id,
                        Name: folder.name,
                        Icon: "",
                        Color: "",
                    });
                });

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

export namespace Credential {
    export const totpFormSchema = z.object({
        Label: z
            .string()
            .min(1, requiredFieldError)
            .max(255, "Label is too long"),
        Issuer: z.string(),
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
        public Issuer: string;
        public Secret: string;
        public Period: number;
        public Digits: number;
        public Algorithm: VaultUtilTypes.TOTPAlgorithm;

        constructor() {
            this.Label = "";
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
        Type: z.nativeEnum(VaultUtilTypes.ItemType).optional(),
        GroupID: z.string().optional(),
        Name: z
            .string()
            .min(1, requiredFieldError)
            .max(255, "Name is too long")
            .optional(),
        Username: z.string().optional(),
        Password: z.string().optional(),
        TOTP: totpFormSchema.optional().nullable(), // This has to be nullable because of the way the form works
        Tags: z.string().optional(),
        URL: z.string().optional(),
        Notes: z.string().optional(),
        DateCreated: z.string().optional(), // Used only in diffing
        DateModified: z.string().nullable().optional(), // Used only in diffing
        DatePasswordChanged: z.string().nullable().optional(), // Used only in diffing
        CustomFields: z
            .array(
                z.object({
                    ID: z.string(),
                    Name: z.string(),
                    Type: z.nativeEnum(VaultUtilTypes.CustomFieldType),
                    Value: z.string(),
                })
            )
            .optional(),
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

        constructor(form?: CredentialFormSchemaType) {
            this.ID = form?.ID ?? "-1";

            this.Type = form?.Type ?? VaultUtilTypes.ItemType.Credentials;
            this.GroupID = form?.GroupID ?? "";

            this.Name = form?.Name ?? "";
            this.Username = form?.Username ?? "";
            this.Password = form?.Password ?? "";
            this.TOTP = form?.TOTP
                ? Object.assign(new Credential.TOTP(), form.TOTP)
                : undefined;
            this.Tags = form?.Tags ?? "";
            this.URL = form?.URL ?? "";
            this.Notes = form?.Notes ?? "";

            this.DateCreated = new Date().toISOString();
            this.DateModified = undefined;
            this.DatePasswordChanged = undefined;

            this.CustomFields = form?.CustomFields ?? [];
        }

        /**
         * Override the string representation of the object
         */
        public toString(): string {
            return JSON.stringify(this);
        }
    }

    export interface DiffChange
        extends VaultUtilTypes.DiffChange,
            DiffChangeSchemaType {
        Type: VaultUtilTypes.DiffType;
        ID: string;
        Props?: VaultUtilTypes.PartialCredential | undefined;
    }
    const DiffChangeSchema = z.object({
        Type: z.nativeEnum(VaultUtilTypes.DiffType),
        ID: z.string(),
        Props: z.any().optional(), // This is Partial<VaultCredential>, undefined for deletes
    });
    type DiffChangeSchemaType = z.infer<typeof DiffChangeSchema>;

    export class Diff implements VaultUtilTypes.Diff, DiffSchemaType {
        Hash: string;
        Changes: DiffChange | undefined;

        constructor(hash = "", changes?: DiffChange) {
            this.Hash = hash;
            this.Changes = changes;
        }
    }
    export const DiffSchema = z.object({
        Hash: z.string(),
        Changes: DiffChangeSchema.optional(),
    });
    export type DiffSchemaType = z.infer<typeof DiffSchema>;

    export const getChanges = (
        prevCredential: VaultCredential | undefined,
        nextCredential: VaultCredential
    ): DiffChange | null => {
        // Normalize the previous and next credentials objects
        prevCredential = prevCredential
            ? JSON.parse(JSON.stringify(prevCredential))
            : undefined;
        nextCredential = JSON.parse(JSON.stringify(nextCredential));

        const changes: DiffChange[] = [];

        // If the previous credential doesn't exist, then this is a new credential
        if (!prevCredential) {
            return {
                Type: VaultUtilTypes.DiffType.Add,
                ID: nextCredential.ID,
                Props: nextCredential,
            };
        }

        // Note: Don't diff the credential type

        if (prevCredential.GroupID !== nextCredential.GroupID) {
            changes.push({
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: {
                    GroupID: nextCredential.GroupID,
                },
            });
        }

        if (prevCredential.Name !== nextCredential.Name) {
            changes.push({
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: {
                    Name: nextCredential.Name,
                },
            });
        }
        if (prevCredential.Username !== nextCredential.Username) {
            changes.push({
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: {
                    Username: nextCredential.Username,
                },
            });
        }
        if (prevCredential.Password !== nextCredential.Password) {
            changes.push({
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: {
                    Password: nextCredential.Password,
                },
            });
        }
        if (
            JSON.stringify(prevCredential.TOTP) !==
            JSON.stringify(nextCredential.TOTP)
        ) {
            changes.push({
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: {
                    TOTP: nextCredential.TOTP,
                },
            });
        }
        if (prevCredential.Tags !== nextCredential.Tags) {
            changes.push({
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: {
                    Tags: nextCredential.Tags,
                },
            });
        }
        if (prevCredential.URL !== nextCredential.URL) {
            changes.push({
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: { URL: nextCredential.URL },
            });
        }
        if (prevCredential.Notes !== nextCredential.Notes) {
            changes.push({
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: {
                    Notes: nextCredential.Notes,
                },
            });
        }
        if (prevCredential.DateCreated !== nextCredential.DateCreated) {
            changes.push({
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: {
                    DateCreated: nextCredential.DateCreated,
                },
            });
        }

        if (prevCredential.DateModified !== nextCredential.DateModified) {
            changes.push({
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: {
                    DateModified: nextCredential.DateModified,
                },
            });
        }

        if (
            prevCredential.DatePasswordChanged !==
            nextCredential.DatePasswordChanged
        ) {
            changes.push({
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: {
                    DatePasswordChanged: nextCredential.DatePasswordChanged,
                },
            });
        }

        // Merge all changes into a single update
        if (changes.length) {
            const _props: Partial<VaultCredential> | undefined = changes.reduce(
                (acc, change) => ({ ...acc, ...change.Props }),
                {}
            );

            // If the _props object only contains the DateModified property, then there are no real changes
            if (
                Object.keys(_props).length === 1 &&
                _props.DateModified !== undefined
            ) {
                return null;
            }

            return {
                Type: VaultUtilTypes.DiffType.Update,
                ID: nextCredential.ID,
                Props: _props,
            };
        }

        return null;
    };
}

export const LinkedDevicesSchema = z.object({
    ID: z.string(),
    Name: z.string(),
    LastSync: z.string().optional(),
    IsRoot: z.boolean(),
    LinkedAtTimestamp: z.number(),
    AutoConnect: z.boolean(),
    SyncTimeout: z.boolean(),
    SyncTimeoutPeriod: z.number(),
});
export type LinkedDeviceSchemaType = z.infer<typeof LinkedDevicesSchema>;
export class LinkedDevice
    implements VaultUtilTypes.LinkedDevice, LinkedDeviceSchemaType
{
    public ID: string;
    public Name: string;
    public LastSync: string | undefined;
    public IsRoot = false;
    public LinkedAtTimestamp = Date.now();
    public AutoConnect: boolean;
    public SyncTimeout: boolean;
    public SyncTimeoutPeriod: number;

    constructor(
        deviceID = "",
        deviceName = "",
        isRoot = false,
        linkedAtTimestamp = Date.now(),
        autoConnect = true,
        syncTimeout = false,
        syncTimeoutPeriod = 30
    ) {
        this.ID = deviceID;
        this.Name = deviceName;
        this.IsRoot = isRoot;
        this.LinkedAtTimestamp = linkedAtTimestamp;
        this.AutoConnect = autoConnect;
        this.SyncTimeout = syncTimeout;
        this.SyncTimeoutPeriod = syncTimeoutPeriod;
    }

    public updateLastSync(): void {
        this.LastSync = new Date().toISOString();

        console.debug(`Updated last sync for device ${this.Name} (${this.ID})`);
    }

    public setName(name: string): void {
        if (name.trim().length > 0) {
            this.Name = name;
        }
    }

    public setAutoConnect(autoConnect: boolean): void {
        this.AutoConnect = autoConnect;
    }

    public setSyncTimeout(syncTimeout: boolean): void {
        this.SyncTimeout = syncTimeout;
    }

    public setSyncTimeoutPeriod(syncTimeoutPeriod: number): void {
        this.SyncTimeoutPeriod = Math.abs(syncTimeoutPeriod);
    }
}

export interface OnlineServicesAccountInterface {
    UserID?: string;
    PublicKey?: string;
    PrivateKey?: string;
}

export class OnlineServicesAccount
    implements VaultUtilTypes.OnlineServices, OnlineServicesAccountInterface
{
    public UserID?: string;
    public PublicKey?: string;
    public PrivateKey?: string;
    public CreationTimestamp = Date.now();

    public LinkedDevices: LinkedDevice[] = [];

    public bindAccount(
        userID: string,
        publicKey: string,
        privateKey: string
    ): void {
        this.UserID = userID;
        this.PublicKey = publicKey;
        this.PrivateKey = privateKey;
        this.CreationTimestamp = Date.now();
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

    //#region Linked Devices
    public addLinkedDevice(
        deviceID: string,
        deviceName: string,
        isRoot = false,
        linkedAtTimestamp = Date.now(),
        autoConnect?: boolean,
        syncTimeout?: boolean,
        syncTimeoutPeriod?: number
    ): void {
        this.LinkedDevices.push(
            new LinkedDevice(
                deviceID,
                deviceName,
                isRoot,
                linkedAtTimestamp,
                autoConnect,
                syncTimeout,
                syncTimeoutPeriod
            )
        );
    }

    public removeLinkedDevice(deviceID: string): void {
        this.LinkedDevices = this.LinkedDevices.filter(
            (device) => device.ID !== deviceID
        );
    }

    public getLinkedDevice(deviceID: string): LinkedDevice | null {
        return (
            this.LinkedDevices.find((device) => device.ID === deviceID) ?? null
        );
    }

    public getLinkedDevices(excludedIDs: string[] = []): LinkedDevice[] {
        return this.LinkedDevices.filter(
            (device) => !excludedIDs.includes(device.ID)
        );
    }
    //#endregion Linked Devices

    /**
     * Decrypts the data that was deserialized for signing in to online services.
     * This is used when linking devices (from outside the vault)
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
        encryptedBlob.Blob = Buffer.from(blob, "base64");
        encryptedBlob.Salt = salt;
        encryptedBlob.HeaderIV = header_iv;

        const decrypted = await VaultEncryption.DecryptDataBlob(
            encryptedBlob,
            secret,
            encryptedBlob.Algorithm,
            encryptedBlob.KeyDerivationFunc,
            encryptedBlob.KeyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
                ? (encryptedBlob.KDFConfigArgon2ID as VaultUtilTypes.KeyDerivationConfigArgon2ID)
                : (encryptedBlob.KDFConfigPBKDF2 as VaultUtilTypes.KeyDerivationConfigPBKDF2)
        );

        const decryptedData: OnlineServicesAccountInterface = JSON.parse(
            Buffer.from(decrypted).toString()
        );

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
     * Encrypts and serializes the data that will be used for signing in to online services on another device.
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

        newEncryptedBlob.Blob = Buffer.from(
            JSON.stringify(dataToEncrypt, null, 0)
        );

        // Encrypt the data using the passphrase
        const _encryptedData = await VaultEncryption.EncryptDataBlob(
            newEncryptedBlob.Blob,
            secret,
            newEncryptedBlob.Algorithm,
            newEncryptedBlob.KeyDerivationFunc,
            newEncryptedBlob.KDFConfigArgon2ID as VaultUtilTypes.KeyDerivationConfigArgon2ID,
            newEncryptedBlob.KDFConfigPBKDF2 as VaultUtilTypes.KeyDerivationConfigPBKDF2
        );

        // Convert the encrypted data to a base64 string
        const encryptdBase64Blob = Buffer.from(_encryptedData.Blob).toString(
            "base64"
        );

        const encryptedDataB64 = `${encryptdBase64Blob}:${_encryptedData.Salt}:${_encryptedData.HeaderIV}`;

        return {
            encryptedDataB64,
            secret,
        };
    }
}

class Configuration implements VaultUtilTypes.Configuration {
    /**
     * The maximum number of diffs to store in the vault.
     * This is used to prevent the vault from growing too large.
     * @default 200
     */
    public MaxDiffCount = 200;

    public setMaxDiffCount(count: number): void {
        this.MaxDiffCount = Math.abs(count);
    }
}

const GroupSchema = z.object({
    ID: z.string().nullable(),
    Name: z.string(),
    Icon: z.string(),
    Color: z.string(),
});
export type GroupSchemaType = z.infer<typeof GroupSchema>;
class Group implements VaultUtilTypes.Group, GroupSchemaType {
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
    public Version: number;
    public Secret: string;
    public Configuration: Configuration = new Configuration();
    public OnlineServices: OnlineServicesAccount;
    public Groups: Group[] = [];
    public Credentials: Credential.VaultCredential[];
    public Diffs: Credential.Diff[] = [];

    constructor(secret = "", seedData = false, seedCount = 0) {
        // This is the version of the vault schema
        // It changes when the schema changes
        this.Version = 1;
        this.Secret = secret;
        this.OnlineServices = new OnlineServicesAccount();
        this.Credentials = seedData ? this.seedVault(seedCount) : [];
    }

    /**
     * Seeds the vault with mock credentials
     * @param num Number of credentials to seed the vault with
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

    //#region Diffing
    /**
     * Hashes the vault's credentials and returns the hash as a hex string.
     * This is used to when computing diffs between changes to the vault credentials.
     * It also sorts the properties of the credentials to ensure that the hash is consistent.
     * @returns A SHA256 hash
     */
    private hashCredentials(): string {
        // Copy the credential object property by property
        const credentialsCopy = this.Credentials.map(
            (c: Credential.VaultCredential) => {
                const blankObject: Partial<Credential.VaultCredential> = {};

                // Sort the properties first to ensure the hash is consistent
                Object.keys(c)
                    .sort()
                    .forEach((key: string) => {
                        const typedKey =
                            key as keyof Credential.VaultCredential;
                        (blankObject as any)[typedKey] = c[typedKey];
                    });

                blankObject.ID = "";

                return blankObject;
            }
        );

        const stringifiedCredentials = JSON.stringify(credentialsCopy, null, 0);
        console.debug("Hashing credentials: ", stringifiedCredentials);

        // Generate a SHA256 hash of the credentials
        const credentialsHash = sodium.crypto_hash_sha256(
            Buffer.from(stringifiedCredentials)
        );

        // Return the hash as a hex string
        return Buffer.from(credentialsHash).toString("hex");
    }

    /**
     * Gets the hash from the latest diff, or calculates the hash from the credentials if there are no diffs.
     * @returns The hash from the latest diff, or the credentials hash if there are no diffs
     * @returns An empty string if there are no credentials
     */
    public getLatestHash(): string | null {
        if (this.Diffs.length === 0) {
            return null;
        }

        return this.Diffs.at(-1)?.Hash ?? "";
    }

    /**
     * Gets the hashes from the latest diff to the first diff.
     * @returns If there are diffs, an array of hashes from the latest diff to the first diff (in that order), empty array otherwise
     */
    public getAllHashes(): string[] {
        return this.Diffs.map((diff) => diff.Hash).reverse();
    }

    /**
     * Gets the diffs for the vault from the specified hash to the latest diff.
     * @param hash - The hash to start from
     * @returns An array of diffs from the specified hash to the latest diff (in that order)
     * @returns The whole array of diffs if the hash is null
     *
     */
    public getDiffsSinceHash(hash: string | null): Credential.Diff[] {
        if (hash === null) {
            return this.Diffs;
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
     * Creates a new diff and adds it to the vault's Diffs array
     * If the changes are null, no diff is created
     * Also removes the oldest diff if the max diff count has been reached
     * @param changes - The changes that were made
     */
    private createDiff(changes: Credential.DiffChange | null) {
        if (!changes) {
            console.debug("No changes to create diff for... Early return.");
            return;
        }

        console.time("createDiff-getCredentialsHash");
        // Get the hash of the current credentials
        const newHash = this.hashCredentials();
        console.timeEnd("createDiff-getCredentialsHash");

        console.time("createDiff-pushDiff");
        const diff = new Credential.Diff(newHash, changes);

        // If the diff array size is greater than the max diff count, remove the oldest diff
        if (this.Diffs.length >= this.Configuration.MaxDiffCount) {
            // Slice the array to remove the overflowing diffs
            // Example: this.Diffs.length = 286, this.Configuration.MaxDiffCount = 95
            // - Result: 286 - 95 + 1 = 192 -> 192 diffs from the start of the array are removed
            // - Amount of diffs currently: 286 - 192 = 94 (diffs saved)
            this.Diffs = this.Diffs.slice(
                this.Diffs.length - this.Configuration.MaxDiffCount + 1
            );
        }

        // Add the new diff to the array
        this.Diffs.push(diff);
        console.timeEnd("createDiff-pushDiff");

        console.debug("Current diff list:", this.Diffs);
    }

    public applyDiffs(diffs: Credential.DiffSchemaType[]) {
        console.time("applyDiffs");

        // If there are no diffs, return
        if (diffs.length === 0) {
            console.timeEnd("applyDiffs");
            return;
        }

        // Apply the diffs in order
        diffs.forEach((diff) => {
            if (diff.Changes) {
                if (
                    diff.Changes.Type === VaultUtilTypes.DiffType.Add ||
                    diff.Changes.Type === VaultUtilTypes.DiffType.Update
                ) {
                    if (diff.Changes.Props) {
                        // If the diff has a TOTP, create a TOTP object
                        let totp: Credential.TOTPFormSchemaType | undefined =
                            undefined;
                        if (diff.Changes.Props.TOTP) {
                            totp = {
                                Label: diff.Changes.Props.TOTP.Label,
                                Issuer: diff.Changes.Props.TOTP.Issuer,
                                Algorithm: diff.Changes.Props.TOTP.Algorithm,
                                Digits: diff.Changes.Props.TOTP.Digits,
                                Period: diff.Changes.Props.TOTP.Period,
                                Secret: diff.Changes.Props.TOTP.Secret,
                            };
                        }

                        // Use the built-in upsert method to add or update the credential
                        // That way we don't have to duplicate the logic
                        this.upsertCredential({
                            ID: diff.Changes.ID,
                            Name: diff.Changes.Props.Name,
                            Username: diff.Changes.Props.Username,
                            Password: diff.Changes.Props.Password,
                            Tags: diff.Changes.Props.Tags,
                            Notes: diff.Changes.Props.Notes,
                            TOTP: totp,
                            URL: diff.Changes.Props.URL,
                            DateCreated: diff.Changes.Props.DateCreated,
                            DateModified: diff.Changes.Props.DateModified,
                            DatePasswordChanged:
                                diff.Changes.Props.DatePasswordChanged,
                        });
                    }
                } else if (
                    diff.Changes.Type === VaultUtilTypes.DiffType.Delete
                ) {
                    // Use the built-in delete method to delete the credential
                    this.deleteCredential(diff.Changes.ID);
                }
            }
        });

        console.timeEnd("applyDiffs");
    }

    //#endregion Diffing

    //#region Credential Methods
    /**
     * Upserts a credential. If the credential already exists, it will be updated. If it does not exist, it will be created.
     * @param form The valid form data with which to upsert the credential.
     * @returns void
     */
    public upsertCredential(form: Credential.CredentialFormSchemaType): void {
        console.time("upsertCredential");

        console.time("upsertCredential-findExisting");
        const existingCreds: Credential.VaultCredential | undefined =
            this.Credentials.find((c) => c.ID === form.ID);
        console.timeEnd("upsertCredential-findExisting");

        let changes: Credential.DiffChange | null = null;

        if (existingCreds) {
            console.time("upsertCredential-existingCreds");

            console.time("upsertCredential-existingCredsCopy");
            const originalCredential = Object.assign({}, existingCreds);
            console.timeEnd("upsertCredential-existingCredsCopy");

            console.time("upsertCredential-updateExisting");
            const today = new Date().toISOString();

            if (form.Name) existingCreds.Name = form.Name;

            if (form.Username !== undefined)
                existingCreds.Username = form.Username;

            if (form.Password !== undefined) {
                if (form.Password !== existingCreds.Password)
                    existingCreds.DatePasswordChanged = form.DatePasswordChanged
                        ? form.DatePasswordChanged
                        : today;

                existingCreds.Password = form.Password;
            }

            existingCreds.TOTP = form.TOTP
                ? Object.assign(new Credential.TOTP(), form.TOTP)
                : undefined;

            if (form.Tags !== undefined) existingCreds.Tags = form.Tags;
            if (form.URL !== undefined) existingCreds.URL = form.URL;
            if (form.Notes !== undefined) existingCreds.Notes = form.Notes;

            // This is OK because if this is the only change, getChanges won't return anything
            existingCreds.DateModified = form.DateModified
                ? form.DateModified
                : today;
            console.timeEnd("upsertCredential-updateExisting");

            console.time("upsertCredential-getChanges");
            changes = Credential.getChanges(originalCredential, existingCreds);
            console.timeEnd("upsertCredential-getChanges");

            console.timeEnd("upsertCredential-existingCreds");
        } else {
            console.time("upsertCredential-newCreds");
            const newCreds = new Credential.VaultCredential(form);

            if (process.env.NODE_ENV === "development") {
                newCreds.ID = form?.ID ?? uuidv4_insecurecontexts();
            } else {
                newCreds.ID = form?.ID ?? crypto.randomUUID();
            }

            console.timeEnd("upsertCredential-newCreds");

            if (form.DateCreated) newCreds.DateCreated = form.DateCreated;

            console.time("upsertCredential-pushNewCreds");
            this.Credentials.push(newCreds);
            console.timeEnd("upsertCredential-pushNewCreds");

            console.time("upsertCredential-getChanges");
            changes = Credential.getChanges(undefined, newCreds);
            console.timeEnd("upsertCredential-getChanges");
        }

        this.createDiff(changes);

        console.timeEnd("upsertCredential");
    }

    /**
     * Deletes a credential from the vault using the credential's ID.
     * We don't throw an error if the credential doesn't exist, because it doesn't matter.
     * @param id The ID of the credential to delete
     */
    public deleteCredential(id: string): void {
        console.time("deleteCredential");

        console.time("deleteCredential-findIndex");
        const index = this.Credentials.findIndex((c) => c.ID === id);
        console.timeEnd("deleteCredential-findIndex");

        if (index >= 0) {
            const change: Credential.DiffChange = {
                Type: VaultUtilTypes.DiffType.Delete,
                ID: id,
            };

            console.time("deleteCredential-splice");
            this.Credentials.splice(index, 1);
            console.timeEnd("deleteCredential-splice");

            this.createDiff(change);
        }

        console.timeEnd("deleteCredential");
    }
    //#endregion Credential Methods

    //#region Group Methods
    public upsertGroup(form: GroupSchemaType): void {
        const existingGroup: Group | undefined = this.Groups.find(
            (g) => g.ID === form.ID
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

            if (process.env.NODE_ENV === "development") {
                newGroup.ID = form?.ID ?? uuidv4_insecurecontexts();
            } else {
                newGroup.ID = form?.ID ?? crypto.randomUUID();
            }

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
    public packageForLinking(
        newOnlineServicesAccount: OnlineServicesAccountInterface
    ): Vault {
        if (!this.OnlineServices.isBound() || !this.OnlineServices.UserID) {
            throw new Error(
                "Cannot package the vault for linking. The vault is not bound to an account."
            );
        }

        if (
            !newOnlineServicesAccount.UserID ||
            !newOnlineServicesAccount.PublicKey ||
            !newOnlineServicesAccount.PrivateKey
        ) {
            throw new Error(
                "Cannot package the vault for linking. The new account is missing required information."
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
        const deviceName = "Root Device";

        // Plant this device as a linked device in the new vault
        vaultCopy.OnlineServices.addLinkedDevice(
            this.OnlineServices.UserID,
            deviceName,
            true,
            this.OnlineServices.CreationTimestamp
        );

        // Make sure we add all the other linked devices to this vault
        this.OnlineServices.LinkedDevices.forEach((device) => {
            vaultCopy.OnlineServices.addLinkedDevice(
                device.ID,
                device.Name,
                device.IsRoot,
                device.LinkedAtTimestamp,
                device.AutoConnect,
                device.SyncTimeout,
                device.SyncTimeoutPeriod
            );
        });

        return vaultCopy;
    }
}

export namespace Synchronization {
    export enum Command {
        SyncRequest = "sync-request",
        SyncResponse = "sync-response",
        ResponseSyncAllHashes = "response-sync-all-hashes",
        LinkedDevicesList = "linked-devices-list",
    }
    export class Message implements z.infer<typeof messageSchema> {
        command: Command;
        hash: string | null;
        diffList: Credential.DiffSchemaType[];
        linkedDevicesList?: LinkedDeviceSchemaType[];

        constructor(
            command: Command,
            hash: string | null,
            diffList: Credential.DiffSchemaType[],
            linkedDevicesList?: LinkedDeviceSchemaType[]
        ) {
            this.command = command;
            this.hash = hash;
            this.diffList = diffList;
            this.linkedDevicesList = linkedDevicesList;
        }
    }
    export const messageSchema = z.object({
        command: z.nativeEnum(Command),
        hash: z.string().nullable(),
        diffList: z.array(Credential.DiffSchema),
        linkedDevicesList: z.array(LinkedDevicesSchema).optional(),
    });
}

//#region Schemas
export const newVaultFormSchema = z.object({
    Name: z.string().min(1, requiredFieldError).max(255, "Name is too long"),
    Description: z.string().max(500, "Description is too long"),
    Secret: z.string().min(1, requiredFieldError),
    Encryption: VaultEncryption.vaultEncryptionFormElement,
    EncryptionKeyDerivationFunction:
        VaultEncryption.vaultEncryptionKeyDerivationFunctionFormElement,
    EncryptionConfig: VaultEncryption.vaultEncryptionConfigurationsFormElement,
});
export type NewVaultFormSchemaType = z.infer<typeof newVaultFormSchema>;

export const vaultRestoreFormSchema = z.object({
    Name: z.string().min(1, requiredFieldError),
});
export type VaultRestoreFormSchema = z.infer<typeof vaultRestoreFormSchema>;
//#endregion Schemas
