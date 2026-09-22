/**
 * @jest-environment node
 *
 * Integration coverage for VaultMetadata security re-keying. Uses the real
 * envelope/crypto stack with an in-memory key-store + Dexie mock, then proves
 * each change by unlocking through VaultMetadata.decryptVault.
 */
import {
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { webcrypto } from "crypto";
import { TextDecoder, TextEncoder } from "util";
import type { VaultHkdfKey } from "@cryptex-industries/vault-core/envelope-crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});
Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});
Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

jest.mock(
    "@/lib/utils",
    () => ({
        base64ToUint8: (value: string): Uint8Array =>
            new Uint8Array(Buffer.from(value, "base64")),
        uint8ToBase64: (value: Uint8Array): string =>
            Buffer.from(value).toString("base64"),
        base64UrlToUint8: (value: string): Uint8Array =>
            new Uint8Array(Buffer.from(value, "base64url")),
        uint8ToBase64Url: (value: Uint8Array): string =>
            Buffer.from(value).toString("base64url"),
    }),
    { virtual: true },
);

jest.mock("dexie", () => {
    class DexieMock {
        public version() {
            return { stores: () => undefined };
        }
    }
    return { __esModule: true, default: DexieMock };
});

type DeviceKeyProtectionRecord = {
    kind: number;
    protectionHkdfKey: VaultHkdfKey | null;
    webauthnCredentialId?: string;
    webauthnPrfSalt?: string;
};

const mockDeviceKeyProtections = new Map<string, DeviceKeyProtectionRecord>();

jest.mock("../../src/app_lib/vault-utils/vault-key-store", () => ({
    setDeviceAdditionalKeyProtectionKey: jest.fn(
        async (
            index: number,
            protectionHkdfKey: VaultHkdfKey | null,
            kind: number,
            webauthnCredentialId?: string,
            webauthnPrfSalt?: string,
        ) => {
            mockDeviceKeyProtections.set(`akp:${index}`, {
                kind,
                protectionHkdfKey,
                webauthnCredentialId,
                webauthnPrfSalt,
            });
        },
    ),
    getDeviceAdditionalKeyProtectionKey: jest.fn(
        async (index: number) =>
            mockDeviceKeyProtections.get(`akp:${index}`)?.protectionHkdfKey ??
            null,
    ),
    getDeviceAdditionalKeyProtectionKind: jest.fn(
        async (index: number) =>
            mockDeviceKeyProtections.get(`akp:${index}`)?.kind ?? null,
    ),
    clearDeviceAdditionalKeyProtection: jest.fn(async (index: number) => {
        mockDeviceKeyProtections.delete(`akp:${index}`);
    }),
}));

import {
    clearDeviceAdditionalKeyProtection,
    getDeviceAdditionalKeyProtectionKey,
    setDeviceAdditionalKeyProtectionKey,
} from "../../src/app_lib/vault-utils/vault-key-store";
import {
    configureVaultCoreRuntime,
    createWebCryptoEnvelopeCrypto,
} from "@cryptex-industries/vault-core/runtime";

configureVaultCoreRuntime({
    envelopeCrypto: createWebCryptoEnvelopeCrypto(),
    env: {
        NEXT_PUBLIC_PUSHER_APP_KEY: "test-key",
        NEXT_PUBLIC_PUSHER_APP_HOST: "localhost",
        NEXT_PUBLIC_PUSHER_APP_PORT: "6001",
        NEXT_PUBLIC_PUSHER_APP_TLS: false,
    },
    onlineServicesSessionPort: {
        ensureFresh: async () => true,
        forceReauthenticate: async () => false,
    },
    onlineServicesApi: {
        getTurnCredentials: async () => ({ iceServers: [], expiresAt: 0 }),
        authorizeSignalingChannel: async () => ({ auth: "" }),
    },
    syncLog: { debug() {}, info() {}, warn() {}, error() {} },
    signalingLog: { debug() {}, info() {}, warn() {}, error() {} },
    webrtcLog: { debug() {}, info() {}, warn() {}, error() {} },
    additionalKeyProtectionStore: {
        setDeviceAdditionalKeyProtectionKey:
            setDeviceAdditionalKeyProtectionKey as never,
        getDeviceAdditionalKeyProtectionKey:
            getDeviceAdditionalKeyProtectionKey as never,
    },
});

import sodium from "libsodium-wrappers-sumo";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    EncryptedBlob,
    EncryptDataBlob,
    hashSecret,
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
} from "@cryptex-industries/vault-core/vault-utils/encryption";
import { VaultMetadata, db } from "../../src/app_lib/vault-utils/storage";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import type {
    EncryptionFormGroupSchemaType,
    VaultEncryptionConfigurationsFormElementType,
} from "@cryptex-industries/vault-core/vault-utils/form-schemas";

const KDF_CONFIG: VaultEncryptionConfigurationsFormElementType = {
    memLimit: 8,
    opsLimit: 1,
    iterations: 1000,
};

const encryptionForm = (secret: string): EncryptionFormGroupSchemaType => ({
    Secret: secret,
    Encryption: VaultUtilTypes.EncryptionAlgorithm.AES256,
    EncryptionKeyDerivationFunction:
        VaultUtilTypes.KeyDerivationFunction.Argon2ID,
    EncryptionConfig: KDF_CONFIG,
});

async function buildVault(masterPassword: string): Promise<VaultMetadata> {
    const created = await VaultMetadata.createNewVault(
        { Name: "Test", Description: "" },
        encryptionForm(masterPassword),
        false,
        0,
        {
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            },
        },
    );
    // createNewVault does not persist; assign a DB index as save() would.
    created.metadata.DBIndex = 1;
    return created.metadata;
}

async function unlock(
    metadata: VaultMetadata,
    params: {
        masterPassword: string;
        useRecovery?: boolean;
        recoveryCode?: string;
        protectionPhrase?: string;
    },
): Promise<boolean> {
    const res = await metadata.decryptVault(
        params.masterPassword,
        VaultUtilTypes.EncryptionAlgorithm.AES256,
        VaultUtilTypes.KeyDerivationFunction.Argon2ID,
        KDF_CONFIG,
        params,
    );
    return res.isOk();
}

describe("VaultMetadata.reconfigureSecurity / resetRecoveryCode", () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockDeviceKeyProtections.clear();
        db.vaults = {
            update: jest.fn(async () => 1),
            add: jest.fn(async () => 1),
        } as never;
    });

    it("changes the master password", async () => {
        const metadata = await buildVault("old-password");

        const res = await metadata.reconfigureSecurity({
            currentMasterPassword: "old-password",
            newMasterPassword: "new-password",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            },
        });

        expect(res.isOk()).toBe(true);
        expect(await unlock(metadata, { masterPassword: "new-password" })).toBe(
            true,
        );
        expect(await unlock(metadata, { masterPassword: "old-password" })).toBe(
            false,
        );
        // Metadata persisted exactly once.
        const vaultsMock = db.vaults as unknown as { update: jest.Mock };
        const updateMock = vaultsMock.update;
        expect(updateMock).toHaveBeenCalledTimes(1);
    });

    it("changes the master password with only the recovery code", async () => {
        const created = await VaultMetadata.createNewVault(
            { Name: "Test", Description: "" },
            encryptionForm("old-password"),
            false,
            0,
            {
                additionalKeyProtection: {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
                },
            },
        );
        const metadata = created.metadata;
        metadata.DBIndex = 1;
        const oldCode = created.revealSecrets.recoveryCode;
        const protectedResult = await metadata.reconfigureSecurity({
            currentMasterPassword: "old-password",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
            },
        });
        expect(protectedResult.isOk()).toBe(true);
        mockDeviceKeyProtections.clear();

        const res = await metadata.reconfigureSecurity({
            currentMasterPassword: "",
            currentRecoveryCode: oldCode,
            newMasterPassword: "new-password",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            },
        });

        expect(res.isOk()).toBe(true);
        if (res.isErr()) return;
        expect(res.value.recoveryCode).toBe("");
        expect(await unlock(metadata, { masterPassword: "new-password" })).toBe(
            true,
        );
        expect(await unlock(metadata, { masterPassword: "old-password" })).toBe(
            false,
        );
        expect(
            await unlock(metadata, {
                masterPassword: "",
                useRecovery: true,
                recoveryCode: oldCode,
            }),
        ).toBe(true);
    });

    it("does not change the vault when recovery authorization fails", async () => {
        const metadata = await buildVault("old-password");

        const missingPassword = await metadata.reconfigureSecurity({
            currentMasterPassword: "",
            currentRecoveryCode: "wrong-code",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            },
        });
        expect(missingPassword.isErr() && missingPassword.error).toBe(
            "NEW_MASTER_PASSWORD_REQUIRED_FOR_RECOVERY",
        );

        const wrongCode = await metadata.reconfigureSecurity({
            currentMasterPassword: "",
            currentRecoveryCode: "wrong-code",
            newMasterPassword: "new-password",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            },
        });
        expect(wrongCode.isErr()).toBe(true);
        expect(await unlock(metadata, { masterPassword: "old-password" })).toBe(
            true,
        );
        expect(await unlock(metadata, { masterPassword: "new-password" })).toBe(
            false,
        );
        expect(
            (db.vaults as unknown as { update: jest.Mock }).update,
        ).not.toHaveBeenCalled();
    });

    it("keeps optional data-key rotation behavior when changing a password with recovery", async () => {
        const created = await VaultMetadata.createNewVault(
            { Name: "Test", Description: "" },
            encryptionForm("old-password"),
            false,
            0,
            {
                additionalKeyProtection: {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
                },
            },
        );
        const metadata = created.metadata;
        metadata.DBIndex = 1;
        const oldCode = created.revealSecrets.recoveryCode;

        const res = await metadata.reconfigureSecurity({
            currentMasterPassword: "",
            currentRecoveryCode: oldCode,
            newMasterPassword: "new-password",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            },
            rotateDataKey: true,
        });

        expect(res.isOk()).toBe(true);
        if (res.isErr()) return;
        expect(res.value.dataKeyRotated).toBe(true);
        expect(res.value.recoveryCode).not.toBe(oldCode);
        expect(await unlock(metadata, { masterPassword: "new-password" })).toBe(
            true,
        );
        expect(
            await unlock(metadata, {
                masterPassword: "",
                useRecovery: true,
                recoveryCode: oldCode,
            }),
        ).toBe(false);
        expect(
            await unlock(metadata, {
                masterPassword: "",
                useRecovery: true,
                recoveryCode: res.value.recoveryCode,
            }),
        ).toBe(true);
    });

    it("rejects out-of-range KDF settings before deriving a key", async () => {
        const metadata = await buildVault("master");

        const result = await metadata.reconfigureSecurity({
            currentMasterPassword: "master",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            },
            kdfConfig: new KeyDerivationConfig_Argon2ID(
                KeyDerivationConfig_Argon2ID.MAX_MEM_LIMIT + 1,
                KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT,
            ),
        });

        expect(result.isErr() && result.error).toBe("INVALID_KDF_CONFIG");
        const vaultsMock = db.vaults as unknown as { update: jest.Mock };
        expect(vaultsMock.update.mock.calls).toHaveLength(0);
    });

    it("rejects an incorrect current password", async () => {
        const metadata = await buildVault("correct");

        const res = await metadata.reconfigureSecurity({
            currentMasterPassword: "wrong",
            newMasterPassword: "whatever",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            },
        });

        expect(res.isErr()).toBe(true);
        expect((res as { error: string }).error).toBe("DEK_UNWRAP_FAILED");
        // Original password still works (nothing was persisted destructively).
        expect(await unlock(metadata, { masterPassword: "correct" })).toBe(
            true,
        );
    });

    it("keeps existing device protection when reconfigure auth fails", async () => {
        const metadata = await buildVault("master");
        await metadata.reconfigureSecurity({
            currentMasterPassword: "master",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
            },
        });
        expect(mockDeviceKeyProtections.has("akp:1")).toBe(true);
        jest.clearAllMocks();

        const res = await metadata.reconfigureSecurity({
            currentMasterPassword: "wrong",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            },
        });

        expect(res.isErr()).toBe(true);
        expect(clearDeviceAdditionalKeyProtection).not.toHaveBeenCalled();
        expect(mockDeviceKeyProtections.has("akp:1")).toBe(true);
        expect(await unlock(metadata, { masterPassword: "master" })).toBe(true);
    });

    it("enrolls a protection phrase and reveals it once", async () => {
        const metadata = await buildVault("master");

        const res = await metadata.reconfigureSecurity({
            currentMasterPassword: "master",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
            },
        });

        expect(res.isOk()).toBe(true);
        const revealSecrets = res as {
            value: {
                additionalKeyProtectionKind?: number;
                protectionPhrase?: string;
            };
        };
        expect(revealSecrets.value?.protectionPhrase).toBeTruthy();
        expect(revealSecrets.value?.additionalKeyProtectionKind).toBe(
            VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
        );
        expect(metadata.Blob?.Envelope?.PrimaryProtectionKind).toBe(
            VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128,
        );
        // The freshly enrolled device protection lets this browser unlock with the
        // master password alone.
        expect(await unlock(metadata, { masterPassword: "master" })).toBe(true);
    });

    it("returns the new phrase when the device-local protection cache fails after persistence", async () => {
        const metadata = await buildVault("master");
        (
            setDeviceAdditionalKeyProtectionKey as jest.Mock
        ).mockRejectedValueOnce(new Error("key store unavailable") as never);

        const result = await metadata.reconfigureSecurity({
            currentMasterPassword: "master",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
            },
        });

        expect(result.isOk()).toBe(true);
        if (result.isErr()) return;
        expect(result.value.deviceKeyProtectionCached).toBe(false);
        expect(result.value.protectionPhrase).toBeTruthy();
        expect(await unlock(metadata, { masterPassword: "master" })).toBe(
            false,
        );
        expect(
            await unlock(metadata, {
                masterPassword: "master",
                protectionPhrase: result.value.protectionPhrase,
            }),
        ).toBe(true);
        expect(await unlock(metadata, { masterPassword: "master" })).toBe(true);
    });

    it("removes additional key protection and clears the device key", async () => {
        const metadata = await buildVault("master");
        await metadata.reconfigureSecurity({
            currentMasterPassword: "master",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
            },
        });
        expect(mockDeviceKeyProtections.has("akp:1")).toBe(true);

        const res = await metadata.reconfigureSecurity({
            currentMasterPassword: "master",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            },
        });

        expect(res.isOk()).toBe(true);
        expect(res.isOk() && res.value).toMatchObject({
            dataKeyRotated: false,
            recoveryCode: "",
            additionalKeyProtectionKind:
                VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
        });
        expect(metadata.Blob?.Envelope?.PrimaryProtectionKind).toBe(
            VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
        );
        expect(clearDeviceAdditionalKeyProtection).toHaveBeenLastCalledWith(1);
        expect(mockDeviceKeyProtections.has("akp:1")).toBe(false);
        expect(await unlock(metadata, { masterPassword: "master" })).toBe(true);
    });

    it("resets the recovery code, invalidating the previous one", async () => {
        const metadata = await buildVault("master");
        // Capture the original recovery code from creation.
        const original = await VaultMetadata.createNewVault(
            { Name: "Test", Description: "" },
            encryptionForm("master"),
            false,
            0,
            {
                additionalKeyProtection: {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
                },
            },
        );
        original.metadata.DBIndex = 1;

        const oldCode = original.revealSecrets.recoveryCode;
        const res = await original.metadata.resetRecoveryCode({
            currentMasterPassword: "master",
        });

        expect(res.isOk()).toBe(true);
        if (res.isErr()) return;
        expect(res.value.dataKeyRotated).toBe(false);
        const newCode = res.value.recoveryCode;
        expect(newCode).not.toBe(oldCode);

        expect(
            await unlock(original.metadata, {
                masterPassword: "",
                useRecovery: true,
                recoveryCode: newCode,
            }),
        ).toBe(true);
        expect(
            await unlock(original.metadata, {
                masterPassword: "",
                useRecovery: true,
                recoveryCode: oldCode,
            }),
        ).toBe(false);
        expect(
            await unlock(original.metadata, { masterPassword: "master" }),
        ).toBe(true);

        // Silence unused-var lint for the throwaway vault.
        expect(metadata.DBIndex).toBe(1);
    });

    it("rotates the DEK, ciphertext, IV, and recovery code as one persisted update", async () => {
        const created = await VaultMetadata.createNewVault(
            { Name: "Test", Description: "" },
            encryptionForm("old-password"),
            false,
            0,
            {
                additionalKeyProtection: {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
                },
            },
        );
        created.metadata.DBIndex = 1;
        const oldRecoveryCode = created.revealSecrets.recoveryCode;
        const oldCiphertext = new Uint8Array(created.metadata.Blob!.Blob);
        const oldIv = created.metadata.Blob!.HeaderIV;

        const result = await created.metadata.reconfigureSecurity({
            currentMasterPassword: "old-password",
            newMasterPassword: "new-password",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            },
            rotateDataKey: true,
        });

        expect(result.isOk()).toBe(true);
        if (result.isErr()) return;
        expect(result.value.dataKeyRotated).toBe(true);
        expect(result.value.sessionDek).toBeInstanceOf(CryptoKey);
        expect(result.value.sessionDek?.extractable).toBe(false);
        expect(result.value.recoveryCode).not.toBe(oldRecoveryCode);
        expect(created.metadata.Blob!.Blob).not.toEqual(oldCiphertext);
        expect(created.metadata.Blob!.HeaderIV).not.toBe(oldIv);
        expect(
            await unlock(created.metadata, {
                masterPassword: "new-password",
            }),
        ).toBe(true);
        expect(
            await unlock(created.metadata, {
                masterPassword: "old-password",
            }),
        ).toBe(false);
        expect(
            await unlock(created.metadata, {
                masterPassword: "",
                useRecovery: true,
                recoveryCode: result.value.recoveryCode,
            }),
        ).toBe(true);
        expect(
            await unlock(created.metadata, {
                masterPassword: "",
                useRecovery: true,
                recoveryCode: oldRecoveryCode,
            }),
        ).toBe(false);
        const vaultsMock = db.vaults as unknown as { update: jest.Mock };
        const updateMock = vaultsMock.update;
        expect(updateMock).toHaveBeenCalledTimes(1);
    });

    it("keeps the published blob and old credentials when persistence fails", async () => {
        const metadata = await buildVault("old-password");
        const originalBlob = metadata.Blob;
        (db.vaults.update as jest.Mock).mockRejectedValueOnce(
            new Error("disk full") as never,
        );

        await expect(
            metadata.reconfigureSecurity({
                currentMasterPassword: "old-password",
                newMasterPassword: "new-password",
                additionalKeyProtection: {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
                },
                rotateDataKey: true,
            }),
        ).rejects.toThrow("disk full");

        expect(metadata.Blob).toBe(originalBlob);
        expect(await unlock(metadata, { masterPassword: "old-password" })).toBe(
            true,
        );
        expect(await unlock(metadata, { masterPassword: "new-password" })).toBe(
            false,
        );
        expect(clearDeviceAdditionalKeyProtection).not.toHaveBeenCalled();
    });

    it("can rotate the DEK while rotating only the recovery code", async () => {
        const created = await VaultMetadata.createNewVault(
            { Name: "Test", Description: "" },
            encryptionForm("master"),
            false,
            0,
            {
                additionalKeyProtection: {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
                },
            },
        );
        created.metadata.DBIndex = 1;
        const oldRecoveryCode = created.revealSecrets.recoveryCode;
        const oldCiphertext = new Uint8Array(created.metadata.Blob!.Blob);

        const result = await created.metadata.resetRecoveryCode({
            currentMasterPassword: "master",
            rotateDataKey: true,
        });

        expect(result.isOk()).toBe(true);
        if (result.isErr()) return;
        expect(result.value.dataKeyRotated).toBe(true);
        expect(result.value.sessionDek).toBeInstanceOf(CryptoKey);
        expect(result.value.sessionDek?.extractable).toBe(false);
        expect(created.metadata.Blob!.Blob).not.toEqual(oldCiphertext);
        expect(
            await unlock(created.metadata, { masterPassword: "master" }),
        ).toBe(true);
        expect(
            await unlock(created.metadata, {
                masterPassword: "",
                useRecovery: true,
                recoveryCode: result.value.recoveryCode,
            }),
        ).toBe(true);
        expect(
            await unlock(created.metadata, {
                masterPassword: "",
                useRecovery: true,
                recoveryCode: oldRecoveryCode,
            }),
        ).toBe(false);
    });

    it("preserves a protection phrase during recovery-authenticated DEK rotation", async () => {
        const created = await VaultMetadata.createNewVault(
            { Name: "Test", Description: "" },
            encryptionForm("master"),
            false,
            0,
            {
                additionalKeyProtection: {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
                },
            },
        );
        created.metadata.DBIndex = 1;
        const oldRecoveryCode = created.revealSecrets.recoveryCode;
        const protectionResult = await created.metadata.reconfigureSecurity({
            currentMasterPassword: "master",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
            },
        });
        expect(protectionResult.isOk()).toBe(true);
        if (protectionResult.isErr()) return;
        const phrase = protectionResult.value.protectionPhrase;
        expect(phrase).toBeTruthy();
        mockDeviceKeyProtections.clear();

        const result = await created.metadata.resetRecoveryCode({
            currentMasterPassword: "master",
            currentRecoveryCode: oldRecoveryCode,
            currentProtectionPhrase: phrase,
            rotateDataKey: true,
        });

        expect(result.isOk()).toBe(true);
        if (result.isErr()) return;
        expect(
            await unlock(created.metadata, {
                masterPassword: "master",
                protectionPhrase: phrase,
            }),
        ).toBe(true);
        expect(
            await unlock(created.metadata, {
                masterPassword: "",
                useRecovery: true,
                recoveryCode: result.value.recoveryCode,
            }),
        ).toBe(true);
    });

    it("refuses recovery-authenticated DEK rotation without the current protection", async () => {
        const created = await VaultMetadata.createNewVault(
            { Name: "Test", Description: "" },
            encryptionForm("master"),
            false,
            0,
            {
                additionalKeyProtection: {
                    kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
                },
            },
        );
        created.metadata.DBIndex = 1;
        const oldRecoveryCode = created.revealSecrets.recoveryCode;
        const protectionResult = await created.metadata.reconfigureSecurity({
            currentMasterPassword: "master",
            additionalKeyProtection: {
                kind: VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_128,
            },
        });
        expect(protectionResult.isOk()).toBe(true);
        mockDeviceKeyProtections.clear();
        const originalBlob = created.metadata.Blob;

        const result = await created.metadata.resetRecoveryCode({
            currentMasterPassword: "master",
            currentRecoveryCode: oldRecoveryCode,
            rotateDataKey: true,
        });

        expect(result.isErr() && result.error).toBe(
            "CURRENT_ADDITIONAL_KEY_PROTECTION_FAILED",
        );
        expect(created.metadata.Blob).toBe(originalBlob);
    });
});

describe("legacy V2 backup restore", () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockDeviceKeyProtections.clear();
        db.vaults = {
            update: jest.fn(async () => 1),
            add: jest.fn(async () => 1),
        } as never;
    });

    it("unlocks after restore when backup blob is pre-envelope Version 2", async () => {
        const vaultBytes = VaultUtilTypes.Vault.encode(new Vault()).finish();
        const legacyEncrypted = await EncryptDataBlob(
            vaultBytes,
            await hashSecret("restore-password"),
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            new KeyDerivationConfig_Argon2ID(8, 1),
            new KeyDerivationConfig_PBKDF2(),
        );
        legacyEncrypted.Version = 2;
        legacyEncrypted.CurrentVersion = 2;

        const backupBytes =
            VaultUtilTypes.EncryptedBlob.encode(legacyEncrypted).finish();
        const restoredBlob = EncryptedBlob.fromBinary(backupBytes);

        expect(restoredBlob.Version).toBe(2);
        expect(restoredBlob.Envelope).toBeUndefined();

        const metadata = new VaultMetadata();
        metadata.Blob = restoredBlob;
        metadata.DBIndex = 1;

        const result = await metadata.decryptVault(
            "restore-password",
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            KDF_CONFIG,
        );

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.revealSecrets?.recoveryCode).toBeDefined();
        }
    });
});
