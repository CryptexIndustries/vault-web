import { trpc } from "@/utils/trpc";
import * as FileSystem from "expo-file-system/legacy";
import {
    deleteAppOwnedTempFile,
    writeSecretTempFile,
} from "@/utils/secret-temp-files";
import { fetchWithTimeout } from "@/utils/online-services-transport";
import {
    serializeVault,
    type VaultMetadata,
} from "@/app_lib/vault-utils/storage";
import type { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    base64ToUint8,
    uint8ToBase64Url,
} from "@cryptex-industries/vault-core/encoding";

export type BackupSnapshot = Awaited<
    ReturnType<typeof trpc.v1.backup.list.query>
>["items"][number];

type BackupOperationContext = {
    signal?: AbortSignal;
    assertActive?: () => void;
};

export async function listAllManagedBackupSnapshots(
    context?: BackupOperationContext,
): Promise<BackupSnapshot[]> {
    const items: BackupSnapshot[] = [];
    let cursor: string | undefined;
    for (;;) {
        const page = await trpc.v1.backup.list.query(
            cursor ? { cursor } : undefined,
            { signal: context?.signal },
        );
        context?.assertActive?.();
        items.push(...page.items);
        if (!page.nextCursor) return items;
        cursor = page.nextCursor;
    }
}

export async function deleteManagedBackupHistoryBefore(
    replacement: Pick<BackupSnapshot, "id" | "createdAt">,
    context?: BackupOperationContext,
): Promise<void> {
    const snapshots = await listAllManagedBackupSnapshots(context);
    const replacementCreatedAt = new Date(replacement.createdAt).getTime();
    for (const snapshot of snapshots) {
        if (
            snapshot.id === replacement.id ||
            new Date(snapshot.createdAt).getTime() >= replacementCreatedAt
        ) {
            continue;
        }
        await trpc.v1.backup.delete.mutate(
            { snapshotId: snapshot.id },
            { signal: context?.signal },
        );
        context?.assertActive?.();
    }
}

export async function sha256Base64Url(bytes: Uint8Array) {
    return uint8ToBase64Url(
        new Uint8Array(
            await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
        ),
    );
}

export async function createEncryptedBackupBytes(
    vault: Vault,
    metadata: VaultMetadata,
    dek: CryptoKey,
) {
    if (!metadata.Blob) throw new Error("Vault is unavailable.");
    return serializeVault(vault, metadata.Blob, dek);
}

async function transfer(url: string, init: RequestInit) {
    const response = await fetchWithTimeout(url, {
        ...init,
        credentials: "omit",
        cache: "no-store",
    });
    if (!response.ok)
        throw new Error(`Backup transfer failed (${response.status}).`);
    return response;
}

export async function uploadEncryptedBackup(
    bytes: Uint8Array,
    idempotencyKey = crypto.randomUUID(),
    context?: { signal: AbortSignal; assertActive: () => void },
) {
    const checksumSha256 = await sha256Base64Url(bytes);
    context?.assertActive();
    const intent = await trpc.v1.backup.createUpload.mutate(
        {
            byteLength: bytes.byteLength,
            checksumSha256,
            idempotencyKey,
        },
        { signal: context?.signal },
    );
    context?.assertActive();
    await transfer(intent.transfer.url, {
        signal: context?.signal,
        method: "PUT",
        headers: {
            "Content-Type": "application/octet-stream",
            ...intent.transfer.headers,
        },
        // React Native accepts typed-array request bodies, but cannot construct
        // browser-style Blobs from them.
        body: new Uint8Array(bytes),
    });
    context?.assertActive();
    return trpc.v1.backup.completeUpload.mutate(
        {
            snapshotId: intent.snapshotId,
        },
        { signal: context?.signal },
    );
}

async function downloadVerifiedBackup(
    result: Awaited<ReturnType<typeof trpc.v1.backup.createDownload.query>>,
) {
    const expectedSize = result.snapshot.byteLength;
    if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0) {
        throw new Error("Backup integrity check failed.");
    }
    const uri = await writeSecretTempFile(
        "cryx",
        "",
        FileSystem.EncodingType.Base64,
    );
    try {
        let transferError: Error | undefined;
        let cancellation: Promise<void> | undefined;
        const cancel = (error: Error) => {
            if (transferError) return;
            transferError = error;
            cancellation = task
                .pauseAsync()
                .then(() => undefined)
                .catch(() => undefined);
        };
        const task = FileSystem.createDownloadResumable(
            result.transfer.url,
            uri,
            { headers: result.transfer.headers },
            (progress) => {
                if (
                    progress.totalBytesWritten > expectedSize ||
                    progress.totalBytesExpectedToWrite > expectedSize
                ) {
                    cancel(new Error("Backup integrity check failed."));
                }
            },
        );
        const timeout = setTimeout(
            () => cancel(new Error("Backup transfer timed out.")),
            15_000,
        );
        let download: FileSystem.FileSystemDownloadResult | undefined;
        try {
            download = await task.downloadAsync();
        } catch (error) {
            throw transferError ?? error;
        } finally {
            clearTimeout(timeout);
            await cancellation;
            // Pausing also releases the native resumable-task registration.
            await task.pauseAsync().catch(() => undefined);
            await task.cancelAsync().catch(() => undefined);
        }
        if (transferError) throw transferError;
        if (!download) throw new Error("Backup transfer was cancelled.");
        if (download.status < 200 || download.status >= 300) {
            throw new Error(`Backup transfer failed (${download.status}).`);
        }
        // Progress cancellation is asynchronous. Check the completed native file
        // before allocating a JavaScript string or decoding its bytes.
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists || info.isDirectory || info.size !== expectedSize) {
            throw new Error("Backup integrity check failed.");
        }
        const bytes = base64ToUint8(
            await FileSystem.readAsStringAsync(uri, {
                encoding: FileSystem.EncodingType.Base64,
            }),
        );
        if (
            bytes.byteLength !== expectedSize ||
            (await sha256Base64Url(bytes)) !== result.snapshot.checksumSha256
        ) {
            throw new Error("Backup integrity check failed.");
        }
        return { snapshot: result.snapshot, bytes };
    } finally {
        await deleteAppOwnedTempFile(uri);
    }
}

export async function downloadBackupBytes(snapshotId: string) {
    return downloadVerifiedBackup(
        await trpc.v1.backup.createDownload.query({ snapshotId }),
    );
}

export async function downloadRecoveryBackupBytes(
    sessionToken: string,
    snapshotId: string,
) {
    return downloadVerifiedBackup(
        await trpc.v1.backup.recoveryDownload.mutate({
            sessionToken,
            snapshotId,
        }),
    );
}
