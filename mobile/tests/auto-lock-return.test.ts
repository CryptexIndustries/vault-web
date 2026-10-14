import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Provider } from "jotai";
import { ok } from "neverthrow";
import { router } from "expo-router";
import { useAutoLock } from "@/hooks/use-auto-lock";
import { vaultStore } from "@/utils/atoms";
import { androidCredentials } from "@/utils/android-credentials";
import { lockUnlockedVault } from "@/utils/vault-lock";

jest.mock("react-native", () => ({
    AppState: {
        currentState: "active",
        addEventListener: () => ({ remove: jest.fn() }),
    },
}));
jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("@cryptex-industries/vault-core/vault-utils/vault", () => ({
    Vault: class {},
}));
jest.mock("@/utils/atoms", () => {
    const { atom, createStore } =
        jest.requireActual<typeof import("jotai")>("jotai");
    return {
        vaultStore: createStore(),
        unlockedVaultAtom: atom({ Credentials: [] }),
        unlockedVaultMetadataAtom: atom({ DBIndex: 1 }),
    };
});
jest.mock("@/utils/auto-lock-settings", () => ({
    getCachedAutoLockMinutes: () => 5,
    loadAutoLockMinutes: async () => 5,
    subscribeAutoLockMinutes: () => jest.fn(),
}));
jest.mock("@/utils/vault-lock", () => ({ lockUnlockedVault: jest.fn() }));
jest.mock("@/utils/android-credentials", () => ({
    androidCredentials: {
        getPendingRequest: jest.fn(),
        clearProviderCredentials: jest.fn(),
    },
}));
jest.mock("@/utils/session-timeout", () => ({
    getVaultLastInteractionAt: () => 1000,
    isAutoLockDue: () => true,
    isVaultTimeoutSessionActive: () => true,
    noteVaultBackgrounded: jest.fn(),
    noteVaultForegrounded: jest.fn(),
    noteVaultInteraction: jest.fn(),
    setVaultTimeoutMinutes: jest.fn(),
    startVaultTimeoutSession: jest.fn(),
    vaultTimeoutRemainingMs: () => 0,
}));

let renderer: ReactTestRenderer | undefined;
function Screen({ returnTo }: { returnTo?: string }) {
    useAutoLock(true, returnTo);
    return null;
}
beforeEach(() => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    jest.mocked(androidCredentials.getPendingRequest).mockReturnValue(null);
    jest.mocked(lockUnlockedVault).mockResolvedValue(ok(undefined));
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean })
        .IS_REACT_NATIVE_TEST_ENVIRONMENT;
});
async function render(returnTo?: string) {
    await act(async () => {
        renderer = create(
            createElement(
                Provider,
                { store: vaultStore },
                createElement(Screen, { returnTo }),
            ),
        );
    });
}

it("preserves checkout's fixed return path after saving and locking an expired vault", async () => {
    await render("/billing-return?outcome=success");
    expect(lockUnlockedVault).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith({
        pathname: "/(locked)/unlock",
        params: { returnTo: "/billing-return?outcome=success" },
    });
});

it("keeps native Credential Manager requests ahead of the billing return", async () => {
    jest.mocked(androidCredentials.getPendingRequest).mockReturnValue({
        id: "credential-request",
    } as ReturnType<typeof androidCredentials.getPendingRequest>);
    await render("/billing-return?outcome=success");
    expect(router.replace).toHaveBeenCalledWith({
        pathname: "/(locked)/unlock",
        params: { returnTo: "/credential-request" },
    });
});

it("preserves the existing default unlock route when no return path was requested", async () => {
    await render();
    expect(router.replace).toHaveBeenCalledWith("/(locked)/unlock");
});
