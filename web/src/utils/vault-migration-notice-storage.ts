// TODO: Remove migration notice localStorage helpers after December 31, 2026.
const STORAGE_KEY_PREFIX = "cryptex.vault.migrationNoticeAcknowledged";

function getStorageKey(dbIndex: number): string {
    return `${STORAGE_KEY_PREFIX}:db:${dbIndex}`;
}

export function isVaultMigrationNoticeAcknowledged(dbIndex: number): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    try {
        return localStorage.getItem(getStorageKey(dbIndex)) === "1";
    } catch {
        return false;
    }
}

export function rememberVaultMigrationNoticeAcknowledged(
    dbIndex: number,
): void {
    if (typeof window === "undefined") {
        return;
    }

    try {
        localStorage.setItem(getStorageKey(dbIndex), "1");
    } catch {
        // Local storage can be unavailable in private browsing or locked-down contexts.
    }
}
