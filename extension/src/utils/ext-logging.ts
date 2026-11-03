/**
 * Extension-side logging adapter. Forwards every log to the shared in-memory
 * `vaultLogger`, so consumers in the web codebase keep working.
 *
 * `vaultLogger` prints to the console only in development builds. Release
 * builds still print warnings and errors, so they stay visible in DevTools.
 */

import {
    LogGroup,
    LogLevel,
    type LogEntry,
    vaultLogger,
} from "@/utils/logging";

export { LogGroup, LogLevel };
export type { LogEntry };

/**
 * Older versions kept up to 2000 log entries under this chrome.storage.local
 * key and rewrote all of them for every new entry.
 */
export const LEGACY_EXT_LOGS_STORAGE_KEY = "extLogs";

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
    if (
        process.env.NODE_ENV !== "development" &&
        (level === LogLevel.Warn || level === LogLevel.Error)
    ) {
        const print = level === LogLevel.Warn ? console.warn : console.error;
        print(
            `[${group}]`,
            ...(data === undefined ? [message] : [message, data]),
        );
    }
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
