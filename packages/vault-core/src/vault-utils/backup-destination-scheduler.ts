/**
 * Uploads the encrypted vault to every active backup destination after
 * changes. The apps supply storage, the backup and a timer; this keeps the
 * debounce, retries and per-destination status in one place.
 *
 * Each unlock starts a session, and a session runs one pass at a time. stop()
 * drops the session, so a pass still running from it stops at its next step
 * and can't touch the next session's state or backups.
 */

import type * as VaultUtilTypes from "../proto/vault";
import { uploadToBackupDestination } from "./backup-destination-transfers";
import { visibleBackupDestinations } from "./backup-destinations";
import { S3Error, type S3Fetch } from "./s3-client";

export const BACKUP_DESTINATION_DEBOUNCE_MS = 30_000;
const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;

/** Kept on this device per vault and destination. Holds no secrets. */
export type BackupDestinationState = {
    /** backupSourceHash of the vault the last good upload held. */
    sourceHash: string | null;
    lastSuccessAt: number | null;
    lastError: { message: string; at: number } | null;
    /** The last upload worked, but removing old backups didn't. */
    pruneError: string | null;
    /**
     * A security change asked to delete this device's older backups here,
     * and that hasn't happened yet. Survives a lock.
     */
    deleteOlder?: boolean;
};

export type BackupDestinationStatus = BackupDestinationState & {
    phase: "idle" | "scheduled" | "uploading" | "error" | "paused";
    retryAt: number | null;
};

export type BackupDestinationSchedulerDeps = {
    getDestinations(): readonly VaultUtilTypes.BackupDestination[];
    /**
     * This installation's folder name. The first call also creates the
     * marker key, and saves the vault.
     */
    getDeviceID(): Promise<string>;
    /** backupSourceHash of the vault now; null while locked or before getDeviceID. */
    getSourceHash(): Promise<string | null>;
    /** The encrypted backup, and the source hash of the vault it holds. */
    createBackup(): Promise<{ bytes: Uint8Array; sourceHash: string }>;
    loadState(destinationID: string): Promise<BackupDestinationState | null>;
    saveState(
        destinationID: string,
        state: BackupDestinationState,
    ): Promise<void>;
    onStatus(destinationID: string, status: BackupDestinationStatus): void;
    setTimer?(delayMs: number, run: () => Promise<void>): () => void;
    onError?(destinationID: string, error: unknown): void;
    /** Overrides the stored error text, such as to add platform hints. */
    describeError?(error: unknown): string | null;
    fetch?: S3Fetch;
};

type Destination = VaultUtilTypes.BackupDestination;

type Pass =
    /** Every destination behind the vault or waiting to delete older backups. */
    | { type: "all" }
    /** Retries due by `at`, or everything pending once a save's debounce is up. */
    | { type: "timer"; at: number }
    /** One destination, even if it's current. Rejects with the failure. */
    | { type: "one"; id: string };

class Session {
    readonly states = new Map<string, BackupDestinationState>();
    /** Retryable failures since the last save. */
    readonly retries = new Map<string, { delayMs: number; at: number }>();
    readonly uploading = new Set<string>();
    sourceHash: string | null = null;
    /** End of the debounce after the last save; null when no save waits. */
    debounceAt: number | null = null;
    cancelTimer: (() => void) | null = null;
    /** The last queued pass. */
    queue: Promise<void> = Promise.resolve();
}

const emptyState = (): BackupDestinationState => ({
    sourceHash: null,
    lastSuccessAt: null,
    lastError: null,
    pruneError: null,
});

const errorMessage = (error: unknown): string =>
    error instanceof S3Error
        ? error.message
        : "The backup couldn't be created on this device.";

export class BackupDestinationScheduler {
    private session: Session | null = null;

    constructor(private readonly deps: BackupDestinationSchedulerDeps) {}

    /** Call after unlock. Uploads anything that changed while locked. */
    async start(): Promise<void> {
        this.stop();
        const session = new Session();
        this.session = session;
        // Name this device's folder now: the app may flush while locking,
        // inside its write queue, where saving the vault would have to wait.
        if (this.active().length > 0) {
            await this.deps.getDeviceID().catch(() => undefined);
        }
        await this.refresh();
        if (this.session !== session) return;
        if (this.pending(session).length > 0) {
            session.debounceAt = Date.now();
            this.arm(session);
        }
    }

    stop(): void {
        this.session?.cancelTimer?.();
        this.session = null;
    }

    /** Call after every vault save. */
    markDirty(): void {
        const session = this.session;
        if (!session) return;
        session.retries.clear();
        // A destination may have just arrived by sync. Name this device's
        // folder now, outside the write queue a later lock would hold.
        if (this.active().length > 0) {
            void this.deps.getDeviceID().catch(() => undefined);
        }
        const now = Date.now();
        session.debounceAt = now + BACKUP_DESTINATION_DEBOUNCE_MS;
        this.arm(session, now);
        void this.refresh();
    }

    /** Uploads to one destination now, even if it's current. */
    async backupNow(destinationID: string): Promise<void> {
        const session = this.session;
        if (session)
            await this.enqueue(session, { type: "one", id: destinationID });
    }

    /**
     * Call after a security change, which leaves every destination behind.
     * Uploads right away. With deleteOlder, each destination's next good
     * upload also deletes this device's older backups there, which the old
     * secrets still open. That request is stored, so it outlives a lock.
     */
    async replaceAfterSecurityChange(deleteOlder: boolean): Promise<void> {
        const session = this.session;
        if (!session) return;
        await this.refresh();
        if (deleteOlder) {
            // Paused ones too, so resuming one deletes its old backups.
            for (const destination of this.activeAndPaused()) {
                if (this.session !== session) return;
                await this.saveState(session, destination.ID, {
                    ...(session.states.get(destination.ID) ?? emptyState()),
                    deleteOlder: true,
                });
            }
        }
        await this.enqueue(session, { type: "all" });
    }

    /** Best effort before locking, bounded so the lock never hangs. */
    async flushBeforeLock(timeoutMs = 5_000): Promise<void> {
        const session = this.session;
        if (!session) return;
        await this.refresh();
        if (this.pending(session).length === 0) return;
        await Promise.race([
            this.enqueue(session, { type: "all" }),
            new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
        ]);
    }

    /** Re-reads stored state and publishes every destination's status. */
    async refresh(): Promise<void> {
        const session = this.session;
        if (!session) return;
        for (const destination of this.activeAndPaused()) {
            if (session.states.has(destination.ID)) continue;
            const stored = await this.deps.loadState(destination.ID);
            if (this.session !== session) return;
            if (!session.states.has(destination.ID)) {
                session.states.set(destination.ID, stored ?? emptyState());
            }
        }
        const sourceHash = await this.deps.getSourceHash();
        if (this.session !== session) return;
        session.sourceHash = sourceHash;
        for (const destination of this.activeAndPaused()) {
            this.publish(session, destination);
        }
    }

    private activeAndPaused(): Destination[] {
        return visibleBackupDestinations(this.deps.getDestinations());
    }

    private active(): Destination[] {
        return this.activeAndPaused().filter(
            (destination) => !destination.Paused,
        );
    }

    /**
     * Active destinations whose last good upload isn't of the vault as it
     * is, or that still have to delete older backups.
     */
    private pending(session: Session): Destination[] {
        const { sourceHash } = session;
        if (!sourceHash) return [];
        return this.active().filter((destination) => {
            const state = session.states.get(destination.ID);
            return state?.sourceHash !== sourceHash || state.deleteOlder;
        });
    }

    private publish(session: Session, destination: Destination): void {
        const state = session.states.get(destination.ID) ?? emptyState();
        const phase = destination.Paused
            ? "paused"
            : session.uploading.has(destination.ID)
              ? "uploading"
              : state.lastError
                ? "error"
                : session.sourceHash && state.sourceHash !== session.sourceHash
                  ? "scheduled"
                  : "idle";
        this.deps.onStatus(destination.ID, {
            ...state,
            phase,
            retryAt: session.retries.get(destination.ID)?.at ?? null,
        });
    }

    /** Sets the timer for the next pass: the end of the debounce, or the first retry. */
    private arm(session: Session, now = Date.now()): void {
        session.cancelTimer?.();
        session.cancelTimer = null;
        const at = Math.min(
            session.debounceAt ?? Infinity,
            ...[...session.retries.values()].map((retry) => retry.at),
        );
        if (!Number.isFinite(at)) return;
        const run = async () => {
            if (this.session !== session) return;
            session.cancelTimer = null;
            await this.enqueue(session, { type: "timer", at }).catch(
                () => undefined,
            );
        };
        const delayMs = Math.max(0, at - now);
        if (this.deps.setTimer) {
            session.cancelTimer = this.deps.setTimer(delayMs, run);
            return;
        }
        const timer = setTimeout(() => void run(), delayMs);
        session.cancelTimer = () => clearTimeout(timer);
    }

    private enqueue(session: Session, pass: Pass): Promise<void> {
        const run = session.queue.then(() => this.run(session, pass));
        session.queue = run.catch(() => undefined);
        return run;
    }

    private async run(session: Session, pass: Pass): Promise<void> {
        if (this.session !== session) return;
        await this.refresh();
        if (this.session !== session || !session.sourceHash) return;

        // Retries of destinations now current, paused or removed would only
        // wake the timer for nothing.
        const pending = this.pending(session);
        for (const id of session.retries.keys()) {
            if (!pending.some((destination) => destination.ID === id)) {
                session.retries.delete(id);
            }
        }

        let targets: Destination[];
        if (pass.type === "one") {
            targets = this.active().filter(
                (destination) => destination.ID === pass.id,
            );
        } else {
            // A pending save covers everything pending, even retries not due.
            const full = pass.type === "all" || session.debounceAt != null;
            session.debounceAt = null;
            targets = pending.filter((destination) => {
                const retry = session.retries.get(destination.ID);
                return full || (retry != null && retry.at <= pass.at);
            });
        }
        if (targets.length === 0) {
            this.arm(session);
            return;
        }

        let deviceID: string;
        let backup: { bytes: Uint8Array; sourceHash: string };
        try {
            deviceID = await this.deps.getDeviceID();
            backup = await this.deps.createBackup();
        } catch (error) {
            for (const target of targets) {
                await this.fail(session, target, error);
            }
            this.arm(session);
            if (pass.type === "one") throw error;
            return;
        }

        let firstError: unknown = null;
        for (const target of targets) {
            if (this.session !== session) return;
            // Use the latest settings, and skip destinations paused or
            // removed while earlier uploads ran.
            const destination = this.active().find(
                (candidate) => candidate.ID === target.ID,
            );
            if (!destination) continue;
            const deleteOlder =
                session.states.get(destination.ID)?.deleteOlder ?? false;
            // Settings changed or the destination went away while uploading:
            // delete nothing on the strength of the old ones.
            const unchanged = () =>
                this.session === session &&
                this.active().some(
                    (candidate) =>
                        candidate.ID === destination.ID &&
                        candidate.Hash === destination.Hash,
                );
            session.uploading.add(destination.ID);
            this.publish(session, destination);
            try {
                const result = await uploadToBackupDestination(
                    destination,
                    deviceID,
                    backup.bytes,
                    {
                        fetch: this.deps.fetch,
                        deleteOlder,
                        stillCurrent: unchanged,
                    },
                );
                if (this.session !== session) return;
                const stillToDelete =
                    deleteOlder && (result.pruneError != null || !unchanged());
                // Without this retry, a failed deletion would wait for the
                // next vault change, since the destination is current now.
                if (stillToDelete && result.pruneError) {
                    this.scheduleRetry(
                        session,
                        destination.ID,
                        result.pruneError,
                    );
                } else {
                    session.retries.delete(destination.ID);
                }
                await this.saveState(session, destination.ID, {
                    sourceHash: backup.sourceHash,
                    lastSuccessAt: Date.now(),
                    lastError: null,
                    pruneError: result.pruneError
                        ? (this.deps.describeError?.(result.pruneError) ??
                          result.pruneError.message)
                        : null,
                    deleteOlder: stillToDelete,
                });
            } catch (error) {
                if (this.session !== session) return;
                firstError ??= error;
                await this.fail(session, destination, error);
            } finally {
                session.uploading.delete(destination.ID);
                if (this.session === session) {
                    this.publish(session, destination);
                }
            }
        }
        this.arm(session);
        if (pass.type === "one" && firstError) throw firstError;
    }

    private async fail(
        session: Session,
        destination: Destination,
        error: unknown,
    ): Promise<void> {
        if (this.session !== session) return;
        this.deps.onError?.(destination.ID, error);
        this.scheduleRetry(session, destination.ID, error);
        const previous = session.states.get(destination.ID) ?? emptyState();
        await this.saveState(session, destination.ID, {
            ...previous,
            lastError: {
                message:
                    this.deps.describeError?.(error) ?? errorMessage(error),
                at: Date.now(),
            },
        });
        this.publish(session, destination);
    }

    /** Backs off on retryable errors. A refusal won't fix itself; the next save tries again. */
    private scheduleRetry(
        session: Session,
        destinationID: string,
        error: unknown,
    ): void {
        if (!(error instanceof S3Error && error.retryable)) {
            session.retries.delete(destinationID);
            return;
        }
        const previous = session.retries.get(destinationID);
        const delayMs = previous
            ? Math.min(MAX_RETRY_MS, previous.delayMs * 2)
            : FIRST_RETRY_MS;
        session.retries.set(destinationID, {
            delayMs,
            at: Date.now() + delayMs,
        });
    }

    private async saveState(
        session: Session,
        destinationID: string,
        state: BackupDestinationState,
    ): Promise<void> {
        session.states.set(destinationID, state);
        await this.deps.saveState(destinationID, state).catch(() => undefined);
    }
}
