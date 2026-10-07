import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AppState } from "react-native";
import { router } from "expo-router";
import { trpcReact } from "@/utils/trpc";
import { syncOnlineServicesRemoteConfiguration } from "@/app_lib/auth-session";
import { refreshSubscriptionAfterExternalBilling } from "@/app_lib/online-services-billing";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";
import AccountScreen from "../app/(app)/(tabs)/account";

jest.mock("react-native", () => ({
    View: "View",
    AppState: {
        currentState: "active",
        addEventListener: (
            _type: string,
            callback: (state: string) => void,
        ) => {
            mockListeners.add(callback);
            return { remove: () => mockListeners.delete(callback) };
        },
    },
}));
jest.mock("lucide-react-native", () => ({
    Shield: "Shield",
    Smartphone: "Smartphone",
    User: "User",
    ArrowLeft: "ArrowLeft",
}));
jest.mock("expo-router", () => ({
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (callback: () => void) => {
        const { useEffect } =
            jest.requireActual<typeof import("react")>("react");
        const focused = mockFocused;
        useEffect(() => {
            if (focused) return callback();
        }, [callback, focused]);
    },
    router: {
        setParams: jest.fn((params: object) =>
            Object.assign(mockParams, params),
        ),
        push: jest.fn(),
    },
}));
jest.mock("expo-router/react-navigation", () => ({
    useIsFocused: () => mockFocused,
}));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedButton: "Button",
    UnlockedMenuRow: "MenuRow",
    UnlockedPageTitle: "PageTitle",
    UnlockedScreen: "Screen",
    UnlockedText: "Text",
    UnlockedDialogTitle: "DialogTitle",
}));
jest.mock("@/components/account/account-summary", () => ({
    AccountSummary: "AccountSummary",
}));
jest.mock("@/components/account/membership-upgrade", () => ({
    MembershipUpgrade: "MembershipUpgrade",
}));
jest.mock("@/components/account/subscription-signup", () => ({
    SubscriptionSignup: "SubscriptionSignup",
}));
jest.mock("@/components/inline-notice", () => ({ InlineNotice: "Notice" }));
jest.mock("@/components/ui/dialog", () => ({
    Dialog: "Dialog",
    DialogHeader: "DialogHeader",
}));
jest.mock("@cryptex-industries/vault-core/vault-utils/vault", () => ({
    Vault: { isOnlineServicesBound: () => mockBound },
}));
jest.mock("@/utils/online-services-api-url", () => ({
    isCloudServicesEnabled: () => true,
}));
jest.mock("@/utils/atoms", () => {
    const { atom, createStore } =
        jest.requireActual<typeof import("jotai")>("jotai");
    return {
        unlockedVaultAtom: atom({
            OnlineServices: { DeviceId: "device-a", UserID: "user-a" },
        }),
        onlineServicesDataAtom: atom({
            sessionToken: "test-token",
            remoteData: {},
        }),
        onlineServicesAuthConnectionStatusAtom: atom({
            statusDescription: "Connected",
        }),
        onlineServicesStore: createStore(),
    };
});
jest.mock("@/app_lib/auth-session", () => ({
    establishOnlineServicesSession: jest.fn(),
    syncOnlineServicesRemoteConfiguration: jest.fn(),
}));
jest.mock("@/app_lib/online-services-billing", () => ({
    refreshSubscriptionAfterExternalBilling: jest.fn(),
}));
jest.mock("@/utils/vault-session", () => ({
    getVaultSessionGeneration: jest.fn(),
    isSameActiveVaultSession: jest.fn(),
}));
jest.mock("@/utils/trpc", () => {
    const utils = {
        v1: {
            user: {
                configuration: { invalidate: jest.fn(async () => undefined) },
            },
            payment: {
                subscription: {
                    setData: jest.fn(),
                    invalidate: jest.fn(async () => undefined),
                },
                customerPortal: { invalidate: jest.fn(async () => undefined) },
            },
        },
    };
    return {
        trpcReact: {
            useUtils: () => utils,
            v1: {
                user: {
                    configuration: {
                        useQuery: () => ({
                            data: mockRemoteConfig,
                            refetch: mockRefetchConfig,
                            isFetching: false,
                        }),
                    },
                },
                payment: {
                    subscription: {
                        useQuery: jest.fn(() => ({
                            data: { nonFree: false },
                            refetch: mockRefetchSubscription,
                            isFetching: false,
                        })),
                    },
                },
            },
        },
    };
});

let renderer: ReactTestRenderer | undefined;
let mockFocused = true;
let mockBound = true;
let mockRemoteConfig:
    | { root: boolean; recoveryTokenCreatedAt: Date | null }
    | undefined;
let mockParams: {
    billingOutcome?: string;
    billingReturn?: string;
    billingResume?: string;
    signup?: string;
} = {};
const mockListeners = new Set<(state: string) => void>();
const mockRefetchConfig = jest.fn<() => Promise<unknown>>();
const mockRefetchSubscription = jest.fn<() => Promise<unknown>>();
const refresh = jest.mocked(refreshSubscriptionAfterExternalBilling);
const utils = trpcReact.useUtils();
const paid = { nonFree: true } as NonNullable<
    Awaited<ReturnType<typeof refresh>>
>;
const free = { nonFree: false } as typeof paid;
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}
async function render() {
    await act(async () => {
        if (renderer) renderer.update(createElement(AccountScreen));
        else renderer = create(createElement(AccountScreen));
    });
}
async function state(next: string) {
    await act(async () => {
        AppState.currentState = next as typeof AppState.currentState;
        for (const listener of Array.from(mockListeners)) listener(next);
    });
    await render();
}
beforeEach(() => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    mockParams = {};
    mockFocused = true;
    mockBound = true;
    mockRemoteConfig = { root: true, recoveryTokenCreatedAt: new Date(0) };
    mockListeners.clear();
    AppState.currentState = "active";
    jest.mocked(getVaultSessionGeneration).mockReset().mockReturnValue(1);
    jest.mocked(isSameActiveVaultSession).mockReset().mockReturnValue(true);
    refresh.mockReset().mockResolvedValue(free);
    mockRefetchConfig.mockReset().mockResolvedValue({ data: {} });
    mockRefetchSubscription.mockReset().mockResolvedValue({ data: free });
    jest.mocked(trpcReact.v1.payment.subscription.useQuery).mockReturnValue({
        data: free,
        refetch: mockRefetchSubscription,
        isFetching: false,
    } as never);
    jest.mocked(syncOnlineServicesRemoteConfiguration)
        .mockReset()
        .mockResolvedValue(undefined);
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean })
        .IS_REACT_NATIVE_TEST_ENVIRONMENT;
});

it("shows confirmation progress then authoritative pending status without a payment-success claim", async () => {
    const pending = deferred<typeof free>();
    refresh.mockReturnValue(pending.promise);
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    expect(
        renderer!.root
            .findAllByType("Notice" as never)
            .some((node) => node.props.message === "Confirming membership…"),
    ).toBe(true);
    await act(async () => pending.resolve(free));
    expect(utils.v1.payment.subscription.setData).toHaveBeenCalledWith(
        undefined,
        free,
    );
    expect(utils.v1.payment.subscription.invalidate).toHaveBeenCalledWith(
        undefined,
        { refetchType: "none" },
    );
    expect(
        renderer!.root
            .findAllByType("Notice" as never)
            .some((node) => node.props.message.includes("still pending")),
    ).toBe(true);
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(1);
    expect(
        renderer!.root
            .findAllByType("Notice" as never)
            .some(
                (node) => node.props.message === "Your membership is active.",
            ),
    ).toBe(false);
});

it.each<["resume" | "cancel", typeof free]>([
    ["resume", free],
    ["resume", paid],
    ["cancel", free],
    ["cancel", paid],
])(
    "silently refreshes membership after %s for the returned subscription",
    async (outcome, subscription) => {
        const pending = deferred<typeof free>();
        refresh.mockReturnValue(pending.promise);
        mockParams = {
            billingOutcome: outcome,
            billingReturn: "billing-return",
        };
        await render();
        expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(0);
        await act(async () => pending.resolve(subscription));
        expect(utils.v1.payment.subscription.setData).toHaveBeenCalledWith(
            undefined,
            subscription,
        );
        expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(0);
    },
);

it("clears confirmation progress once the authoritative subscription is active", async () => {
    const pending = deferred<typeof paid>();
    refresh.mockReturnValue(pending.promise);
    mockParams = {
        billingOutcome: "success",
        billingReturn: "checkout-return",
    };
    await render();
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(1);
    await act(async () => pending.resolve(paid));
    expect(utils.v1.payment.subscription.setData).toHaveBeenCalledWith(
        undefined,
        paid,
    );
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(0);
});

it("preserves a useful billing refresh failure without a routine success notice", async () => {
    refresh.mockRejectedValueOnce(new Error("Offline"));
    mockParams = { billingOutcome: "resume", billingReturn: "billing-return" };
    await render();
    const notices = renderer!.root.findAllByType("Notice" as never);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.props.tone).toBe("error");
    expect(notices[0]!.props.message).toContain("Could not refresh membership");
});

it("shows an account error once when its sheet is opened and once after it closes", async () => {
    await render();
    const overview = renderer!.root
        .findAllByType("AccountSummary" as never)
        .find((node) => node.props.mode === "overview")!;
    await act(async () =>
        overview.props.onMessage("Could not open billing portal."),
    );
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(1);
    await act(async () =>
        renderer!.root
            .findAllByType("MenuRow" as never)
            .find((node) => node.props.title === "Account identifiers")!
            .props.onPress(),
    );
    expect(renderer!.root.findByType("Dialog" as never).props.open).toBe(true);
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(1);
    await act(async () =>
        renderer!.root.findByType("Dialog" as never).props.onOpenChange(false),
    );
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(1);
});

it.each(["background", "inactive"] as const)(
    "refreshes a pending deep link when a %s mount becomes active without another render",
    async (initialState) => {
        AppState.currentState = initialState;
        mockParams = {
            billingOutcome: "resume",
            billingReturn: "portal-return",
        };
        await render();
        expect(refresh).not.toHaveBeenCalled();

        // Native AppState events must drive React themselves. An explicit
        // renderer.update here would hide the real warm browser-return race.
        await act(async () => {
            AppState.currentState = "active";
            for (const listener of Array.from(mockListeners)) {
                listener("active");
            }
        });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(refresh.mock.calls[0]![0]).toBe("resume");
        expect(utils.v1.payment.subscription.setData).toHaveBeenCalledWith(
            undefined,
            free,
        );
    },
);

it.each(["success", "cancel"] as const)(
    "preserves an incoming %s callback when the prior billing browser resumes",
    async (outcome) => {
        await render();
        renderer!.root
            .findAllByType("AccountSummary" as never)[0]!
            .props.onExternalBillingOpened();
        await state("background");
        mockParams = { billingOutcome: outcome, billingReturn: "checkout-a" };
        await render();
        await act(async () => {
            AppState.currentState = "active";
            for (const listener of Array.from(mockListeners)) {
                listener("active");
            }
        });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(refresh.mock.calls[0]![0]).toBe(outcome);
    },
);

it("aborts on background and preserves the same confirmation budget across three returns", async () => {
    refresh.mockImplementation(() => new Promise(() => {}));
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    const confirmation = refresh.mock.calls[0]![2];
    for (let cycle = 0; cycle < 3; cycle++) {
        const previousSignal = refresh.mock.calls[cycle]![1];
        await state("background");
        expect(previousSignal.aborted).toBe(true);
        expect(
            renderer!.root
                .findAllByType("AccountSummary" as never)
                .every((node) => node.props.refreshing === false),
        ).toBe(true);
        await state("active");
        expect(refresh.mock.calls[cycle + 1]![2]).toBe(confirmation);
    }
    expect(refresh).toHaveBeenCalledTimes(4);
});

it("does not poll or react to AppState while the account route is retained off screen", async () => {
    mockFocused = false;
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    await state("background");
    await state("active");
    expect(refresh).not.toHaveBeenCalled();
    mockFocused = true;
    await render();
    expect(refresh).toHaveBeenCalledTimes(1);
});

it("refreshes once when the user returns manually from the billing browser", async () => {
    await render();
    renderer!.root
        .findAllByType("AccountSummary" as never)[0]!
        .props.onExternalBillingOpened();
    await state("background");
    await state("active");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0]![0]).toBe("resume");
});

it("discards stale results before cache writes if the vault expires during the refresh", async () => {
    const pending = deferred<typeof paid>();
    refresh.mockReturnValue(pending.promise);
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    jest.mocked(isSameActiveVaultSession).mockReturnValue(false);
    await act(async () => pending.resolve(paid));
    expect(utils.v1.payment.subscription.setData).not.toHaveBeenCalled();
    expect(utils.v1.user.configuration.invalidate).not.toHaveBeenCalled();
});

it("replaces the previous confirmation state for a distinct browser return", async () => {
    refresh.mockImplementation(() => new Promise(() => {}));
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    const first = refresh.mock.calls[0]![2];
    mockParams = { billingOutcome: "success", billingReturn: "checkout-b" };
    await render();
    expect(refresh.mock.calls[1]![2]).not.toBe(first);
    expect(refresh.mock.calls[0]![1].aborted).toBe(true);
});

it("drops a prior confirmation when a different vault session becomes active", async () => {
    refresh.mockImplementation(() => new Promise(() => {}));
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    const signal = refresh.mock.calls[0]![1];
    await state("background");
    jest.mocked(getVaultSessionGeneration).mockReturnValue(2);
    await state("active");
    expect(signal.aborted).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(router.setParams).toHaveBeenLastCalledWith({
        billingOutcome: undefined,
        billingReturn: undefined,
        billingResume: undefined,
    });
    expect(utils.v1.payment.subscription.setData).not.toHaveBeenCalled();
});

it("refreshes on every Membership open and keeps a loading overlay until the account data arrives", async () => {
    await render();
    const pending = deferred<unknown>();
    mockRefetchSubscription.mockReturnValue(pending.promise);
    const overview = renderer!.root
        .findAllByType("AccountSummary" as never)
        .find((node) => node.props.mode === "overview")!;
    await act(async () => overview.props.onOpenMembership());
    const dialog = renderer!.root.findByType("Dialog" as never);
    expect(dialog.props.open).toBe(true);
    expect(dialog.props.loading).toBe(true);
    expect(mockRefetchSubscription).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ data: free }));
    expect(dialog.props.loading).toBe(false);
    await act(async () => dialog.props.onOpenChange(false));
    await act(async () => overview.props.onOpenMembership());
    expect(mockRefetchSubscription).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(0);
});

it("offers Retry after a failed automatic refresh and recovers without a persistent refresh button", async () => {
    mockRefetchSubscription.mockRejectedValueOnce(
        new Error("network unavailable"),
    );
    await render();
    await act(async () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "overview")!
            .props.onOpenMembership(),
    );
    expect(renderer!.root.findByType("Dialog" as never).props.loading).toBe(
        false,
    );
    expect(
        renderer!.root
            .findAllByType("Notice" as never)
            .some((node) => node.props.message.includes("Could not update")),
    ).toBe(true);
    await act(async () =>
        renderer!.root
            .findAllByType("Button" as never)
            .find((node) => node.props.children === "Retry")!
            .props.onPress(),
    );
    expect(mockRefetchSubscription).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(0);
});

it("opens the dedicated upgrade sheet and closes it when the checkout browser opens", async () => {
    await render();
    const overview = renderer!.root
        .findAllByType("AccountSummary" as never)
        .find((node) => node.props.mode === "overview")!;
    await act(async () => overview.props.onOpenUpgrade());
    expect(renderer!.root.findByType("Dialog" as never).props.open).toBe(true);
    const upgrade = renderer!.root.findByType("MembershipUpgrade" as never);
    expect(upgrade.props.canUpgrade).toBe(true);
    expect(
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .some((node) => node.props.mode === "membership"),
    ).toBe(false);
    await act(async () => upgrade.props.onExternalBillingOpened());
    expect(renderer!.root.findByType("Dialog" as never).props.open).toBe(false);
    expect(
        renderer!.root.findAllByType("MembershipUpgrade" as never),
    ).toHaveLength(0);
});

it("opens subscription signup directly for an unbound vault", async () => {
    mockBound = false;
    await render();
    await act(async () =>
        renderer!.root
            .findAllByType("Button" as never)
            .find((node) => node.props.children === "Get Online Services")!
            .props.onPress(),
    );
    expect(
        renderer!.root.findByType("SubscriptionSignup" as never).props.open,
    ).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
});

it("resumes interrupted bound signup through Upgrade without leaving two sheets open", async () => {
    mockBound = false;
    await render();
    await act(async () =>
        renderer!.root
            .findAllByType("Button" as never)
            .find((node) => node.props.children === "Get Online Services")!
            .props.onPress(),
    );
    mockBound = true;
    await render();
    await act(async () =>
        renderer!.root
            .findByType("SubscriptionSignup" as never)
            .props.onOpenChange(false),
    );
    const overview = renderer!.root
        .findAllByType("AccountSummary" as never)
        .find((node) => node.props.mode === "overview")!;
    await act(async () => overview.props.onOpenMembership());
    await act(async () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "membership")!
            .props.onOpenUpgrade(),
    );
    expect(
        renderer!.root.findByType("SubscriptionSignup" as never).props.open,
    ).toBe(true);
    expect(renderer!.root.findByType("Dialog" as never).props.open).toBe(false);
});

it("uses normal upgrade for an existing-kit account reached through the old register route", async () => {
    mockParams = { signup: "1" };
    await render();
    expect(
        renderer!.root.findAllByType("SubscriptionSignup" as never),
    ).toHaveLength(0);
    expect(
        renderer!.root.findByType("MembershipUpgrade" as never).props
            .canUpgrade,
    ).toBe(true);
});

it("resumes a missing kit through the old register route even when automatic recovery is not requested", async () => {
    mockParams = { signup: "1" };
    mockRemoteConfig = { root: true, recoveryTokenCreatedAt: null };
    await render();
    expect(
        renderer!.root.findByType("SubscriptionSignup" as never).props.open,
    ).toBe(true);
    expect(
        renderer!.root.findAllByType("MembershipUpgrade" as never),
    ).toHaveLength(0);
});

it("waits for configuration before deciding how an existing legacy signup should resume", async () => {
    mockParams = { signup: "1" };
    mockRemoteConfig = undefined;
    await render();
    expect(
        renderer!.root.findAllByType("SubscriptionSignup" as never),
    ).toHaveLength(0);
    expect(
        renderer!.root.findAllByType("MembershipUpgrade" as never),
    ).toHaveLength(0);
    mockRemoteConfig = { root: true, recoveryTokenCreatedAt: new Date(0) };
    await render();
    expect(
        renderer!.root.findByType("MembershipUpgrade" as never).props
            .canUpgrade,
    ).toBe(true);
});

it("keeps paid legacy accounts on Membership with their existing billing behavior", async () => {
    mockParams = { signup: "1" };
    jest.mocked(trpcReact.v1.payment.subscription.useQuery).mockReturnValue({
        data: paid,
        refetch: mockRefetchSubscription,
        isFetching: false,
    } as never);
    await render();
    expect(
        renderer!.root.findAllByType("SubscriptionSignup" as never),
    ).toHaveLength(0);
    expect(
        renderer!.root.findAllByType("MembershipUpgrade" as never),
    ).toHaveLength(0);
    expect(
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "membership")!.props
            .subscription.nonFree,
    ).toBe(true);
});

it("keeps a free secondary device on normal upgrade when its configuration hides the kit creation date", async () => {
    mockParams = { signup: "1" };
    mockRemoteConfig = { root: false, recoveryTokenCreatedAt: null };
    await render();
    expect(
        renderer!.root.findAllByType("SubscriptionSignup" as never),
    ).toHaveLength(0);
    expect(
        renderer!.root.findByType("MembershipUpgrade" as never).props
            .canUpgrade,
    ).toBe(true);
});

it("resumes a root account with a missing kit through Upgrade without prior local signup state", async () => {
    mockRemoteConfig = { root: true, recoveryTokenCreatedAt: null };
    await render();
    await act(async () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "overview")!
            .props.onOpenUpgrade(),
    );
    expect(
        renderer!.root.findByType("SubscriptionSignup" as never).props.open,
    ).toBe(true);
    expect(
        renderer!.root.findAllByType("MembershipUpgrade" as never),
    ).toHaveLength(0);
});

it("discards retained signup state when the unlocked vault session changes", async () => {
    mockBound = false;
    await render();
    await act(async () =>
        renderer!.root
            .findAllByType("Button" as never)
            .find((node) => node.props.children === "Get Online Services")!
            .props.onPress(),
    );
    jest.mocked(getVaultSessionGeneration).mockReturnValue(2);
    await render();
    expect(
        renderer!.root.findAllByType("SubscriptionSignup" as never),
    ).toHaveLength(0);
});
