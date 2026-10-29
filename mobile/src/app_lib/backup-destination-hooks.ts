// Lets vault-mutations and vault-lock reach the scheduler without an import cycle.

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
