import { z } from "zod";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    BackupDestinationScheduler,
    type BackupDestinationState,
    type BackupDestinationStatus,
} from "@cryptex-industries/vault-core/vault-utils/backup-destination-scheduler";
import {
    backupSourceHash,
    newBackupDeviceIdentity,
    type BackupDestinationChange,
} from "@cryptex-industries/vault-core/vault-utils/backup-destinations";
import { S3Error } from "@cryptex-industries/vault-core/vault-utils/s3-client";
import { vaultWriteCoordinator } from "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator";

import { createEncryptedBackupBytes } from "./backup-service";

export const BACKUP_DESTINATION_ALARM = "backup-destinations";
const STATE_PREFIX = "BACKUP_DESTINATION:";
// chrome.alarms won't fire sooner than this; shorter waits use a timer while
// the worker is awake.
const MIN_ALARM_MS = 30_000;

// Popup messages are authenticated, but still validate before writing the vault.
const destinationSchema = z.object({
    ID: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    Name: z.string().max(64),
    Endpoint: z.string().max(512),
    Region: z.string().max(32),
    Bucket: z.string().max(63),
    Prefix: z.string().max(256),
    PathStyle: z.boolean(),
    AccessKeyID: z.string().max(256),
    SecretAccessKey: z.string().max(256),
    KeepAll: z.boolean(),
    Paused: z.boolean(),
    CreatedAtTimestamp: z.number().int().nonnegative(),
    Hash: z.string().max(128),
    Version: z.number().int().nonnegative(),
    DateModifiedTimestamp: z.number().int().nonnegative(),
    Deleted: z.boolean(),
});

const idSchema = destinationSchema.shape.ID;

const changePayloadSchema = z.object({
    change: z.discriminatedUnion("type", [
        z.object({ type: z.literal("add"), record: destinationSchema }),
        z.object({
            type: z.literal("edit"),
            id: idSchema,
            input: destinationSchema.pick({
                Name: true,
                Endpoint: true,
                Region: true,
                Bucket: true,
                Prefix: true,
                PathStyle: true,
                AccessKeyID: true,
                SecretAccessKey: true,
                KeepAll: true,
            }),
        }),
        z.object({
            type: z.literal("pause"),
            id: idSchema,
            paused: z.boolean(),
        }),
        z.object({ type: z.literal("remove"), id: idSchema }),
    ]),
});

const backupNowPayloadSchema = z.object({ id: idSchema });

export function parseBackupDestinationChangePayload(
    payload: unknown,
): BackupDestinationChange | null {
    const parsed = changePayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data.change : null;
}

/** Keeps the well-formed records a peer sent and drops the rest. */
export function parseSyncedBackupDestinations(
    records: unknown,
): VaultUtilTypes.BackupDestination[] {
    if (!Array.isArray(records)) return [];
    return records.flatMap((record) => {
        const parsed = destinationSchema.safeParse(record);
        return parsed.success ? [parsed.data] : [];
    });
}

export function parseBackupDestinationNowPayload(
    payload: unknown,
): string | null {
    const parsed = backupNowPayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data.id : null;
}

type UnlockedVault = {
    vault: VaultUtilTypes.Vault;
    metadata: VaultUtilTypes.VaultMetadata;
    dek: CryptoKey;
};

/** The vault with this installation's backup folder name and marker key. */
export function withBackupDeviceIdentity(
    vault: VaultUtilTypes.Vault,
): VaultUtilTypes.Vault {
    const linked = vault.LinkedDevices;
    if (!linked) throw new Error("VAULT_INVALID");
    const identity = newBackupDeviceIdentity(linked, "extension");
    return identity
        ? { ...vault, LinkedDevices: { ...linked, ...identity } }
        : vault;
}

async function sourceHashOf({
    vault,
    metadata,
}: UnlockedVault): Promise<string | null> {
    const envelope = metadata.Blob?.Envelope;
    const key = vault.LinkedDevices?.BackupMarkerKey;
    return envelope && key ? backupSourceHash(vault, envelope, key) : null;
}

export type ServiceWorkerBackupDestinationsDeps = {
    getUnlocked(): Promise<UnlockedVault | null>;
    /** Saves the vault through the worker's write queue. */
    saveVault(
        update: (vault: VaultUtilTypes.Vault) => VaultUtilTypes.Vault,
    ): Promise<VaultUtilTypes.Vault>;
};

/**
 * Runs backup destination uploads in the service worker. The worker can stop
 * between events, so destinations are cached from every save and anything
 * left pending is picked up again when it wakes while unlocked.
 */
export function createServiceWorkerBackupDestinations(
    deps: ServiceWorkerBackupDestinationsDeps,
) {
    let destinations: VaultUtilTypes.BackupDestination[] = [];
    let vaultID = "";
    let running: Promise<void> | null = null;
    let alarmRun: (() => Promise<void>) | null = null;
    let statuses: Record<string, BackupDestinationStatus> = {};
    /** Bumped on stop, so a read that started before a lock is dropped. */
    let generation = 0;

    const cache = (unlocked: Pick<UnlockedVault, "vault" | "metadata">) => {
        destinations = unlocked.vault.BackupDestinations ?? [];
        vaultID = unlocked.metadata.Blob?.Envelope?.VaultID ?? "";
    };

    const stateKey = (destinationID: string) =>
        `${STATE_PREFIX}${vaultID}:${destinationID}`;

    const scheduler = new BackupDestinationScheduler({
        getDestinations: () => destinations,
        getDeviceID: async () => {
            const linked = (await deps.getUnlocked())?.vault.LinkedDevices;
            if (linked && !newBackupDeviceIdentity(linked, "extension")) {
                return linked.BackupDeviceID;
            }
            const saved = await deps.saveVault(withBackupDeviceIdentity);
            return saved.LinkedDevices?.BackupDeviceID ?? "";
        },
        getSourceHash: async () => {
            const unlocked = await deps.getUnlocked();
            return unlocked ? sourceHashOf(unlocked) : null;
        },
        // A key change stores the new key and envelope one after the other.
        createBackup: () =>
            vaultWriteCoordinator.readBetweenKeyChanges(async () => {
                const unlocked = await deps.getUnlocked();
                const sourceHash = unlocked
                    ? await sourceHashOf(unlocked)
                    : null;
                if (!unlocked?.metadata.Blob || !sourceHash) {
                    throw new Error("VAULT_NOT_UNLOCKED");
                }
                const result = await createEncryptedBackupBytes(
                    unlocked.vault,
                    unlocked.metadata.Blob,
                    unlocked.dek,
                );
                if (!result.ok) throw new Error(result.error);
                return { bytes: result.backup.bytes, sourceHash };
            }),
        loadState: async (destinationID) => {
            const key = stateKey(destinationID);
            const stored = (await chrome.storage.local.get(key))[key];
            return (stored as BackupDestinationState | undefined) ?? null;
        },
        saveState: (destinationID, state) =>
            chrome.storage.local.set({ [stateKey(destinationID)]: state }),
        onStatus: (destinationID, status) => {
            statuses[destinationID] = status;
        },
        setTimer: (delayMs, run) => {
            if (delayMs < MIN_ALARM_MS) {
                const timer = setTimeout(() => void run(), delayMs);
                return () => clearTimeout(timer);
            }
            alarmRun = run;
            void chrome.alarms.create(BACKUP_DESTINATION_ALARM, {
                when: Date.now() + delayMs,
            });
            return () => {
                alarmRun = null;
                void chrome.alarms.clear(BACKUP_DESTINATION_ALARM);
            };
        },
        onError: (destinationID, error) =>
            console.warn("[SW] Backup destination upload failed", {
                destinationID,
                code: error instanceof S3Error ? error.code : undefined,
            }),
    });

    /** Starts once per unlock, or after the worker restarts while unlocked. */
    const ensureStarted = async (): Promise<boolean> => {
        if (!running) {
            const started = generation;
            const unlocked = await deps.getUnlocked();
            if (!unlocked || started !== generation) return false;
            cache(unlocked);
            running = scheduler.start();
        }
        await running;
        return true;
    };

    const stop = () => {
        generation += 1;
        running = null;
        alarmRun = null;
        destinations = [];
        statuses = {};
        scheduler.stop();
        void chrome.alarms.clear(BACKUP_DESTINATION_ALARM);
    };

    return {
        ensureStarted,
        stop,
        /** Call after every vault save. */
        vaultSaved(
            vault: VaultUtilTypes.Vault,
            metadata: VaultUtilTypes.VaultMetadata,
        ) {
            cache({ vault, metadata });
            scheduler.markDirty();
        },
        async onAlarm() {
            const run = alarmRun;
            alarmRun = null;
            // After a restart the closure is gone; starting again uploads
            // whatever is still pending.
            if (run) await run();
            else await ensureStarted();
        },
        async getView() {
            if (!(await ensureStarted())) return null;
            await scheduler.refresh();
            return { destinations, statuses: { ...statuses } };
        },
        async backupNow(destinationID: string) {
            if (!(await ensureStarted())) throw new Error("VAULT_NOT_UNLOCKED");
            await scheduler.backupNow(destinationID);
        },
        flushBeforeLock: () => scheduler.flushBeforeLock(),
        async replaceAfterSecurityChange(deleteOlder: boolean) {
            if (await ensureStarted()) {
                await scheduler.replaceAfterSecurityChange(deleteOlder);
            }
        },
    };
}
