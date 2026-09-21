/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { webcrypto } from "node:crypto";

const statusQueryMock = jest.fn();
const createUploadMock = jest.fn();
const completeUploadMock = jest.fn();
const listMock = jest.fn();
const deleteMock = jest.fn();
const createEncryptedBackupBytesMock = jest.fn();
const alarmCreateMock = jest.fn(async () => undefined);

const directClient = {
    v1: {
        backup: {
            status: { query: statusQueryMock },
            createUpload: { mutate: createUploadMock },
            completeUpload: { mutate: completeUploadMock },
            list: { query: listMock },
            delete: { mutate: deleteMock },
        },
    },
};
const mockCreateDirectClient = jest.fn(() => directClient);

jest.mock("../src/app_lib/auth-session-ext", () => ({
    createDirectOnlineServicesTrpcClient: mockCreateDirectClient,
}));

jest.mock("../src/background/backup-service", () => ({
    createEncryptedBackupBytes: createEncryptedBackupBytesMock,
}));

const sessionValues: Record<string, unknown> = {};
Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
        storage: {
            session: {
                async set(values: Record<string, unknown>) {
                    Object.assign(sessionValues, values);
                },
                async get(key: string) {
                    return { [key]: sessionValues[key] };
                },
            },
        },
        alarms: { create: alarmCreateMock },
    },
});

Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
        ...webcrypto,
        subtle: webcrypto.subtle,
        randomUUID: jest.fn(() => "11111111-1111-4111-8111-111111111111"),
    },
});

const fetchMock = jest.fn(async () => new Response(null, { status: 200 }));
Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchMock,
});

import {
    getLatestSecurityBackupJobId,
    getSecurityBackupJob,
    queueSecurityManagedBackup,
    runSecurityManagedBackup,
    SECURITY_BACKUP_ALARM_PREFIX,
} from "../src/background/security-backup-job";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_JOB_ID = "22222222-2222-4222-8222-222222222222";
const DEVICE_ID = "device-1";
const VAULT_ID = "vault-id";
const replacementCreatedAt = new Date("2026-09-17T10:00:00.000Z");
const olderCreatedAt = new Date("2026-09-16T10:00:00.000Z");
const newerCreatedAt = new Date("2026-09-18T10:00:00.000Z");

describe("extension security managed-backup jobs", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        for (const key of Object.keys(sessionValues)) delete sessionValues[key];
        statusQueryMock.mockResolvedValue({ enabled: true, entitled: true });
        createEncryptedBackupBytesMock.mockResolvedValue({
            ok: true,
            backup: {
                bytes: new Uint8Array([1, 2, 3]),
                vaultId: "vault-id",
                source: new Uint8Array([4]),
            },
        });
        createUploadMock.mockResolvedValue({
            snapshotId: "replacement",
            transfer: { url: "https://upload.invalid", headers: {} },
        });
        completeUploadMock.mockResolvedValue({
            id: "replacement",
            createdAt: replacementCreatedAt,
        });
        listMock.mockResolvedValue({
            items: [
                { id: "old", createdAt: olderCreatedAt },
                { id: "replacement", createdAt: replacementCreatedAt },
                { id: "newer", createdAt: newerCreatedAt },
            ],
            nextCursor: null,
        });
        deleteMock.mockResolvedValue(undefined);
        fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    });

    it("queues work in an alarm so the mutation response is not blocked", async () => {
        await expect(
            queueSecurityManagedBackup(true, DEVICE_ID, VAULT_ID),
        ).resolves.toBe(JOB_ID);

        expect(alarmCreateMock).toHaveBeenCalledWith(
            `${SECURITY_BACKUP_ALARM_PREFIX}${JOB_ID}`,
            expect.objectContaining({ when: expect.any(Number) }),
        );
        await expect(getSecurityBackupJob(JOB_ID)).resolves.toMatchObject({
            id: JOB_ID,
            status: "queued",
            deleteOlderSnapshots: true,
            onlineServicesDeviceId: DEVICE_ID,
            vaultId: VAULT_ID,
        });
        await expect(getLatestSecurityBackupJobId(VAULT_ID)).resolves.toBe(
            JOB_ID,
        );
        await expect(
            getLatestSecurityBackupJobId("another-vault"),
        ).resolves.toBeUndefined();
    });

    it("records an error instead of leaving a queued job when alarm creation fails", async () => {
        alarmCreateMock.mockRejectedValueOnce(new Error("alarms unavailable"));

        await expect(
            queueSecurityManagedBackup(false, DEVICE_ID, VAULT_ID),
        ).rejects.toThrow("alarms unavailable");
        await expect(getSecurityBackupJob(JOB_ID)).resolves.toMatchObject({
            status: "error",
            error: "BACKUP_QUEUE_FAILED",
        });
    });

    it("rejects malformed job records instead of trusting session storage", async () => {
        sessionValues[`SECURITY_BACKUP_JOB:${JOB_ID}`] = {
            id: JOB_ID,
            status: "queued",
            deleteOlderSnapshots: "false",
            onlineServicesDeviceId: DEVICE_ID,
            vaultId: VAULT_ID,
            updatedAt: Date.now(),
        };

        await expect(getSecurityBackupJob(JOB_ID)).resolves.toBeNull();
    });

    it("uploads a replacement before deleting older snapshots", async () => {
        await queueSecurityManagedBackup(true, DEVICE_ID, VAULT_ID);

        await runSecurityManagedBackup({
            jobId: JOB_ID,
            prepareBackup: createEncryptedBackupBytesMock,
        });

        await expect(getSecurityBackupJob(JOB_ID)).resolves.toMatchObject({
            status: "success",
        });
        expect(createEncryptedBackupBytesMock).toHaveBeenCalledWith(
            DEVICE_ID,
            VAULT_ID,
        );
        expect(completeUploadMock).toHaveBeenCalledWith({
            snapshotId: "replacement",
        });
        expect(mockCreateDirectClient).toHaveBeenCalledWith(DEVICE_ID);
        expect(deleteMock).toHaveBeenCalledWith({ snapshotId: "old" });
        expect(deleteMock).not.toHaveBeenCalledWith({
            snapshotId: "replacement",
        });
        expect(deleteMock).not.toHaveBeenCalledWith({ snapshotId: "newer" });
        expect(completeUploadMock.mock.invocationCallOrder[0]).toBeLessThan(
            deleteMock.mock.invocationCallOrder[0]!,
        );
    });

    it("lists every page before deletion so cursor pagination cannot skip history", async () => {
        listMock
            .mockResolvedValueOnce({
                items: [
                    { id: "old-a", createdAt: olderCreatedAt },
                    {
                        id: "replacement",
                        createdAt: replacementCreatedAt,
                    },
                ],
                nextCursor: "page-2",
            })
            .mockResolvedValueOnce({
                items: [
                    {
                        id: "old-b",
                        createdAt: new Date(olderCreatedAt.getTime() + 1_000),
                    },
                ],
                nextCursor: null,
            });
        await queueSecurityManagedBackup(true, DEVICE_ID, VAULT_ID);

        await runSecurityManagedBackup({
            jobId: JOB_ID,
            prepareBackup: createEncryptedBackupBytesMock,
        });

        expect(listMock).toHaveBeenNthCalledWith(2, { cursor: "page-2" });
        expect(deleteMock).toHaveBeenCalledWith({ snapshotId: "old-a" });
        expect(deleteMock).toHaveBeenCalledWith({ snapshotId: "old-b" });
        expect(listMock.mock.invocationCallOrder[1]).toBeLessThan(
            deleteMock.mock.invocationCallOrder[0]!,
        );
    });

    it("records a skipped job when managed backups are not enabled", async () => {
        statusQueryMock.mockResolvedValue({ enabled: false, entitled: true });
        await queueSecurityManagedBackup(false, DEVICE_ID, VAULT_ID);

        await runSecurityManagedBackup({
            jobId: JOB_ID,
            prepareBackup: createEncryptedBackupBytesMock,
        });

        await expect(getSecurityBackupJob(JOB_ID)).resolves.toMatchObject({
            status: "skipped",
        });
        expect(createEncryptedBackupBytesMock).not.toHaveBeenCalled();
    });

    it("reports history deletion separately from a successful upload", async () => {
        deleteMock.mockRejectedValue(new Error("delete failed"));
        await queueSecurityManagedBackup(true, DEVICE_ID, VAULT_ID);

        await runSecurityManagedBackup({
            jobId: JOB_ID,
            prepareBackup: createEncryptedBackupBytesMock,
        });

        await expect(getSecurityBackupJob(JOB_ID)).resolves.toMatchObject({
            status: "error",
            error: "BACKUP_HISTORY_DELETE_FAILED",
        });
        expect(completeUploadMock).toHaveBeenCalledTimes(1);
    });

    it("serializes replacement jobs so purge operations cannot race", async () => {
        sessionValues[`SECURITY_BACKUP_JOB:${JOB_ID}`] = {
            id: JOB_ID,
            status: "queued",
            deleteOlderSnapshots: false,
            onlineServicesDeviceId: DEVICE_ID,
            vaultId: VAULT_ID,
            updatedAt: Date.now(),
        };
        sessionValues[`SECURITY_BACKUP_JOB:${SECOND_JOB_ID}`] = {
            id: SECOND_JOB_ID,
            status: "queued",
            deleteOlderSnapshots: false,
            onlineServicesDeviceId: DEVICE_ID,
            vaultId: VAULT_ID,
            updatedAt: Date.now(),
        };
        const prepared = {
            ok: true as const,
            backup: {
                bytes: new Uint8Array([1, 2, 3]),
                vaultId: "vault-id",
                source: new Uint8Array([4]),
            },
        };
        let finishFirstPreparation!: (value: typeof prepared) => void;
        const firstPreparation = new Promise<typeof prepared>((resolve) => {
            finishFirstPreparation = resolve;
        });
        const prepareFirst = jest.fn(async () => firstPreparation);
        const prepareSecond = jest.fn(async () => prepared);

        const first = runSecurityManagedBackup({
            jobId: JOB_ID,
            prepareBackup: prepareFirst,
        });
        const second = runSecurityManagedBackup({
            jobId: SECOND_JOB_ID,
            prepareBackup: prepareSecond,
        });
        for (
            let attempt = 0;
            attempt < 20 && !prepareFirst.mock.calls.length;
            attempt += 1
        ) {
            await Promise.resolve();
        }

        expect(prepareFirst).toHaveBeenCalledTimes(1);
        expect(prepareSecond).not.toHaveBeenCalled();

        finishFirstPreparation(prepared);
        await Promise.all([first, second]);

        expect(prepareSecond).toHaveBeenCalledTimes(1);
        expect(completeUploadMock).toHaveBeenCalledTimes(2);
    });
});
