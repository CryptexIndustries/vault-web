import { vaultLogger } from "@/utils/logging";
import type { GetLogsResponse, TransportLogEntry } from "../types/sw-messaging";

const errorReplacer = (_key: string, value: unknown) =>
    value instanceof Error
        ? { name: value.name, message: value.message }
        : value;

/**
 * The envelope JSON-encodes the whole response, so one entry with a cycle or
 * a BigInt would fail it. Errors would also turn into `{}`.
 */
function toTransportData(data: unknown): unknown {
    if (data === undefined) return undefined;
    try {
        return JSON.parse(JSON.stringify(data, errorReplacer));
    } catch {
        return String(data);
    }
}

/** Handles `MessageType.GetLogs`: the worker's logs, optionally since a time. */
export function readWorkerLogs(
    payload: unknown,
): GetLogsResponse | { ok: false; error: "INVALID_LOGS_REQUEST" } {
    let since: Date | undefined;
    if (payload != null) {
        if (typeof payload !== "object" || Array.isArray(payload)) {
            return { ok: false, error: "INVALID_LOGS_REQUEST" };
        }
        const raw = (payload as { since?: unknown }).since;
        if (raw !== undefined) {
            if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) {
                return { ok: false, error: "INVALID_LOGS_REQUEST" };
            }
            since = new Date(raw);
        }
    }

    const logs: TransportLogEntry[] = (
        since
            ? vaultLogger.getFilteredLogs({ since })
            : vaultLogger.getAllLogs()
    ).map((entry) => ({
        ...entry,
        timestamp: entry.timestamp.toISOString(),
        data: toTransportData(entry.data),
    }));
    return { ok: true, logs };
}
