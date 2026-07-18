import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    jest,
} from "@jest/globals";

import { LogGroup, LogLevel, vaultLogger } from "../../src/utils/logging";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const setNodeEnv = (value: string | undefined) => {
    Reflect.set(process.env, "NODE_ENV", value);
};

beforeEach(() => {
    vaultLogger.setEnabled(true);
    vaultLogger.clearAll();
});

afterEach(() => {
    setNodeEnv(ORIGINAL_NODE_ENV);
    jest.restoreAllMocks();
});

describe("vaultLogger", () => {
    describe("setEnabled", () => {
        it("disables log capture and re-enabling restores it", () => {
            vaultLogger.setEnabled(false);
            expect(vaultLogger.isEnabled()).toBe(false);

            vaultLogger.info(LogGroup.General, "should-not-record");
            vaultLogger.error(LogGroup.Vault, "also-not-recorded");

            expect(vaultLogger.getLogsByGroup(LogGroup.General)).toHaveLength(
                0,
            );
            expect(vaultLogger.getLogsByGroup(LogGroup.Vault)).toHaveLength(0);

            vaultLogger.setEnabled(true);
            vaultLogger.info(LogGroup.General, "now-recorded");

            const general = vaultLogger.getLogsByGroup(LogGroup.General);
            expect(general).toHaveLength(1);
            expect(general[0]?.message).toBe("now-recorded");
        });
    });

    describe("per-group cap", () => {
        it("trims oldest entries when exceeding MAX_LOGS_PER_GROUP (500)", () => {
            const overflow = 502;
            for (let i = 0; i < overflow; i++) {
                vaultLogger.debug(LogGroup.UI, `msg-${i}`);
            }

            const ui = vaultLogger.getLogsByGroup(LogGroup.UI);
            expect(ui).toHaveLength(500);
            // Two oldest entries dropped — first remaining message is index 2.
            expect(ui[0]?.message).toBe("msg-2");
            expect(ui[ui.length - 1]?.message).toBe(`msg-${overflow - 1}`);
        });

        it("does not impact unrelated groups when one group overflows", () => {
            for (let i = 0; i < 600; i++) {
                vaultLogger.info(LogGroup.WebRTC, `w-${i}`);
            }
            vaultLogger.info(LogGroup.Signaling, "sig-1");

            expect(vaultLogger.getLogsByGroup(LogGroup.WebRTC)).toHaveLength(
                500,
            );
            expect(vaultLogger.getLogsByGroup(LogGroup.Signaling)).toHaveLength(
                1,
            );
        });
    });

    describe("getFilteredLogs", () => {
        beforeEach(() => {
            vaultLogger.info(LogGroup.UI, "ui-info", { area: "settings" });
            vaultLogger.warn(LogGroup.UI, "ui-warn");
            vaultLogger.error(LogGroup.Vault, "vault-error");
            vaultLogger.debug(LogGroup.WebRTC, "webrtc-debug", "ICE candidate");
        });

        it("filters by single group", () => {
            const result = vaultLogger.getFilteredLogs({
                groups: [LogGroup.UI],
            });
            expect(result.map((l) => l.message).sort()).toEqual(
                ["ui-info", "ui-warn"].sort(),
            );
        });

        it("filters by multiple groups (OR)", () => {
            const result = vaultLogger.getFilteredLogs({
                groups: [LogGroup.Vault, LogGroup.WebRTC],
            });
            expect(result).toHaveLength(2);
            expect(result.map((l) => l.group).sort()).toEqual(
                [LogGroup.Vault, LogGroup.WebRTC].sort(),
            );
        });

        it("filters by levels", () => {
            const result = vaultLogger.getFilteredLogs({
                levels: [LogLevel.Warn, LogLevel.Error],
            });
            expect(result.map((l) => l.level).sort()).toEqual(
                [LogLevel.Warn, LogLevel.Error].sort(),
            );
        });

        it("filters by since timestamp (inclusive)", () => {
            const beforeNewLog = new Date(Date.now() + 1);
            // small wait via spy on Date to avoid flakiness — manually advance entries.
            vaultLogger.info(LogGroup.General, "after-cutoff");
            // The new entry's timestamp >= beforeNewLog (almost certainly).
            const recent = vaultLogger.getFilteredLogs({ since: beforeNewLog });
            // All filtered entries must satisfy log.timestamp >= since.
            for (const entry of recent) {
                expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(
                    beforeNewLog.getTime(),
                );
            }
        });

        it("filters by searchText against message and stringified data", () => {
            const byMessage = vaultLogger.getFilteredLogs({
                searchText: "ui-warn",
            });
            expect(byMessage).toHaveLength(1);
            expect(byMessage[0]?.message).toBe("ui-warn");

            const byData = vaultLogger.getFilteredLogs({
                searchText: "settings",
            });
            expect(byData).toHaveLength(1);
            expect(byData[0]?.message).toBe("ui-info");

            const byDataAcrossTypes = vaultLogger.getFilteredLogs({
                searchText: "ice candidate",
            });
            expect(byDataAcrossTypes).toHaveLength(1);
            expect(byDataAcrossTypes[0]?.group).toBe(LogGroup.WebRTC);
        });

        it("returns all logs when no filters provided", () => {
            const result = vaultLogger.getFilteredLogs({});
            expect(result).toHaveLength(4);
        });
    });

    describe("clearGroup", () => {
        it("clears only the targeted group and leaves others intact", () => {
            vaultLogger.info(LogGroup.UI, "a");
            vaultLogger.info(LogGroup.UI, "b");
            vaultLogger.info(LogGroup.Vault, "v");

            vaultLogger.clearGroup(LogGroup.UI);

            expect(vaultLogger.getLogsByGroup(LogGroup.UI)).toHaveLength(0);
            expect(vaultLogger.getLogsByGroup(LogGroup.Vault)).toHaveLength(1);
        });
    });

    describe("getLogCounts", () => {
        it("returns per-group log counts including zero-counts", () => {
            vaultLogger.info(LogGroup.UI, "a");
            vaultLogger.info(LogGroup.UI, "b");
            vaultLogger.error(LogGroup.Synchronization, "c");

            const counts = vaultLogger.getLogCounts();
            expect(counts[LogGroup.UI]).toBe(2);
            expect(counts[LogGroup.Synchronization]).toBe(1);
            expect(counts[LogGroup.Vault]).toBe(0);
            // Every enum value should be a key in the returned record.
            for (const group of Object.values(LogGroup)) {
                expect(typeof counts[group as LogGroup]).toBe("number");
            }
        });
    });

    describe("exportAsJSON", () => {
        it("returns a JSON array string of all logs with messages and data", () => {
            vaultLogger.info(LogGroup.UI, "one");
            vaultLogger.warn(LogGroup.Vault, "two", { hint: "context" });

            const json = vaultLogger.exportAsJSON();
            expect(typeof json).toBe("string");
            const parsed = JSON.parse(json) as Array<{
                message: string;
                group: string;
                level: string;
                data?: unknown;
            }>;
            expect(parsed).toHaveLength(2);
            const byMessage = new Map(parsed.map((p) => [p.message, p]));
            expect(byMessage.get("one")?.group).toBe(LogGroup.UI);
            expect(byMessage.get("one")?.level).toBe(LogLevel.Info);
            expect(byMessage.get("two")?.group).toBe(LogGroup.Vault);
            expect(byMessage.get("two")?.level).toBe(LogLevel.Warn);
            expect(byMessage.get("two")?.data).toEqual({ hint: "context" });
        });

        it("applies group/level filters when provided", () => {
            vaultLogger.info(LogGroup.UI, "kept");
            vaultLogger.warn(LogGroup.UI, "dropped-by-level");
            vaultLogger.info(LogGroup.Vault, "dropped-by-group");

            const json = vaultLogger.exportAsJSON({
                groups: [LogGroup.UI],
                levels: [LogLevel.Info],
            });
            const parsed = JSON.parse(json) as Array<{ message: string }>;
            expect(parsed).toHaveLength(1);
            expect(parsed[0]?.message).toBe("kept");
        });
    });

    describe("development console branch", () => {
        it("does not emit to console in non-development environment", () => {
            setNodeEnv("production");
            const debug = jest
                .spyOn(console, "debug")
                .mockImplementation(() => {});
            const info = jest
                .spyOn(console, "info")
                .mockImplementation(() => {});
            const warn = jest
                .spyOn(console, "warn")
                .mockImplementation(() => {});
            const error = jest
                .spyOn(console, "error")
                .mockImplementation(() => {});

            vaultLogger.debug(LogGroup.UI, "no-console");
            vaultLogger.info(LogGroup.UI, "no-console");
            vaultLogger.warn(LogGroup.UI, "no-console");
            vaultLogger.error(LogGroup.UI, "no-console");

            expect(debug).not.toHaveBeenCalled();
            expect(info).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();
            expect(error).not.toHaveBeenCalled();
        });

        it("emits each level to the matching console method in development", () => {
            setNodeEnv("development");
            const debug = jest
                .spyOn(console, "debug")
                .mockImplementation(() => {});
            const info = jest
                .spyOn(console, "info")
                .mockImplementation(() => {});
            const warn = jest
                .spyOn(console, "warn")
                .mockImplementation(() => {});
            const error = jest
                .spyOn(console, "error")
                .mockImplementation(() => {});

            vaultLogger.debug(LogGroup.UI, "d-msg");
            vaultLogger.info(LogGroup.UI, "i-msg", { ctx: 1 });
            vaultLogger.warn(LogGroup.UI, "w-msg");
            vaultLogger.error(LogGroup.UI, "e-msg");

            expect(debug).toHaveBeenCalledWith("[UI]", "d-msg");
            expect(info).toHaveBeenCalledWith("[UI]", "i-msg", { ctx: 1 });
            expect(warn).toHaveBeenCalledWith("[UI]", "w-msg");
            expect(error).toHaveBeenCalledWith("[UI]", "e-msg");
        });
    });
});
