import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { err, ok, type Result } from "neverthrow";

const values = new Map<unknown, unknown>();
const metadataAtom = { name: "metadata" };
const vaultAtom = { name: "vault" };
const mockClearDEK = jest.fn();
const mockSave = jest.fn(async (): Promise<Result<void, "VAULT_SAVE_FAILED">> => err("VAULT_SAVE_FAILED"));
const mockClipboardClear = jest.fn(async () => undefined);
const mockLogout = jest.fn(async () => undefined);
const mockStopBackup = jest.fn();
const mockClearProvider = jest.fn();

jest.mock("jotai", () => ({ atom: (initial: unknown) => ({ initial }) }));
jest.mock("@/utils/atoms", () => ({
    unlockedVaultAtom: vaultAtom,
    unlockedVaultMetadataAtom: metadataAtom,
    vaultStore: {
        get: (key: unknown) => values.get(key),
        set: (key: unknown, value: unknown) => values.set(key, value),
    },
}));
jest.mock("@cryptex-industries/vault-core/vault-utils/vault", () => ({
    Vault: class Vault {},
}));
jest.mock("@cryptex-industries/vault-core/vault-utils/vault-write-coordinator", () => ({
    vaultWriteCoordinator: { run: async (_kind: string, action: () => Promise<unknown>) => action() },
}));
jest.mock("@/utils/vault-session", () => ({
    clearVaultDEKFromSession: mockClearDEK,
    saveVaultWithSessionDEK: mockSave,
}));
jest.mock("@/utils/clipboard", () => ({
    clearPendingSecretFromClipboard: mockClipboardClear,
}));
jest.mock("@/utils/secret-temp-files", () => ({
    purgeSecretTempFiles: jest.fn(async () => undefined),
}));
jest.mock("@/app_lib/auth-session", () => ({
    logoutOnlineServicesSession: mockLogout,
}));
jest.mock("@/app_lib/managed-backup-hooks", () => ({
    flushManagedBackupBeforeLock: jest.fn(async () => undefined),
    stopManagedBackup: mockStopBackup,
}));
jest.mock("@/utils/android-credentials", () => ({
    androidCredentials: { clearProviderCredentials: mockClearProvider },
}));
jest.mock("@/utils/logging", () => ({
    vaultLog: { error: jest.fn() },
    vaultLogger: { clearAll: jest.fn() },
}));

const {
    lockUnlockedVault,
    lockVaultWithoutSaving,
    vaultLockStateAtom,
} = require("@/utils/vault-lock") as typeof import("@/utils/vault-lock");
const { registerActiveSyncController } = require("@/utils/active-sync-controllers") as typeof import("@/utils/active-sync-controllers");

describe("lock after a save failure", () => {
    beforeEach(() => {
        values.clear();
        jest.clearAllMocks();
        values.set(vaultLockStateAtom, "idle");
        values.set(metadataAtom, { ID: "vault" });
        values.set(vaultAtom, { Credentials: [{ Password: "unsaved" }] });
    });

    it("keeps the vault available for retry, then discards it when the user locks anyway", async () => {
        const result = await lockUnlockedVault({
            unlockedVaultMetadata: { ID: "vault" } as never,
            setUnlockedVault: async () => undefined,
            setUnlockedVaultMetadata: () => undefined,
        });
        expect(result.isErr()).toBe(true);
        expect(values.get(vaultLockStateAtom)).toBe("failed");
        expect(mockClearDEK).not.toHaveBeenCalled();
        expect(values.get(metadataAtom)).not.toBeNull();

        const teardown = jest.fn(() => {
            expect(mockClearDEK).toHaveBeenCalledTimes(1);
            expect(values.get(metadataAtom)).toBeNull();
            expect(values.get(vaultAtom)).not.toEqual({ Credentials: [{ Password: "unsaved" }] });
        });
        const forced = await lockVaultWithoutSaving({ teardown } as never);
        expect(forced.isOk()).toBe(true);
        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(mockClearDEK).toHaveBeenCalledTimes(1);
        expect(values.get(metadataAtom)).toBeNull();
        expect(values.get(vaultAtom)).not.toEqual({ Credentials: [{ Password: "unsaved" }] });
        expect(teardown).toHaveBeenCalledTimes(1);
        expect(mockClearProvider).toHaveBeenCalledTimes(1);
        expect(mockStopBackup).toHaveBeenCalledTimes(1);
        expect(mockLogout).toHaveBeenCalledTimes(1);
        expect(mockClipboardClear).toHaveBeenCalledTimes(1);
        expect(values.get(vaultLockStateAtom)).toBe("idle");
    });

    it("rejects a discard request unless a previous lock failed", async () => {
        const result = await lockVaultWithoutSaving();
        expect(result.isErr()).toBe(true);
        expect(mockClearDEK).not.toHaveBeenCalled();
    });

    it("continues cleanup if a native provider call fails", async () => {
        values.set(vaultLockStateAtom, "failed");
        mockClearProvider.mockImplementationOnce(() => {
            throw new Error("provider unavailable");
        });
        const result = await lockVaultWithoutSaving();
        expect(result.isOk()).toBe(true);
        expect(mockClearDEK).toHaveBeenCalledTimes(1);
        expect(mockLogout).toHaveBeenCalledTimes(1);
        expect(mockClipboardClear).toHaveBeenCalledTimes(1);
    });

    it("tears down the shell controller when top-level lock has no sync context", async () => {
        mockSave.mockResolvedValueOnce(ok(undefined));
        const teardown = jest.fn(() => {
            expect(mockClearDEK).toHaveBeenCalledTimes(1);
        });
        const unregister = registerActiveSyncController({ teardown } as never);

        const result = await lockUnlockedVault({
            unlockedVaultMetadata: { ID: "vault" } as never,
            setUnlockedVault: async () => undefined,
            setUnlockedVaultMetadata: (metadata) => values.set(metadataAtom, metadata),
        });

        expect(result.isOk()).toBe(true);
        expect(teardown).toHaveBeenCalledTimes(1);
        expect(values.get(metadataAtom)).toBeNull();
        expect(mockClearProvider).toHaveBeenCalledTimes(1);
        unregister();
        expect(teardown).toHaveBeenCalledTimes(1);
    });

    it("tears down a controller when its provider unmounts", () => {
        const teardown = jest.fn();
        const unregister = registerActiveSyncController({ teardown } as never);
        unregister();
        unregister();
        expect(teardown).toHaveBeenCalledTimes(1);
    });
});
