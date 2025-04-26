import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as VaultUtilTypes from "../proto/vault";
import * as VaultEncryption from "./encryption";

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
