import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as FileSystem from "expo-file-system/legacy";
import {
    deleteAppOwnedTempFile,
    isAppOwnedTempFile,
    purgeSecretTempFiles,
    writeSecretTempFile,
} from "@/utils/secret-temp-files";

jest.mock("expo-file-system/legacy", () => ({
    cacheDirectory: "file:///cache/",
    EncodingType: { UTF8: "utf8", Base64: "base64" },
    makeDirectoryAsync: jest.fn(async () => undefined),
    writeAsStringAsync: jest.fn(async () => undefined),
    deleteAsync: jest.fn(async () => undefined),
}));

beforeEach(() => {
    jest.clearAllMocks();
});

describe("secret temporary files", () => {
    it("only deletes files under the app-owned cache directories", async () => {
        for (const uri of [
            "content://provider/secret",
            "file:///documents/secret",
            "file:///cache/DocumentPicker/../documents/secret",
            "file:///cache/DocumentPicker/%2E%2E%2Fsecret",
            "file:///cache/DocumentPicker/%2e%2e%2fsecret",
            "file:///cache/secret-temp/%252e%252e%252fsecret",
        ]) {
            expect(isAppOwnedTempFile(uri)).toBe(false);
            await deleteAppOwnedTempFile(uri);
        }
        expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
        await deleteAppOwnedTempFile("file:///cache/DocumentPicker/copy.cryx");
        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
            "file:///cache/DocumentPicker/copy.cryx",
            { idempotent: true },
        );
        expect(
            isAppOwnedTempFile("file:///cache/DocumentPicker/copy%20one.cryx"),
        ).toBe(true);
    });

    it("waits for startup purge before creating a new share file", async () => {
        let releasePurge: () => void = () => undefined;
        const delayedPurge = new Promise<void>((resolve) => {
            releasePurge = resolve;
        });
        jest.mocked(FileSystem.deleteAsync).mockImplementationOnce(
            async () => delayedPurge,
        );

        const writing = writeSecretTempFile(
            "json",
            "secret",
            FileSystem.EncodingType.UTF8,
        );
        await Promise.resolve();
        expect(FileSystem.makeDirectoryAsync).not.toHaveBeenCalled();

        releasePurge();
        await writing;
        expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledTimes(1);
    });

    it("writes a share file in the dedicated directory and removes it", async () => {
        const uri = await writeSecretTempFile(
            "json",
            "secret",
            FileSystem.EncodingType.UTF8,
        );
        expect(uri).toMatch(
            /^file:\/\/\/cache\/secret-temp\/[0-9a-f]{32}\.json$/,
        );
        expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith(
            "file:///cache/secret-temp/",
            { intermediates: true },
        );
        expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
            uri,
            "secret",
            { encoding: FileSystem.EncodingType.UTF8 },
        );
        await deleteAppOwnedTempFile(uri);
        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, {
            idempotent: true,
        });
    });

    it("purges share and picker copies at startup or lock", async () => {
        await purgeSecretTempFiles();
        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
            "file:///cache/secret-temp/",
            { idempotent: true },
        );
        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
            "file:///cache/DocumentPicker/",
            { idempotent: true },
        );
    });

    it("still purges picker copies if share-directory cleanup fails", async () => {
        jest.mocked(FileSystem.deleteAsync).mockRejectedValueOnce(
            new Error("permission denied"),
        );
        await expect(purgeSecretTempFiles()).rejects.toThrow(
            "permission denied",
        );
        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
            "file:///cache/DocumentPicker/",
            { idempotent: true },
        );
    });

    it("removes an incomplete share file if writing fails", async () => {
        jest.mocked(FileSystem.writeAsStringAsync).mockRejectedValueOnce(
            new Error("disk full"),
        );
        await expect(
            writeSecretTempFile("json", "secret", FileSystem.EncodingType.UTF8),
        ).rejects.toThrow("disk full");
        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
            expect.stringMatching(
                /^file:\/\/\/cache\/secret-temp\/[0-9a-f]{32}\.json$/,
            ),
            { idempotent: true },
        );
    });
});
