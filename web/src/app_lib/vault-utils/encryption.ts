import * as sodium from "libsodium-wrappers-sumo";
import * as VaultUtilTypes from "../proto/vault";
import { err, ok } from "neverthrow";
import { base64ToUint8, uint8ToBase64 } from "@/lib/utils";

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
        keyDerivationFunction === VaultUtilTypes.KeyDerivationFunction.Argon2ID
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
    configuration: KeyDerivationConfig_Argon2ID | KeyDerivationConfig_PBKDF2,
) => {
    // Verify that the blob is an Uint8Array
    if (!(blob.Blob instanceof Uint8Array)) {
        return err("VAULT_BLOB_INVALID_TYPE");
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
            return err("ENCRYPTION_ALGORITHM_INVALID");
    }
};

/**
 * Hashes the provided data using the SHA-256 algorithm.
 * @param data - The data to hash
 * @returns The hashed data
 */
export const hashSecret = async (data: string) => {
    return new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)),
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

        if (keyDerivationFunc === VaultUtilTypes.KeyDerivationFunction.PBKDF2) {
            derivedKey = await KeyDerivation.deriveKeyPBKDF2(
                secret,
                salt,
                keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2,
            );
        } else if (
            keyDerivationFunc === VaultUtilTypes.KeyDerivationFunction.Argon2ID
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
            keyDerivationFunc === VaultUtilTypes.KeyDerivationFunction.Argon2ID
                ? (keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID)
                : null,
            keyDerivationFunc === VaultUtilTypes.KeyDerivationFunction.PBKDF2
                ? (keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2)
                : null,
            encryptedBlob,
            uint8ToBase64(salt),
            uint8ToBase64(iv),
        );
    }

    static async decryptBlobAES256(
        blob: EncryptedBlob,
        secret: Uint8Array,
        keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
        keyDerivationFuncConfig:
            | KeyDerivationConfig_Argon2ID
            | KeyDerivationConfig_PBKDF2,
    ) {
        if (keyDerivationFuncConfig == undefined) {
            return err("KEY_DERIVATION_FN_CONFIG_UNDEFINED");
        }

        const encryptedBlob = blob.Blob;
        const salt = base64ToUint8(blob.Salt);
        const iv = base64ToUint8(blob.HeaderIV);

        // These hold the derived key and the configuration for the key derivation function
        let derivedKey: CryptoKey;

        if (keyDerivationFunc === VaultUtilTypes.KeyDerivationFunction.PBKDF2) {
            derivedKey = await KeyDerivation.deriveKeyPBKDF2(
                secret,
                salt,
                keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2,
            );
        } else if (
            keyDerivationFunc === VaultUtilTypes.KeyDerivationFunction.Argon2ID
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
            return err("KEY_DERIVATION_FN_INVALID");
        }

        try {
            const decrypted = await crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv,
                },
                derivedKey,
                encryptedBlob,
            );

            // return new TextDecoder().decode(decrypted);
            return ok(new Uint8Array(decrypted));
        } catch (e) {
            console.debug("Failed to decrypt blob (AES256):", e);
            return err("DECRYPTION_FAILED");
        }
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

        const salt = sodium.randombytes_buf(sodium.crypto_shorthash_KEYBYTES);
        let key: Uint8Array;

        if (keyDerivationFunc === VaultUtilTypes.KeyDerivationFunction.PBKDF2) {
            const _key = await KeyDerivation.deriveKeyPBKDF2(
                secret,
                salt,
                keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2,
            );
            const rawKey = await crypto.subtle.exportKey("raw", _key);

            key = new Uint8Array(rawKey);
        } else if (
            keyDerivationFunc === VaultUtilTypes.KeyDerivationFunction.Argon2ID
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

        const res = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
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
            keyDerivationFunc === VaultUtilTypes.KeyDerivationFunction.Argon2ID
                ? (keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID)
                : null,
            keyDerivationFunc === VaultUtilTypes.KeyDerivationFunction.PBKDF2
                ? (keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2)
                : null,
            c1,
            uint8ToBase64(salt),
            uint8ToBase64(header),
        );
    }

    static async decryptBlob(
        encryptedBlob: EncryptedBlob,
        secret: Uint8Array,
        keyDerivationFunc: VaultUtilTypes.KeyDerivationFunction,
        keyDerivationFuncConfig:
            | KeyDerivationConfig_Argon2ID
            | KeyDerivationConfig_PBKDF2,
    ) {
        if (keyDerivationFuncConfig == undefined) {
            return err("KEY_DERIVATION_FN_CONFIG_UNDEFINED");
        }

        await sodium.ready;

        const c1 = encryptedBlob.Blob;
        const salt = base64ToUint8(encryptedBlob.Salt);
        const header = base64ToUint8(encryptedBlob.HeaderIV);

        let key: Uint8Array;

        if (keyDerivationFunc === VaultUtilTypes.KeyDerivationFunction.PBKDF2) {
            const _key = await KeyDerivation.deriveKeyPBKDF2(
                secret,
                salt,
                keyDerivationFuncConfig as KeyDerivationConfig_PBKDF2,
            );
            const rawKey = await crypto.subtle.exportKey("raw", _key);

            key = new Uint8Array(rawKey);
        } else if (
            keyDerivationFunc === VaultUtilTypes.KeyDerivationFunction.Argon2ID
        ) {
            key = await KeyDerivation.deriveKeyArgon2ID(
                sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES,
                secret,
                salt,
                keyDerivationFuncConfig as KeyDerivationConfig_Argon2ID,
            );
        } else {
            return err("KEY_DERIVATION_FN_INVALID");
        }

        const state_in = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
            header,
            key,
        );
        const r1 = sodium.crypto_secretstream_xchacha20poly1305_pull(
            state_in,
            c1,
        );

        if (typeof r1 === "boolean" && r1 === false) {
            return err("DECRYPTION_FAILED");
        }

        // Convert the byte array to a string
        // const m1 = Buffer.from(r1.message).toString("utf-8");
        // console.debug(
        //     `Decrypted blob with XChaCha20Poly1305: ${m1.length} bytes`,
        //     m1
        // );

        // Return the decrypted byte array
        return ok(r1.message);
    }
}
