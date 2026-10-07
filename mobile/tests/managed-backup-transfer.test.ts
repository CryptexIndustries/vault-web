import { beforeEach, expect, it, jest } from "@jest/globals";
import {
    deleteManagedBackupHistoryBefore,
    uploadEncryptedBackup,
} from "@/app_lib/managed-backups";
import { fetchWithTimeout } from "@/utils/online-services-transport";
import { trpc } from "@/utils/trpc";

jest.mock("@/app_lib/vault-utils/storage", () => ({}));
jest.mock("expo-file-system/legacy", () => ({}));
jest.mock("@/utils/secret-temp-files", () => ({}));
jest.mock("@/utils/online-services-transport", () => ({
    fetchWithTimeout: jest.fn(),
}));
jest.mock("@/utils/trpc", () => ({
    trpc: {
        v1: {
            backup: {
                createUpload: { mutate: jest.fn() },
                completeUpload: { mutate: jest.fn() },
                list: { query: jest.fn() },
                delete: { mutate: jest.fn() },
            },
        },
    },
}));

beforeEach(() => {
    jest.mocked(trpc.v1.backup.createUpload.mutate).mockResolvedValue({
        snapshotId: "snapshot",
        transfer: { url: "https://storage.example/upload", headers: {} },
    } as Awaited<ReturnType<typeof trpc.v1.backup.createUpload.mutate>>);
    jest.mocked(fetchWithTimeout).mockResolvedValue({ ok: true } as Response);
});

it("uploads exact binary bytes without constructing a React Native Blob", async () => {
    const bytes = new Uint8Array([0, 128, 255, 1]);
    await uploadEncryptedBackup(bytes, "00000000-0000-4000-8000-000000000001");
    expect(fetchWithTimeout).toHaveBeenCalledWith(
        "https://storage.example/upload",
        expect.objectContaining({
            method: "PUT",
            body: bytes,
            headers: { "Content-Type": "application/octet-stream" },
        }),
    );
    expect(
        jest.mocked(fetchWithTimeout).mock.calls[0]?.[1]?.body,
    ).toBeInstanceOf(Uint8Array);
    expect(trpc.v1.backup.completeUpload.mutate).toHaveBeenCalledWith(
        { snapshotId: "snapshot" },
        expect.anything(),
    );
});

it("does not complete an upload after cancellation", async () => {
    const controller = new AbortController();
    jest.mocked(fetchWithTimeout).mockImplementation(async () => {
        controller.abort();
        return { ok: true } as Response;
    });
    await expect(
        uploadEncryptedBackup(
            new Uint8Array([1]),
            "00000000-0000-4000-8000-000000000001",
            {
                signal: controller.signal,
                assertActive: () => {
                    if (controller.signal.aborted) throw new Error("cancelled");
                },
            },
        ),
    ).rejects.toThrow("cancelled");
    expect(trpc.v1.backup.completeUpload.mutate).not.toHaveBeenCalled();
});

it("deletes only snapshots older than a completed replacement", async () => {
    const replacement = {
        id: "replacement",
        createdAt: new Date("2026-09-21T12:00:00.000Z"),
    };
    jest.mocked(trpc.v1.backup.list.query)
        .mockResolvedValueOnce({
            items: [
                replacement,
                {
                    id: "newer",
                    createdAt: new Date("2026-09-21T13:00:00.000Z"),
                },
            ],
            nextCursor: "next-page",
        } as never)
        .mockResolvedValueOnce({
            items: [
                {
                    id: "older",
                    createdAt: new Date("2026-09-20T12:00:00.000Z"),
                },
            ],
            nextCursor: undefined,
        } as never);

    await deleteManagedBackupHistoryBefore(replacement);

    expect(trpc.v1.backup.list.query).toHaveBeenNthCalledWith(
        2,
        { cursor: "next-page" },
        expect.anything(),
    );
    expect(trpc.v1.backup.delete.mutate).toHaveBeenCalledTimes(1);
    expect(trpc.v1.backup.delete.mutate).toHaveBeenCalledWith(
        { snapshotId: "older" },
        expect.anything(),
    );
});
