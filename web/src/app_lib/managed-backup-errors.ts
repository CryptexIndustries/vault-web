const BACKUP_ERRORS = {
    BACKUP_NOT_ENABLED: [
        "Managed backups are not enabled for this vault.",
        false,
    ],
    BACKUP_VAULT_UNAVAILABLE: [
        "The vault locked before the encrypted backup could be prepared. Unlock it and try again.",
        false,
    ],
    BACKUP_UPLOAD_NETWORK: [
        "Could not reach encrypted backup storage. Check your connection and try again.",
        true,
    ],
    BACKUP_UPLOAD_REJECTED: [
        "Encrypted backup storage rejected the upload.",
        false,
    ],
    BACKUP_DOWNLOAD_NETWORK: [
        "Could not download from encrypted backup storage. Check your connection and try again.",
        true,
    ],
    BACKUP_DOWNLOAD_REJECTED: [
        "Encrypted backup storage rejected the download.",
        false,
    ],
    BACKUP_INTEGRITY_FAILED: [
        "The downloaded backup failed its integrity check and was not used.",
        false,
    ],
    BACKUP_AUTH_REQUIRED: [
        "Your Online Services session expired. Sign in again, then retry the backup.",
        false,
    ],
    BACKUP_RATE_LIMITED: [
        "The backup service is receiving too many requests. Wait a moment and try again.",
        true,
    ],
    BACKUP_TOO_LARGE: [
        "This encrypted vault exceeds the managed-backup size limit.",
        false,
    ],
    BACKUP_UNAVAILABLE: [
        "Managed backups are not available for this account or storage configuration.",
        false,
    ],
    BACKUP_API_FAILED: [
        "The backup service could not complete the request. Try again in a moment.",
        true,
    ],
    BACKUP_HISTORY_DELETE_FAILED: [
        "The replacement backup succeeded, but older managed snapshots could not be deleted yet.",
        true,
    ],
} as const;

export type ManagedBackupErrorCode = keyof typeof BACKUP_ERRORS;

type ManagedBackupErrorOptions = {
    retryable?: boolean;
    status?: number;
    cause?: unknown;
};

/** A user-safe managed-backup failure. Never put signed URLs in its message. */
export class ManagedBackupError extends Error {
    readonly code: ManagedBackupErrorCode;
    readonly retryable: boolean;
    readonly status?: number;

    constructor(
        code: ManagedBackupErrorCode,
        options: ManagedBackupErrorOptions = {},
    ) {
        const details = BACKUP_ERRORS[code];
        const message =
            options.status == null
                ? details[0]
                : `${details[0].slice(0, -1)} (HTTP ${options.status}).`;
        super(message, { cause: options.cause });
        this.name = "ManagedBackupError";
        this.code = code;
        this.retryable = options.retryable ?? details[1];
        this.status = options.status;
    }
}

const TRPC_BACKUP_ERRORS: Partial<Record<string, ManagedBackupErrorCode>> = {
    UNAUTHORIZED: "BACKUP_AUTH_REQUIRED",
    TOO_MANY_REQUESTS: "BACKUP_RATE_LIMITED",
    PAYLOAD_TOO_LARGE: "BACKUP_TOO_LARGE",
    FORBIDDEN: "BACKUP_UNAVAILABLE",
    PRECONDITION_FAILED: "BACKUP_UNAVAILABLE",
    BAD_REQUEST: "BACKUP_UNAVAILABLE",
    NOT_FOUND: "BACKUP_UNAVAILABLE",
    CONFLICT: "BACKUP_UNAVAILABLE",
    INTERNAL_SERVER_ERROR: "BACKUP_API_FAILED",
    TIMEOUT: "BACKUP_API_FAILED",
};

function trpcCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object") return undefined;
    const data = (error as { data?: unknown }).data;
    if (!data || typeof data !== "object") return undefined;
    const code = (data as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
}

export function normalizeManagedBackupError(
    error: unknown,
): ManagedBackupError {
    if (error instanceof ManagedBackupError) return error;

    const apiCode = trpcCode(error);
    const backupCode = apiCode && TRPC_BACKUP_ERRORS[apiCode];
    return new ManagedBackupError(backupCode || "BACKUP_API_FAILED", {
        cause: error,
        // Code-less errors are usually transport failures. Unknown API codes
        // require a fresh user action instead of an automatic retry loop.
        ...(!backupCode ? { retryable: apiCode == null } : {}),
    });
}

export function managedBackupErrorMessage(
    error: unknown,
    fallback?: string,
): string {
    const normalized = normalizeManagedBackupError(error);
    return fallback && normalized.code === "BACKUP_API_FAILED"
        ? fallback
        : normalized.message;
}
