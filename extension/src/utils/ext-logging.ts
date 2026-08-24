/**
 * Extension-side logging adapter.
 *
 * Forwards every log to the shared in-memory `vaultLogger` (so consumers in the
 * web codebase keep working) and persists each entry to `chrome.storage.local`
 * so diagnostic history survives popup teardown.
 */

import {
    LogGroup,
    LogLevel,
    type LogEntry,
    vaultLogger,
} from "@/utils/logging";

export { LogGroup, LogLevel };
export type { LogEntry };

export const EXT_LOGS_STORAGE_KEY = "extLogs";
const MAX_STORED_LOGS = 2000;

export interface SerializedLogEntry extends Omit<LogEntry, "timestamp"> {
    timestamp: string;
}

const serialize = (entry: LogEntry): SerializedLogEntry => ({
    id: entry.id,
    timestamp: entry.timestamp.toISOString(),
    group: entry.group,
    level: entry.level,
    message: entry.message,
    data: entry.data,
});

let entryCounter = 0;
let writeQueue: Promise<void> = Promise.resolve();

const hasChromeStorage = (): boolean =>
    typeof chrome !== "undefined" && !!chrome.storage && !!chrome.storage.local;

const persist = (entry: LogEntry) => {
    if (!hasChromeStorage()) return;

    writeQueue = writeQueue
        .catch(() => undefined)
        .then(async () => {
            const result = await chrome.storage.local.get(EXT_LOGS_STORAGE_KEY);
            const existing = Array.isArray(result[EXT_LOGS_STORAGE_KEY])
                ? (result[EXT_LOGS_STORAGE_KEY] as SerializedLogEntry[])
                : [];
            existing.push(serialize(entry));
            if (existing.length > MAX_STORED_LOGS) {
                existing.splice(0, existing.length - MAX_STORED_LOGS);
            }
            await chrome.storage.local.set({
                [EXT_LOGS_STORAGE_KEY]: existing,
            });
        });
};

const makeEntry = (
    group: LogGroup,
    level: LogLevel,
    message: string,
    data?: unknown,
): LogEntry => ({
    id: `${Date.now()}-${entryCounter++}`,
    timestamp: new Date(),
    group,
    level,
    message,
    data,
});

const dispatch = (
    group: LogGroup,
    level: LogLevel,
    message: string,
    data?: unknown,
) => {
    switch (level) {
        case LogLevel.Debug:
            vaultLogger.debug(group, message, data);
            break;
        case LogLevel.Info:
            vaultLogger.info(group, message, data);
            break;
        case LogLevel.Warn:
            vaultLogger.warn(group, message, data);
            break;
        case LogLevel.Error:
            vaultLogger.error(group, message, data);
            break;
    }
    persist(makeEntry(group, level, message, data));
};

const channel = (group: LogGroup) => ({
    debug: (message: string, data?: unknown) =>
        dispatch(group, LogLevel.Debug, message, data),
    info: (message: string, data?: unknown) =>
        dispatch(group, LogLevel.Info, message, data),
    warn: (message: string, data?: unknown) =>
        dispatch(group, LogLevel.Warn, message, data),
    error: (message: string, data?: unknown) =>
        dispatch(group, LogLevel.Error, message, data),
});

export const uiLog = channel(LogGroup.UI);
export const vaultLog = channel(LogGroup.Vault);
export const signalingLog = channel(LogGroup.Signaling);
export const webrtcLog = channel(LogGroup.WebRTC);
export const onlineServicesLog = channel(LogGroup.OnlineServices);
export const importLog = channel(LogGroup.Import);
export const generalLog = channel(LogGroup.General);
export const syncLog = channel(LogGroup.Synchronization);
