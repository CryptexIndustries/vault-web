import type {
    LogInspectorEntry,
    LogInspectorSource,
} from "@/components/dialog/log-inspector";
import { vaultLogger } from "@/utils/logging";

import { MessageType, type GetLogsResponse } from "../types/sw-messaging";
import { sendEncryptedEnvelopeToSW } from "./sw-envelope-client";

/** The worker keeps 500 entries for each of its 8 log groups. */
const MAX_WORKER_LOGS = 4000;

/**
 * Logs of this page plus the service worker's, for the log inspector. The
 * inspector reloads every second, so after the first load this asks the
 * worker only for entries since the newest one it already has.
 */
export function createExtensionLogSource(): LogInspectorSource {
    let workerLogs: LogInspectorEntry[] = [];
    let since: string | undefined;
    // A load that started before a clear must not add cleared entries back.
    let clears = 0;

    return {
        load: async () => {
            const clearsBefore = clears;
            const res = await sendEncryptedEnvelopeToSW<
                GetLogsResponse | { ok: false; error: string }
            >(MessageType.GetLogs, since ? { since } : null);
            if (res.ok && res.payload.ok && clears === clearsBefore) {
                // `since` is inclusive, so the newest entry comes back again.
                const known = new Set(workerLogs.map((log) => log.id));
                for (const log of res.payload.logs) {
                    // Page and worker ids come from separate counters.
                    const id = `worker:${log.id}`;
                    if (known.has(id)) continue;
                    workerLogs.push({
                        ...log,
                        id,
                        timestamp: new Date(log.timestamp),
                        source: "Worker",
                    });
                }
                workerLogs = workerLogs.slice(-MAX_WORKER_LOGS);
                since = res.payload.logs.at(-1)?.timestamp ?? since;
            }

            const pageLogs = vaultLogger
                .getAllLogs()
                .map((log) => ({ ...log, source: "Page" }));
            return [...pageLogs, ...workerLogs].sort(
                (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
            );
        },
        clear: async () => {
            vaultLogger.clearAll();
            const res = await sendEncryptedEnvelopeToSW<
                { ok: true } | { ok: false; error: string }
            >(MessageType.ClearLogs, null);
            // On failure the worker still has its entries, so keep showing them.
            if (!res.ok || !res.payload.ok) return;
            clears++;
            workerLogs = [];
            since = undefined;
        },
    };
}
