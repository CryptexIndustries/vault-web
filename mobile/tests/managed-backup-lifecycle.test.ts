import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { EncryptedBlob } from "@cryptex-industries/vault-core/proto";
import { ManagedBackupCoordinator } from "@/app_lib/managed-backup-coordinator";
import {
    createEncryptedBackupBytes,
    deleteManagedBackupHistoryBefore,
    sha256Base64Url,
    uploadEncryptedBackup,
} from "@/app_lib/managed-backups";
import { trpc } from "@/utils/trpc";

const mockState = {
    vault: { OnlineServices: { DeviceId: "device-1" } },
    metadata: { Blob: EncryptedBlob.decode(new Uint8Array()) },
};

jest.mock("@react-native-async-storage/async-storage", () => ({
    getItem: jest.fn(async () => null),
    setItem: jest.fn(),
}));
jest.mock("@/utils/trpc", () => ({
    trpc: { v1: { backup: { status: { query: jest.fn() } } } },
}));
jest.mock("@/utils/atoms", () => ({
    unlockedVaultAtom: "vault",
    unlockedVaultMetadataAtom: "metadata",
    vaultStore: {
        get: (atom: string) =>
            atom === "vault" ? mockState.vault : mockState.metadata,
    },
}));
jest.mock("@/utils/vault-session", () => ({
    getVaultSessionGeneration: () => 1,
    getVaultDEKFromSession: () => ({
        isErr: () => false,
        value: {} as CryptoKey,
    }),
}));
jest.mock("@/utils/online-services-api-url", () => ({
    isCloudServicesEnabled: () => true,
}));
jest.mock("@cryptex-industries/vault-core/vault-utils/vault", () => ({
    Vault: { isOnlineServicesBound: () => true },
}));
jest.mock("@/app_lib/managed-backups", () => ({
    createEncryptedBackupBytes: jest.fn(),
    deleteManagedBackupHistoryBefore: jest.fn(),
    sha256Base64Url: jest.fn(),
    uploadEncryptedBackup: jest.fn(),
}));

beforeEach(() => {
    jest.useFakeTimers();
    mockState.vault = { OnlineServices: { DeviceId: "device-1" } };
    mockState.metadata = {
        Blob: EncryptedBlob.decode(new Uint8Array()),
    };
    jest.mocked(createEncryptedBackupBytes).mockResolvedValue(
        new Uint8Array([1, 2, 3]),
    );
    jest.mocked(sha256Base64Url).mockResolvedValue("source-hash");
    jest.mocked(uploadEncryptedBackup).mockResolvedValue({
        id: "snapshot-1",
        createdAt: new Date("2026-09-21T12:00:00.000Z"),
    } as never);
    jest.mocked(deleteManagedBackupHistoryBefore).mockResolvedValue(undefined);
});
afterEach(() => {
    jest.useRealTimers();
});

it("cannot enable backups when status arrives after stop", async () => {
    let resolve!: (value: unknown) => void;
    jest.mocked(trpc.v1.backup.status.query).mockImplementation(
        () =>
            new Promise((r) => {
                resolve = r;
            }) as never,
    );
    const coordinator = new ManagedBackupCoordinator();
    const start = coordinator.start();
    coordinator.stop();
    resolve({ enabled: true, entitled: true });
    await start;
    await expect(coordinator.backupNow()).rejects.toThrow("not enabled");
    expect(jest.getTimerCount()).toBe(0);
});

it("retries a failed debounced backup and clears the retry on stop", async () => {
    jest.mocked(uploadEncryptedBackup).mockRejectedValueOnce(
        new Error("upload failed"),
    );
    const coordinator = new ManagedBackupCoordinator();
    coordinator.setEnabled(true);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(jest.getTimerCount()).toBe(1);
    coordinator.stop();
    expect(jest.getTimerCount()).toBe(0);
});

it("cleans lock flush timers and cancels backup work", async () => {
    const coordinator = new ManagedBackupCoordinator();
    coordinator.setEnabled(true);
    await coordinator.flushBeforeLock();
    expect(jest.getTimerCount()).toBe(0);
    await expect(coordinator.backupNow()).rejects.toThrow("not enabled");
});

it("waits for a pre-change upload and then uploads the latest dirty state", async () => {
    let resolveFirstUpload!: (value: unknown) => void;
    let reportFirstUploadStarted!: () => void;
    const firstUploadStarted = new Promise<void>((resolve) => {
        reportFirstUploadStarted = resolve;
    });
    jest.mocked(uploadEncryptedBackup)
        .mockImplementationOnce(() => {
            reportFirstUploadStarted();
            return new Promise((resolve) => {
                resolveFirstUpload = resolve;
            }) as never;
        })
        .mockResolvedValueOnce({
            id: "snapshot-2",
            createdAt: new Date("2026-09-21T12:01:00.000Z"),
        } as never);

    const coordinator = new ManagedBackupCoordinator();
    coordinator.setEnabled(true);
    const firstBackup = coordinator.backupNow();
    await firstUploadStarted;

    const replacementBackup = coordinator.backupNow();
    resolveFirstUpload({
        id: "snapshot-1",
        createdAt: new Date("2026-09-21T12:00:00.000Z"),
    });
    await Promise.all([firstBackup, replacementBackup]);

    expect(uploadEncryptedBackup).toHaveBeenCalledTimes(2);
    coordinator.stop();
});

it("reuses encrypted bytes and the idempotency key when an upload is retried", async () => {
    jest.mocked(uploadEncryptedBackup)
        .mockRejectedValueOnce(new Error("upload failed"))
        .mockResolvedValueOnce({
            id: "snapshot-1",
            createdAt: new Date("2026-09-21T12:00:00.000Z"),
        } as never);

    const coordinator = new ManagedBackupCoordinator();
    coordinator.setEnabled(true);
    await expect(coordinator.backupNow()).rejects.toThrow("upload failed");
    const [firstBytes, firstIdempotencyKey] = jest.mocked(uploadEncryptedBackup)
        .mock.calls[0]!;

    await coordinator.backupNow();
    const [secondBytes, secondIdempotencyKey] = jest.mocked(
        uploadEncryptedBackup,
    ).mock.calls[1]!;

    expect(createEncryptedBackupBytes).toHaveBeenCalledTimes(1);
    expect(secondBytes).toBe(firstBytes);
    expect(secondIdempotencyKey).toBe(firstIdempotencyKey);
    coordinator.stop();
});
