export type MobileLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type MobileLogEntry = {
    id: number;
    timestamp: string;
    group: string;
    level: MobileLogLevel;
    message: string;
    details?: unknown;
};

const MAX_LOGS = 500;
const SECRET_KEY = /password|secret|token|private|cipher|payload|phrase|dek|key/i;
let sequence = 0;
let entries: MobileLogEntry[] = [];

function redact(value: unknown, depth = 0): unknown {
    if (depth > 4) return "[truncated]";
    if (value instanceof Error) {
        return { name: value.name, message: value.message };
    }
    if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, item]) => [
                key,
                SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1),
            ]),
        );
    }
    return value;
}

function add(group: string, level: MobileLogLevel, message: string, details?: unknown) {
    entries.push({
        id: sequence++,
        timestamp: new Date().toISOString(),
        group,
        level,
        message,
        details: details === undefined ? undefined : redact(details),
    });
    if (entries.length > MAX_LOGS) entries = entries.slice(-MAX_LOGS);

    if (__DEV__) {
        const args = details === undefined ? [message] : [message, redact(details)];
        if (level === "ERROR") console.error(`[${group}]`, ...args);
        else if (level === "WARN") console.warn(`[${group}]`, ...args);
        else if (level === "INFO") console.info(`[${group}]`, ...args);
        else console.debug(`[${group}]`, ...args);
    }
}

function makeLogger(group: string) {
    return {
        debug: (message: string, details?: unknown) => add(group, "DEBUG", message, details),
        info: (message: string, details?: unknown) => add(group, "INFO", message, details),
        warn: (message: string, details?: unknown) => add(group, "WARN", message, details),
        error: (message: string, details?: unknown) => add(group, "ERROR", message, details),
        clearAll: () => {
            entries = [];
            sequence = 0;
        },
    };
}

export const vaultLogger = {
    getAllLogs: () => [...entries],
    exportAsJSON: () => JSON.stringify(entries, null, 2),
    clearAll: () => {
        entries = [];
        sequence = 0;
    },
};

export const vaultLog = makeLogger("vault");
export const syncLog = makeLogger("sync");
export const webrtcLog = makeLogger("webrtc");
export const signalingLog = makeLogger("signaling");
export const onlineServicesLog = makeLogger("online-services");
export const passkeyLog = makeLogger("passkey");
