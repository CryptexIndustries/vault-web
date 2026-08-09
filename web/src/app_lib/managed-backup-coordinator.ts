import { EncryptedBlob } from "@cryptex-industries/vault-core/proto";

import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "@/utils/atoms";
import { getVaultDEKFromSession } from "@/utils/vault-session";
import { vaultLog } from "@/utils/logging";
import { trpc } from "@/utils/trpc";
import {
    createEncryptedBackupBytes,
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
    | "error";

export type ManagedBackupStatusDetail = {
    status: ManagedBackupCoordinatorStatus;
    error?: {
        message: string;
        retryInMs?: number;
    };
};

class ManagedBackupCoordinator {
    private enabled = false;
    private dirty = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private inFlight: Promise<void> | null = null;
    private retryMs = 5_000;
    // Re-encryption changes the checksum, so retry the exact bytes with the same key.
    private uploadAttempt: {
        sourceHash: string | null;
        idempotencyKey: string;
        bytes: Uint8Array;
    } | null = null;

    async start(): Promise<void> {
        try {
            const status = await trpc.v1.backup.status.query();
            this.enabled = status.enabled && status.entitled;
            if (this.enabled && (await this.sourceChanged())) this.markDirty();
        } catch {
            this.enabled = false;
        }
    }

    stop(): void {
        this.enabled = false;
        this.dirty = false;
        this.uploadAttempt = null;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (enabled) this.markDirty();
        else this.stop();
    }

    markDirty(): void {
        if (!this.enabled) return;
        this.dirty = true;
        this.emit("scheduled");
        if (this.timer) clearTimeout(this.timer);
        this.scheduleFlush(DEBOUNCE_MS);
    }

    async backupNow(): Promise<void> {
        if (!this.enabled) {
            throw new ManagedBackupError("BACKUP_NOT_ENABLED");
        }
        this.dirty = true;
        await this.flush();
    }

    // Best-effort upload before locking; keep the lock path bounded by timeoutMs.
    async flushBeforeLock(timeoutMs = 5_000): Promise<void> {
        if (!this.enabled) return;
        this.dirty = true;
        await Promise.race([
            this.flush().catch(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
        ]);
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
        const upload = this.performUpload();
        this.inFlight = upload;
        try {
            await upload;
        } finally {
            this.inFlight = null;
        }
        if (this.enabled && this.dirty) await this.flush();
    }

    private async performUpload(): Promise<void> {
        this.emit("uploading");
        try {
            const metadata = vaultStore.get(unlockedVaultMetadataAtom);
            const vault = vaultStore.get(unlockedVaultAtom);
            const dek = getVaultDEKFromSession();
            if (!metadata?.Blob || dek.isErr()) {
                throw new ManagedBackupError("BACKUP_VAULT_UNAVAILABLE");
            }
            const sourceStorageKey = this.storageKey();
            const sourceHash = await this.sourceHash();
            const uploadAttempt =
                this.uploadAttempt?.sourceHash === sourceHash
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
            this.uploadAttempt = uploadAttempt;
            await uploadEncryptedBackup(
                uploadAttempt.bytes,
                uploadAttempt.idempotencyKey,
            );
            if (this.uploadAttempt === uploadAttempt) {
                this.uploadAttempt = null;
            }
            if (sourceHash) localStorage.setItem(sourceStorageKey, sourceHash);
            this.retryMs = 5_000;
            this.emit("success");
        } catch (error) {
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
        if (typeof window === "undefined") return;
        const detail: ManagedBackupStatusDetail = {
            status,
            ...(error
                ? {
                      error: {
                          message: error.message,
                          retryInMs,
                      },
                  }
                : {}),
        };
        window.dispatchEvent(
            new CustomEvent(MANAGED_BACKUP_STATUS_EVENT, { detail }),
        );
    }
}

export const managedBackupCoordinator = new ManagedBackupCoordinator();
registerManagedBackupHooks({
    markDirty: () => managedBackupCoordinator.markDirty(),
    flushBeforeLock: () => managedBackupCoordinator.flushBeforeLock(),
    stop: () => managedBackupCoordinator.stop(),
});
