import { beforeEach, expect, it, jest } from "@jest/globals";
import * as FileSystem from "expo-file-system/legacy";
import {
    downloadBackupBytes,
    downloadRecoveryBackupBytes,
    sha256Base64Url,
} from "@/app_lib/managed-backups";
import {
    deleteAppOwnedTempFile,
    writeSecretTempFile,
} from "@/utils/secret-temp-files";
import { trpc } from "@/utils/trpc";

jest.mock("@/app_lib/vault-utils/storage", () => ({}));
jest.mock("@/utils/online-services-transport", () => ({}));
jest.mock("expo-file-system/legacy", () => ({
    EncodingType: { Base64: "base64" },
    createDownloadResumable: jest.fn(),
    getInfoAsync: jest.fn(),
    readAsStringAsync: jest.fn(),
}));
jest.mock("@/utils/secret-temp-files", () => ({
    writeSecretTempFile: jest.fn(),
    deleteAppOwnedTempFile: jest.fn(),
}));
jest.mock("@/utils/trpc", () => ({
    trpc: {
        v1: {
            backup: {
                createDownload: { query: jest.fn() },
                recoveryDownload: { mutate: jest.fn() },
            },
        },
    },
}));

const uri = "file:///cache/secret-temp/test.cryx";
const bytes = new Uint8Array([0, 128, 255, 1]);
const pauseAsync = jest.fn<() => Promise<void>>();
const cancelAsync = jest.fn<() => Promise<void>>();
const downloadAsync =
    jest.fn<() => Promise<FileSystem.FileSystemDownloadResult | undefined>>();
let intent: Awaited<ReturnType<typeof trpc.v1.backup.createDownload.query>>;

beforeEach(async () => {
    jest.useRealTimers();
    intent = {
        snapshot: {
            id: "snapshot",
            createdAt: new Date(),
            readyAt: new Date(),
            sourceLabel: "Root device",
            byteLength: bytes.byteLength,
            checksumSha256: await sha256Base64Url(bytes),
        },
        transfer: {
            url: "https://storage.example/backup",
            headers: { "x-test": "value" },
            expiresAt: new Date(),
        },
    };
    jest.mocked(trpc.v1.backup.createDownload.query).mockResolvedValue(intent);
    jest.mocked(trpc.v1.backup.recoveryDownload.mutate).mockResolvedValue(
        intent,
    );
    jest.mocked(writeSecretTempFile).mockResolvedValue(uri);
    jest.mocked(deleteAppOwnedTempFile).mockResolvedValue(undefined);
    jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({
        exists: true,
        isDirectory: false,
        size: bytes.byteLength,
        uri,
        modificationTime: 0,
    });
    jest.mocked(FileSystem.readAsStringAsync).mockResolvedValue(
        Buffer.from(bytes).toString("base64"),
    );
    pauseAsync.mockResolvedValue(undefined);
    cancelAsync.mockResolvedValue(undefined);
    downloadAsync.mockResolvedValue({
        uri,
        status: 200,
        headers: {},
        mimeType: "application/octet-stream",
    });
    jest.mocked(FileSystem.createDownloadResumable).mockReturnValue({
        downloadAsync,
        cancelAsync,
        pauseAsync,
    } as unknown as FileSystem.DownloadResumable);
});

it.each(["account", "recovery"])(
    "verifies %s backup bytes using native storage before decoding",
    async (kind) => {
        const result =
            kind === "account"
                ? await downloadBackupBytes("snapshot")
                : await downloadRecoveryBackupBytes(
                      "recovery-token",
                      "snapshot",
                  );
        expect(result).toEqual({ snapshot: intent.snapshot, bytes });
        expect(FileSystem.createDownloadResumable).toHaveBeenCalledWith(
            intent.transfer.url,
            uri,
            { headers: intent.transfer.headers },
            expect.any(Function),
        );
        const statOrder = jest.mocked(FileSystem.getInfoAsync).mock
            .invocationCallOrder[0];
        const readOrder = jest.mocked(FileSystem.readAsStringAsync).mock
            .invocationCallOrder[0];
        expect(statOrder).toBeLessThan(readOrder ?? 0);
        expect(deleteAppOwnedTempFile).toHaveBeenCalledWith(uri);
    },
);

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid declared size %s before starting a transfer",
    async (size) => {
        intent.snapshot.byteLength = size;
        await expect(downloadBackupBytes("snapshot")).rejects.toThrow(
            "integrity",
        );
        expect(writeSecretTempFile).not.toHaveBeenCalled();
        expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
    },
);

it.each([
    { totalBytesWritten: 1, totalBytesExpectedToWrite: 5 },
    { totalBytesWritten: 5, totalBytesExpectedToWrite: -1 },
])(
    "cancels an oversized response before decoding, including missing content length",
    async (progress) => {
        downloadAsync.mockImplementation(async () => {
            const callback = jest.mocked(FileSystem.createDownloadResumable)
                .mock.calls[0]?.[3];
            if (!callback)
                throw new Error("Download progress callback is missing");
            callback(progress);
            return undefined;
        });
        await expect(downloadBackupBytes("snapshot")).rejects.toThrow(
            "integrity",
        );
        expect(pauseAsync).toHaveBeenCalled();
        expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
        expect(deleteAppOwnedTempFile).toHaveBeenCalledWith(uri);
    },
);

it.each([3, 5])(
    "rejects completed file size %s before allocating JavaScript bytes",
    async (size) => {
        jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({
            exists: true,
            isDirectory: false,
            size,
            uri,
            modificationTime: 0,
        });
        await expect(downloadBackupBytes("snapshot")).rejects.toThrow(
            "integrity",
        );
        expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
        expect(deleteAppOwnedTempFile).toHaveBeenCalledWith(uri);
    },
);

it("rejects checksum mismatches and removes the native file", async () => {
    intent.snapshot.checksumSha256 = "A".repeat(43);
    await expect(downloadBackupBytes("snapshot")).rejects.toThrow("integrity");
    expect(deleteAppOwnedTempFile).toHaveBeenCalledWith(uri);
});

it("rejects HTTP errors before decoding their response body", async () => {
    downloadAsync.mockResolvedValue({
        uri,
        status: 403,
        headers: {},
        mimeType: "application/octet-stream",
    });
    await expect(downloadBackupBytes("snapshot")).rejects.toThrow("403");
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
    expect(deleteAppOwnedTempFile).toHaveBeenCalledWith(uri);
});

it("removes a partially downloaded file on native transfer failure", async () => {
    downloadAsync.mockRejectedValue(new Error("network unavailable"));
    await expect(downloadBackupBytes("snapshot")).rejects.toThrow(
        "network unavailable",
    );
    expect(pauseAsync).toHaveBeenCalled();
    expect(deleteAppOwnedTempFile).toHaveBeenCalledWith(uri);
});

it("cancels a timed out transfer and waits for it to stop before deleting its file", async () => {
    jest.useFakeTimers();
    let finish: ((value: undefined) => void) | undefined;
    downloadAsync.mockImplementation(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    pauseAsync.mockImplementation(async () => {
        finish?.(undefined);
    });
    const result = downloadBackupBytes("snapshot");
    await Promise.all([
        expect(result).rejects.toThrow("timed out"),
        jest.advanceTimersByTimeAsync(15_000),
    ]);
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
    expect(deleteAppOwnedTempFile).toHaveBeenCalledWith(uri);
    jest.useRealTimers();
});
