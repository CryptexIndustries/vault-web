import { describe, expect, it } from "@jest/globals";

import {
    AUTO_LOCK_MINUTE_OPTIONS,
    DEFAULT_AUTO_LOCK_MINUTES,
    autoLockThresholdMs,
    elapsedMs,
    nextForegroundIdleDelayMs,
    parseAutoLockMinutes,
    shouldAcceptInteractionTimestamp,
} from "@/utils/auto-lock-policy";

describe("auto-lock policy", () => {
    it("defaults and parses minute settings", () => {
        expect(parseAutoLockMinutes(null)).toBe(DEFAULT_AUTO_LOCK_MINUTES);
        expect(parseAutoLockMinutes("")).toBe(DEFAULT_AUTO_LOCK_MINUTES);
        expect(parseAutoLockMinutes("bogus")).toBe(DEFAULT_AUTO_LOCK_MINUTES);
        expect(parseAutoLockMinutes("-1")).toBe(DEFAULT_AUTO_LOCK_MINUTES);
        expect(parseAutoLockMinutes("0")).toBe(0);
        expect(parseAutoLockMinutes("15")).toBe(15);
        expect(AUTO_LOCK_MINUTE_OPTIONS).toEqual([
            0, 1, 5, 15, 30, 60, 240, 480,
        ]);
    });

    it("treats 0 as disabled threshold", () => {
        expect(autoLockThresholdMs(0)).toBeNull();
        expect(autoLockThresholdMs(5)).toBe(5 * 60_000);
    });

    it("clamps clock skew for elapsed time", () => {
        expect(elapsedMs(1000, 900)).toBe(0);
        expect(elapsedMs(1000, 1500)).toBe(500);
    });

    it("computes remaining foreground delay", () => {
        const threshold = 60_000;
        expect(nextForegroundIdleDelayMs(0, 10_000, threshold)).toBe(50_000);
        expect(nextForegroundIdleDelayMs(0, 70_000, threshold)).toBe(0);
        expect(nextForegroundIdleDelayMs(0, 10_000, null)).toBeNull();
    });

    it("throttles interaction timestamps", () => {
        expect(shouldAcceptInteractionTimestamp(1000, 1000)).toBe(false);
        expect(shouldAcceptInteractionTimestamp(1000, 1999)).toBe(false);
        expect(shouldAcceptInteractionTimestamp(1000, 2000)).toBe(true);
    });
});
