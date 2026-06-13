import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
    afterEach,
} from "@jest/globals";
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

if (!("fromBase64" in Uint8Array)) {
    Object.defineProperty(Uint8Array, "fromBase64", {
        value: (value: string) => new Uint8Array(Buffer.from(value, "base64")),
        configurable: true,
    });
}

jest.mock(
    "@/lib/utils",
    () => ({
        base64ToUint8: (value: string) =>
            new Uint8Array(Buffer.from(value, "base64")),
        uint8ToBase64: (value: Uint8Array) =>
            Buffer.from(value).toString("base64"),
        base64UrlToUint8: (value: string) =>
            new Uint8Array(Buffer.from(value, "base64url")),
        uint8ToBase64Url: (value: Uint8Array) =>
            Buffer.from(value).toString("base64url"),
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
import { TOTP, Vault, VaultCredential } from "../../src/app_lib/vault-utils/vault";
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

type OpenEnvelopeBlobFn = (
    blob: import("../../src/app_lib/vault-utils/encryption").EncryptedBlob,
    vaultId: string | undefined,
    options: unknown,
) => Promise<Result<{ dek: CryptoKey; plaintext: Uint8Array }, string>>;

type ReencryptVaultBytesWithDEKFn = (
    bytes: Uint8Array,
    dek: CryptoKey,
    existing: import("../../src/app_lib/vault-utils/encryption").EncryptedBlob,
    envelope: VaultUtilTypes.KeyEnvelope,
    kdfConfig: VaultUtilTypes.KeyDerivationConfigArgon2ID,
) => Promise<import("../../src/app_lib/vault-utils/encryption").EncryptedBlob>;

type ReconfigurePrimaryFactorFn = (
    blob: import("../../src/app_lib/vault-utils/encryption").EncryptedBlob,
    vaultId: string,
    currentCreds: unknown,
    next: unknown,
    kdfConfig: VaultUtilTypes.KeyDerivationConfigArgon2ID,
) => Promise<
    Result<import("../../src/app_lib/vault-utils/encryption").EncryptedBlob, string>
>;

type RotateRecoveryCodeFn = (
    blob: import("../../src/app_lib/vault-utils/encryption").EncryptedBlob,
    vaultId: string,
    currentCreds: unknown,
    kdfConfig: VaultUtilTypes.KeyDerivationConfigArgon2ID,
) => Promise<
    Result<
        {
            blob: import("../../src/app_lib/vault-utils/encryption").EncryptedBlob;
            recoveryCode: string;
        },
        string
    >
>;

const mockEncryptDataBlob: jest.MockedFunction<EncryptDataBlobFn> = jest.fn();
const mockDecryptDataBlob: jest.MockedFunction<DecryptDataBlobFn> = jest.fn();
const mockOpenEnvelopeBlob: jest.MockedFunction<OpenEnvelopeBlobFn> = jest.fn();
const mockReencryptVaultBytesWithDEK: jest.MockedFunction<ReencryptVaultBytesWithDEKFn> =
    jest.fn();
const mockReconfigurePrimaryFactor: jest.MockedFunction<ReconfigurePrimaryFactorFn> =
    jest.fn();
const mockRotateRecoveryCode: jest.MockedFunction<RotateRecoveryCodeFn> = jest.fn();
const mockHashSecret: jest.MockedFunction<
    (secret: string) => Promise<Uint8Array>
> = jest.fn();

jest.mock("../../src/app_lib/vault-utils/vault-key-store", () => ({
    setDeviceSecondFactorKey: jest.fn(async () => undefined),
    getDeviceSecondFactorKey: jest.fn(async () => null),
    getDeviceSecondFactorKind: jest.fn(async () => null),
    clearDeviceSecondFactor: jest.fn(async () => undefined),
}));

jest.mock("../../src/app_lib/vault-utils/vault-envelope-ops", () => {
    const { EncryptedBlob } = jest.requireActual(
        "../../src/app_lib/vault-utils/encryption",
    ) as {
        EncryptedBlob: typeof import("../../src/app_lib/vault-utils/encryption").EncryptedBlob;
    };
    return {
        migrateLegacyBlobToEnvelope: jest.fn(async () => {
            const blob = EncryptedBlob.CreateDefault();
            blob.Envelope = {
                Version: 3,
                DEKAlgo: "AES-GCM-256",
                Slots: [],
                PrimaryFactorKind: VaultUtilTypes.SecondFactorKind.NONE,
                VaultID: "test-vault",
            };
            return {
                blob,
                recoveryCode: "deadbeef",
                secondFactorDisplaySecret: undefined,
            };
        }),
        openEnvelopeBlob: (...args: Parameters<OpenEnvelopeBlobFn>) =>
            mockOpenEnvelopeBlob(...args),
        reencryptVaultBytesWithDEK: (
            ...args: Parameters<ReencryptVaultBytesWithDEKFn>
        ) => mockReencryptVaultBytesWithDEK(...args),
        reconfigurePrimaryFactor: (
            ...args: Parameters<ReconfigurePrimaryFactorFn>
        ) => mockReconfigurePrimaryFactor(...args),
        rotateRecoveryCode: (...args: Parameters<RotateRecoveryCodeFn>) =>
            mockRotateRecoveryCode(...args),
        createEnvelopeEncryptedBlob: jest.fn(async () => {
            const blob = EncryptedBlob.CreateDefault();
            blob.Envelope = {
                Version: 3,
                DEKAlgo: "AES-GCM-256",
                Slots: [],
                PrimaryFactorKind: VaultUtilTypes.SecondFactorKind.NONE,
                VaultID: "test-vault",
            };
            return {
                blob,
                recoveryCode: "recovery-code",
                secondFactorDisplaySecret: undefined,
            };
        }),
    };
});

jest.mock("../../src/app_lib/vault-utils/encryption", () => {
    const actual = jest.requireActual(
        "../../src/app_lib/vault-utils/encryption",
    ) as object;
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
        overrides.Encryption ??
        VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
    EncryptionKeyDerivationFunction:
        overrides.EncryptionKeyDerivationFunction ??
        VaultUtilTypes.KeyDerivationFunction.Argon2ID,
    EncryptionConfig: overrides.EncryptionConfig ?? makeArgonConfig(),
});

const getVaultTableMocks = () =>
    db.vaults as unknown as { update: jest.Mock; add: jest.Mock };

class MockPublicKeyCredential {
    public static async getClientCapabilities() {
        return { "extension:prf": true };
    }

    public rawId = new Uint8Array([1, 2, 3]);

    public getClientExtensionResults() {
        return {
            prf: {
                results: {
                    first: crypto.getRandomValues(new Uint8Array(32)).buffer,
                },
            },
        };
    }
}

const installWebAuthnMocks = () => {
    Object.defineProperty(globalThis, "PublicKeyCredential", {
        value: MockPublicKeyCredential,
        configurable: true,
    });
    Object.defineProperty(globalThis, "window", {
        value: {
            PublicKeyCredential: MockPublicKeyCredential,
            crypto: webcrypto,
            location: { hostname: "vault.example.test" },
        },
        configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
        value: {
            credentials: {
                create: jest.fn(async () => new MockPublicKeyCredential()),
                get: jest.fn(async () => new MockPublicKeyCredential()),
            },
        },
        configurable: true,
    });
};

const makeEnvelopeBlob = (
    kind = VaultUtilTypes.SecondFactorKind.NONE,
): EncryptedBlob => {
    const blob = EncryptedBlob.CreateDefault();
    blob.Version = 3;
    blob.CurrentVersion = 3;
    blob.Envelope = {
        Version: 3,
        DEKAlgo: "AES-GCM-256",
        Slots: [
            {
                Kind: VaultUtilTypes.KeySlotKind.PRIMARY,
                WrappedDEK: new Uint8Array([1, 2, 3]),
                WrapAlgo: "AES-KW",
                Salt: Buffer.from([1]).toString("base64"),
                KDFConfigArgon2ID: {
                    memLimit: 4,
                    opsLimit: 1,
                },
                HKDFSalt: Buffer.from([2]).toString("base64"),
                HKDFInfo: "cryptex/kek/v1|test-vault",
                FactorKind: kind,
                WebauthnCredentialId: "",
                WebauthnPrfSalt: "",
                SecondFactorSalt: "",
            },
        ],
        PrimaryFactorKind: kind,
        VaultID: "test-vault",
    };
    return blob;
};

describe("vault-utils/storage", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete (globalThis as { window?: unknown }).window;
        delete (globalThis as { navigator?: unknown }).navigator;
        delete (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;

        db.vaults = {
            update: jest.fn(async () => 1),
            add: jest.fn(async () => 1),
        } as unknown as Dexie.Table<{ id?: number; data: Uint8Array }, number>;

        mockHashSecret.mockResolvedValue(new Uint8Array([7, 7, 7]));
        mockEncryptDataBlob.mockResolvedValue(EncryptedBlob.CreateDefault());
        mockDecryptDataBlob.mockResolvedValue(err("DECRYPTION_FAILED"));
        mockOpenEnvelopeBlob.mockImplementation(async () => {
            const dek = await webcrypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            );
            return ok({
                dek,
                plaintext: VaultUtilTypes.Vault.encode(new Vault()).finish(),
            });
        });
        mockReencryptVaultBytesWithDEK.mockImplementation(
            async (_bytes, _dek, existing) => existing,
        );
        mockReconfigurePrimaryFactor.mockImplementation(async (blob) => ok(blob));
        mockRotateRecoveryCode.mockImplementation(async (blob) =>
            ok({ blob, recoveryCode: "rotated-recovery-code" }),
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("saveVault updates existing record when index is provided", async () => {
        await saveVault(5, new Uint8Array([1, 2]));

        const { update: updateMock, add: addMock } = getVaultTableMocks();
        expect(updateMock).toHaveBeenCalledWith(5, {
            data: new Uint8Array([1, 2]),
        });
        expect(addMock).not.toHaveBeenCalled();
    });

    it("saveVault adds a new record when index is undefined", async () => {
        await saveVault(undefined, new Uint8Array([9]));

        const { update: updateMock, add: addMock } = getVaultTableMocks();
        expect(addMock).toHaveBeenCalledWith({ data: new Uint8Array([9]) });
        expect(updateMock).not.toHaveBeenCalled();
    });

    it("creates new vault metadata and encrypts seeded vault", async () => {
        const form: NewVaultFormSchemaType = {
            Name: "Main Vault",
            Description: "Personal data",
        };
        const encryptionForm = makeEncryptionForm();

        const created = await VaultMetadata.createNewVault(
            form,
            encryptionForm,
            true,
            1,
        );

        expect(created.metadata.Name).toBe("Main Vault");
        expect(created.metadata.Description).toBe("Personal data");
        expect(created.metadata.Blob).toBeDefined();
        expect(created.revealSecrets.recoveryCode).toBe("recovery-code");
    });

    it("save throws when blob is missing", async () => {
        const metadata = new VaultMetadata();
        metadata.Blob = undefined;

        await expect(
            metadata.save(new Vault(), new Uint8Array([1])),
        ).rejects.toThrow("Cannot save, vault blob is null");
    });

    it("save re-encrypts vault and persists metadata", async () => {
        const metadata = new VaultMetadata();
        metadata.DBIndex = 10;
        metadata.Blob = EncryptedBlob.CreateDefault();
        metadata.Blob.Envelope = {
            Version: 3,
            DEKAlgo: "AES-GCM-256",
            Slots: [],
            PrimaryFactorKind: VaultUtilTypes.SecondFactorKind.NONE,
            VaultID: "test-vault",
        };
        const { update: updateMock } = getVaultTableMocks();
        const dek = await webcrypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        );

        await metadata.save(new Vault(), dek);

        expect(mockReencryptVaultBytesWithDEK).toHaveBeenCalledTimes(1);
        expect(mockEncryptDataBlob).not.toHaveBeenCalled();
        expect(updateMock).toHaveBeenCalledWith(10, {
            data: expect.any(Uint8Array),
        });
    });

    it("save rejects legacy keys for vault writes", async () => {
        const metadata = new VaultMetadata();
        metadata.Blob = EncryptedBlob.CreateDefault();

        await expect(
            metadata.save(
                new Vault(),
                new Uint8Array([1]),
            ),
        ).rejects.toThrow("Invalid encryption key type for save");

        expect(mockHashSecret).not.toHaveBeenCalledWith("vault-secret");
        expect(mockEncryptDataBlob).not.toHaveBeenCalled();
    });

    it("save with null vault instance persists existing blob only without re-encrypting", async () => {
        const metadata = new VaultMetadata();
        metadata.DBIndex = 12;
        metadata.Blob = EncryptedBlob.CreateDefault();
        const { update: updateMock } = getVaultTableMocks();
        const beforeLastUsed = metadata.LastUsed;

        await metadata.save(
            null,
            new Uint8Array([1, 2, 3]),
        );

        expect(mockEncryptDataBlob).not.toHaveBeenCalled();
        expect(metadata.LastUsed).toBe(beforeLastUsed);
        expect(updateMock).toHaveBeenCalledWith(12, {
            data: expect.any(Uint8Array),
        });
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
        expect((result as { error: string }).error).toBe("VAULT_BLOB_NULL");
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
        expect((result as { error: string }).error).toBe("DECRYPTION_FAILED");
    });

    it("decryptVault rejects version 3 blobs without an envelope without logging the blob", async () => {
        const metadata = new VaultMetadata();
        const blob = EncryptedBlob.CreateDefault();
        blob.Version = 3;
        blob.CurrentVersion = 3;
        metadata.Blob = blob;
        const consoleLogSpy = jest
            .spyOn(console, "log")
            .mockImplementation(() => undefined);
        mockDecryptDataBlob.mockResolvedValueOnce(
            ok(VaultUtilTypes.Vault.encode(new Vault()).finish()),
        );

        const result = await metadata.decryptVault(
            "pw",
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            makeArgonConfig(),
        );

        expect(result.isErr()).toBe(true);
        expect((result as { error: string }).error).toBe(
            "INVALID_VAULT_VERSION",
        );
        expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("decryptVault returns hydrated vault and dek on success", async () => {
        const metadata = new VaultMetadata();
        const blob = EncryptedBlob.CreateDefault();
        blob.Version = 3;
        blob.CurrentVersion = 3;
        blob.Envelope = {
            Version: 3,
            DEKAlgo: "AES-GCM-256",
            Slots: [],
            PrimaryFactorKind: VaultUtilTypes.SecondFactorKind.NONE,
            VaultID: "test-vault",
        };
        metadata.Blob = blob;

        const vault = new Vault();
        const credential = new VaultCredential();
        credential.ID = "cred-1";
        credential.Name = "Name";
        credential.Username = "user";
        credential.Password = "pw";
        vault.Credentials = [credential];
        const encodedVault = VaultUtilTypes.Vault.encode(vault).finish();
        const dek = await webcrypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        );

        mockOpenEnvelopeBlob.mockResolvedValueOnce(
            ok({ dek, plaintext: encodedVault }),
        );

        const result = await metadata.decryptVault(
            "pw",
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            makeArgonConfig(),
        );

        expect(result.isOk()).toBe(true);
        const decryptSuccess = result as {
            value: { dek: CryptoKey; vault: Vault };
        };
        expect(decryptSuccess.value.dek).toBeDefined();
        expect(decryptSuccess.value.vault).toBeInstanceOf(Vault);
        expect(decryptSuccess.value.vault.Credentials[0]?.Name).toBe("Name");
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

    it("exportForLinking returns serialized vault bytes", () => {
        const metadata = new VaultMetadata();
        const vault = new Vault();

        const binary = metadata.exportForLinking(vault);

        expect(mockEncryptDataBlob).not.toHaveBeenCalled();
        expect(VaultUtilTypes.Vault.decode(binary)).toBeDefined();
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
        const { update: updateMock } = getVaultTableMocks();

        const result = await metadata.decryptVault(
            "pw",
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            makeArgonConfig(),
        );

        expect(result.isOk()).toBe(true);
        expect(mockReencryptVaultBytesWithDEK).toHaveBeenCalledTimes(1);
        expect(mockEncryptDataBlob).not.toHaveBeenCalled();
        expect(updateMock).toHaveBeenCalled();
        expect(
            (result as { value: { revealSecrets?: { recoveryCode?: string } } })
                .value.revealSecrets?.recoveryCode,
        ).toBeDefined();
    });

    it("returns error when legacy migration cannot reopen the new envelope", async () => {
        const metadata = new VaultMetadata();
        const blob = EncryptedBlob.CreateDefault();
        blob.Version = 1;
        blob.CurrentVersion = 0;
        metadata.Blob = blob;

        mockDecryptDataBlob.mockResolvedValueOnce(
            ok(VaultUtilTypes.Vault.encode(new Vault()).finish()),
        );
        mockOpenEnvelopeBlob.mockResolvedValueOnce(err("REOPEN_FAILED"));

        const result = await metadata.decryptVault(
            "pw",
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            makeArgonConfig(),
        );

        expect(result.isErr()).toBe(true);
        expect((result as { error: string }).error).toBe("REOPEN_FAILED");
    });

    it("serializeVault removes linked devices and returns encrypted binary", async () => {
        const existingBlob = EncryptedBlob.CreateDefault();
        existingBlob.Envelope = {
            Version: 3,
            DEKAlgo: "AES-GCM-256",
            Slots: [],
            PrimaryFactorKind: VaultUtilTypes.SecondFactorKind.NONE,
            VaultID: "test-vault",
        };
        const vault = new Vault();
        Object.assign(vault.LinkedDevices, { ID: "linked" });
        const dek = await webcrypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        );

        mockReencryptVaultBytesWithDEK.mockImplementationOnce(async (blob) => {
            const decoded = VaultUtilTypes.Vault.decode(blob);
            expect((decoded.LinkedDevices as { ID?: string } | undefined)?.ID).not.toBe(
                "linked",
            );
            expect(decoded.LinkedDevices?.Devices ?? []).toHaveLength(0);
            return existingBlob;
        });

        const binary = await serializeVault(vault, existingBlob, dek);
        const decoded = VaultUtilTypes.EncryptedBlob.decode(binary);

        expect(decoded.Blob).toBeInstanceOf(Uint8Array);
        expect(mockReencryptVaultBytesWithDEK).toHaveBeenCalledTimes(1);
        expect(mockEncryptDataBlob).not.toHaveBeenCalled();
    });

    it("createNewVault throws when post-create envelope unlock fails", async () => {
        mockOpenEnvelopeBlob.mockResolvedValueOnce(err("UNLOCK_FAILED"));

        await expect(
            VaultMetadata.createNewVault(
                { Name: "Broken", Description: "" },
                makeEncryptionForm(),
                false,
                0,
            ),
        ).rejects.toThrow("Post-create unlock failed: UNLOCK_FAILED");
    });

    it("persists second-factor enrollment only when local state requires it", async () => {
        const metadata = new VaultMetadata();
        const key = await crypto.subtle.importKey(
            "raw",
            new Uint8Array(32),
            { name: "HKDF" },
            false,
            ["deriveKey"],
        );

        await metadata.persistSecondFactorEnrollment({
            kind: VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
            hkdfBaseKey: key,
        });
        await metadata.persistSecondFactorEnrollment({
            kind: VaultUtilTypes.SecondFactorKind.NONE,
            hkdfBaseKey: null,
        });

        metadata.DBIndex = 5;
        await expect(
            metadata.persistSecondFactorEnrollment({
                kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF,
                hkdfBaseKey: null,
            }),
        ).rejects.toThrow("WEBAUTHN_ENROLLMENT_METADATA_MISSING");
        await metadata.persistSecondFactorEnrollment({
            kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF,
            hkdfBaseKey: null,
            webauthnCredentialId: "credential",
            webauthnPrfSalt: "salt",
        });
        await metadata.persistSecondFactorEnrollment({
            kind: VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
            hkdfBaseKey: null,
        });

        expect(getVaultTableMocks().update).not.toHaveBeenCalled();
    });

    it("returns security reconfiguration guard errors", async () => {
        const metadata = new VaultMetadata();

        await expect(
            metadata.reconfigureSecurity({
                currentMasterPassword: "master",
                secondFactor: { kind: VaultUtilTypes.SecondFactorKind.NONE },
            }),
        ).resolves.toMatchObject({ error: "NOT_ENVELOPE_BLOB" });

        metadata.Blob = makeEnvelopeBlob();
        await expect(
            metadata.reconfigureSecurity({
                currentMasterPassword: "master",
                secondFactor: { kind: VaultUtilTypes.SecondFactorKind.NONE },
            }),
        ).resolves.toMatchObject({ error: "VAULT_DB_INDEX_MISSING" });

        metadata.DBIndex = 1;
        metadata.Blob.Envelope!.VaultID = "";
        await expect(
            metadata.reconfigureSecurity({
                currentMasterPassword: "master",
                secondFactor: { kind: VaultUtilTypes.SecondFactorKind.NONE },
            }),
        ).rejects.toThrow("Vault ID is missing");
    });

    it("returns reset recovery guard errors", async () => {
        const metadata = new VaultMetadata();

        await expect(
            metadata.resetRecoveryCode({ currentMasterPassword: "master" }),
        ).resolves.toMatchObject({ error: "NOT_ENVELOPE_BLOB" });

        metadata.Blob = makeEnvelopeBlob();
        await expect(
            metadata.resetRecoveryCode({ currentMasterPassword: "master" }),
        ).resolves.toMatchObject({ error: "VAULT_DB_INDEX_MISSING" });

        metadata.DBIndex = 1;
        metadata.Blob.Envelope!.VaultID = "";
        await expect(
            metadata.resetRecoveryCode({ currentMasterPassword: "master" }),
        ).rejects.toThrow("Vault ID is missing");
    });

    it("propagates recovery rotation errors", async () => {
        const metadata = new VaultMetadata();
        metadata.DBIndex = 1;
        metadata.Blob = makeEnvelopeBlob();
        mockRotateRecoveryCode.mockResolvedValueOnce(err("ROTATE_FAILED"));

        await expect(
            metadata.resetRecoveryCode({ currentMasterPassword: "master" }),
        ).resolves.toMatchObject({ error: "ROTATE_FAILED" });
    });

    it("reports current second-factor failures during reconfigure and recovery reset", async () => {
        const metadata = new VaultMetadata();
        metadata.DBIndex = 1;
        metadata.Blob = makeEnvelopeBlob(VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF);

        await expect(
            metadata.reconfigureSecurity({
                currentMasterPassword: "master",
                secondFactor: { kind: VaultUtilTypes.SecondFactorKind.NONE },
            }),
        ).resolves.toMatchObject({ error: "CURRENT_SECOND_FACTOR_FAILED" });

        await expect(
            metadata.resetRecoveryCode({ currentMasterPassword: "master" }),
        ).resolves.toMatchObject({ error: "CURRENT_SECOND_FACTOR_FAILED" });
    });

    it("throws when requireVaultID is called without a blob envelope", () => {
        const metadata = new VaultMetadata();

        expect(() =>
            (
                metadata as unknown as {
                    requireVaultID: () => string;
                }
            ).requireVaultID(),
        ).toThrow("Vault blob or envelope is null");
    });

    it("returns null when resolving current second factor without an envelope", async () => {
        const metadata = new VaultMetadata();

        await expect(
            (
                metadata as unknown as {
                    resolveCurrentSecondFactor: () => Promise<CryptoKey | null>;
                }
            ).resolveCurrentSecondFactor(),
        ).resolves.toBeNull();
    });

    it("uses stored WebAuthn metadata for current-factor reconfiguration", async () => {
        installWebAuthnMocks();
        const metadata = new VaultMetadata();
        metadata.DBIndex = 1;
        metadata.Blob = makeEnvelopeBlob(VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF);
        const primarySlot = metadata.Blob.Envelope!.Slots[0]!;
        primarySlot.WebauthnCredentialId = Buffer.from([1, 2, 3]).toString("base64");
        primarySlot.WebauthnPrfSalt = Buffer.from([4, 5, 6]).toString("base64");

        await expect(
            metadata.reconfigureSecurity({
                currentMasterPassword: "master",
                secondFactor: { kind: VaultUtilTypes.SecondFactorKind.NONE },
            }),
        ).resolves.toMatchObject({ value: null });
        expect(mockReconfigurePrimaryFactor).toHaveBeenCalledWith(
            metadata.Blob,
            "test-vault",
            expect.objectContaining({
                secondFactorHkdfBase: expect.anything(),
            }),
            expect.anything(),
            expect.anything(),
        );
    });

    it("reports WebAuthn enrollment failures and success reveal payloads", async () => {
        const metadata = new VaultMetadata();
        metadata.DBIndex = 1;
        metadata.Blob = makeEnvelopeBlob();

        await expect(
            metadata.reconfigureSecurity({
                currentMasterPassword: "master",
                secondFactor: {
                    kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF,
                },
            }),
        ).resolves.toMatchObject({ error: "SECOND_FACTOR_ENROLL_FAILED" });

        installWebAuthnMocks();
        await expect(
            metadata.reconfigureSecurity({
                currentMasterPassword: "master",
                secondFactor: {
                    kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF,
                },
            }),
        ).resolves.toMatchObject({
            value: {
                recoveryCode: "",
                secondFactorKind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF,
            },
        });
    });

    it("decryptVault derives WebAuthn unlock callback from primary slot metadata", async () => {
        installWebAuthnMocks();
        const metadata = new VaultMetadata();
        metadata.DBIndex = 1;
        metadata.Blob = makeEnvelopeBlob(VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF);
        const primarySlot = metadata.Blob.Envelope!.Slots[0]!;
        primarySlot.WebauthnCredentialId = Buffer.from([1, 2, 3]).toString("base64");
        primarySlot.WebauthnPrfSalt = Buffer.from([4, 5, 6]).toString("base64");

        const vault = new Vault();
        const credential = new VaultCredential();
        credential.TOTP = Object.assign(new TOTP(), { Secret: "JBSWY3DPEHPK3PXP" });
        vault.Credentials = [credential];
        mockOpenEnvelopeBlob.mockImplementationOnce(async (_blob, _vaultId, options) => {
            expect(
                (options as { secondFactorHkdfBase?: CryptoKey | null })
                    .secondFactorHkdfBase,
            ).toBeTruthy();
            const dek = await webcrypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"],
            );
            return ok({
                dek,
                plaintext: VaultUtilTypes.Vault.encode(vault).finish(),
            });
        });

        const result = await metadata.decryptVault(
            "pw",
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            makeArgonConfig(),
        );

        expect(result.isOk()).toBe(true);
        if (result.isErr()) return;
        expect(result.value.vault.Credentials[0]?.TOTP).toBeInstanceOf(TOTP);
    });

    it("decryptVault returns WebAuthn resolve errors", async () => {
        const metadata = new VaultMetadata();
        metadata.DBIndex = 1;
        metadata.Blob = makeEnvelopeBlob(VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF);

        const result = await metadata.decryptVault(
            "pw",
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            makeArgonConfig(),
        );

        expect(result.isErr()).toBe(true);
        expect((result as { error: string }).error).toBe("WEBAUTHN_UNLOCK_REQUIRED");
    });

    it("deserializeMetadataBinary preserves envelope data and backfills missing vault id", () => {
        const metadata = new VaultMetadata();
        metadata.Name = "Envelope metadata";
        metadata.Blob = makeEnvelopeBlob();
        metadata.Blob.Envelope!.VaultID = "";
        const encoded = VaultUtilTypes.VaultMetadata.encode(metadata).finish();

        const restored = VaultMetadata.deserializeMetadataBinary(encoded);

        expect(restored.Blob?.Envelope).toBeDefined();
        expect(restored.Blob?.Envelope?.VaultID).toBeTruthy();
    });

    it("serializeVault rejects non-envelope blobs", async () => {
        await expect(
            serializeVault(
                new Vault(),
                EncryptedBlob.CreateDefault(),
                await webcrypto.subtle.generateKey(
                    { name: "AES-GCM", length: 256 },
                    false,
                    ["encrypt", "decrypt"],
                ),
            ),
        ).rejects.toThrow("Invalid key for serializeVault");
    });
});
