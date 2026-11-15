/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockState = {
    sourceVersion: 1,
    vaultId: "vault-a",
    deviceId: "device-a",
};
const mockUnlockedVaultAtom = Symbol("unlockedVaultAtom");
const mockUnlockedVaultMetadataAtom = Symbol("unlockedVaultMetadataAtom");
const vaultStoreGetMock = jest.fn<(atom: symbol) => unknown>();

const uploadEncryptedBackupMock =
    jest.fn<
        (
            bytes: Uint8Array,
            idempotencyKey?: string,
            client?: unknown,
        ) => Promise<unknown>
    >();
const createEncryptedBackupBytesMock = jest.fn(
    async () => new Uint8Array([mockState.sourceVersion]),
);
const deleteManagedBackupHistoryBeforeMock = jest.fn(
    async (_replacement: { id: string; createdAt: Date }, _client?: unknown) =>
        undefined,
);
const sha256Base64UrlMock = jest.fn(
    async (bytes: Uint8Array) => `hash-${bytes[0]}`,
);
const replacementCreatedAt = new Date("2026-09-17T10:00:00.000Z");
const backupStatusQueryMock = jest.fn(async () => ({
    enabled: true,
    entitled: true,
}));
const accountBoundClient = {
    v1: { backup: { status: { query: backupStatusQueryMock } } },
};
const createAccountBoundTrpcClientMock = jest.fn(() => accountBoundClient);

jest.mock("@cryptex-industries/vault-core/proto", () => ({
    EncryptedBlob: {
        encode: () => ({
            finish: () => new Uint8Array([mockState.sourceVersion]),
        }),
    },
}));

jest.mock("../../src/utils/atoms", () => {
    return {
        unlockedVaultAtom: mockUnlockedVaultAtom,
        unlockedVaultMetadataAtom: mockUnlockedVaultMetadataAtom,
        vaultStore: {
            get: vaultStoreGetMock,
        },
    };
});

jest.mock("../../src/utils/vault-session", () => ({
    getVaultDEKFromSession: () => ({
        isErr: () => false,
        value: {},
    }),
}));

jest.mock("../../src/utils/logging", () => ({
    vaultLog: { error: jest.fn() },
}));

jest.mock("../../src/utils/trpc", () => ({
    createAccountBoundTrpcClient: createAccountBoundTrpcClientMock,
}));

jest.mock("../../src/app_lib/managed-backups", () => ({
    createEncryptedBackupBytes: createEncryptedBackupBytesMock,
    deleteManagedBackupHistoryBefore: deleteManagedBackupHistoryBeforeMock,
    sha256Base64Url: sha256Base64UrlMock,
    uploadEncryptedBackup: uploadEncryptedBackupMock,
}));

jest.mock("../../src/app_lib/managed-backup-hooks", () => ({
    registerManagedBackupHooks: jest.fn(),
}));

import { managedBackupCoordinator } from "../../src/app_lib/managed-backup-coordinator";
import { ManagedBackupError } from "../../src/app_lib/managed-backup-errors";

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

async function expectUploadCalls(count: number): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        if (uploadEncryptedBackupMock.mock.calls.length === count) return;
        await Promise.resolve();
    }
    expect(uploadEncryptedBackupMock).toHaveBeenCalledTimes(count);
}

describe("managed backup coordinator", () => {
    beforeEach(() => {
        let uuid = 0;
        Object.defineProperty(globalThis.crypto, "randomUUID", {
            configurable: true,
            value: jest.fn(() => `upload-key-${++uuid}`),
        });
        managedBackupCoordinator.stop();
        localStorage.clear();
        jest.clearAllMocks();
        uploadEncryptedBackupMock.mockReset();
        deleteManagedBackupHistoryBeforeMock.mockReset();
        deleteManagedBackupHistoryBeforeMock.mockResolvedValue(undefined);
        mockState.sourceVersion = 1;
        mockState.vaultId = "vault-a";
        mockState.deviceId = "device-a";
        vaultStoreGetMock.mockImplementation((atom) =>
            atom === mockUnlockedVaultMetadataAtom
                ? { Blob: { Envelope: { VaultID: mockState.vaultId } } }
                : {
                      OnlineServices: {
                          DeviceId: mockState.deviceId,
                      },
                  },
        );
    });

    it("uploads the latest dirty state before the pre-lock flush resolves", async () => {
        const firstUpload = deferred<unknown>();
        uploadEncryptedBackupMock
            .mockReturnValueOnce(firstUpload.promise)
            .mockResolvedValueOnce({});
        managedBackupCoordinator.setEnabled(true);

        const initialBackup = managedBackupCoordinator.backupNow();
        await expectUploadCalls(1);

        mockState.sourceVersion = 2;
        managedBackupCoordinator.markDirty();
        const preLockFlush = managedBackupCoordinator.flushBeforeLock(1_000);

        firstUpload.resolve({});
        await initialBackup;
        await preLockFlush;
        managedBackupCoordinator.stop();

        expect(uploadEncryptedBackupMock).toHaveBeenCalledTimes(2);
        expect(uploadEncryptedBackupMock).toHaveBeenLastCalledWith(
            new Uint8Array([2]),
            expect.any(String),
            accountBoundClient,
        );
        expect(uploadEncryptedBackupMock.mock.calls[1]?.[1]).not.toBe(
            uploadEncryptedBackupMock.mock.calls[0]?.[1],
        );
    });

    it("skips the pre-lock upload when nothing changed since the last one", async () => {
        uploadEncryptedBackupMock.mockResolvedValue({});
        managedBackupCoordinator.setEnabled(true);
        await managedBackupCoordinator.backupNow();

        // The lock's save re-encrypts the unchanged vault.
        mockState.sourceVersion = 2;
        await managedBackupCoordinator.flushBeforeLock(1_000);

        expect(uploadEncryptedBackupMock).toHaveBeenCalledTimes(1);
        expect(
            localStorage.getItem("cryptex:managed-backup-source:vault-a"),
        ).toBe("hash-2");
    });

    it("stores the lock's hash after waiting for an upload in progress", async () => {
        const upload = deferred<unknown>();
        uploadEncryptedBackupMock.mockReturnValueOnce(upload.promise);
        managedBackupCoordinator.setEnabled(true);
        const pending = managedBackupCoordinator.backupNow();
        await expectUploadCalls(1);

        mockState.sourceVersion = 2;
        const locking = managedBackupCoordinator.flushBeforeLock(1_000);
        upload.resolve({});
        await pending;
        await locking;

        expect(uploadEncryptedBackupMock).toHaveBeenCalledTimes(1);
        expect(
            localStorage.getItem("cryptex:managed-backup-source:vault-a"),
        ).toBe("hash-2");
    });

    it("does not store the lock's hash while start is still checking the vault", async () => {
        localStorage.setItem("cryptex:managed-backup-source:vault-a", "hash-0");
        const startHash = deferred<string>();
        sha256Base64UrlMock.mockReturnValueOnce(startHash.promise);
        const starting = managedBackupCoordinator.start();
        for (let i = 0; i < 10 && !sha256Base64UrlMock.mock.calls.length; i++) {
            await Promise.resolve();
        }

        await managedBackupCoordinator.flushBeforeLock(1_000);
        managedBackupCoordinator.stop();
        startHash.resolve("hash-1");
        await starting;

        expect(
            localStorage.getItem("cryptex:managed-backup-source:vault-a"),
        ).toBe("hash-0");
    });

    it("keeps a vault write made while start is still checking the vault", async () => {
        localStorage.setItem("cryptex:managed-backup-source:vault-a", "hash-1");
        const startHash = deferred<string>();
        sha256Base64UrlMock.mockReturnValueOnce(startHash.promise);
        uploadEncryptedBackupMock.mockResolvedValue({});
        const starting = managedBackupCoordinator.start();
        for (let i = 0; i < 10 && !sha256Base64UrlMock.mock.calls.length; i++) {
            await Promise.resolve();
        }

        managedBackupCoordinator.markDirty();
        startHash.resolve("hash-1");
        await starting;
        await managedBackupCoordinator.flushBeforeLock(1_000);

        expect(uploadEncryptedBackupMock).toHaveBeenCalledTimes(1);
    });

    it("does not let an older status check undo enabling backups", async () => {
        const status = deferred<{ enabled: boolean; entitled: boolean }>();
        backupStatusQueryMock.mockReturnValueOnce(status.promise);
        uploadEncryptedBackupMock.mockResolvedValue({});

        const starting = managedBackupCoordinator.start();
        managedBackupCoordinator.setEnabled(true);
        status.resolve({ enabled: false, entitled: true });
        await starting;

        await expect(managedBackupCoordinator.backupNow()).resolves.toBe(
            undefined,
        );
    });

    it("keeps an upload in progress when a session refresh calls start again", async () => {
        const upload = deferred<unknown>();
        uploadEncryptedBackupMock.mockReturnValueOnce(upload.promise);
        managedBackupCoordinator.setEnabled(true);
        const pending = managedBackupCoordinator.backupNow();
        await expectUploadCalls(1);

        await managedBackupCoordinator.start();
        upload.resolve({});
        await pending;

        expect(backupStatusQueryMock).not.toHaveBeenCalled();
        expect(uploadEncryptedBackupMock).toHaveBeenCalledTimes(1);
        expect(
            localStorage.getItem("cryptex:managed-backup-source:vault-a"),
        ).toBe("hash-1");
    });

    it("uploads an unscheduled change only when the vault locks", async () => {
        jest.useFakeTimers();
        try {
            const upload = deferred<unknown>();
            uploadEncryptedBackupMock
                .mockReturnValueOnce(upload.promise)
                .mockResolvedValue({});
            managedBackupCoordinator.setEnabled(true);
            const pending = managedBackupCoordinator.backupNow();
            await expectUploadCalls(1);

            mockState.sourceVersion = 2;
            managedBackupCoordinator.markDirty(false);
            upload.resolve({});
            await pending;
            await jest.advanceTimersByTimeAsync(60_000);
            expect(uploadEncryptedBackupMock).toHaveBeenCalledTimes(1);

            await managedBackupCoordinator.flushBeforeLock(1_000);
            expect(uploadEncryptedBackupMock).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    it("does not publish or purge an upload after its vault lifecycle stops", async () => {
        const oldUpload = deferred<unknown>();
        uploadEncryptedBackupMock.mockReturnValueOnce(oldUpload.promise);
        managedBackupCoordinator.setEnabled(true);

        const pending = managedBackupCoordinator.backupNow(true);
        await expectUploadCalls(1);

        managedBackupCoordinator.stop();
        mockState.vaultId = "vault-b";
        mockState.deviceId = "device-b";
        mockState.sourceVersion = 2;
        oldUpload.resolve({
            id: "stale-replacement",
            createdAt: replacementCreatedAt,
        });
        await pending;
        managedBackupCoordinator.stop();

        expect(
            localStorage.getItem("cryptex:managed-backup-source:vault-a"),
        ).toBeNull();
        expect(
            localStorage.getItem("cryptex:managed-backup-source:vault-b"),
        ).toBeNull();
        expect(deleteManagedBackupHistoryBeforeMock).not.toHaveBeenCalled();
    });

    it("reuses the idempotency key when the same encrypted state is retried", async () => {
        uploadEncryptedBackupMock
            .mockRejectedValueOnce(
                new ManagedBackupError("BACKUP_UPLOAD_NETWORK"),
            )
            .mockResolvedValueOnce({});
        managedBackupCoordinator.setEnabled(true);

        await expect(
            managedBackupCoordinator.backupNow(),
        ).rejects.toMatchObject({ code: "BACKUP_UPLOAD_NETWORK" });
        await managedBackupCoordinator.backupNow();
        managedBackupCoordinator.stop();

        const firstKey = uploadEncryptedBackupMock.mock.calls[0]?.[1];
        const secondKey = uploadEncryptedBackupMock.mock.calls[1]?.[1];
        expect(firstKey).toEqual(expect.any(String));
        expect(secondKey).toBe(firstKey);
        expect(createEncryptedBackupBytesMock).toHaveBeenCalledTimes(1);
    });

    it("deletes older history only after the replacement upload succeeds", async () => {
        uploadEncryptedBackupMock.mockResolvedValue({
            id: "replacement",
            createdAt: replacementCreatedAt,
        });
        managedBackupCoordinator.setEnabled(true);

        await managedBackupCoordinator.backupNow(true);
        managedBackupCoordinator.stop();

        expect(uploadEncryptedBackupMock).toHaveBeenCalledTimes(1);
        expect(deleteManagedBackupHistoryBeforeMock).toHaveBeenCalledWith(
            {
                id: "replacement",
                createdAt: replacementCreatedAt,
            },
            accountBoundClient,
        );
        expect(
            uploadEncryptedBackupMock.mock.invocationCallOrder[0],
        ).toBeLessThan(
            deleteManagedBackupHistoryBeforeMock.mock.invocationCallOrder[0]!,
        );
    });

    it("does not let a pre-change upload consume the history deletion request", async () => {
        const oldUpload = deferred<unknown>();
        uploadEncryptedBackupMock
            .mockReturnValueOnce(oldUpload.promise)
            .mockResolvedValueOnce({
                id: "replacement",
                createdAt: replacementCreatedAt,
            });
        managedBackupCoordinator.setEnabled(true);

        const pendingOldBackup = managedBackupCoordinator.backupNow();
        await expectUploadCalls(1);

        mockState.sourceVersion = 2;
        const pendingReplacement = managedBackupCoordinator.backupNow(true);
        await Promise.resolve();
        expect(deleteManagedBackupHistoryBeforeMock).not.toHaveBeenCalled();

        oldUpload.resolve({ id: "pre-change" });
        await pendingOldBackup;
        await pendingReplacement;
        managedBackupCoordinator.stop();

        expect(uploadEncryptedBackupMock).toHaveBeenCalledTimes(2);
        expect(deleteManagedBackupHistoryBeforeMock).toHaveBeenCalledTimes(1);
        expect(deleteManagedBackupHistoryBeforeMock).toHaveBeenCalledWith(
            {
                id: "replacement",
                createdAt: replacementCreatedAt,
            },
            accountBoundClient,
        );
    });

    it("retries history deletion without uploading a second replacement", async () => {
        uploadEncryptedBackupMock.mockResolvedValue({
            id: "replacement",
            createdAt: replacementCreatedAt,
        });
        deleteManagedBackupHistoryBeforeMock
            .mockRejectedValueOnce(new Error("delete failed"))
            .mockResolvedValueOnce(undefined);
        managedBackupCoordinator.setEnabled(true);

        await expect(
            managedBackupCoordinator.backupNow(true),
        ).rejects.toMatchObject({ code: "BACKUP_HISTORY_DELETE_FAILED" });
        await managedBackupCoordinator.backupNow();
        managedBackupCoordinator.stop();

        expect(uploadEncryptedBackupMock).toHaveBeenCalledTimes(1);
        expect(deleteManagedBackupHistoryBeforeMock).toHaveBeenCalledTimes(2);
        expect(deleteManagedBackupHistoryBeforeMock).toHaveBeenNthCalledWith(
            2,
            { id: "replacement", createdAt: replacementCreatedAt },
            accountBoundClient,
        );
    });

    it("uploads newer vault data before retrying a failed history purge", async () => {
        uploadEncryptedBackupMock
            .mockResolvedValueOnce({
                id: "replacement-a",
                createdAt: replacementCreatedAt,
            })
            .mockResolvedValueOnce({
                id: "replacement-b",
                createdAt: new Date(replacementCreatedAt.getTime() + 1_000),
            });
        deleteManagedBackupHistoryBeforeMock
            .mockRejectedValueOnce(new Error("delete failed"))
            .mockResolvedValueOnce(undefined);
        managedBackupCoordinator.setEnabled(true);

        await expect(
            managedBackupCoordinator.backupNow(true),
        ).rejects.toMatchObject({ code: "BACKUP_HISTORY_DELETE_FAILED" });

        mockState.sourceVersion = 2;
        await managedBackupCoordinator.backupNow();
        managedBackupCoordinator.stop();

        expect(uploadEncryptedBackupMock).toHaveBeenCalledTimes(2);
        expect(uploadEncryptedBackupMock).toHaveBeenLastCalledWith(
            new Uint8Array([2]),
            expect.any(String),
            accountBoundClient,
        );
        expect(deleteManagedBackupHistoryBeforeMock).toHaveBeenNthCalledWith(
            2,
            {
                id: "replacement-b",
                createdAt: new Date(replacementCreatedAt.getTime() + 1_000),
            },
            accountBoundClient,
        );
    });

    it("does not let a stale start re-enable a stopped coordinator", async () => {
        const status = deferred<{ enabled: boolean; entitled: boolean }>();
        backupStatusQueryMock.mockReturnValueOnce(status.promise);

        const starting = managedBackupCoordinator.start();
        managedBackupCoordinator.stop();
        status.resolve({ enabled: true, entitled: true });
        await starting;

        await expect(
            managedBackupCoordinator.backupNow(),
        ).rejects.toMatchObject({ code: "BACKUP_NOT_ENABLED" });
    });
});
