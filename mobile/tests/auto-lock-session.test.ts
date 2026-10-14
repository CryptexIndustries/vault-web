import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";

// Exercise hook sessions without mounting native UI. Each mount gets fresh refs;
// the module-level secret-release guard deliberately survives between sessions.
const mockEffects: Array<() => void | (() => void)> = [];
const mockListeners = new Set<(state: string) => void>();
const mockAppState = {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
        mockListeners.add(listener);
        return { remove: () => mockListeners.delete(listener) };
    },
};
const mockLock = jest.fn<() => Promise<{ isOk: () => boolean }>>();

jest.mock("react", () => ({
    useCallback: (callback: unknown) => callback,
    useRef: (current: unknown) => ({ current }),
    useEffect: (effect: () => void | (() => void)) => mockEffects.push(effect),
}));
jest.mock("react-native", () => ({ AppState: mockAppState }));
jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("jotai", () => ({
    useAtomValue: () => ({ ID: "test-vault" }),
    useSetAtom: () => jest.fn(),
}));
jest.mock("@/utils/atoms", () => ({
    unlockedVaultAtom: {},
    unlockedVaultMetadataAtom: {},
    vaultStore: { get: () => ({ ID: "test-vault", Credentials: [] }) },
}));
jest.mock("@cryptex-industries/vault-core/vault-utils/vault", () => ({
    Vault: class {},
}));
jest.mock("@/utils/vault-lock", () => ({
    lockUnlockedVault: () => mockLock(),
}));
jest.mock("@/utils/android-credentials", () => ({
    androidCredentials: {
        refreshProviderSession: jest.fn(),
        resumeProviderSession: jest.fn(),
        backgroundProviderSession: jest.fn(),
        clearProviderCredentials: jest.fn(),
        setProviderCredentials: jest.fn(),
        expireSensitiveClipboard: jest.fn(),
        getPendingRequest: jest.fn(() => null),
    },
}));
jest.mock("@/utils/auto-lock-settings", () => ({
    getCachedAutoLockMinutes: () => 1,
    loadAutoLockMinutes: async () => 1,
    subscribeAutoLockMinutes: () => () => {},
}));

// Require after the mock state is initialized; retain this module across mounts.
const { useAutoLock, isAutoLockDue } =
    require("@/hooks/use-auto-lock") as typeof import("@/hooks/use-auto-lock");
const { stopVaultTimeoutSession } =
    require("@/utils/session-timeout") as typeof import("@/utils/session-timeout");
const { androidCredentials } =
    require("@/utils/android-credentials") as typeof import("@/utils/android-credentials");

async function mountSession(enabled = true) {
    const hook = useAutoLock(enabled);
    const cleanups = mockEffects.splice(0).map((effect) => effect());
    await Promise.resolve();
    return {
        ...hook,
        unmount: () => cleanups.forEach((cleanup) => cleanup?.()),
    };
}

function appState(state: string) {
    mockAppState.currentState = state;
    for (const listener of mockListeners) listener(state);
}

describe("auto-lock session lifecycle", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        stopVaultTimeoutSession();
        jest.useFakeTimers();
        jest.setSystemTime(1_000_000);
        mockAppState.currentState = "active";
        mockLock.mockResolvedValue({ isOk: () => true });
    });
    afterEach(() => {
        mockListeners.clear();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it("does not carry an expired background timeout into a fresh unlock", async () => {
        const previous = await mountSession();
        appState("background");
        expect(androidCredentials.backgroundProviderSession).toHaveBeenCalledWith(1);
        jest.advanceTimersByTime(60_001);
        expect(isAutoLockDue()).toBe(true);
        appState("active");
        expect(mockLock).toHaveBeenCalledTimes(1);
        previous.unmount();
        stopVaultTimeoutSession(); // lockUnlockedVault clears the DEK in production

        const fresh = await mountSession();
        expect(isAutoLockDue()).toBe(false);
        fresh.onInteraction();
        expect(mockLock).toHaveBeenCalledTimes(1);
        fresh.unmount();
    });

    it("still locks the fresh session at its foreground timeout", async () => {
        const session = await mountSession();
        jest.advanceTimersByTime(59_999);
        expect(mockLock).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(mockLock).toHaveBeenCalledTimes(1);
        session.unmount();
    });

    it("tracks a fresh unlock that starts in the background", async () => {
        mockAppState.currentState = "background";
        const session = await mountSession();
        jest.advanceTimersByTime(60_001);
        expect(isAutoLockDue()).toBe(true);
        appState("active");
        expect(mockLock).toHaveBeenCalledTimes(1);
        session.unmount();
    });

    it("starts a new idle window when the user keeps editing after a failed lock", async () => {
        mockLock.mockResolvedValue({ isOk: () => false });
        const session = await mountSession();
        jest.advanceTimersByTime(60_000);
        expect(isAutoLockDue()).toBe(true);
        expect(mockLock).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        await Promise.resolve();

        session.resumeAfterFailedLock();
        expect(androidCredentials.clearProviderCredentials).toHaveBeenCalledTimes(1);
        expect(androidCredentials.setProviderCredentials).toHaveBeenCalledWith([], 1);
        expect(isAutoLockDue()).toBe(false);
        jest.advanceTimersByTime(59_999);
        expect(mockLock).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(1);
        expect(mockLock).toHaveBeenCalledTimes(2);
        session.unmount();
    });

    it("resumes native metadata only after a short background return", async () => {
        const session = await mountSession();
        appState("background");
        jest.advanceTimersByTime(30_000);
        appState("active");
        expect(mockLock).not.toHaveBeenCalled();
        expect(androidCredentials.resumeProviderSession).toHaveBeenCalledWith(1);
        session.unmount();
    });

    it("locks on return after a monotonic deadline despite a backward clock change", async () => {
        const session = await mountSession();
        const initialResumes = jest.mocked(androidCredentials.resumeProviderSession).mock.calls.length;
        appState("background");
        jest.advanceTimersByTime(60_001);
        jest.setSystemTime(1_000_000);
        appState("active");
        expect(mockLock).toHaveBeenCalledTimes(1);
        expect(androidCredentials.resumeProviderSession).toHaveBeenCalledTimes(initialResumes);
        session.unmount();
    });

    it("honors the monotonic foreground deadline after a backward clock change", async () => {
        const session = await mountSession();
        jest.advanceTimersByTime(30_000);
        jest.setSystemTime(1_000_000);
        jest.advanceTimersByTime(30_000);
        expect(mockLock).toHaveBeenCalledTimes(1);
        session.unmount();
    });

    it("hands timer ownership to a focused route without stale retry after Keep editing", async () => {
        mockLock.mockResolvedValue({ isOk: () => false });
        const underlying = await mountSession(false);
        expect(mockListeners.size).toBe(0);
        const focused = await mountSession(true);
        expect(mockListeners.size).toBe(1);
        appState("background");
        jest.advanceTimersByTime(60_000);
        appState("active");
        expect(mockLock).toHaveBeenCalledTimes(1);
        focused.resumeAfterFailedLock();
        focused.unmount();
        underlying.unmount();

        const returned = await mountSession(true);
        expect(isAutoLockDue()).toBe(false);
        jest.advanceTimersByTime(59_999);
        expect(mockLock).toHaveBeenCalledTimes(1);
        returned.unmount();
    });
});
