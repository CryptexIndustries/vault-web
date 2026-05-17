import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { webcrypto } from "crypto";
import type Dexie from "dexie";
import { err, ok, type Result } from "neverthrow";
import { TextDecoder, TextEncoder } from "util";

Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});

Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

jest.mock(
    "@/lib/utils",
    () => ({
        base64ToUint8: (value: string) => new Uint8Array(Buffer.from(value, "base64")),
        uint8ToBase64: (value: Uint8Array) => Buffer.from(value).toString("base64"),
    }),
    { virtual: true },
);

jest.mock("dexie", () => {
    class DexieMock {
        public version() {
            return {
                stores: () => undefined,
            };
        }
    }

    return {
        __esModule: true,
        default: DexieMock,
    };
});

import * as VaultUtilTypes from "../../src/app_lib/proto/vault";
import { Vault, VaultCredential } from "../../src/app_lib/vault-utils/vault";
import type {
    EncryptionFormGroupSchemaType,
    NewVaultFormSchemaType,
    VaultEncryptionConfigurationsFormElementType,
} from "../../src/app_lib/vault-utils/form-schemas";

type EncryptDataBlobFn = (
    blob: Uint8Array,
    secret: Uint8Array,
    algorithm: VaultUtilTypes.EncryptionAlgorithm,
    keyDerivationFunction: VaultUtilTypes.KeyDerivationFunction,
    kdfConfigArgon2ID: VaultUtilTypes.KeyDerivationConfigArgon2ID,
    kdfConfigPBKDF2: VaultUtilTypes.KeyDerivationConfigPBKDF2,
) => Promise<VaultUtilTypes.EncryptedBlob>;

type DecryptDataBlobFn = (
    blob: VaultUtilTypes.EncryptedBlob,
    secret: Uint8Array,
    algorithm: VaultUtilTypes.EncryptionAlgorithm,
    keyDerivationFunction: VaultUtilTypes.KeyDerivationFunction,
    configuration:
        | VaultUtilTypes.KeyDerivationConfigArgon2ID
        | VaultUtilTypes.KeyDerivationConfigPBKDF2,
) => Promise<Result<Uint8Array, string>>;

const mockEncryptDataBlob: jest.MockedFunction<
    EncryptDataBlobFn
> = jest.fn();
const mockDecryptDataBlob: jest.MockedFunction<
    DecryptDataBlobFn
> = jest.fn();
const mockHashSecret: jest.MockedFunction<
    (secret: string) => Promise<Uint8Array>
> = jest.fn();

jest.mock("../../src/app_lib/vault-utils/encryption", () => {
    const actual = jest.requireActual("../../src/app_lib/vault-utils/encryption") as object;
    return {
        __esModule: true,
        ...actual,
        EncryptDataBlob: (...args: Parameters<EncryptDataBlobFn>) =>
            mockEncryptDataBlob(...args),
        DecryptDataBlob: (...args: Parameters<DecryptDataBlobFn>) =>
            mockDecryptDataBlob(...args),
        hashSecret: (secret: string) => mockHashSecret(secret),
    };
});

import {
    VaultMetadata,
    db,
    saveVault,
    serializeVault,
} from "../../src/app_lib/vault-utils/storage";
import { EncryptedBlob } from "../../src/app_lib/vault-utils/encryption";

const makeArgonConfig = (): VaultEncryptionConfigurationsFormElementType => ({
    memLimit: 4,
    opsLimit: 2,
    iterations: 1000,
});

const makeEncryptionForm = (
    overrides: Partial<EncryptionFormGroupSchemaType> = {},
): EncryptionFormGroupSchemaType => ({
    Secret: overrides.Secret ?? "vault-secret",
    Encryption:
        overrides.Encryption ?? VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
    EncryptionKeyDerivationFunction:
        overrides.EncryptionKeyDerivationFunction ??
        VaultUtilTypes.KeyDerivationFunction.Argon2ID,
    EncryptionConfig: overrides.EncryptionConfig ?? makeArgonConfig(),
});

describe("vault-utils/storage", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        db.vaults = {
            update: jest.fn(async () => 1),
            add: jest.fn(async () => 1),
        } as unknown as Dexie.Table<{ id?: number; data: Uint8Array }, number>;

        mockHashSecret.mockResolvedValue(new Uint8Array([7, 7, 7]));
        mockEncryptDataBlob.mockResolvedValue(EncryptedBlob.CreateDefault());
        mockDecryptDataBlob.mockResolvedValue(err("DECRYPTION_FAILED"));
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("saveVault updates existing record when index is provided", async () => {
        await saveVault(5, new Uint8Array([1, 2]));

        const updateMock = db.vaults.update as unknown as jest.Mock;
        const addMock = db.vaults.add as unknown as jest.Mock;
        expect(updateMock).toHaveBeenCalledWith(5, { data: new Uint8Array([1, 2]) });
        expect(addMock).not.toHaveBeenCalled();
    });

    it("saveVault adds a new record when index is undefined", async () => {
        await saveVault(undefined, new Uint8Array([9]));

        const updateMock = db.vaults.update as unknown as jest.Mock;
        const addMock = db.vaults.add as unknown as jest.Mock;
        expect(addMock).toHaveBeenCalledWith({ data: new Uint8Array([9]) });
        expect(updateMock).not.toHaveBeenCalled();
    });

    it("creates new vault metadata and encrypts seeded vault", async () => {
        const form: NewVaultFormSchemaType = {
            Name: "Main Vault",
            Description: "Personal data",
        };
        const encryptionForm = makeEncryptionForm();

        const metadata = await VaultMetadata.createNewVault(
            form,
            encryptionForm,
            true,
            1,
        );

        expect(metadata.Name).toBe("Main Vault");
        expect(metadata.Description).toBe("Personal data");
        expect(mockHashSecret).toHaveBeenCalledWith("vault-secret");
        expect(mockEncryptDataBlob).toHaveBeenCalledTimes(1);
        expect(metadata.Blob).toBeDefined();
    });

    it("save throws when blob is missing", async () => {
        const metadata = new VaultMetadata();
        metadata.Blob = undefined;

        await expect(metadata.save(new Vault(), new Uint8Array([1]))).rejects.toThrow(
            "Cannot save, vault blob is null",
        );
    });

    it("save re-encrypts vault and persists metadata", async () => {
        const metadata = new VaultMetadata();
        metadata.DBIndex = 10;
        metadata.Blob = EncryptedBlob.CreateDefault();
        const updateMock = db.vaults.update as unknown as jest.Mock;

        await metadata.save(new Vault(), new Uint8Array([1, 2, 3]));

        expect(mockEncryptDataBlob).toHaveBeenCalledTimes(1);
        expect(updateMock).toHaveBeenCalledWith(
            10,
            {
                data: expect.any(Uint8Array),
            },
        );
    });

    it("save can override encryption using encryption form secret", async () => {
        const metadata = new VaultMetadata();
        metadata.Blob = EncryptedBlob.CreateDefault();

        await metadata.save(new Vault(), new Uint8Array([1]), makeEncryptionForm());

        expect(mockHashSecret).toHaveBeenCalledWith("vault-secret");
        expect(mockEncryptDataBlob).toHaveBeenCalledTimes(1);
    });

    it("decryptVault returns VAULT_BLOB_NULL when blob is absent", async () => {
        const metadata = new VaultMetadata();
        metadata.Blob = undefined;

        const result = await metadata.decryptVault(
            "pw",
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            makeArgonConfig(),
        );

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            expect(result.error).toBe("VAULT_BLOB_NULL");
        }
    });

    it("decryptVault propagates decryption failures", async () => {
        const metadata = new VaultMetadata();
        metadata.Blob = EncryptedBlob.CreateDefault();
        mockDecryptDataBlob.mockResolvedValueOnce(err("DECRYPTION_FAILED"));

        const result = await metadata.decryptVault(
            "pw",
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            makeArgonConfig(),
        );

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            expect(result.error).toBe("DECRYPTION_FAILED");
        }
    });

    it("decryptVault returns hydrated vault and encryptionData on success", async () => {
        const metadata = new VaultMetadata();
        metadata.Blob = EncryptedBlob.CreateDefault();

        const vault = new Vault();
        const credential = new VaultCredential();
        credential.ID = "cred-1";
        credential.Name = "Name";
        credential.Username = "user";
        credential.Password = "pw";
        vault.Credentials = [credential];
        const encodedVault = VaultUtilTypes.Vault.encode(vault).finish();
        const hashed = new Uint8Array([8, 8, 8]);

        mockHashSecret.mockResolvedValueOnce(hashed);
        mockDecryptDataBlob.mockResolvedValueOnce(ok(encodedVault));

        const result = await metadata.decryptVault(
            "pw",
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            makeArgonConfig(),
        );

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.encryptionData).toEqual(hashed);
            expect(result.value.vault).toBeInstanceOf(Vault);
            expect(result.value.vault.Credentials[0]?.Name).toBe("Name");
        }
    });

    it("deserializeMetadataBinary restores blob as EncryptedBlob instance", () => {
        const metadata = new VaultMetadata();
        metadata.Name = "Serialized";
        metadata.Blob = EncryptedBlob.CreateDefault();
        metadata.Blob.Blob = new Uint8Array([1, 2, 3]);
        const encoded = VaultUtilTypes.VaultMetadata.encode(metadata).finish();

        const restored = VaultMetadata.deserializeMetadataBinary(encoded, 3);

        expect(restored.DBIndex).toBe(3);
        expect(restored.Name).toBe("Serialized");
        expect(restored.Blob).toBeInstanceOf(EncryptedBlob);
    });

    it("exportForLinking resets db index and re-encrypts clean vault", async () => {
        const metadata = new VaultMetadata();
        metadata.DBIndex = 9;
        metadata.Blob = EncryptedBlob.CreateDefault();

        const binary = await metadata.exportForLinking(new Vault(), new Uint8Array([1]));
        const decoded = VaultUtilTypes.VaultMetadata.decode(binary);

        expect(mockEncryptDataBlob).toHaveBeenCalled();
        expect(decoded.DBIndex).toBeUndefined();
    });

    it("decryptVault triggers async re-save when blob upgrade requires it", async () => {
        const metadata = new VaultMetadata();
        const blob = EncryptedBlob.CreateDefault();
        blob.Version = 1;
        blob.CurrentVersion = 0;
        metadata.Blob = blob;
        metadata.DBIndex = 4;

        const vault = new Vault();
        const encodedVault = VaultUtilTypes.Vault.encode(vault).finish();
        mockHashSecret.mockResolvedValueOnce(new Uint8Array([1, 1, 1]));
        mockDecryptDataBlob.mockResolvedValueOnce(ok(encodedVault));
        mockEncryptDataBlob.mockResolvedValueOnce(EncryptedBlob.CreateDefault());
        const updateMock = db.vaults.update as unknown as jest.Mock;

        const result = await metadata.decryptVault(
            "pw",
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            makeArgonConfig(),
        );

        expect(result.isOk()).toBe(true);
        await new Promise((r) => setTimeout(r, 0));
        expect(mockEncryptDataBlob).toHaveBeenCalled();
        expect(updateMock).toHaveBeenCalled();
    });

    it("exportForLinking throws when blob is null", async () => {
        const metadata = new VaultMetadata();
        metadata.Blob = undefined;

        await expect(
            metadata.exportForLinking(new Vault(), new Uint8Array([1])),
        ).rejects.toThrow(
            "Cannot export metadata for linking without an encrypted blob.",
        );
    });

    it("save with null vault instance persists existing blob only without re-encrypting", async () => {
        const metadata = new VaultMetadata();
        metadata.DBIndex = 12;
        metadata.Blob = EncryptedBlob.CreateDefault();
        const updateMock = db.vaults.update as unknown as jest.Mock;
        const beforeLastUsed = metadata.LastUsed;

        await metadata.save(null, new Uint8Array([1, 2, 3]));

        expect(mockEncryptDataBlob).not.toHaveBeenCalled();
        expect(metadata.LastUsed).toBe(beforeLastUsed);
        expect(updateMock).toHaveBeenCalledWith(12, {
            data: expect.any(Uint8Array),
        });
    });

    it("serializeVault removes linked devices and returns encrypted binary", async () => {
        const existingBlob = EncryptedBlob.CreateDefault();
        const vault = new Vault();
        vault.LinkedDevices.ID = "linked";

        mockEncryptDataBlob.mockImplementationOnce(async (blob) => {
            const decoded = VaultUtilTypes.Vault.decode(blob);
            expect(decoded.LinkedDevices?.ID).not.toBe("linked");
            expect(decoded.LinkedDevices?.Devices ?? []).toHaveLength(0);
            return EncryptedBlob.CreateDefault();
        });

        const binary = await serializeVault(vault, existingBlob, new Uint8Array([4]));
        const decoded = VaultUtilTypes.EncryptedBlob.decode(binary);

        expect(decoded.Blob).toBeInstanceOf(Uint8Array);
        expect(mockEncryptDataBlob).toHaveBeenCalledTimes(1);
    });
});
