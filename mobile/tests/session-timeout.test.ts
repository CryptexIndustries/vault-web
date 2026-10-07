import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
const mockClearProviderCredentials = jest.fn();
jest.mock("@/utils/android-credentials", () => ({
    androidCredentials: { clearProviderCredentials: mockClearProviderCredentials },
}));
import {
    getVaultDEKFromSession,
    saveVaultWithSessionDEK,
    setVaultDEKInSession,
    clearVaultDEKFromSession,
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";
import {
    isAutoLockDue,
    noteVaultBackgrounded,
    noteVaultForegrounded,
    noteVaultInteraction,
    setVaultTimeoutMinutes,
    subscribeVaultTimeoutChanges,
    vaultTimeoutRemainingMs,
} from "@/utils/session-timeout";

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    clearVaultDEKFromSession();
    mockClearProviderCredentials.mockClear();
});

afterEach(() => {
    clearVaultDEKFromSession();
    jest.useRealTimers();
});

function unlock() {
    const dek = { type: "secret" } as CryptoKey;
    setVaultDEKInSession(dek);
    setVaultTimeoutMinutes(1);
    return dek;
}

it("only a fresh unlock explicitly resets the native provider cache", () => {
    unlock();
    expect(mockClearProviderCredentials).toHaveBeenCalledTimes(1);
    noteVaultInteraction();
    expect(mockClearProviderCredentials).toHaveBeenCalledTimes(1);
    setVaultDEKInSession({ type: "secret" } as CryptoKey);
    expect(mockClearProviderCredentials).toHaveBeenCalledTimes(1);
});

it("does not let a late key rotation revive an expired session", () => {
    unlock();
    noteVaultBackgrounded();
    jest.advanceTimersByTime(60_000);
    const generation = getVaultSessionGeneration();
    expect(() => setVaultDEKInSession({ type: "secret" } as CryptoKey)).toThrow(
        "Vault session expired",
    );
    expect(getVaultSessionGeneration()).toBe(generation);
    expect(getVaultDEKFromSession().isErr()).toBe(true);
    expect(mockClearProviderCredentials).toHaveBeenCalledTimes(1);
});

it("rejects DEK access at the background deadline without waiting for a resume", () => {
    unlock();
    noteVaultBackgrounded();
    jest.setSystemTime(1_059_999);
    expect(getVaultDEKFromSession().isOk()).toBe(true);
    jest.setSystemTime(1_060_000);
    expect(isAutoLockDue()).toBe(true);
    expect(getVaultDEKFromSession().isErr()).toBe(true);
    noteVaultInteraction();
    noteVaultForegrounded();
    expect(getVaultDEKFromSession().isErr()).toBe(true);
});

it("does not revive an expired session when the wall clock moves backward", () => {
    unlock();
    noteVaultBackgrounded();
    jest.advanceTimersByTime(60_000);
    expect(isAutoLockDue()).toBe(true);
    jest.setSystemTime(1_000_000);
    expect(isAutoLockDue()).toBe(true);
    expect(getVaultDEKFromSession().isErr()).toBe(true);
});

it("preserves a short background return and the disabled setting", () => {
    unlock();
    noteVaultBackgrounded();
    jest.setSystemTime(1_030_000);
    noteVaultForegrounded();
    jest.setSystemTime(1_089_999);
    expect(getVaultDEKFromSession().isOk()).toBe(true);
    jest.setSystemTime(1_090_000);
    expect(getVaultDEKFromSession().isErr()).toBe(true);

    clearVaultDEKFromSession();
    unlock();
    setVaultTimeoutMinutes(0);
    noteVaultBackgrounded();
    jest.setSystemTime(10_000_000);
    expect(getVaultDEKFromSession().isOk()).toBe(true);
});

it("allows only the lock save to use the retained key after timeout", async () => {
    unlock();
    noteVaultBackgrounded();
    jest.setSystemTime(1_060_000);
    const save = jest.fn(async () => undefined);
    const metadata = { save } as never;
    expect((await saveVaultWithSessionDEK(metadata, null)).isErr()).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect((await saveVaultWithSessionDEK(metadata, null, true)).isOk()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
});

it("rejects a cleartext export continuation after expiry or a new unlock", () => {
    unlock();
    const generation = getVaultSessionGeneration();
    expect(isSameActiveVaultSession(generation)).toBe(true);
    noteVaultBackgrounded();
    jest.setSystemTime(1_060_000);
    expect(isSameActiveVaultSession(generation)).toBe(false);

    clearVaultDEKFromSession();
    unlock();
    expect(isSameActiveVaultSession(generation)).toBe(false);
});

it("notifies sync of each deadline change so it can pause connected peers", () => {
    const changed = jest.fn();
    const unsubscribe = subscribeVaultTimeoutChanges(changed);
    unlock();
    expect(vaultTimeoutRemainingMs()).toBe(60_000);
    jest.setSystemTime(1_030_000);
    noteVaultInteraction();
    expect(vaultTimeoutRemainingMs()).toBe(60_000);
    noteVaultBackgrounded();
    jest.setSystemTime(1_090_000);
    expect(vaultTimeoutRemainingMs()).toBe(0);
    expect(changed).toHaveBeenCalled();
    unsubscribe();
});
