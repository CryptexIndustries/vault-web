import * as sodium from "libsodium-wrappers-sumo";

/**
 * @param encryptedSecretIVPair The encrypted secret and IV pair
 * @param secret The encryption secret
 * @returns The decrypted TOTP secret
 */
export const decryptTOTPSecret = async (
    encryptedSecretIVPair: string,
    secret: string
) => {
    const [encrypted, iv] = encryptedSecretIVPair.split(":");

    if (encrypted == null || iv == null) {
        throw new Error(
            "Could not find encrypted secret or initialization vector in encrypted secret. Pair: ".concat(
                encryptedSecretIVPair
            )
        );
    }

    const crypto = await import("crypto");
    const algorithm = "aes-256-cbc";

    // Convert the env.NEXTAUTH_SECRET into MD5 (32chars)
    const hash = crypto.createHash("md5").update(secret).digest("hex");
    // console.log("--HASH DECRYPT:", hash);

    const decipher = crypto.createDecipheriv(
        algorithm,
        Buffer.from(hash),
        Buffer.from(iv, "hex")
    );

    // Return decrypted data as a string
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
};

/**
 * @param totpSecret The TOTP secret to encrypt
 * @param encryptionKey The encryption key
 * @returns The encrypted TOTP secret and IV pair separated by a colon
 */
export const encryptTOTPSecret = async (
    totpSecret: string,
    encryptionKey: string
) => {
    const crypto = await import("crypto");
    const algorithm = "aes-256-cbc";
    const iv = crypto.randomBytes(16).toString("hex");

    // Convert the env.NEXTAUTH_SECRET into MD5 (32chars)
    const hash = crypto.createHash("md5").update(encryptionKey).digest("hex");
    // console.log("--HASH ENCRYPT:", hash);

    const cipher = crypto.createCipheriv(
        algorithm,
        Buffer.from(hash),
        Buffer.from(iv, "hex")
    );

    // Return encrypted data as a string
    let encrypted = cipher.update(totpSecret);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return `${encrypted.toString("hex")}:${iv}`;
};

/**
 * This function is used to check the validity of a TOTP token. It can work with encrypted and decrypted data.
 * @param token The token to check.
 * @param secret The secret to check against. This can be encrypted (format <encrypte_string>:<IV>) or in raw format.
 * @param encryptionKey The key to use to decrypt the secret if it is encrypted.
 * @returns A boolean indicating if the token is valid or not.
 */
export const checkTOTP = async (
    token: string,
    secret: string,
    encryptionKey?: string
): Promise<boolean> => {
    // Decrypt the secret if it is encrypted, otherwise use it as is
    // If the encryptionKey is not provided, the secret is assumed to be in raw format
    const totp_secret_decrypted =
        encryptionKey != null
            ? await decryptTOTPSecret(secret, encryptionKey)
            : secret;

    // Check if the decryption was successful
    if (!totp_secret_decrypted) return false;

    const { TOTP, Secret } = await import("otpauth");

    const isValid: boolean =
        TOTP.validate({
            token,
            secret: Secret.fromBase32(totp_secret_decrypted),
            algorithm: "SHA1",
            digits: 6,
            period: 30,
        }) === 0;

    return isValid;
};

/**
 * Hashes the provided string using SHA512.
 * @param key The API key to hash
 * @returns The hashed API key as a string
 */
export const hashAPIKey = async (key: string): Promise<string> => {
    const crypto = await import("crypto");
    return crypto.createHash("sha512").update(key).digest("hex");
};

/**
 * Generates a random API key and its hashed version.
 * Uses the crypto module under the hood.
 * Currently creates a 32 byte key and hashes it using SHA512.
 * @returns An object containing the key and its hashed version
 */
export const generateAPIKey = async (): Promise<{
    key: string;
    hash: string;
}> => {
    const crypto = await import("crypto");
    const key = crypto.randomBytes(32).toString("hex");
    const hashedKey = await hashAPIKey(key);

    // Return the key and the hashed version of the key
    return {
        key,
        hash: hashedKey,
    };
};

/**
 * Verifies the signature of the provided nonce using the provided public key.
 * @param signedNonce
 * @param publicKey
 * @returns A boolean indicating if the signature is valid or not
 */
export const validateSignature = async (
    signedNonce: string,
    publicKey: string
): Promise<boolean> => {
    await sodium.ready;

    // Verify the nonce signature using libsodium-wrapper-sumo
    const signature = await new Promise((resolve) =>
        resolve(
            sodium.crypto_sign_open(
                sodium.from_base64(signedNonce),
                sodium.from_base64(publicKey)
            )
        )
    );

    return signature !== null;
};
