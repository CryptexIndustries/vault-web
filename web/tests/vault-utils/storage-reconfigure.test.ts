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

type DeviceFactorRecord = {
    kind: number;
    factorHkdfKey: CryptoKey | null;
    webauthnCredentialId?: string;
    webauthnPrfSalt?: string;
};

const mockDeviceFactors = new Map<string, DeviceFactorRecord>();

jest.mock("../../src/app_lib/vault-utils/vault-key-store", () => ({
    setDeviceSecondFactorKey: jest.fn(
        async (
            index: number,
            factorHkdfKey: CryptoKey | null,
            kind: number,
            webauthnCredentialId?: string,
            webauthnPrfSalt?: string,
        ) => {
            mockDeviceFactors.set(`sf:${index}`, {
                kind,
                factorHkdfKey,
                webauthnCredentialId,
                webauthnPrfSalt,
            });
        },
    ),
    getDeviceSecondFactorKey: jest.fn(
        async (index: number) =>
            mockDeviceFactors.get(`sf:${index}`)?.factorHkdfKey ?? null,
    ),
    getDeviceSecondFactorKind: jest.fn(
        async (index: number) =>
            mockDeviceFactors.get(`sf:${index}`)?.kind ?? null,
    ),
    clearDeviceSecondFactor: jest.fn(async (index: number) => {
        mockDeviceFactors.delete(`sf:${index}`);
    }),
}));

import sodium from "libsodium-wrappers-sumo";
import * as VaultUtilTypes from "../../src/app_lib/proto/vault";
import {
    EncryptedBlob,
    EncryptDataBlob,
    hashSecret,
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
} from "../../src/app_lib/vault-utils/encryption";
import { VaultMetadata, db } from "../../src/app_lib/vault-utils/storage";
import { Vault } from "../../src/app_lib/vault-utils/vault";
import type {
    EncryptionFormGroupSchemaType,
    VaultEncryptionConfigurationsFormElementType,
} from "../../src/app_lib/vault-utils/form-schemas";
import { clearDeviceSecondFactor } from "../../src/app_lib/vault-utils/vault-key-store";

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
        { secondFactor: { kind: VaultUtilTypes.SecondFactorKind.NONE } },
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
        mockDeviceFactors.clear();
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
            secondFactor: { kind: VaultUtilTypes.SecondFactorKind.NONE },
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

    it("rejects an incorrect current password", async () => {
        const metadata = await buildVault("correct");

        const res = await metadata.reconfigureSecurity({
            currentMasterPassword: "wrong",
            newMasterPassword: "whatever",
            secondFactor: { kind: VaultUtilTypes.SecondFactorKind.NONE },
        });

        expect(res.isErr()).toBe(true);
        expect((res as { error: string }).error).toBe("DEK_UNWRAP_FAILED");
        // Original password still works (nothing was persisted destructively).
        expect(await unlock(metadata, { masterPassword: "correct" })).toBe(
            true,
        );
    });

    it("keeps existing device factor when reconfigure auth fails", async () => {
        const metadata = await buildVault("master");
        await metadata.reconfigureSecurity({
            currentMasterPassword: "master",
            secondFactor: {
                kind: VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
            },
        });
        expect(mockDeviceFactors.has("sf:1")).toBe(true);
        jest.clearAllMocks();

        const res = await metadata.reconfigureSecurity({
            currentMasterPassword: "wrong",
            secondFactor: { kind: VaultUtilTypes.SecondFactorKind.NONE },
        });

        expect(res.isErr()).toBe(true);
        expect(clearDeviceSecondFactor).not.toHaveBeenCalled();
        expect(mockDeviceFactors.has("sf:1")).toBe(true);
        expect(await unlock(metadata, { masterPassword: "master" })).toBe(true);
    });

    it("enrolls a passphrase second factor and reveals it once", async () => {
        const metadata = await buildVault("master");

        const res = await metadata.reconfigureSecurity({
            currentMasterPassword: "master",
            secondFactor: {
                kind: VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
            },
        });

        expect(res.isOk()).toBe(true);
        const revealSecrets = res as {
            value: {
                secondFactorKind?: number;
                secondFactorPassphrase?: string;
            };
        };
        expect(revealSecrets.value?.secondFactorPassphrase).toBeTruthy();
        expect(revealSecrets.value?.secondFactorKind).toBe(
            VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
        );
        expect(metadata.Blob?.Envelope?.PrimaryFactorKind).toBe(
            VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
        );
        // The freshly enrolled device factor lets this browser unlock with the
        // master password alone.
        expect(await unlock(metadata, { masterPassword: "master" })).toBe(true);
    });

    it("removes a second factor and clears the device key", async () => {
        const metadata = await buildVault("master");
        await metadata.reconfigureSecurity({
            currentMasterPassword: "master",
            secondFactor: {
                kind: VaultUtilTypes.SecondFactorKind.PASSPHRASE_128,
            },
        });
        expect(mockDeviceFactors.has("sf:1")).toBe(true);

        const res = await metadata.reconfigureSecurity({
            currentMasterPassword: "master",
            secondFactor: { kind: VaultUtilTypes.SecondFactorKind.NONE },
        });

        expect(res.isOk()).toBe(true);
        expect(res.isOk() && res.value).toBeNull();
        expect(metadata.Blob?.Envelope?.PrimaryFactorKind).toBe(
            VaultUtilTypes.SecondFactorKind.NONE,
        );
        expect(clearDeviceSecondFactor).toHaveBeenLastCalledWith(1);
        expect(mockDeviceFactors.has("sf:1")).toBe(false);
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
            { secondFactor: { kind: VaultUtilTypes.SecondFactorKind.NONE } },
        );
        original.metadata.DBIndex = 1;

        const oldCode = original.revealSecrets.recoveryCode;
        const res = await original.metadata.resetRecoveryCode({
            currentMasterPassword: "master",
        });

        expect(res.isOk()).toBe(true);
        if (res.isErr()) return;
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
});

describe("legacy V2 backup restore", () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockDeviceFactors.clear();
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
