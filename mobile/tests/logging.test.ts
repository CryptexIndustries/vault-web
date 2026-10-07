import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { vaultLog, vaultLogger } from "@/utils/logging";

describe("mobile diagnostics logging", () => {
    beforeEach(() => {
        vaultLogger.clearAll();
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("retains useful error context while redacting named secret fields", () => {
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        vaultLog.warn("Connection stalled", {
            stage: "handshake",
            password: "do-not-export",
            nested: { apiToken: "do-not-export", attempt: 2 },
            error: new Error("timeout"),
        });

        expect(vaultLogger.getAllLogs()[0]).toMatchObject({
            group: "vault",
            level: "WARN",
            message: "Connection stalled",
            details: {
                stage: "handshake",
                password: "[redacted]",
                nested: { apiToken: "[redacted]", attempt: 2 },
                error: { name: "Error", message: "timeout" },
            },
        });
    });

    it("keeps only the most recent 500 events", () => {
        jest.spyOn(console, "debug").mockImplementation(() => undefined);
        for (let index = 0; index < 501; index += 1) {
            vaultLog.debug(`event ${index}`);
        }
        const entries = vaultLogger.getAllLogs();
        expect(entries).toHaveLength(500);
        expect(entries[0].message).toBe("event 1");
        expect(entries[499].message).toBe("event 500");
    });
});
