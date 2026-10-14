import * as FileSystem from "expo-file-system/legacy";

const cacheRoot = FileSystem.cacheDirectory;
const secretDirectory = cacheRoot ? `${cacheRoot}secret-temp/` : null;
const pickerDirectory = cacheRoot ? `${cacheRoot}DocumentPicker/` : null;
let startupPurge: Promise<void> | null = null;

/** Share writes wait for the first purge, even if it is still running. */
export function ensureSecretTempFilesReady(): Promise<void> {
    if (!startupPurge) {
        startupPurge = purgeSecretTempFiles().catch((error: unknown) => {
            startupPurge = null;
            throw error;
        });
    }
    return startupPurge;
}

/** Never delete a document-provider URI or a file outside this app's cache. */
export function isAppOwnedTempFile(uri: string): boolean {
    if (!cacheRoot || !uri.startsWith("file://")) return false;
    const directory = [secretDirectory, pickerDirectory].find(
        (candidate) => candidate && uri.startsWith(candidate),
    );
    if (!directory) return false;
    const remainder = uri.slice(directory.length);
    if (!remainder || remainder.includes("?") || remainder.includes("#")) {
        return false;
    }
    try {
        const decoded = decodeURIComponent(remainder);
        return Boolean(
            decoded &&
            !decoded.includes("..") &&
            !decoded.includes("/") &&
            !decoded.includes("\\") &&
            !decoded.includes("%") &&
            decoded !== "." &&
            !decoded.includes("\0"),
        );
    } catch {
        return false;
    }
}

export async function deleteAppOwnedTempFile(uri: string): Promise<void> {
    if (!isAppOwnedTempFile(uri)) return;
    await FileSystem.deleteAsync(uri, { idempotent: true });
}

/** App-created share files live here so a killed process has one cleanup target. */
export async function writeSecretTempFile(
    extension: string,
    contents: string,
    encoding: (typeof FileSystem.EncodingType)[keyof typeof FileSystem.EncodingType],
): Promise<string> {
    if (!secretDirectory || !/^[a-z0-9]+$/i.test(extension)) {
        throw new Error("Secret temporary storage is unavailable");
    }
    await ensureSecretTempFilesReady();
    await FileSystem.makeDirectoryAsync(secretDirectory, {
        intermediates: true,
    });
    const random = crypto.getRandomValues(new Uint8Array(16));
    const name = Array.from(random, (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
    const path = `${secretDirectory}${name}.${extension}`;
    try {
        await FileSystem.writeAsStringAsync(path, contents, { encoding });
    } catch (error) {
        await deleteAppOwnedTempFile(path).catch(() => undefined);
        throw error;
    }
    return path;
}

/** Run at startup and lock. A process kill cannot bypass the next-start purge. */
export async function purgeSecretTempFiles(): Promise<void> {
    const directories = [secretDirectory, pickerDirectory].filter(
        (directory): directory is string => Boolean(directory),
    );
    const results = await Promise.allSettled(
        directories.map((directory) =>
            FileSystem.deleteAsync(directory, { idempotent: true }),
        ),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
        throw failed.reason;
    }
}
