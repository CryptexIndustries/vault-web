import type { DocumentPickerAsset } from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import {
    ImportFileError,
    MAX_IMPORT_FILE_BYTES,
} from "@cryptex-industries/vault-core/vault-utils/import-export";
import { base64ToUint8 } from "@cryptex-industries/vault-core/encoding";
import { deleteAppOwnedTempFile } from "@/utils/secret-temp-files";

export type PickedImportFile = {
    name: string;
    bytes: Uint8Array;
    mimeType?: string;
};

/** Check the on-disk size before materializing an import in JS memory. */
export async function readPickedImportFile(
    asset: DocumentPickerAsset,
): Promise<PickedImportFile> {
    try {
        const info =
            asset.size == null
                ? await FileSystem.getInfoAsync(asset.uri)
                : undefined;
        const size = asset.size ?? (info?.exists ? info.size : undefined);
        if (size != null && size > MAX_IMPORT_FILE_BYTES) {
            throw new ImportFileError(
                "IMPORT_FILE_TOO_LARGE",
                "This file is larger than the 1 GB import limit.",
            );
        }

        const encoded = await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
        });
        return {
            name: asset.name || "import.bin",
            bytes: base64ToUint8(encoded),
            mimeType: asset.mimeType ?? undefined,
        };
    } finally {
        await deleteAppOwnedTempFile(asset.uri).catch(() => undefined);
    }
}
