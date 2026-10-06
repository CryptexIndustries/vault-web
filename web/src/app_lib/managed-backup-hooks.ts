// Facade so vault-mutations / vault-lock can nudge backups without importing
// the coordinator directly (keeps the module graph cycle-free).
import { normalizeManagedBackupError } from "./managed-backup-errors";

export const VAULT_SECURITY_BACKUP_EVENT = "cryptex:vault-security-backup";

export type VaultSecurityBackupEventDetail = {
    status: "skipped" | "error";
    message: string;
};

type ManagedBackupHooks = {
    markDirty: () => void;
    backupNow: (deleteOlderSnapshots: boolean) => Promise<void>;
    flushBeforeLock: () => Promise<void>;
    stop: () => void;
};

let hooks: ManagedBackupHooks | null = null;

export function registerManagedBackupHooks(next: ManagedBackupHooks): void {
    hooks = next;
}

export function markManagedBackupDirty(): void {
    hooks?.markDirty();
}

/** Queue an immediate upload without coupling a local write to network health. */
export function queueManagedBackupNow(deleteOlderSnapshots = false): void {
    void hooks?.backupNow(deleteOlderSnapshots).catch((error) => {
        if (typeof window === "undefined") return;
        const normalized = normalizeManagedBackupError(error);
        const detail: VaultSecurityBackupEventDetail = {
            status:
                normalized.code === "BACKUP_NOT_ENABLED" ? "skipped" : "error",
            message: normalized.message,
        };
        window.dispatchEvent(
            new CustomEvent(VAULT_SECURITY_BACKUP_EVENT, { detail }),
        );
    });
}

export async function flushManagedBackupBeforeLock(): Promise<void> {
    await hooks?.flushBeforeLock();
}

export function stopManagedBackup(): void {
    hooks?.stop();
}
