import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { DocumentPickerAsset } from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import { MAX_IMPORT_FILE_BYTES } from "@cryptex-industries/vault-core/vault-utils/import-export";
import { readPickedImportFile } from "@/utils/mobile-import-picker";

jest.mock("expo-file-system/legacy", () => ({
    cacheDirectory: "file:///cache/",
    EncodingType: { Base64: "base64" },
    deleteAsync: jest.fn(async () => undefined),
    getInfoAsync: jest.fn(),
    readAsStringAsync: jest.fn(),
}));

const asset = (size?: number): DocumentPickerAsset =>
    ({
        name: "vault.json",
        uri: "file:///cache/DocumentPicker/vault.json",
        mimeType: "application/json",
        size,
        lastModified: 0,
    }) as DocumentPickerAsset;

beforeEach(() => {
    jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({
        exists: true,
        uri: "file:///cache/DocumentPicker/vault.json",
        size: 3,
        isDirectory: false,
        modificationTime: 0,
    });
    jest.mocked(FileSystem.readAsStringAsync).mockResolvedValue("AQID");
});

describe("readPickedImportFile", () => {
    it("rejects an oversized asset before reading it into JS memory", async () => {
        await expect(
            readPickedImportFile(asset(MAX_IMPORT_FILE_BYTES + 1)),
        ).rejects.toThrow("larger than the 1 GB import limit");

        expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
            "file:///cache/DocumentPicker/vault.json",
            { idempotent: true },
        );
    });

    it("uses on-disk metadata when the picker does not provide a size", async () => {
        jest.mocked(FileSystem.getInfoAsync).mockResolvedValueOnce({
            exists: true,
            uri: "file:///cache/vault.json",
            size: MAX_IMPORT_FILE_BYTES + 1,
            isDirectory: false,
            modificationTime: 0,
        });

        await expect(readPickedImportFile(asset())).rejects.toThrow(
            "larger than the 1 GB import limit",
        );
        expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
    });

    it("returns the selected bytes after the pre-read size check", async () => {
        const picked = await readPickedImportFile(asset(3));

        expect(picked).toEqual({
            name: "vault.json",
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: "application/json",
        });
        expect(FileSystem.getInfoAsync).not.toHaveBeenCalled();
        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
            "file:///cache/DocumentPicker/vault.json",
            { idempotent: true },
        );
    });

    it("deletes the picker copy when reading fails", async () => {
        jest.mocked(FileSystem.readAsStringAsync).mockRejectedValueOnce(
            new Error("read failed"),
        );

        await expect(readPickedImportFile(asset(3))).rejects.toThrow(
            "read failed",
        );
        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
            "file:///cache/DocumentPicker/vault.json",
            { idempotent: true },
        );
    });

    it("does not delete a document-provider URI", async () => {
        await readPickedImportFile({
            ...asset(3),
            uri: "content://provider/vault.json",
        });
        expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    });
});
