/**
 * @jest-environment jsdom
 */
import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import {
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";

type Snapshot = {
    id: string;
    createdAt: Date;
    readyAt: Date | null;
    byteLength: number;
    checksumSha256: string;
    sourceLabel: "Root device" | "Linked device" | "Removed device";
};

type Transfer = {
    url: string;
    headers: Record<string, string>;
};

const createUploadMock =
    jest.fn<
        (input: {
            byteLength: number;
            checksumSha256: string;
            idempotencyKey: string;
        }) => Promise<{ snapshotId: string; transfer: Transfer }>
    >();
const completeUploadMock =
    jest.fn<(input: { snapshotId: string }) => Promise<Snapshot>>();
const recoveryDownloadMock =
    jest.fn<
        (input: {
            sessionToken: string;
            snapshotId: string;
        }) => Promise<{ snapshot: Snapshot; transfer: Transfer }>
    >();
const recoveryListMock =
    jest.fn<
        (input: {
            sessionToken: string;
            cursor?: string;
        }) => Promise<{ items: Snapshot[]; nextCursor: string | null }>
    >();
const listMock =
    jest.fn<
        (input?: {
            cursor?: string;
        }) => Promise<{ items: Snapshot[]; nextCursor: string | null }>
    >();
const deleteMock =
    jest.fn<(input: { snapshotId: string }) => Promise<boolean>>();

jest.mock("../../src/utils/trpc", () => ({
    trpc: {
        v1: {
            backup: {
                createUpload: { mutate: createUploadMock },
                completeUpload: { mutate: completeUploadMock },
                list: { query: listMock },
                delete: { mutate: deleteMock },
                recoveryDownload: { mutate: recoveryDownloadMock },
                recoveryList: { mutate: recoveryListMock },
            },
        },
    },
}));

import {
    createBackupRecoverySessionToken,
    deleteManagedBackupHistoryBefore,
    downloadRecoveryBackupBytes,
    listAllRecoverySnapshots,
    recommendNewestSnapshot,
    sha256Base64Url,
    sortSnapshotsNewestFirst,
    uploadEncryptedBackup,
} from "../../src/app_lib/managed-backups";
import {
    ManagedBackupError,
    normalizeManagedBackupError,
} from "../../src/app_lib/managed-backup-errors";

const snapshot = {
    id: "snapshot-1",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    readyAt: new Date("2026-08-01T00:00:01.000Z"),
    byteLength: 3,
    checksumSha256: "",
    sourceLabel: "Root device" as const,
};

describe("managed encrypted backup transfers", () => {
    beforeAll(() => {
        Object.defineProperty(global, "crypto", {
            configurable: true,
            value: webcrypto,
        });
        Object.defineProperty(global, "TextEncoder", {
            configurable: true,
            value: TextEncoder,
        });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("computes the portable SHA-256 base64url checksum", async () => {
        await expect(
            sha256Base64Url(new TextEncoder().encode("abc")),
        ).resolves.toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
    });

    it("uploads only encrypted bytes through the signed transfer", async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const checksumSha256 = await sha256Base64Url(bytes);
        createUploadMock.mockResolvedValue({
            snapshotId: snapshot.id,
            transfer: {
                url: "https://storage.example.test/upload",
                headers: {
                    "content-type": "application/octet-stream",
                    "x-amz-meta-cryptex-sha256": checksumSha256,
                },
            },
        });
        completeUploadMock.mockResolvedValue({
            ...snapshot,
            checksumSha256,
        });
        const fetchMock = jest
            .fn<typeof fetch>()
            .mockResolvedValue({ ok: true } as Response);
        global.fetch = fetchMock;

        await expect(
            uploadEncryptedBackup(bytes, "logical-upload-1"),
        ).resolves.toMatchObject({ id: snapshot.id });
        expect(createUploadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                byteLength: 3,
                checksumSha256,
                idempotencyKey: "logical-upload-1",
            }),
        );
        expect(fetchMock).toHaveBeenCalledWith(
            "https://storage.example.test/upload",
            expect.objectContaining({
                method: "PUT",
                credentials: "omit",
                cache: "no-store",
            }),
        );
        expect(completeUploadMock).toHaveBeenCalledWith({
            snapshotId: snapshot.id,
        });
    });

    it("turns a failed upload fetch into a safe retryable error", async () => {
        createUploadMock.mockResolvedValue({
            snapshotId: snapshot.id,
            transfer: {
                url: "https://storage.example.test/upload?secret=signature",
                headers: {},
            },
        });
        global.fetch = jest
            .fn<typeof fetch>()
            .mockRejectedValue(new TypeError("Failed to fetch"));

        const error = await uploadEncryptedBackup(
            new Uint8Array([1, 2, 3]),
        ).catch((cause: unknown) => cause);

        expect(error).toBeInstanceOf(ManagedBackupError);
        expect(error).toMatchObject({
            code: "BACKUP_UPLOAD_NETWORK",
            retryable: true,
        });
        expect((error as Error).message).not.toContain("secret=signature");
        expect(completeUploadMock).not.toHaveBeenCalled();
    });

    it("reports a rejected upload without retrying a permanent status", async () => {
        createUploadMock.mockResolvedValue({
            snapshotId: snapshot.id,
            transfer: {
                url: "https://storage.example.test/upload",
                headers: {},
            },
        });
        global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
            ok: false,
            status: 403,
        } as Response);

        const error = await uploadEncryptedBackup(
            new Uint8Array([1, 2, 3]),
        ).catch((cause: unknown) => cause);

        expect(error).toMatchObject({
            code: "BACKUP_UPLOAD_REJECTED",
            retryable: false,
            status: 403,
        });
    });

    it("does not retry permanent backup API errors", () => {
        expect(
            normalizeManagedBackupError({
                data: { code: "PAYLOAD_TOO_LARGE" },
            }),
        ).toMatchObject({
            code: "BACKUP_TOO_LARGE",
            retryable: false,
        });
        expect(
            normalizeManagedBackupError({ data: { code: "BAD_REQUEST" } }),
        ).toMatchObject({
            code: "BACKUP_UNAVAILABLE",
            retryable: false,
        });
    });

    it("rejects downloaded ciphertext that does not match server metadata", async () => {
        recoveryDownloadMock.mockResolvedValue({
            snapshot: {
                ...snapshot,
                checksumSha256: await sha256Base64Url(
                    new Uint8Array([1, 2, 3]),
                ),
            },
            transfer: {
                url: "https://storage.example.test/download",
                headers: {},
            },
        });
        global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new Uint8Array([3, 2, 1]).buffer,
        } as Response);

        const error = await downloadRecoveryBackupBytes(
            "session-token-abcdefghijklmnopqrstuvwxyz012345",
            snapshot.id,
        ).catch((cause: unknown) => cause);

        expect(recoveryDownloadMock).toHaveBeenCalledWith({
            sessionToken: "session-token-abcdefghijklmnopqrstuvwxyz012345",
            snapshotId: snapshot.id,
        });
        expect(error).toBeInstanceOf(ManagedBackupError);
        expect(error).toMatchObject({
            code: "BACKUP_INTEGRITY_FAILED",
            retryable: false,
        });
    });

    it("creates a client recovery session token long enough for the contract", () => {
        const token = createBackupRecoverySessionToken();
        expect(token.length).toBeGreaterThanOrEqual(32);
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("recommends and sorts the newest snapshot first", () => {
        const older = {
            id: "old",
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
        };
        const newer = {
            id: "new",
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
        };
        expect(recommendNewestSnapshot([older, newer])?.id).toBe("new");
        expect(
            sortSnapshotsNewestFirst([older, newer]).map((item) => item.id),
        ).toEqual(["new", "old"]);
    });

    it("follows recovery list pagination so eligible snapshots are not hidden", async () => {
        const first = { ...snapshot, id: "snap-1" };
        const second = { ...snapshot, id: "snap-2" };
        recoveryListMock
            .mockResolvedValueOnce({ items: [first], nextCursor: "snap-1" })
            .mockResolvedValueOnce({ items: [second], nextCursor: null });

        await expect(listAllRecoverySnapshots("s".repeat(32))).resolves.toEqual(
            [first, second],
        );
        expect(recoveryListMock).toHaveBeenNthCalledWith(1, {
            sessionToken: "s".repeat(32),
        });
        expect(recoveryListMock).toHaveBeenNthCalledWith(2, {
            sessionToken: "s".repeat(32),
            cursor: "snap-1",
        });
    });

    it("deletes only snapshots older than the completed replacement", async () => {
        const replacement = {
            ...snapshot,
            id: "replacement",
            createdAt: new Date("2026-08-15T00:00:00.000Z"),
        };
        const older = {
            ...snapshot,
            id: "older",
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
        };
        const newer = {
            ...snapshot,
            id: "newer",
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
        };
        const concurrent = {
            ...snapshot,
            id: "same-time",
            createdAt: replacement.createdAt,
        };
        listMock
            .mockResolvedValueOnce({
                items: [replacement, older],
                nextCursor: "page-2",
            })
            .mockResolvedValueOnce({
                items: [newer, concurrent],
                nextCursor: null,
            });
        deleteMock.mockResolvedValue(true);

        await deleteManagedBackupHistoryBefore(replacement);

        expect(listMock).toHaveBeenNthCalledWith(1, undefined);
        expect(listMock).toHaveBeenNthCalledWith(2, { cursor: "page-2" });
        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(deleteMock).toHaveBeenCalledWith({ snapshotId: "older" });
    });
});
