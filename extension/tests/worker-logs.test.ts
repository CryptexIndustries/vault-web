/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/utils/sw-envelope-client", () => ({
    sendEncryptedEnvelopeToSW: jest.fn(),
}));

import { LogGroup, LogLevel, vaultLogger } from "@/utils/logging";
import { readWorkerLogs } from "../src/background/worker-logs";
import { createExtensionLogSource } from "../src/utils/extension-log-source";
import { sendEncryptedEnvelopeToSW } from "../src/utils/sw-envelope-client";
import type { TransportLogEntry } from "../src/types/sw-messaging";

const send = jest.mocked(sendEncryptedEnvelopeToSW);

beforeEach(() => {
    vaultLogger.clearAll();
    send.mockReset();
});

describe("readWorkerLogs", () => {
    it("rejects malformed requests", () => {
        for (const payload of [[], { since: 5 }, { since: "not a date" }]) {
            expect(readWorkerLogs(payload)).toEqual({
                ok: false,
                error: "INVALID_LOGS_REQUEST",
            });
        }
    });

    it("keeps entries JSON-safe so one bad entry can't fail the response", () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        vaultLogger.error(LogGroup.General, "failed", new Error("boom"));
        vaultLogger.info(LogGroup.General, "cyclic", cyclic);

        const res = readWorkerLogs(null);

        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.logs.map((log) => log.data)).toEqual([
            { name: "Error", message: "boom" },
            "[object Object]",
        ]);
    });

    it("returns only entries since the given time", () => {
        vaultLogger.info(LogGroup.General, "old");
        const since = new Date(Date.now() + 60_000).toISOString();

        const res = readWorkerLogs({ since });

        expect(res).toEqual({ ok: true, logs: [] });
    });
});

describe("createExtensionLogSource", () => {
    const workerEntry = (id: string, timestamp: string): TransportLogEntry => ({
        id,
        timestamp,
        group: LogGroup.Synchronization,
        level: LogLevel.Info,
        message: `worker ${id}`,
    });

    it("merges page and worker logs and asks the worker only for newer ones", async () => {
        const source = createExtensionLogSource();
        send.mockResolvedValueOnce({
            ok: true,
            payload: {
                ok: true,
                logs: [workerEntry("1", "2000-01-01T10:00:00.000Z")],
            },
        });
        vaultLogger.info(LogGroup.UI, "page");

        const first = await source.load();

        expect(first.map((log) => [log.source, log.message])).toEqual([
            ["Worker", "worker 1"],
            ["Page", "page"],
        ]);
        expect(send).toHaveBeenLastCalledWith(expect.anything(), null);

        // `since` is inclusive: the worker repeats its newest entry.
        send.mockResolvedValueOnce({
            ok: true,
            payload: {
                ok: true,
                logs: [
                    workerEntry("1", "2000-01-01T10:00:00.000Z"),
                    workerEntry("2", "2000-01-01T10:00:01.000Z"),
                ],
            },
        });

        const second = await source.load();

        expect(send).toHaveBeenLastCalledWith(expect.anything(), {
            since: "2000-01-01T10:00:00.000Z",
        });
        expect(
            second
                .filter((log) => log.source === "Worker")
                .map((log) => log.id),
        ).toEqual(["worker:1", "worker:2"]);
    });

    it("drops a load that a clear overtook", async () => {
        const source = createExtensionLogSource();
        let answerLoad!: (value: unknown) => void;
        send.mockReturnValueOnce(
            new Promise((resolve) => {
                answerLoad = resolve;
            }) as never,
        );
        const load = source.load();
        send.mockResolvedValueOnce({ ok: true, payload: { ok: true } });
        await source.clear();

        answerLoad({
            ok: true,
            payload: {
                ok: true,
                logs: [workerEntry("1", "2000-01-01T10:00:00.000Z")],
            },
        });

        expect(await load).toEqual([]);
    });
});
