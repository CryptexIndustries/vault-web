import AsyncStorage from "@react-native-async-storage/async-storage";
import { EncryptedBlob } from "@cryptex-industries/vault-core/proto";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { trpc } from "@/utils/trpc";
import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "@/utils/atoms";
import {
    getVaultDEKFromSession,
    getVaultSessionGeneration,
} from "@/utils/vault-session";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import {
    createEncryptedBackupBytes,
    deleteManagedBackupHistoryBefore,
    sha256Base64Url,
    uploadEncryptedBackup,
} from "./managed-backups";
import { registerManagedBackupHooks } from "./managed-backup-hooks";
import { isAutoLockDue } from "@/utils/session-timeout";

const DEBOUNCE_MS = 30_000;
const RETRY_MS = 60_000;

export class ManagedBackupCoordinator {
    private enabled = false;
    private dirty = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private inFlight: Promise<void> | null = null;
    private lifetime = new AbortController();
    private vaultGeneration = getVaultSessionGeneration();
    // Re-encryption changes the uploaded bytes. Keep a failed attempt intact so
    // a retry uses the same payload and idempotency key for the same source.
    private uploadAttempt: {
        sourceHash: string;
        idempotencyKey: ReturnType<typeof crypto.randomUUID>;
        bytes: Uint8Array;
    } | null = null;
    private deleteOlderSnapshotsAfterUpload = false;
    private pendingHistoryPurgeSnapshot: {
        id: string;
        createdAt: Date;
        onlineServicesDeviceId: string;
    } | null = null;

    async start() {
        this.stop();
        if (
            !isCloudServicesEnabled() ||
            !Vault.isOnlineServicesBound(vaultStore.get(unlockedVaultAtom))
        )
            return;
        const signal = this.lifetime.signal;
        const status = await trpc.v1.backup.status.query(undefined, { signal });
        if (!this.active(signal)) return;
        this.enabled = status.enabled && status.entitled;
        if (this.enabled) this.markDirty();
    }

    stop() {
        this.lifetime.abort();
        this.lifetime = new AbortController();
        this.vaultGeneration = getVaultSessionGeneration();
        this.enabled = false;
        this.dirty = false;
        this.inFlight = null;
        this.uploadAttempt = null;
        this.deleteOlderSnapshotsAfterUpload = false;
        this.pendingHistoryPurgeSnapshot = null;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    private active(signal: AbortSignal) {
        return (
            !signal.aborted &&
            !isAutoLockDue() &&
            signal === this.lifetime.signal &&
            this.vaultGeneration === getVaultSessionGeneration()
        );
    }

    setEnabled(enabled: boolean) {
        if (!enabled) {
            this.stop();
            return;
        }
        this.enabled = true;
        this.markDirty();
    }

    private schedule(delay: number) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush().catch(() => undefined);
        }, delay);
    }

    markDirty() {
        if (!this.enabled) return;
        this.dirty = true;
        this.schedule(DEBOUNCE_MS);
    }

    async backupNow(deleteOlderSnapshots = false) {
        if (!this.enabled) throw new Error("Managed backups are not enabled.");
        if (deleteOlderSnapshots && this.inFlight) {
            await this.inFlight.catch(() => undefined);
            if (!this.enabled) {
                throw new Error("Managed backups are not enabled.");
            }
        }
        if (deleteOlderSnapshots) this.deleteOlderSnapshotsAfterUpload = true;
        this.dirty = true;
        await this.flush();
    }

    async flushBeforeLock(timeoutMs = 5_000) {
        if (!this.enabled) return;
        this.dirty = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                this.flush().catch(() => undefined),
                new Promise<void>((resolve) => {
                    timer = setTimeout(resolve, timeoutMs);
                }),
            ]);
        } finally {
            clearTimeout(timer);
            this.stop();
        }
    }

    private async flush(): Promise<void> {
        if (!this.enabled || !this.dirty) return;
        if (this.inFlight) {
            await this.inFlight;
            if (this.enabled && this.dirty) await this.flush();
            return;
        }
        const signal = this.lifetime.signal;
        if (!this.active(signal)) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.dirty = false;
        const upload = this.upload(signal);
        this.inFlight = upload;
        try {
            await upload;
        } catch (error) {
            if (this.active(signal)) {
                this.dirty = true;
                this.schedule(RETRY_MS);
            }
            throw error;
        } finally {
            if (this.inFlight === upload) this.inFlight = null;
        }
        if (this.active(signal) && this.dirty) this.schedule(DEBOUNCE_MS);
    }

    private async upload(signal: AbortSignal) {
        const assertActive = () => {
            if (!this.active(signal))
                throw new Error("Backup session changed.");
        };
        assertActive();
        if (this.pendingHistoryPurgeSnapshot) {
            const sourceChanged = await this.sourceChanged();
            assertActive();
            if (!sourceChanged) {
                await this.deletePendingHistory(signal, assertActive);
                return;
            }
        }
        const purgeAfterUpload =
            this.deleteOlderSnapshotsAfterUpload ||
            this.pendingHistoryPurgeSnapshot != null;
        const metadata = vaultStore.get(unlockedVaultMetadataAtom);
        const vault = vaultStore.get(unlockedVaultAtom);
        const dek = getVaultDEKFromSession();
        if (!metadata?.Blob || dek.isErr())
            throw new Error("Vault is unavailable.");
        const source = EncryptedBlob.encode(metadata.Blob).finish();
        const sourceHash = await sha256Base64Url(source);
        assertActive();
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
        assertActive();
        this.uploadAttempt = uploadAttempt;
        const snapshot = await uploadEncryptedBackup(
            uploadAttempt.bytes,
            uploadAttempt.idempotencyKey,
            {
                signal,
                assertActive,
            },
        );
        assertActive();
        if (this.uploadAttempt === uploadAttempt) this.uploadAttempt = null;
        const vaultId = metadata.Blob.Envelope?.VaultID ?? "unknown";
        await AsyncStorage.setItem(
            `cryptex:managed-backup-source:${vaultId}`,
            sourceHash,
        );
        if (purgeAfterUpload) {
            const onlineServicesDeviceId = vault.OnlineServices?.DeviceId;
            if (!onlineServicesDeviceId) {
                throw new Error(
                    "Managed backup account binding is unavailable.",
                );
            }
            this.deleteOlderSnapshotsAfterUpload = false;
            this.pendingHistoryPurgeSnapshot = {
                id: snapshot.id,
                createdAt: new Date(snapshot.createdAt),
                onlineServicesDeviceId,
            };
            await this.deletePendingHistory(signal, assertActive);
        }
    }

    private async sourceChanged(): Promise<boolean> {
        const metadata = vaultStore.get(unlockedVaultMetadataAtom);
        if (!metadata?.Blob) return true;
        const vaultId = metadata.Blob.Envelope?.VaultID ?? "unknown";
        const currentHash = await sha256Base64Url(
            EncryptedBlob.encode(metadata.Blob).finish(),
        );
        const storedHash = await AsyncStorage.getItem(
            `cryptex:managed-backup-source:${vaultId}`,
        );
        return storedHash !== currentHash;
    }

    private async deletePendingHistory(
        signal: AbortSignal,
        assertActive: () => void,
    ): Promise<void> {
        const replacement = this.pendingHistoryPurgeSnapshot;
        if (!replacement) return;
        const onlineServicesDeviceId =
            vaultStore.get(unlockedVaultAtom).OnlineServices?.DeviceId;
        if (onlineServicesDeviceId !== replacement.onlineServicesDeviceId) {
            throw new Error("Managed backup account binding changed.");
        }
        await deleteManagedBackupHistoryBefore(replacement, {
            signal,
            assertActive,
        });
        assertActive();
        if (this.pendingHistoryPurgeSnapshot === replacement) {
            this.pendingHistoryPurgeSnapshot = null;
        }
    }
}

export const managedBackupCoordinator = new ManagedBackupCoordinator();
registerManagedBackupHooks({
    markDirty: () => managedBackupCoordinator.markDirty(),
    backupNow: (deleteOlderSnapshots) =>
        managedBackupCoordinator.backupNow(deleteOlderSnapshots),
    flushBeforeLock: () => managedBackupCoordinator.flushBeforeLock(),
    stop: () => managedBackupCoordinator.stop(),
});
