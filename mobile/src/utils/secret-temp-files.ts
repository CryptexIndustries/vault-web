import * as FileSystem from "expo-file-system/legacy";

const cacheRoot = FileSystem.cacheDirectory;
const secretDirectory = cacheRoot ? `${cacheRoot}secret-temp/` : null;
const pickerDirectory = cacheRoot ? `${cacheRoot}DocumentPicker/` : null;
let startupPurge: Promise<void> | null = null;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NAMED_FILE_PATH = new RegExp(
    `^[0-9a-f]{32}/${SAFE_FILE_NAME.source.slice(1, -1)}$`,
);

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
    // Named share files sit alone in a random directory; see writeSecretTempNamedFile.
    if (directory === secretDirectory && NAMED_FILE_PATH.test(remainder)) {
        return true;
    }
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
    const named =
        secretDirectory != null &&
        NAMED_FILE_PATH.test(uri.slice(secretDirectory.length));
    await FileSystem.deleteAsync(
        named ? uri.slice(0, uri.lastIndexOf("/") + 1) : uri,
        { idempotent: true },
    );
}

function randomTempName(): string {
    const random = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(random, (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
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
    const path = `${secretDirectory}${randomTempName()}.${extension}`;
    try {
        await FileSystem.writeAsStringAsync(path, contents, { encoding });
    } catch (error) {
        await deleteAppOwnedTempFile(path).catch(() => undefined);
        throw error;
    }
    return path;
}

/**
 * Like writeSecretTempFile, for files whose name the receiving app shows, such
 * as an SSH key. Each file gets its own random directory under the share cache.
 */
export async function writeSecretTempNamedFile(
    fileName: string,
    contents: string,
    encoding: (typeof FileSystem.EncodingType)[keyof typeof FileSystem.EncodingType],
): Promise<string> {
    if (!secretDirectory || !SAFE_FILE_NAME.test(fileName)) {
        throw new Error("Secret temporary storage is unavailable");
    }
    await ensureSecretTempFilesReady();
    const directory = `${secretDirectory}${randomTempName()}/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const path = `${directory}${fileName}`;
    try {
        await FileSystem.writeAsStringAsync(path, contents, { encoding });
    } catch (error) {
        await FileSystem.deleteAsync(directory, { idempotent: true }).catch(
            () => undefined,
        );
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
