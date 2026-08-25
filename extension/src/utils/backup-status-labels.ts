export type BackupHistoryAccessInput = {
    entitled: boolean;
    graceExpiresAt: Date | null;
};

export type AccountRecoveryProtection =
    | "none"
    | "pending"
    | "protected"
    | "degraded";

export function hasBackupHistoryAccess(
    status: BackupHistoryAccessInput,
    now = new Date(),
): boolean {
    if (status.entitled) return true;
    return (
        status.graceExpiresAt != null &&
        status.graceExpiresAt.getTime() > now.getTime()
    );
}

export function accountRecoveryProtectionLabel(
    protection: AccountRecoveryProtection,
): string {
    switch (protection) {
        case "protected":
            return "Protected";
        case "pending":
            return "Pending first root backup";
        case "degraded":
            return "Degraded";
        case "none":
            return "Unavailable";
    }
}

export function backupStorageUsage(
    storageBytes: number,
    maxAccountBytes: number,
): {
    percent: number;
    percentLabel: string;
    sizeLabel: string;
} {
    const percent = maxAccountBytes
        ? Math.max(0, (storageBytes / maxAccountBytes) * 100)
        : 0;
    const percentLabel =
        percent > 0 && percent < 1
            ? percent.toFixed(1)
            : Math.round(percent).toString();
    const sizeLabel =
        storageBytes >= 1024 * 1024
            ? `${(storageBytes / (1024 * 1024)).toFixed(1)} MiB`
            : `${(storageBytes / 1024).toFixed(1)} KiB`;
    return { percent, percentLabel, sizeLabel };
}
