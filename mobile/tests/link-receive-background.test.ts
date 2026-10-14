import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { shouldCancelReceiveLinkOnBackground } from "@/utils/link-receive-background";
import {
    isAutoLockDue,
    noteVaultBackgrounded,
    setVaultTimeoutMinutes,
    startVaultTimeoutSession,
    stopVaultTimeoutSession,
} from "@/utils/session-timeout";

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    stopVaultTimeoutSession();
});
afterEach(() => {
    stopVaultTimeoutSession();
    jest.useRealTimers();
});

it("cancels active receive work in either mode, but not an idle picker", () => {
    expect(shouldCancelReceiveLinkOnBackground("background", true, false)).toBe(true);
    expect(shouldCancelReceiveLinkOnBackground("inactive", false, true)).toBe(true);
    expect(shouldCancelReceiveLinkOnBackground("background", false, false)).toBe(false);
    expect(shouldCancelReceiveLinkOnBackground("active", false, true)).toBe(false);
});

it("does not impose a vault timeout on a locked first-vault receive", () => {
    setVaultTimeoutMinutes(1);
    noteVaultBackgrounded();
    jest.setSystemTime(1_120_000);
    expect(isAutoLockDue()).toBe(false);

    startVaultTimeoutSession();
    setVaultTimeoutMinutes(1);
    noteVaultBackgrounded();
    jest.setSystemTime(1_180_000);
    expect(isAutoLockDue()).toBe(true);
});
