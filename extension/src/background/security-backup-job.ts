import { uint8ToBase64 } from "@cryptex-industries/vault-core/encoding";

import { createDirectOnlineServicesTrpcClient } from "../app_lib/auth-session-ext";
import type { SecurityBackupJob } from "../types/sw-messaging";
import type { EncryptedBackupBytesResult } from "./backup-service";

export const SECURITY_BACKUP_ALARM_PREFIX = "security-backup:";
const SECURITY_BACKUP_JOB_PREFIX = "SECURITY_BACKUP_JOB:";
const LATEST_SECURITY_BACKUP_JOB_KEY = "LATEST_SECURITY_BACKUP_JOB";
const JOB_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VAULT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
let backupJobTail: Promise<void> = Promise.resolve();

class SecurityBackupFailure extends Error {
    constructor(readonly code: string) {
        super(code);
    }
}

const jobKey = (id: string): string => `${SECURITY_BACKUP_JOB_PREFIX}${id}`;

async function writeJob(job: SecurityBackupJob): Promise<void> {
    await chrome.storage.session.set({
        [jobKey(job.id)]: job,
        [LATEST_SECURITY_BACKUP_JOB_KEY]: job.id,
    });
}

async function updateJob(
    job: SecurityBackupJob,
    patch: Partial<SecurityBackupJob>,
): Promise<SecurityBackupJob> {
    const next = { ...job, ...patch, updatedAt: Date.now() };
    await writeJob(next);
    return next;
}

export async function queueSecurityManagedBackup(
    deleteOlderSnapshots: boolean,
    onlineServicesDeviceId: string,
    vaultId: string,
): Promise<string> {
    if (
        onlineServicesDeviceId.length === 0 ||
        onlineServicesDeviceId.length > 255 ||
        !VAULT_ID_PATTERN.test(vaultId)
    ) {
        throw new Error("INVALID_SECURITY_BACKUP_TARGET");
    }
    const id = crypto.randomUUID();
    const job: SecurityBackupJob = {
        id,
        status: "queued",
        deleteOlderSnapshots,
        onlineServicesDeviceId,
        vaultId,
        updatedAt: Date.now(),
    };
    await writeJob(job);
    try {
        await chrome.alarms.create(`${SECURITY_BACKUP_ALARM_PREFIX}${id}`, {
            when: Date.now() + 1,
        });
    } catch (error) {
        await updateJob(job, {
            status: "error",
            error: "BACKUP_QUEUE_FAILED",
        }).catch(() => undefined);
        throw error;
    }
    return id;
}

export async function getSecurityBackupJob(
    id: string,
): Promise<SecurityBackupJob | null> {
    if (!JOB_ID_PATTERN.test(id)) return null;
    const stored = await chrome.storage.session.get(jobKey(id));
    const value = stored[jobKey(id)];
    if (!value || typeof value !== "object") return null;
    const job = value as Partial<SecurityBackupJob>;
    const validStatus = [
        "queued",
        "preparing",
        "uploading",
        "deleting",
        "success",
        "skipped",
        "error",
    ].includes(job.status ?? "");
    return job.id === id &&
        validStatus &&
        typeof job.deleteOlderSnapshots === "boolean" &&
        typeof job.onlineServicesDeviceId === "string" &&
        job.onlineServicesDeviceId.length > 0 &&
        job.onlineServicesDeviceId.length <= 255 &&
        typeof job.vaultId === "string" &&
        VAULT_ID_PATTERN.test(job.vaultId) &&
        typeof job.updatedAt === "number" &&
        (job.error === undefined || typeof job.error === "string")
        ? (value as SecurityBackupJob)
        : null;
}

export async function getLatestSecurityBackupJobId(
    vaultId: string,
): Promise<string | undefined> {
    const stored = await chrome.storage.session.get(
        LATEST_SECURITY_BACKUP_JOB_KEY,
    );
    const value = stored[LATEST_SECURITY_BACKUP_JOB_KEY];
    if (typeof value !== "string" || !JOB_ID_PATTERN.test(value)) {
        return undefined;
    }
    const job = await getSecurityBackupJob(value);
    return job?.vaultId === vaultId ? value : undefined;
}

function bytesToBase64Url(bytes: Uint8Array): string {
    return uint8ToBase64(bytes)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/g, "");
}

async function checksum(bytes: Uint8Array): Promise<string> {
    return bytesToBase64Url(
        new Uint8Array(
            await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
        ),
    );
}

async function uploadBackup(
    bytes: Uint8Array,
    onlineServicesDeviceId: string,
): Promise<{ id: string; createdAt: Date }> {
    const client = createDirectOnlineServicesTrpcClient(onlineServicesDeviceId);
    const intent = await client.v1.backup.createUpload.mutate({
        byteLength: bytes.byteLength,
        checksumSha256: await checksum(bytes),
        idempotencyKey: crypto.randomUUID(),
    });
    let response: Response;
    try {
        response = await globalThis.fetch(intent.transfer.url, {
            method: "PUT",
            headers: intent.transfer.headers,
            body: new Blob([new Uint8Array(bytes)], {
                type: "application/octet-stream",
            }),
            credentials: "omit",
            cache: "no-store",
        });
    } catch {
        throw new SecurityBackupFailure("BACKUP_UPLOAD_NETWORK");
    }
    if (!response.ok) {
        throw new SecurityBackupFailure("BACKUP_UPLOAD_REJECTED");
    }
    return client.v1.backup.completeUpload.mutate({
        snapshotId: intent.snapshotId,
    });
}

async function deleteOlderSnapshots(
    replacement: {
        id: string;
        createdAt: Date;
    },
    onlineServicesDeviceId: string,
) {
    const client = createDirectOnlineServicesTrpcClient(onlineServicesDeviceId);
    const snapshotIds: string[] = [];
    const replacementCreatedAt = new Date(replacement.createdAt).getTime();
    let cursor: string | undefined;
    for (;;) {
        const page = await client.v1.backup.list.query(
            cursor ? { cursor } : undefined,
        );
        for (const snapshot of page.items as Array<{
            id: string;
            createdAt: Date;
        }>) {
            if (
                snapshot.id !== replacement.id &&
                new Date(snapshot.createdAt).getTime() < replacementCreatedAt
            ) {
                snapshotIds.push(snapshot.id);
            }
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
    }
    for (const snapshotId of snapshotIds) {
        await client.v1.backup.delete.mutate({ snapshotId });
    }
}

async function executeSecurityManagedBackup(input: {
    jobId: string;
    prepareBackup: (
        onlineServicesDeviceId: string,
        vaultId: string,
    ) => Promise<EncryptedBackupBytesResult | null>;
}): Promise<void> {
    let job = await getSecurityBackupJob(input.jobId);
    if (!job || job.status !== "queued") return;

    try {
        const client = createDirectOnlineServicesTrpcClient(
            job.onlineServicesDeviceId,
        );
        const status = await client.v1.backup.status.query();
        if (!status.enabled || !status.entitled) {
            await updateJob(job, { status: "skipped" });
            return;
        }
        job = await updateJob(job, { status: "preparing" });
        let created: EncryptedBackupBytesResult | null;
        try {
            created = await input.prepareBackup(
                job.onlineServicesDeviceId,
                job.vaultId,
            );
        } catch {
            throw new SecurityBackupFailure("BACKUP_SERIALIZE_FAILED");
        }
        if (!created) {
            throw new SecurityBackupFailure("BACKUP_VAULT_UNAVAILABLE");
        }
        if (!created.ok) {
            throw new SecurityBackupFailure(created.error);
        }

        job = await updateJob(job, { status: "uploading" });
        const replacement = await uploadBackup(
            created.backup.bytes,
            job.onlineServicesDeviceId,
        );

        if (job.deleteOlderSnapshots) {
            job = await updateJob(job, { status: "deleting" });
            try {
                await deleteOlderSnapshots(
                    replacement,
                    job.onlineServicesDeviceId,
                );
            } catch {
                throw new SecurityBackupFailure("BACKUP_HISTORY_DELETE_FAILED");
            }
        }

        await updateJob(job, { status: "success", error: undefined });
    } catch (error) {
        const code =
            error instanceof SecurityBackupFailure
                ? error.code
                : "BACKUP_UPLOAD_FAILED";
        await updateJob(job, { status: "error", error: code });
    }
}

/** Keep replacement-and-purge jobs ordered without blocking vault writes. */
export function runSecurityManagedBackup(input: {
    jobId: string;
    prepareBackup: (
        onlineServicesDeviceId: string,
        vaultId: string,
    ) => Promise<EncryptedBackupBytesResult | null>;
}): Promise<void> {
    const result = backupJobTail.then(() =>
        executeSecurityManagedBackup(input),
    );
    backupJobTail = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}
