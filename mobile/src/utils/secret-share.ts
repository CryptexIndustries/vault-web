import * as Sharing from "expo-sharing";

import { deleteAppOwnedTempFile } from "@/utils/secret-temp-files";

export type ShareSecretFileResult = "shared" | "unavailable" | "cancelled";

/**
 * Writes a temporary secret file, hands it to the share sheet and deletes it.
 * isCurrent (usually a SecretRelease's current) runs after every await and
 * right before the share sheet opens; once it returns false nothing is
 * shared, a file already written is deleted and the result is "cancelled".
 */
export async function shareSecretFile(
    write: () => Promise<string>,
    options: {
        isCurrent: () => boolean;
        mimeType: string;
        dialogTitle?: string;
        UTI?: string;
        /** Runs right before the share sheet opens. */
        beforeShare?: () => void;
    },
): Promise<ShareSecretFileResult> {
    const { isCurrent, beforeShare, ...shareOptions } = options;
    if (!isCurrent()) return "cancelled";
    const available = await Sharing.isAvailableAsync();
    if (!isCurrent()) return "cancelled";
    if (!available) return "unavailable";
    let path: string | undefined;
    try {
        path = await write();
        if (!isCurrent()) return "cancelled";
        beforeShare?.();
        await Sharing.shareAsync(path, shareOptions);
        return "shared";
    } finally {
        if (path) await deleteAppOwnedTempFile(path).catch(() => undefined);
    }
}
