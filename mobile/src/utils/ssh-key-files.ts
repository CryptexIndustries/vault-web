import { t } from "@lingui/core/macro";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import {
    shareSecretFile,
    type ShareSecretFileResult,
} from "@/utils/secret-share";
import {
    deleteAppOwnedTempFile,
    ensureSecretTempFilesReady,
    writeSecretTempNamedFile,
} from "@/utils/secret-temp-files";

/** Key files are a few KB; anything far larger is the wrong file. */
export const MAX_SSH_KEY_FILE_BYTES = 64 * 1024;

export class SSHKeyFileError extends Error {
    override name = "SSHKeyFileError";
}

/** Lets the user choose a key or .pub file and reads it as text. */
export async function pickSSHKeyFile(): Promise<{
    name: string;
    text: string;
} | null> {
    await ensureSecretTempFilesReady();
    const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: "*/*",
    });
    const asset = picked.canceled ? undefined : picked.assets?.[0];
    if (!asset) return null;
    try {
        const info =
            asset.size == null
                ? await FileSystem.getInfoAsync(asset.uri)
                : undefined;
        const size = asset.size ?? (info?.exists ? info.size : undefined);
        if (size != null && size > MAX_SSH_KEY_FILE_BYTES) {
            throw new SSHKeyFileError(
                t`This file is too large to be an SSH key.`,
            );
        }
        const text = await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.UTF8,
        });
        return { name: asset.name || "key", text };
    } finally {
        await deleteAppOwnedTempFile(asset.uri).catch(() => undefined);
    }
}

/**
 * Hands a key file to the Android share sheet under its real name, then
 * removes the temporary copy. For a private key, pass isCurrent from
 * startSecretRelease(); see shareSecretFile.
 */
export function shareSSHKeyFile(
    fileName: string,
    contents: string,
    options: {
        mimeType: string;
        dialogTitle: string;
        isCurrent?: () => boolean;
    },
): Promise<ShareSecretFileResult> {
    const { isCurrent = () => true, ...shareOptions } = options;
    return shareSecretFile(
        () =>
            writeSecretTempNamedFile(
                fileName,
                contents,
                FileSystem.EncodingType.UTF8,
            ),
        { ...shareOptions, isCurrent },
    );
}
