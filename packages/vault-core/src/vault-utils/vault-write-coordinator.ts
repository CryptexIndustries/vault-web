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
    | "link.merge"
    | "vault.configuration"
    | "vault.account"
    | "vault.unlock"
    | "vault.lock";

/**
 * A small single-writer actor. Rejections never poison the queue, so a failed
 * persistence attempt cannot prevent later writes (or a lock) from running.
 */
export class VaultWriteCoordinator {
    private tail: Promise<void> = Promise.resolve();

    public run<T>(
        _kind: VaultWriteKind,
        operation: () => Promise<T>,
    ): Promise<T> {
        const result = this.tail.then(operation);
        this.tail = result.then(
            () => undefined,
            () => undefined,
        );

        return result;
    }
}

export const vaultWriteCoordinator = new VaultWriteCoordinator();
