import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Provider, atom, createStore, type PrimitiveAtom } from "jotai";
import { err, ok } from "neverthrow";
import { useAutoLock } from "@/hooks/use-auto-lock";
import { getVaultDEKFromSession } from "@/utils/vault-session";
import { vaultLockStateAtom } from "@/utils/vault-lock";
import {
    billingManagement,
    storeBilling,
    restoreStorePurchases,
    openBillingManagement,
} from "@/app_lib/online-services-billing";
import BillingReturnScreen from "../app/billing-return";
import { AccountSummary } from "@/components/account/account-summary";
import { MembershipUpgrade } from "@/components/account/membership-upgrade";

jest.mock("react-native", () => ({
    useWindowDimensions: () => ({ fontScale: 1 }),
    View: "View",
    Pressable: "Pressable",
    ActivityIndicator: "Spinner",
}));
jest.mock("lucide-react-native", () => ({
    ChevronRight: "ChevronRight",
    CreditCard: "CreditCard",
    Check: "Check",
    Minus: "Minus",
}));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedButton: "Button",
    UnlockedMenuRow: "MenuRow",
    UnlockedText: "Text",
    VaultLockScreen: "LockScreen",
}));
jest.mock("@/utils/clipboard", () => ({ copyTextToClipboard: jest.fn() }));
jest.mock("@/components/account/payment-status", () => ({
    PaymentStatus: "PaymentStatus",
}));
jest.mock("@/utils/atoms", () => {
    const mockUnlockedAtom = atom(false);
    return { isVaultUnlockedAtom: mockUnlockedAtom, mockUnlockedAtom };
});
jest.mock("@/utils/vault-lock", () => ({ vaultLockStateAtom: atom("idle") }));
jest.mock("@/utils/vault-session", () => ({
    getVaultDEKFromSession: jest.fn(),
    getVaultSessionGeneration: () => 1,
    isSameActiveVaultSession: () => true,
}));
jest.mock("@/hooks/use-auto-lock", () => ({
    useAutoLock: jest.fn(() => ({ resumeAfterFailedLock: jest.fn() })),
}));
jest.mock("@/app_lib/online-services-billing", () => ({
    storeBilling: jest.fn(() => null),
    restoreStorePurchases: jest.fn(),
    openBillingManagement: jest.fn(),
    billingManagement: jest.fn(() => "stripe"),
}));
jest.mock("expo-router", () => ({
    Redirect: "Redirect",
    useLocalSearchParams: () => mockParams,
}));
jest.mock("expo-router/react-navigation", () => ({
    useIsFocused: () => mockFocused,
}));

let mockParams: { outcome?: string } = {};
let mockFocused = true;
let renderer: ReactTestRenderer | undefined;
const store = createStore();
const { mockUnlockedAtom } = jest.requireMock<{
    mockUnlockedAtom: PrimitiveAtom<boolean>;
}>("@/utils/atoms");

beforeEach(() => {
    jest.mocked(storeBilling).mockReturnValue(null);
    jest.mocked(billingManagement).mockReturnValue("stripe");
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    mockParams = {};
    mockFocused = true;
    store.set(mockUnlockedAtom, false);
    store.set(vaultLockStateAtom, "idle");
    jest.mocked(getVaultDEKFromSession).mockReturnValue(ok({} as CryptoKey));
    jest.mocked(openBillingManagement).mockResolvedValue({ ok: true });
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean })
        .IS_REACT_NATIVE_TEST_ENVIRONMENT;
});
async function renderReturn() {
    await act(async () => {
        renderer = create(
            createElement(
                Provider,
                { store },
                createElement(BillingReturnScreen),
            ),
        );
    });
}

it("preserves the fixed checkout return path through a locked vault", async () => {
    mockParams.outcome = "success";
    await renderReturn();
    expect(renderer!.root.findByType("Redirect" as never).props.href).toEqual({
        pathname: "/(locked)/unlock",
        params: { returnTo: "/billing-return?outcome=success" },
    });
});

it("waits for safe auto-lock when the atom still says unlocked but DEK access has expired", async () => {
    store.set(mockUnlockedAtom, true);
    mockParams.outcome = "cancel";
    jest.mocked(getVaultDEKFromSession).mockReturnValue(
        err("VAULT_DEK_NOT_FOUND"),
    );
    await renderReturn();
    expect(renderer!.root.findAllByType("Redirect" as never)).toHaveLength(0);
    expect(renderer!.root.findAllByType("LockScreen" as never)).toHaveLength(1);
    expect(useAutoLock).toHaveBeenCalledWith(
        true,
        "/billing-return?outcome=cancel",
    );
});

it("keeps the existing save-failure lock UI and does not run auto-lock off screen", async () => {
    store.set(mockUnlockedAtom, true);
    store.set(vaultLockStateAtom, "failed");
    mockFocused = false;
    await renderReturn();
    expect(renderer!.root.findAllByType("LockScreen" as never)).toHaveLength(1);
    expect(useAutoLock).toHaveBeenCalledWith(
        false,
        "/billing-return?outcome=resume",
    );
});

it.each(["success", "cancel", "return", "https://attacker.test", undefined])(
    "routes %s only to account refresh without trusting arbitrary navigation",
    async (outcome) => {
        store.set(mockUnlockedAtom, true);
        mockParams.outcome = outcome;
        await renderReturn();
        const { pathname, params } = renderer!.root.findByType(
            "Redirect" as never,
        ).props.href;
        expect(pathname).toBe("/(app)/(tabs)/account");
        expect(params.billingOutcome).toBe(
            outcome === "success" || outcome === "cancel" ? outcome : "resume",
        );
    },
);

const summaryProps = {
    mode: "overview" as const,
    tierName: "Free",
    subscriptionStatus: "active",
    subscription: { nonFree: false },
    remoteConfig: {},
    hasSession: true,
    deviceId: "device",
    userId: "user",
    onlineServicesBound: true,
    isConnected: true,
    authStatusDescription: "Connected",
    refreshing: false,
    onRefresh: jest.fn(),
    onMessage: jest.fn(),
    onExternalBillingOpened: jest.fn(),
    onOpenUpgrade: jest.fn(),
    onRestored: jest.fn(),
};
function button(label: string) {
    return renderer!.root
        .findAllByType("Button" as never)
        .find((node) => node.props.children === label)!;
}

it("opens upgrade details without starting checkout or exposing the interval picker in Account", async () => {
    await act(async () => {
        renderer = create(createElement(AccountSummary, summaryProps));
    });
    expect(
        renderer!.root.findAll(
            (node) => node.props.accessibilityRole === "radio",
        ),
    ).toHaveLength(0);
    await act(async () => button("Upgrade membership").props.onPress());
    expect(summaryProps.onOpenUpgrade).toHaveBeenCalledTimes(1);
});

it("defaults to Monthly in the upgrade sheet and continues with the selected tier", async () => {
    const onContinue = jest.fn();
    await act(async () => {
        renderer = create(
            createElement(MembershipUpgrade, {
                canUpgrade: true,
                refreshing: false,
                onMessage: summaryProps.onMessage,
                onContinue,
            }),
        );
    });
    const options = renderer!.root.findAllByType("Pressable" as never);
    expect(options[0]!.props.accessibilityState.checked).toBe(true);
    await act(async () => button("Continue with monthly").props.onPress());
    expect(onContinue).toHaveBeenLastCalledWith("premiumMonthly", false);
    await act(async () => options[1]!.props.onPress());
    await act(async () => button("Continue with yearly").props.onPress());
    expect(onContinue).toHaveBeenLastCalledWith("premiumYearly", false);
});

it("continues to use the customer portal for paid members", async () => {
    await act(async () => {
        renderer = create(
            createElement(AccountSummary, {
                ...summaryProps,
                subscription: { nonFree: true },
            }),
        );
    });
    await act(async () => button("Manage billing").props.onPress());
    expect(openBillingManagement).toHaveBeenCalledTimes(1);
    expect(summaryProps.onExternalBillingOpened).toHaveBeenCalledTimes(1);
});

it.each(["overview", "membership"] as const)(
    "shows a Play build's Stripe subscriber where they are billed without linking to Stripe in %s",
    async (mode) => {
        jest.mocked(storeBilling).mockReturnValue("google_play");
        jest.mocked(billingManagement).mockReturnValue(null);
        await act(async () => {
            renderer = create(
                createElement(AccountSummary, {
                    ...summaryProps,
                    mode,
                    subscription: { nonFree: true, provider: "stripe" },
                }),
            );
        });
        expect(button("Manage billing")).toBeUndefined();
        expect(button("Manage Google Play subscriptions")).toBeUndefined();
        expect(JSON.stringify(renderer!.toJSON())).toContain(
            "Billed outside Google Play",
        );
        expect(openBillingManagement).not.toHaveBeenCalled();
    },
);

it("shows free and paid benefits in Membership with only enabled services highlighted and no tier picker", async () => {
    await act(async () => {
        renderer = create(
            createElement(AccountSummary, {
                ...summaryProps,
                mode: "membership",
                remoteConfig: {
                    canLink: true,
                    canPromoteDevices: false,
                    managedEncryptedBackups: false,
                },
            }),
        );
    });
    const labels = renderer!.root
        .findAllByType("View" as never)
        .map((node) => node.props.accessibilityLabel)
        .filter(Boolean);
    expect(labels).toContain("Local encrypted vault, included");
    expect(labels).toContain("Managed P2P infrastructure, included");
    expect(labels).toContain(
        "Managed encrypted backups, Online Services tier only",
    );
    expect(labels).toContain(
        "Online Services device management, Online Services tier only",
    );
    expect(
        renderer!.root.findAll(
            (node) => node.props.accessibilityRole === "radio",
        ),
    ).toHaveLength(0);
    expect(button("Refresh account status")).toBeUndefined();
    await act(async () => button("Upgrade").props.onPress());
    expect(summaryProps.onOpenUpgrade).toHaveBeenCalled();
});

it.each([
    { ok: false as const, pending: "sync" as const },
    { ok: true as const },
])(
    "hands restored purchases %p to the account for confirmation and hides restore while it confirms",
    async (result) => {
        jest.mocked(storeBilling).mockReturnValue("google_play");
        jest.mocked(restoreStorePurchases).mockResolvedValueOnce(result);
        await act(async () => {
            renderer = create(createElement(AccountSummary, summaryProps));
        });
        const restore = button("Restore Google Play purchases").props.onPress;
        await act(async () => restore());
        expect(summaryProps.onRestored).toHaveBeenCalledTimes(1);
        await act(async () =>
            renderer!.update(
                createElement(AccountSummary, {
                    ...summaryProps,
                    paymentStatus: createElement("PaymentCard"),
                }),
            ),
        );
        expect(
            renderer!.root.findAllByType("PaymentCard" as never),
        ).toHaveLength(1);
        expect(button("Restore Google Play purchases")).toBeUndefined();
        expect(button("Upgrade membership")).toBeUndefined();
        expect(summaryProps.onMessage).not.toHaveBeenCalled();
        expect(summaryProps.onExternalBillingOpened).not.toHaveBeenCalled();
    },
);

it("keeps canceled restore quiet", async () => {
    jest.mocked(storeBilling).mockReturnValue("google_play");
    jest.mocked(restoreStorePurchases).mockResolvedValueOnce({
        ok: false,
        canceled: true,
    });
    await act(async () => {
        renderer = create(createElement(AccountSummary, summaryProps));
    });
    await act(async () =>
        button("Restore Google Play purchases").props.onPress(),
    );
    expect(summaryProps.onMessage).not.toHaveBeenCalled();
    expect(summaryProps.onRestored).not.toHaveBeenCalled();
});
