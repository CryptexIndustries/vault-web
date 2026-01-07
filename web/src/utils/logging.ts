/**
 * Centralized, structured, in-memory logging.
 * Logs are automatically cleared when the user locks the vault.
 */

export enum LogGroup {
    WebRTC = "WebRTC",
    Signaling = "Signaling",
    Synchronization = "Synchronization",
    // UI = "UI",
    // Encryption = "Encryption",
    // Storage = "Storage",
    General = "General",
}

export enum LogLevel {
    Debug = "DEBUG",
    Info = "INFO",
    Warn = "WARN",
    Error = "ERROR",
}

export interface LogEntry {
    id: string;
    timestamp: Date;
    group: LogGroup;
    level: LogLevel;
    message: string;
    data?: unknown;
}

// Maximum number of log entries to retain per group
const MAX_LOGS_PER_GROUP = 500;

class VaultLogger {
    private logs: Map<LogGroup, LogEntry[]>;
    private logCounter: number;
    private enabled: boolean;

    constructor() {
        this.logs = new Map();
        this.logCounter = 0;
        this.enabled = true;

        // Initialize empty arrays for each group
        for (const group of Object.values(LogGroup)) {
            this.logs.set(group as LogGroup, []);
        }
    }

    /**
     * Enable or disable logging
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    /**
     * Check if logging is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Internal method to add a log entry
     */
    private addLog(group: LogGroup, level: LogLevel, message: string, data?: unknown): void {
        if (!this.enabled) return;

        const entry: LogEntry = {
            id: `${Date.now()}-${this.logCounter++}`,
            timestamp: new Date(),
            group,
            level,
            message,
            data,
        };

        const groupLogs = this.logs.get(group) ?? [];
        groupLogs.push(entry);

        // Trim old logs if we exceed the maximum
        if (groupLogs.length > MAX_LOGS_PER_GROUP) {
            groupLogs.splice(0, groupLogs.length - MAX_LOGS_PER_GROUP);
        }

        this.logs.set(group, groupLogs);

        // Also output to console in development
        if (process.env.NODE_ENV === "development") {
            const prefix = `[${group}]`;
            const consoleData = data !== undefined ? [message, data] : [message];
            switch (level) {
                case LogLevel.Debug:
                    console.debug(prefix, ...consoleData);
                    break;
                case LogLevel.Info:
                    console.info(prefix, ...consoleData);
                    break;
                case LogLevel.Warn:
                    console.warn(prefix, ...consoleData);
                    break;
                case LogLevel.Error:
                    console.error(prefix, ...consoleData);
                    break;
            }
        }
    }

    /**
     * Log a debug message
     */
    debug(group: LogGroup, message: string, data?: unknown): void {
        this.addLog(group, LogLevel.Debug, message, data);
    }

    /**
     * Log an info message
     */
    info(group: LogGroup, message: string, data?: unknown): void {
        this.addLog(group, LogLevel.Info, message, data);
    }

    /**
     * Log a warning message
     */
    warn(group: LogGroup, message: string, data?: unknown): void {
        this.addLog(group, LogLevel.Warn, message, data);
    }

    /**
     * Log an error message
     */
    error(group: LogGroup, message: string, data?: unknown): void {
        this.addLog(group, LogLevel.Error, message, data);
    }

    /**
     * Get all logs for a specific group
     */
    getLogsByGroup(group: LogGroup): LogEntry[] {
        return [...(this.logs.get(group) ?? [])];
    }

    /**
     * Get all logs across all groups
     */
    getAllLogs(): LogEntry[] {
        const allLogs: LogEntry[] = [];
        for (const groupLogs of this.logs.values()) {
            allLogs.push(...groupLogs);
        }
        // Sort by timestamp
        return allLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }

    /**
     * Get logs filtered by multiple criteria
     */
    getFilteredLogs(options: {
        groups?: LogGroup[];
        levels?: LogLevel[];
        since?: Date;
        searchText?: string;
    }): LogEntry[] {
        let logs = this.getAllLogs();

        if (options.groups && options.groups.length > 0) {
            logs = logs.filter(log => options.groups!.includes(log.group));
        }

        if (options.levels && options.levels.length > 0) {
            logs = logs.filter(log => options.levels!.includes(log.level));
        }

        if (options.since) {
            logs = logs.filter(log => log.timestamp >= options.since!);
        }

        if (options.searchText) {
            const searchLower = options.searchText.toLowerCase();
            logs = logs.filter(log => 
                log.message.toLowerCase().includes(searchLower) ||
                (log.data && JSON.stringify(log.data).toLowerCase().includes(searchLower))
            );
        }

        return logs;
    }

    /**
     * Clear all logs - should be called when user leaves the vault
     */
    clearAll(): void {
        for (const group of Object.values(LogGroup)) {
            this.logs.set(group as LogGroup, []);
        }
        this.logCounter = 0;
    }

    /**
     * Clear logs for a specific group
     */
    clearGroup(group: LogGroup): void {
        this.logs.set(group, []);
    }

    /**
     * Get the count of logs per group
     */
    getLogCounts(): Record<LogGroup, number> {
        const counts: Record<LogGroup, number> = {} as Record<LogGroup, number>;
        for (const [group, logs] of this.logs.entries()) {
            counts[group] = logs.length;
        }
        return counts;
    }

    /**
     * Export logs as JSON string (useful for debugging/support)
     */
    exportAsJSON(options?: {
        groups?: LogGroup[];
        levels?: LogLevel[];
    }): string {
        const logs = options 
            ? this.getFilteredLogs(options)
            : this.getAllLogs();
        
        return JSON.stringify(logs, null, 2);
    }
}

// Singleton instance
export const vaultLogger = new VaultLogger();

// Convenience functions for synchronization logging
export const syncLog = {
    debug: (message: string, data?: unknown) => vaultLogger.debug(LogGroup.Synchronization, message, data),
    info: (message: string, data?: unknown) => vaultLogger.info(LogGroup.Synchronization, message, data),
    warn: (message: string, data?: unknown) => vaultLogger.warn(LogGroup.Synchronization, message, data),
    error: (message: string, data?: unknown) => vaultLogger.error(LogGroup.Synchronization, message, data),
};

// Convenience functions for WebRTC logging (sub-category of sync)
export const webrtcLog = {
    debug: (message: string, data?: unknown) => vaultLogger.debug(LogGroup.WebRTC, message, data),
    info: (message: string, data?: unknown) => vaultLogger.info(LogGroup.WebRTC, message, data),
    warn: (message: string, data?: unknown) => vaultLogger.warn(LogGroup.WebRTC, message, data),
    error: (message: string, data?: unknown) => vaultLogger.error(LogGroup.WebRTC, message, data),
};

// Convenience functions for Signaling logging (sub-category of sync)
export const signalingLog = {
    debug: (message: string, data?: unknown) => vaultLogger.debug(LogGroup.Signaling, message, data),
    info: (message: string, data?: unknown) => vaultLogger.info(LogGroup.Signaling, message, data),
    warn: (message: string, data?: unknown) => vaultLogger.warn(LogGroup.Signaling, message, data),
    error: (message: string, data?: unknown) => vaultLogger.error(LogGroup.Signaling, message, data),
};
