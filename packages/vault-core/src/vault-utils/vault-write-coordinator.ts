/**
 * Names every operation that is allowed to write an unlocked vault.
 *
 * Keep this list explicit: it is the audit surface for persisted vault
 * mutations. Callers provide the platform-specific load/save/commit work, and
 * the coordinator guarantees that only one write runs at a time.
 */
export type VaultWriteKind =
    | "credential.upsert"
    | "credential.delete"
    | "credentials.move"
    | "credentials.import"
    | "directory.create"
    | "directory.rename"
    | "directory.delete"
    | "synchronization.apply"
    | "share.update"
    | "share.settings"
    | "agent.pair"
    | "agent.update"
    | "agent.history"
    | "agent.revoke"
    | "agent.settings"
    | "backup.destinations"
    | "backup.device"
    | "link.merge"
    | "vault.configuration"
    | "vault.account"
    | "vault.security.reconfigure"
    | "vault.recovery.rotate"
    | "vault.unlock"
    | "vault.lock";

/** Writes that can replace the vault key or the envelope that wraps it. */
const KEY_CHANGES: ReadonlySet<VaultWriteKind> = new Set([
    "vault.security.reconfigure",
    "vault.recovery.rotate",
]);

/**
 * A small single-writer actor. Rejections never poison the queue, so a failed
 * persistence attempt cannot prevent later writes (or a lock) from running.
 */
export class VaultWriteCoordinator {
    private tail: Promise<void> = Promise.resolve();
    /** Settles when the key change running now ends; null when none runs. */
    private keyChange: Promise<void> | null = null;
    private keyChanges = 0;

    public run<T>(
        kind: VaultWriteKind,
        operation: () => Promise<T>,
    ): Promise<T> {
        if (!KEY_CHANGES.has(kind)) return this.enqueue(operation);
        return this.enqueue(async () => {
            let settle = () => {};
            this.keyChange = new Promise((resolve) => (settle = resolve));
            try {
                return await operation();
            } finally {
                this.keyChanges += 1;
                this.keyChange = null;
                settle();
            }
        });
    }

    /**
     * Reads the key and its envelope together without joining the queue, which
     * a lock holds while it waits for a last backup. Waits out a running key
     * change, and reads again if one ran meanwhile.
     */
    public async readBetweenKeyChanges<T>(read: () => Promise<T>): Promise<T> {
        for (;;) {
            await this.keyChange;
            const before = this.keyChanges;
            const result = await read();
            if (this.keyChanges === before && !this.keyChange) return result;
        }
    }

    /** Capture a consistent read while excluding queued vault writes. */
    public runSnapshot<T>(operation: () => Promise<T>): Promise<T> {
        return this.enqueue(operation);
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.tail.then(operation);
        this.tail = result.then(
            () => undefined,
            () => undefined,
        );

        return result;
    }
}

export const vaultWriteCoordinator = new VaultWriteCoordinator();
