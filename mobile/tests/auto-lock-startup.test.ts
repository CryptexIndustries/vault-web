import { afterEach, expect, it, jest } from "@jest/globals";

const mockGetItem = jest.fn(async () => "1");
jest.mock("@react-native-async-storage/async-storage", () => ({
    __esModule: true,
    default: { getItem: mockGetItem, setItem: jest.fn(async () => undefined) },
}));
jest.mock("@/utils/android-credentials", () => ({
    androidCredentials: { clearProviderCredentials: jest.fn() },
}));

const {
    getCachedAutoLockMinutes,
    loadAutoLockMinutes,
    resetAutoLockSettingsForTests,
} = require("@/utils/auto-lock-settings") as typeof import("@/utils/auto-lock-settings");
const {
    clearVaultDEKFromSession,
    getVaultDEKFromSession,
    setVaultDEKInSession,
} = require("@/utils/vault-session") as typeof import("@/utils/vault-session");
const { noteVaultBackgrounded } = require("@/utils/session-timeout") as typeof import("@/utils/session-timeout");

afterEach(() => {
    clearVaultDEKFromSession();
    resetAutoLockSettingsForTests();
    jest.useRealTimers();
});

it("starts an unlocked session with the persisted timeout loaded at startup", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    resetAutoLockSettingsForTests();
    expect(getCachedAutoLockMinutes()).toBe(5);
    await loadAutoLockMinutes();
    expect(getCachedAutoLockMinutes()).toBe(1);

    setVaultDEKInSession({ type: "secret" } as CryptoKey);
    noteVaultBackgrounded();
    jest.advanceTimersByTime(60_000);
    expect(getVaultDEKFromSession().isErr()).toBe(true);
});
