type ManagedBackupHooks = {
    markDirty: () => void;
    backupNow: (deleteOlderSnapshots: boolean) => Promise<void>;
    flushBeforeLock: () => Promise<void>;
    stop: () => void;
};

let hooks: ManagedBackupHooks | null = null;

export function registerManagedBackupHooks(next: ManagedBackupHooks) {
    hooks = next;
}

export function markManagedBackupDirty() {
    hooks?.markDirty();
}

export function queueManagedBackupNow(
    deleteOlderSnapshots = false,
): Promise<void> {
    if (!hooks)
        return Promise.reject(new Error("Managed backups are unavailable."));
    return hooks.backupNow(deleteOlderSnapshots);
}

export async function flushManagedBackupBeforeLock() {
    await hooks?.flushBeforeLock();
}

export function stopManagedBackup() {
    hooks?.stop();
}
