// Facade so vault-mutations / vault-lock can reach the backup destination
// scheduler without importing it (keeps the module graph cycle-free).

type BackupDestinationHooks = {
    markDirty: () => void;
    flushBeforeLock: () => Promise<void>;
    replaceAfterSecurityChange: (deleteOlder: boolean) => Promise<void>;
    stop: () => void;
};

let hooks: BackupDestinationHooks | null = null;

export function registerBackupDestinationHooks(
    next: BackupDestinationHooks,
): void {
    hooks = next;
}

export function markBackupDestinationsDirty(): void {
    hooks?.markDirty();
}

export async function flushBackupDestinationsBeforeLock(): Promise<void> {
    await hooks?.flushBeforeLock();
}

export async function replaceBackupDestinationsAfterSecurityChange(
    deleteOlder: boolean,
): Promise<void> {
    await hooks?.replaceAfterSecurityChange(deleteOlder);
}

export function stopBackupDestinations(): void {
    hooks?.stop();
}
