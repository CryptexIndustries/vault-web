import { trpc } from "@/utils/trpc";
import type { VaultMetadata } from "@/app_lib/vault-utils/storage";
import type { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { ManagedBackupError } from "./managed-backup-errors";

export type BackupSnapshot = Awaited<
    ReturnType<typeof trpc.v1.backup.list.query>
>["items"][number];

// TODO: Centralize the b64<->bytes conversion
function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

/** Opaque client token so retries reuse one recovery session after Kit consume. */
export function createBackupRecoverySessionToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
}

export function sortSnapshotsNewestFirst<T extends { createdAt: Date }>(
    items: readonly T[],
): T[] {
    return [...items].sort(
        (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

export function recommendNewestSnapshot<T extends { createdAt: Date }>(
    items: readonly T[],
): T | null {
    const sorted = sortSnapshotsNewestFirst(items);
    return sorted[0] ?? null;
}

/** Fetch every recovery page so eligible root snapshots are not silently hidden. */
export async function listAllRecoverySnapshots(
    sessionToken: string,
): Promise<BackupSnapshot[]> {
    const items: BackupSnapshot[] = [];
    let cursor: string | undefined;
    for (;;) {
        const page = await trpc.v1.backup.recoveryList.mutate({
            sessionToken,
            ...(cursor ? { cursor } : {}),
        });
        items.push(...page.items);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
    }
    return items;
}

export async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
    const copy = new Uint8Array(bytes);
    return bytesToBase64Url(
        new Uint8Array(await crypto.subtle.digest("SHA-256", copy)),
    );
}

export async function createEncryptedBackupBytes(
    vault: Vault,
    metadata: VaultMetadata,
    dek: CryptoKey,
): Promise<Uint8Array> {
    if (!metadata.Blob) {
        throw new ManagedBackupError("BACKUP_VAULT_UNAVAILABLE");
    }
    const { serializeVault } = await import("@/app_lib/vault-utils/storage");
    return serializeVault(vault, metadata.Blob, dek);
}

type TransferOperation = "upload" | "download";

async function fetchBackupTransfer(
    url: string,
    init: RequestInit,
    operation: TransferOperation,
): Promise<Response> {
    let response: Response;
    try {
        response = await fetch(url, {
            ...init,
            credentials: "omit",
            cache: "no-store",
        });
    } catch (cause) {
        throw new ManagedBackupError(
            operation === "upload"
                ? "BACKUP_UPLOAD_NETWORK"
                : "BACKUP_DOWNLOAD_NETWORK",
            { cause },
        );
    }
    if (!response.ok) {
        throw new ManagedBackupError(
            operation === "upload"
                ? "BACKUP_UPLOAD_REJECTED"
                : "BACKUP_DOWNLOAD_REJECTED",
            {
                retryable:
                    response.status === 408 ||
                    response.status === 429 ||
                    response.status >= 500,
                status: response.status,
            },
        );
    }
    return response;
}

export async function uploadEncryptedBackup(
    bytes: Uint8Array,
    idempotencyKey = crypto.randomUUID(),
): Promise<BackupSnapshot> {
    const checksumSha256 = await sha256Base64Url(bytes);
    const intent = await trpc.v1.backup.createUpload.mutate({
        byteLength: bytes.byteLength,
        checksumSha256,
        idempotencyKey,
    });
    await fetchBackupTransfer(
        intent.transfer.url,
        {
            method: "PUT",
            headers: intent.transfer.headers,
            body: new Blob([new Uint8Array(bytes)], {
                type: "application/octet-stream",
            }),
        },
        "upload",
    );
    return trpc.v1.backup.completeUpload.mutate({
        snapshotId: intent.snapshotId,
    });
}

export async function downloadBackupBytes(
    snapshotId: string,
): Promise<{ snapshot: BackupSnapshot; bytes: Uint8Array }> {
    const result = await trpc.v1.backup.createDownload.query({ snapshotId });
    return downloadSignedBackup(result);
}

export async function downloadRecoveryBackupBytes(
    sessionToken: string,
    snapshotId: string,
): Promise<{ snapshot: BackupSnapshot; bytes: Uint8Array }> {
    const result = await trpc.v1.backup.recoveryDownload.mutate({
        sessionToken,
        snapshotId,
    });
    return downloadSignedBackup(result);
}

async function downloadSignedBackup(result: {
    snapshot: BackupSnapshot;
    transfer: { url: string; headers: Record<string, string> };
}): Promise<{ snapshot: BackupSnapshot; bytes: Uint8Array }> {
    const response = await fetchBackupTransfer(
        result.transfer.url,
        {
            method: "GET",
            headers: result.transfer.headers,
        },
        "download",
    );
    let bytes: Uint8Array;
    try {
        bytes = new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
        throw new ManagedBackupError("BACKUP_DOWNLOAD_NETWORK", { cause });
    }
    if (
        bytes.byteLength !== result.snapshot.byteLength ||
        (await sha256Base64Url(bytes)) !== result.snapshot.checksumSha256
    ) {
        throw new ManagedBackupError("BACKUP_INTEGRITY_FAILED");
    }
    return { snapshot: result.snapshot, bytes };
}

export function downloadBackupFile(bytes: Uint8Array, createdAt: Date): void {
    const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cryptexvault-cloud-${createdAt.getTime()}.cryx`;
    anchor.click();
    URL.revokeObjectURL(url);
}
