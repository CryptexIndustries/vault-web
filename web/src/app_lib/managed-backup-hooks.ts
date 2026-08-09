// Facade so vault-mutations / vault-lock can nudge backups without importing
// the coordinator directly (keeps the module graph cycle-free).
type ManagedBackupHooks = {
    markDirty: () => void;
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

export async function flushManagedBackupBeforeLock(): Promise<void> {
    await hooks?.flushBeforeLock();
}

export function stopManagedBackup(): void {
    hooks?.stop();
}
