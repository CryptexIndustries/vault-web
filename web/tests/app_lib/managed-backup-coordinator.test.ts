/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockState = {
    sourceVersion: 1,
    vaultId: "vault-a",
};
const mockUnlockedVaultAtom = Symbol("unlockedVaultAtom");
const mockUnlockedVaultMetadataAtom = Symbol("unlockedVaultMetadataAtom");
const vaultStoreGetMock = jest.fn<(atom: symbol) => unknown>();

const uploadEncryptedBackupMock =
    jest.fn<(bytes: Uint8Array, idempotencyKey?: string) => Promise<unknown>>();
const createEncryptedBackupBytesMock = jest.fn(
    async () => new Uint8Array([mockState.sourceVersion]),
);

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
    trpc: {
        v1: {
            backup: {
                status: {
                    query: jest.fn(async () => ({
                        enabled: true,
                        entitled: true,
                    })),
                },
            },
        },
    },
}));

jest.mock("../../src/app_lib/managed-backups", () => ({
    createEncryptedBackupBytes: createEncryptedBackupBytesMock,
    sha256Base64Url: jest.fn(async (bytes: Uint8Array) => `hash-${bytes[0]}`),
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
        mockState.sourceVersion = 1;
        mockState.vaultId = "vault-a";
        vaultStoreGetMock.mockImplementation((atom) =>
            atom === mockUnlockedVaultMetadataAtom
                ? { Blob: { Envelope: { VaultID: mockState.vaultId } } }
                : {},
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
        );
        expect(uploadEncryptedBackupMock.mock.calls[1]?.[1]).not.toBe(
            uploadEncryptedBackupMock.mock.calls[0]?.[1],
        );
    });

    it("does not write an old upload marker under a newly opened vault", async () => {
        const oldUpload = deferred<unknown>();
        uploadEncryptedBackupMock.mockReturnValueOnce(oldUpload.promise);
        managedBackupCoordinator.setEnabled(true);

        const pending = managedBackupCoordinator.backupNow();
        await expectUploadCalls(1);

        managedBackupCoordinator.stop();
        mockState.vaultId = "vault-b";
        mockState.sourceVersion = 2;
        oldUpload.resolve({});
        await pending;
        managedBackupCoordinator.stop();

        expect(
            localStorage.getItem("cryptex:managed-backup-source:vault-a"),
        ).toBe("hash-1");
        expect(
            localStorage.getItem("cryptex:managed-backup-source:vault-b"),
        ).toBeNull();
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
});
