import { EncryptedBlob } from "@cryptex-industries/vault-core/proto";
import { vaultWriteCoordinator } from "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator";

import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "@/utils/atoms";
import { getVaultDEKFromSession } from "@/utils/vault-session";
import { vaultLog } from "@/utils/logging";
import { createAccountBoundTrpcClient } from "@/utils/trpc";
import {
    createEncryptedBackupBytes,
    deleteManagedBackupHistoryBefore,
    sha256Base64Url,
    uploadEncryptedBackup,
} from "./managed-backups";
import { registerManagedBackupHooks } from "./managed-backup-hooks";
import {
    ManagedBackupError,
    normalizeManagedBackupError,
} from "./managed-backup-errors";

export const MANAGED_BACKUP_STATUS_EVENT = "cryptex:managed-backup-status";
const DEBOUNCE_MS = 30_000;
const MAX_RETRY_MS = 5 * 60_000;

export type ManagedBackupCoordinatorStatus =
    | "scheduled"
    | "uploading"
    | "success"
    | "error"
    | "stopped";

export type ManagedBackupStatusDetail = {
    status: ManagedBackupCoordinatorStatus;
    error?: {
        message: string;
        retryInMs?: number;
    };
};

class ManagedBackupCoordinator {
    // The last upload failure, kept until an upload succeeds or backups stop.
    failure: ManagedBackupStatusDetail["error"];
    private enabled = false;
    private dirty = false;
    // SSH agent history goes into the next upload without starting one.
    private unscheduledChanges = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private inFlight: Promise<void> | null = null;
    private retryMs = 5_000;
    private lifecycle = 0;
    // Set while start compares the vault with the last upload. A lock in the
    // meantime must not mark the vault as backed up.
    private sourceCheckLifecycle: number | null = null;
    private onlineServicesDeviceId: string | null = null;
    // Re-encryption changes the checksum, so retry the exact bytes with the same key.
    private uploadAttempt: {
        sourceHash: string | null;
        idempotencyKey: string;
        bytes: Uint8Array;
    } | null = null;
    private deleteOlderSnapshotsAfterUpload = false;
    private pendingHistoryPurgeSnapshot: {
        id: string;
        createdAt: Date;
        onlineServicesDeviceId: string;
    } | null = null;

    async start(): Promise<void> {
        const vault = vaultStore.get(unlockedVaultAtom);
        // Session refreshes call start again. Restarting would cancel an upload
        // in progress, so only recheck the status while backups are off.
        if (
            this.enabled &&
            this.onlineServicesDeviceId === vault.OnlineServices?.DeviceId
        ) {
            return;
        }
        const lifecycle = ++this.lifecycle;
        if (!vault.OnlineServices) {
            this.enabled = false;
            this.onlineServicesDeviceId = null;
            return;
        }
        const onlineServicesDeviceId = vault.OnlineServices.DeviceId;
        this.onlineServicesDeviceId = onlineServicesDeviceId;
        try {
            const client = createAccountBoundTrpcClient(onlineServicesDeviceId);
            const status = await client.v1.backup.status.query();
            if (lifecycle !== this.lifecycle) return;
            this.enabled = status.enabled && status.entitled;
            this.sourceCheckLifecycle = lifecycle;
            const sourceChanged = this.enabled && (await this.sourceChanged());
            if (lifecycle !== this.lifecycle) return;
            this.sourceCheckLifecycle = null;
            if (sourceChanged) this.markDirty();
        } catch {
            if (lifecycle === this.lifecycle) this.enabled = false;
        }
    }

    stop(): void {
        this.lifecycle += 1;
        this.enabled = false;
        this.onlineServicesDeviceId = null;
        this.dirty = false;
        this.unscheduledChanges = false;
        this.uploadAttempt = null;
        this.deleteOlderSnapshotsAfterUpload = false;
        this.pendingHistoryPurgeSnapshot = null;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.emit("stopped");
    }

    setEnabled(enabled: boolean): void {
        if (!enabled) {
            this.stop();
            return;
        }
        const vault = vaultStore.get(unlockedVaultAtom);
        if (!vault.OnlineServices) {
            this.stop();
            return;
        }
        const nextDeviceId = vault.OnlineServices.DeviceId;
        if (
            this.onlineServicesDeviceId &&
            this.onlineServicesDeviceId !== nextDeviceId
        ) {
            this.stop();
        }
        // An older status check still in flight must not turn this back off.
        this.lifecycle += 1;
        this.onlineServicesDeviceId = nextDeviceId;
        this.enabled = true;
        this.markDirty();
    }

    markDirty(scheduleUpload = true): void {
        if (!this.enabled) return;
        if (!scheduleUpload) {
            this.unscheduledChanges = true;
            return;
        }
        this.dirty = true;
        this.emit("scheduled");
        if (this.timer) clearTimeout(this.timer);
        this.scheduleFlush(DEBOUNCE_MS);
    }

    async backupNow(deleteOlderSnapshots = false): Promise<void> {
        if (!this.enabled) {
            throw new ManagedBackupError("BACKUP_NOT_ENABLED");
        }

        // A security-change purge must belong to the replacement generated
        // after that change. Let any older upload finish before arming the
        // purge, otherwise the older upload could consume the flag and delete
        // history before the post-change snapshot exists.
        if (deleteOlderSnapshots && this.inFlight) {
            await this.inFlight.catch(() => undefined);
            if (!this.enabled) {
                throw new ManagedBackupError("BACKUP_NOT_ENABLED");
            }
        }
        if (deleteOlderSnapshots) this.deleteOlderSnapshotsAfterUpload = true;
        this.dirty = true;
        await this.flush();
    }

    // Best-effort upload before locking; keep the lock path bounded by timeoutMs.
    async flushBeforeLock(timeoutMs = 5_000): Promise<void> {
        if (!this.enabled) return;
        if (this.unscheduledChanges) this.dirty = true;
        await Promise.race([
            this.flush().catch(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
        ]);
        // Everything is uploaded, so the lock's save only re-encrypted the
        // vault. Store the new hash so the next unlock doesn't upload it again.
        if (
            this.enabled &&
            !this.dirty &&
            !this.unscheduledChanges &&
            !this.inFlight &&
            this.sourceCheckLifecycle !== this.lifecycle
        ) {
            const sourceHash = await this.sourceHash();
            if (sourceHash) localStorage.setItem(this.storageKey(), sourceHash);
        }
    }

    private async flush(): Promise<void> {
        if (!this.enabled || (!this.dirty && !this.inFlight)) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        if (this.inFlight) {
            await this.inFlight;
            if (this.enabled && this.dirty) await this.flush();
            return;
        }
        this.dirty = false;
        this.unscheduledChanges = false;
        const upload = this.performUpload(this.lifecycle);
        this.inFlight = upload;
        try {
            await upload;
        } finally {
            this.inFlight = null;
        }
        if (this.enabled && this.dirty) await this.flush();
    }

    private async performUpload(lifecycle: number): Promise<void> {
        this.emit("uploading");
        try {
            if (this.pendingHistoryPurgeSnapshot) {
                const sourceChanged = await this.sourceChanged();
                if (lifecycle !== this.lifecycle) return;
                if (!sourceChanged) {
                    await this.deletePendingHistory();
                    if (lifecycle !== this.lifecycle) return;
                    this.retryMs = 5_000;
                    this.emit("success");
                    return;
                }
            }

            const purgeAfterUpload =
                this.deleteOlderSnapshotsAfterUpload ||
                this.pendingHistoryPurgeSnapshot != null;

            const onlineServicesDeviceId = this.onlineServicesDeviceId;
            if (!onlineServicesDeviceId) {
                throw new ManagedBackupError("BACKUP_VAULT_UNAVAILABLE");
            }
            const client = createAccountBoundTrpcClient(onlineServicesDeviceId);
            const sourceStorageKey = this.storageKey();
            // A key rotation publishes the new envelope before the new key.
            const uploadAttempt =
                await vaultWriteCoordinator.readBetweenKeyChanges(async () => {
                    const metadata = vaultStore.get(unlockedVaultMetadataAtom);
                    const vault = vaultStore.get(unlockedVaultAtom);
                    const dek = getVaultDEKFromSession();
                    if (!metadata?.Blob || dek.isErr()) {
                        throw new ManagedBackupError(
                            "BACKUP_VAULT_UNAVAILABLE",
                        );
                    }
                    const sourceHash = await this.sourceHash();
                    return this.uploadAttempt?.sourceHash === sourceHash
                        ? this.uploadAttempt
                        : {
                              sourceHash,
                              idempotencyKey: crypto.randomUUID(),
                              bytes: await createEncryptedBackupBytes(
                                  vault,
                                  metadata,
                                  dek.value,
                              ),
                          };
                });
            const { sourceHash } = uploadAttempt;
            if (lifecycle !== this.lifecycle) return;
            this.uploadAttempt = uploadAttempt;
            const snapshot = await uploadEncryptedBackup(
                uploadAttempt.bytes,
                uploadAttempt.idempotencyKey,
                client,
            );
            if (lifecycle !== this.lifecycle) return;
            if (this.uploadAttempt === uploadAttempt) {
                this.uploadAttempt = null;
            }
            if (sourceHash) localStorage.setItem(sourceStorageKey, sourceHash);
            if (purgeAfterUpload) {
                this.deleteOlderSnapshotsAfterUpload = false;
                this.pendingHistoryPurgeSnapshot = {
                    id: snapshot.id,
                    createdAt: snapshot.createdAt,
                    onlineServicesDeviceId,
                };
                await this.deletePendingHistory();
            }
            this.retryMs = 5_000;
            this.emit("success");
        } catch (error) {
            if (lifecycle !== this.lifecycle) return;
            const backupError = normalizeManagedBackupError(error);
            this.dirty = true;
            const retryInMs =
                this.enabled && backupError.retryable
                    ? this.retryMs
                    : undefined;
            this.emit("error", backupError, retryInMs);
            vaultLog.error("Managed encrypted backup failed", {
                code: backupError.code,
                retryable: backupError.retryable,
                status: backupError.status,
            });
            if (retryInMs != null) {
                this.scheduleFlush(retryInMs);
                this.retryMs = Math.min(MAX_RETRY_MS, this.retryMs * 2);
            }
            throw backupError;
        }
    }

    private async deletePendingHistory(): Promise<void> {
        const replacement = this.pendingHistoryPurgeSnapshot;
        if (!replacement) return;
        if (
            replacement.onlineServicesDeviceId !== this.onlineServicesDeviceId
        ) {
            throw new ManagedBackupError("BACKUP_HISTORY_DELETE_FAILED");
        }
        try {
            await deleteManagedBackupHistoryBefore(
                { id: replacement.id, createdAt: replacement.createdAt },
                createAccountBoundTrpcClient(
                    replacement.onlineServicesDeviceId,
                ),
            );
            if (this.pendingHistoryPurgeSnapshot === replacement) {
                this.pendingHistoryPurgeSnapshot = null;
            }
        } catch (cause) {
            throw new ManagedBackupError("BACKUP_HISTORY_DELETE_FAILED", {
                cause,
            });
        }
    }

    private scheduleFlush(delayMs: number): void {
        this.timer = setTimeout(() => {
            void this.flush().catch(() => undefined);
        }, delayMs);
    }

    private storageKey(): string {
        const vaultId = vaultStore.get(unlockedVaultMetadataAtom)?.Blob
            ?.Envelope?.VaultID;
        return `cryptex:managed-backup-source:${vaultId ?? "unknown"}`;
    }

    // Keep this marker local: hashing ciphertext never exposes vault plaintext.
    private async sourceHash(): Promise<string | null> {
        const blob = vaultStore.get(unlockedVaultMetadataAtom)?.Blob;
        if (!blob) return null;
        return sha256Base64Url(EncryptedBlob.encode(blob).finish());
    }

    private async sourceChanged(): Promise<boolean> {
        const current = await this.sourceHash();
        return (
            current != null &&
            localStorage.getItem(this.storageKey()) !== current
        );
    }

    private emit(
        status: ManagedBackupCoordinatorStatus,
        error?: ManagedBackupError,
        retryInMs?: number,
    ): void {
        if (status === "success" || status === "stopped") {
            this.failure = undefined;
        }
        if (error) this.failure = { message: error.message, retryInMs };
        if (typeof window === "undefined") return;
        const detail: ManagedBackupStatusDetail = {
            status,
            ...(error ? { error: this.failure } : {}),
        };
        window.dispatchEvent(
            new CustomEvent(MANAGED_BACKUP_STATUS_EVENT, { detail }),
        );
    }
}

export const managedBackupCoordinator = new ManagedBackupCoordinator();
registerManagedBackupHooks({
    markDirty: (scheduleUpload) =>
        managedBackupCoordinator.markDirty(scheduleUpload),
    backupNow: (deleteOlderSnapshots) =>
        managedBackupCoordinator.backupNow(deleteOlderSnapshots),
    flushBeforeLock: () => managedBackupCoordinator.flushBeforeLock(),
    stop: () => managedBackupCoordinator.stop(),
});
