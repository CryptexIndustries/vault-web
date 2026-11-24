import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AppState } from "react-native";
import { getDefaultStore } from "jotai";
import {
    unlockedVaultAtom,
    onlineServicesDataAtom,
    onlineServicesStore,
} from "@/utils/atoms";
import { router } from "expo-router";
import { trpcReact } from "@/utils/trpc";
import {
    establishOnlineServicesSession,
    syncOnlineServicesRemoteConfiguration,
} from "@/app_lib/auth-session";
import NetInfo from "@react-native-community/netinfo";
import {
    storeBilling,
    confirmMembership,
    purchaseMembership,
    restoreStorePurchases,
} from "@/app_lib/online-services-billing";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";
import AccountScreen from "../app/(app)/(tabs)/account";

jest.mock("react-native", () => ({
    useWindowDimensions: () => ({ fontScale: 1 }),
    View: "View",
    Pressable: "Pressable",
    Platform: { OS: "android" },
    AccessibilityInfo: {},
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
    X: "X",
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
    formatAccountDate: (_locale: string, value?: Date | null) =>
        value ? "June 1, 2027" : null,
}));
jest.mock("@/components/account/payment-status", () => ({
    PaymentStatus: "PaymentStatus",
}));
jest.mock("@react-native-community/netinfo", () => ({
    __esModule: true,
    default: { addEventListener: jest.fn(() => () => undefined) },
}));
jest.mock("@/components/account/membership-upgrade", () => ({
    MembershipUpgrade: "MembershipUpgrade",
}));
jest.mock("@/components/account/subscription-signup", () => ({
    SubscriptionSignup: "SubscriptionSignup",
}));
jest.mock("@/components/inline-notice", () => ({ InlineNotice: "Notice" }));
jest.mock("@/components/ui/dialog", () => ({
    Dialog: ({
        footer,
        children,
        ...props
    }: {
        footer?: React.ReactNode;
        children?: React.ReactNode;
    }) => createElement("Dialog", props, children, footer),
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
            status: "CONNECTED",
            statusDescription: "Connected",
        }),
        onlineServicesAuthStatusLabel: () => "Connected",
        onlineServicesStore: createStore(),
    };
});
jest.mock("@/app_lib/auth-session", () => ({
    establishOnlineServicesSession: jest.fn(),
    syncOnlineServicesRemoteConfiguration: jest.fn(),
}));
jest.mock("@/app_lib/online-services-billing", () => ({
    storeBilling: jest.fn(() => null),
    confirmMembership: jest.fn(),
    purchaseMembership: jest.fn(),
    restoreStorePurchases: jest.fn(),
    confirmationSchedules: {
        store: "store",
        stripe: "stripe",
        returned: "returned",
        once: "once",
    },
    startConfirmation: (schedule: string, sync: string) => ({ schedule, sync }),
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
const confirm = jest.mocked(confirmMembership);
const purchase = jest.mocked(purchaseMembership);
const utils = trpcReact.useUtils();
const paid = {
    nonFree: true,
    status: "trialing",
    trialEndsAt: new Date(0),
} as never;
const free = { nonFree: false } as never;
const notYet = { subscription: null, offline: false };
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
function panel() {
    return renderer!.root
        .findAllByType("PaymentStatus" as never)
        .find((node) => !node.props.compact)?.props;
}
function summary(mode: "overview" | "membership") {
    return renderer!.root
        .findAllByType("AccountSummary" as never)
        .find((node) => node.props.mode === mode)!.props;
}
function texts() {
    return renderer!.root
        .findAllByType("Text" as never)
        .map((node) => node.props.children);
}
async function openUpgrade() {
    await act(async () => summary("overview").onOpenUpgrade());
}
async function payFromUpgrade(tier = "premiumMonthly") {
    await act(async () =>
        renderer!.root
            .findByType("MembershipUpgrade" as never)
            .props.onContinue(tier, false),
    );
}
async function activate() {
    await act(async () => {
        AppState.currentState = "active";
        for (const listener of Array.from(mockListeners)) listener("active");
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
    jest.mocked(storeBilling).mockReturnValue(null);
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    getDefaultStore().set(unlockedVaultAtom, {
        OnlineServices: { DeviceId: "device-a", UserID: "user-a" },
    } as never);
    onlineServicesStore.set(onlineServicesDataAtom, {
        sessionToken: "test-token",
        remoteData: {},
    } as never);
    jest.mocked(establishOnlineServicesSession)
        .mockReset()
        .mockResolvedValue(undefined);
    mockParams = {};
    mockFocused = true;
    mockBound = true;
    mockRemoteConfig = { root: true, recoveryTokenCreatedAt: new Date(0) };
    mockListeners.clear();
    AppState.currentState = "active";
    jest.mocked(getVaultSessionGeneration).mockReset().mockReturnValue(1);
    jest.mocked(isSameActiveVaultSession).mockReset().mockReturnValue(true);
    confirm.mockReset().mockResolvedValue(notYet);
    purchase.mockReset().mockResolvedValue({ ok: true });
    jest.mocked(restoreStorePurchases).mockReset().mockResolvedValue({
        ok: true,
    });
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

it("opens the payment panel for a Stripe success link and falls back to Still confirming", async () => {
    const result = deferred<Awaited<ReturnType<typeof confirm>>>();
    confirm.mockReturnValue(result.promise);
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    expect(renderer!.root.findByType("Dialog" as never).props.open).toBe(true);
    expect(renderer!.root.findAllByType("DialogHeader" as never)).toHaveLength(
        0,
    );
    expect(panel()).toMatchObject({ state: "confirming", store: "stripe" });
    expect(confirm.mock.calls[0]![0]).toEqual({
        schedule: "stripe",
        sync: "never",
    });
    expect(mockParams.billingOutcome).toBeUndefined();
    await act(async () =>
        result.resolve({ subscription: null, offline: true }),
    );
    expect(panel()).toMatchObject({
        state: "unconfirmed",
        offline: true,
        checking: false,
    });
    expect(utils.v1.payment.subscription.setData).not.toHaveBeenCalled();
});

it("installs a confirmed subscription and closes the panel on Done", async () => {
    confirm.mockResolvedValue({ subscription: paid, offline: false });
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    expect(utils.v1.payment.subscription.setData).toHaveBeenCalledWith(
        undefined,
        paid,
    );
    expect(utils.v1.user.configuration.invalidate).toHaveBeenCalled();
    expect(panel()).toMatchObject({
        state: "confirmed",
        trial: true,
        date: "June 1, 2027",
    });
    await act(async () => panel()!.onPrimary());
    expect(renderer!.root.findByType("Dialog" as never).props.open).toBe(false);
    expect(panel()).toBeUndefined();
});

it("ignores a late cancel link while a Stripe payment is confirming", async () => {
    confirm.mockReturnValue(new Promise(() => {}));
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    const signal = confirm.mock.calls[0]![1];
    mockParams = { billingOutcome: "cancel", billingReturn: "checkout-b" };
    await render();
    expect(panel()).toMatchObject({ state: "confirming" });
    expect(signal.aborted).toBe(false);
    expect(texts()).not.toContain("Payment canceled. Nothing was charged.");
});

it("stops confirming and ignores a late result when Online Services signs out", async () => {
    const result = deferred<Awaited<ReturnType<typeof confirm>>>();
    confirm.mockReturnValue(result.promise);
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    const signal = confirm.mock.calls[0]![1];
    await act(async () =>
        onlineServicesStore.set(onlineServicesDataAtom, null),
    );
    expect(signal.aborted).toBe(true);
    await act(async () =>
        result.resolve({ subscription: paid, offline: false }),
    );
    expect(utils.v1.payment.subscription.setData).not.toHaveBeenCalled();
});

it("reports a Stripe cancel link without opening a sheet", async () => {
    mockParams = { billingOutcome: "cancel", billingReturn: "checkout-a" };
    await render();
    expect(renderer!.root.findByType("Dialog" as never).props.open).toBe(false);
    expect(texts()).toContain("Payment canceled. Nothing was charged.");
    expect(confirm).not.toHaveBeenCalled();
});

it("refreshes membership for a return with no checkout in progress", async () => {
    mockParams = { billingOutcome: "resume", billingReturn: "portal-return" };
    await render();
    expect(mockRefetchSubscription).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(panel()).toBeUndefined();
});

it("clears a previous screen error when the account sheet changes view", async () => {
    await render();
    const overview = renderer!.root
        .findAllByType("AccountSummary" as never)
        .find((node) => node.props.mode === "overview")!;
    await act(async () =>
        overview.props.onMessage("Could not open billing portal."),
    );
    expect(renderer!.root.findAllByProps({ testID: "snackbar" })).toHaveLength(
        1,
    );
    await act(async () =>
        renderer!.root
            .findAllByType("MenuRow" as never)
            .find((node) => node.props.title === "Account identifiers")!
            .props.onPress(),
    );
    expect(renderer!.root.findByType("Dialog" as never).props.open).toBe(true);
    expect(renderer!.root.findAllByProps({ testID: "snackbar" })).toHaveLength(
        0,
    );
    await act(async () =>
        renderer!.root.findByType("Dialog" as never).props.onOpenChange(false),
    );
    expect(renderer!.root.findAllByProps({ testID: "snackbar" })).toHaveLength(
        0,
    );
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
        expect(mockRefetchSubscription).not.toHaveBeenCalled();

        // Native AppState events must drive React themselves. An explicit
        // renderer.update here would hide the real warm browser-return race.
        await activate();
        expect(mockRefetchSubscription).toHaveBeenCalledTimes(1);
    },
);

it.each<["success" | "cancel" | undefined, string, object | undefined]>([
    ["success", "confirming", { schedule: "stripe", sync: "never" }],
    ["cancel", "canceled", undefined],
    [undefined, "returned", { schedule: "returned", sync: "never" }],
])(
    "settles a Stripe checkout from the upgrade sheet by how the browser returns (%s)",
    async (outcome, expected, run) => {
        confirm.mockReturnValue(new Promise(() => {}));
        await render();
        await openUpgrade();
        await payFromUpgrade("premiumYearly");
        expect(purchase).toHaveBeenCalledWith(
            "premiumYearly",
            { trialEligible: false, trial: false },
            expect.any(Function),
        );
        expect(panel()).toMatchObject({
            state: "opening",
            tier: "premiumYearly",
        });
        await state("background");
        if (outcome)
            mockParams = {
                billingOutcome: outcome,
                billingReturn: "checkout-a",
            };
        await render();
        await activate();
        expect(panel()).toMatchObject({
            state: expected,
            tier: "premiumYearly",
        });
        if (run) expect(confirm.mock.calls.at(-1)![0]).toEqual(run);
        else expect(confirm).not.toHaveBeenCalled();
    },
);

it("lets a Stripe return without a link check again or reopen checkout", async () => {
    await render();
    await openUpgrade();
    await payFromUpgrade();
    await state("background");
    await state("active");
    expect(panel()).toMatchObject({ state: "returned", checking: false });
    await act(async () => panel()!.onPrimary());
    expect(confirm.mock.calls.at(-1)![0]).toEqual({
        schedule: "once",
        sync: "never",
    });
    await act(async () => panel()!.onSecondary());
    expect(purchase).toHaveBeenCalledTimes(2);
    expect(panel()).toMatchObject({ state: "opening" });
});

it("keeps a Stripe return without a link on the Account card when the sheet closes", async () => {
    confirm.mockReturnValue(new Promise(() => {}));
    await render();
    await openUpgrade();
    await payFromUpgrade();
    await state("background");
    await state("active");
    const signal = confirm.mock.calls[0]![1];
    await act(async () =>
        renderer!.root.findByType("Dialog" as never).props.onOpenChange(false),
    );
    expect(summary("overview").paymentStatus.props).toMatchObject({
        state: "returned",
        compact: true,
    });
    expect(signal.aborted).toBe(false);
});

it("pauses confirmation in the background and resumes the same run", async () => {
    confirm.mockImplementation(() => new Promise(() => {}));
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    const run = confirm.mock.calls[0]![0];
    for (let cycle = 0; cycle < 3; cycle++) {
        const previousSignal = confirm.mock.calls[cycle]![1];
        await state("background");
        expect(previousSignal.aborted).toBe(true);
        await state("active");
        expect(confirm.mock.calls[cycle + 1]![0]).toBe(run);
    }
    expect(confirm).toHaveBeenCalledTimes(4);
});

it("does not confirm or react to AppState while the account route is retained off screen", async () => {
    mockFocused = false;
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    await state("background");
    await state("active");
    expect(confirm).not.toHaveBeenCalled();
    mockFocused = true;
    await render();
    expect(confirm).toHaveBeenCalledTimes(1);
});

it("refreshes once when the user returns manually from billing management", async () => {
    await render();
    summary("overview").onExternalBillingOpened();
    await state("background");
    await state("active");
    expect(mockRefetchSubscription).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
});

it("drops a running confirmation when the bound account changes", async () => {
    confirm.mockImplementation(() => new Promise(() => {}));
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    const signal = confirm.mock.calls[0]![1];
    await act(async () =>
        getDefaultStore().set(unlockedVaultAtom, {
            OnlineServices: { DeviceId: "device-b", UserID: "user-b" },
        } as never),
    );
    expect(signal.aborted).toBe(true);
    expect(panel()).toBeUndefined();
    expect(confirm).toHaveBeenCalledTimes(1);
});

it("replaces the running confirmation for a distinct browser return", async () => {
    confirm.mockImplementation(() => new Promise(() => {}));
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    const first = confirm.mock.calls[0]!;
    mockParams = { billingOutcome: "success", billingReturn: "checkout-b" };
    await render();
    expect(confirm.mock.calls[1]![0]).not.toBe(first[0]);
    expect(first[1].aborted).toBe(true);
});

it("drops a prior confirmation when a different vault session becomes active", async () => {
    confirm.mockImplementation(() => new Promise(() => {}));
    mockParams = { billingOutcome: "success", billingReturn: "checkout-a" };
    await render();
    const signal = confirm.mock.calls[0]![1];
    await state("background");
    jest.mocked(getVaultSessionGeneration).mockReturnValue(2);
    await state("active");
    expect(signal.aborted).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
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
            .findAllByType("Text" as never)
            .some(
                (node) =>
                    typeof node.props.children === "string" &&
                    node.props.children.includes("Could not update"),
            ),
    ).toBe(true);
    await act(async () =>
        renderer!.root
            .findAllByType("Pressable" as never)
            .find((node) => node.props.accessibilityLabel === "Retry")!
            .props.onPress(),
    );
    expect(mockRefetchSubscription).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findAllByType("Notice" as never)).toHaveLength(0);
});

it("replaces retained upgrade controls on dismissal, account change, and logout", async () => {
    await render();
    const openUpgrade = () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "overview")!
            .props.onOpenUpgrade();
    await act(async () => openUpgrade());
    const original = renderer!.root.findByType("MembershipUpgrade" as never);
    await act(async () =>
        renderer!.root.findByType("Dialog" as never).props.onOpenChange(false),
    );
    const dismissed = renderer!.root.findByType("MembershipUpgrade" as never);
    expect(dismissed).not.toBe(original);
    await act(async () => openUpgrade());
    const reopened = renderer!.root.findByType("MembershipUpgrade" as never);
    expect(reopened).not.toBe(dismissed);
    await act(async () =>
        getDefaultStore().set(unlockedVaultAtom, {
            OnlineServices: { DeviceId: "device-b", UserID: "user-b" },
        } as never),
    );
    const replaced = renderer!.root.findByType("MembershipUpgrade" as never);
    expect(replaced).not.toBe(reopened);
    await act(async () =>
        onlineServicesStore.set(onlineServicesDataAtom, null),
    );
    expect(renderer!.root.findByType("MembershipUpgrade" as never)).not.toBe(
        replaced,
    );
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

it("uses normal upgrade after the signup kit was saved and payment did not finish", async () => {
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
    const signup = renderer!.root.findByType("SubscriptionSignup" as never);
    await act(async () => signup.props.onRecoveryKitSaved());
    await act(async () => signup.props.onOpenChange(false));
    expect(
        renderer!.root.findAllByType("SubscriptionSignup" as never),
    ).toHaveLength(0);
    await act(async () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "overview")!
            .props.onOpenUpgrade(),
    );
    expect(
        renderer!.root.findAllByType("SubscriptionSignup" as never),
    ).toHaveLength(0);
    expect(
        renderer!.root.findByType("MembershipUpgrade" as never).props
            .canUpgrade,
    ).toBe(true);
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

it("shows a store purchase as confirming once the store takes payment, then confirms it", async () => {
    jest.mocked(storeBilling).mockReturnValue("google_play");
    const result = deferred<Awaited<ReturnType<typeof purchase>>>();
    let onPaid!: () => void;
    purchase.mockImplementation((_tier, _terms, paidCallback) => {
        onPaid = paidCallback!;
        return result.promise;
    });
    confirm.mockResolvedValue({ subscription: paid, offline: false });
    await render();
    await openUpgrade();
    await payFromUpgrade();
    expect(panel()).toMatchObject({ state: "opening", store: "google_play" });
    expect(renderer!.root.findByType("Dialog" as never).props.dismissible).toBe(
        false,
    );
    await act(async () => onPaid());
    expect(panel()).toMatchObject({ state: "confirming" });
    expect(renderer!.root.findByType("Dialog" as never).props.dismissible).toBe(
        true,
    );
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => result.resolve({ ok: true }));
    expect(confirm.mock.calls[0]![0]).toEqual({
        schedule: "store",
        sync: "afterFirst",
    });
    expect(panel()).toMatchObject({ state: "confirmed" });
});

it.each<
    ["sync" | "owned" | "store", Record<string, unknown>, string | undefined]
>([
    ["sync", { state: "confirming", owned: false }, "afterFirst"],
    ["owned", { state: "confirming", owned: true }, "always"],
    ["store", { state: "storePending" }, undefined],
])(
    "routes a purchase pending for reason %s",
    async (pending, expected, sync) => {
        jest.mocked(storeBilling).mockReturnValue("google_play");
        purchase.mockResolvedValue({ ok: false, pending });
        confirm.mockReturnValue(new Promise(() => {}));
        await render();
        await openUpgrade();
        await payFromUpgrade();
        expect(panel()).toMatchObject(expected);
        if (sync)
            expect(confirm.mock.calls[0]![0]).toEqual({
                schedule: "store",
                sync,
            });
        else expect(confirm).not.toHaveBeenCalled();
    },
);

it("restores an already-owned subscription from Still confirming", async () => {
    jest.mocked(storeBilling).mockReturnValue("app_store");
    purchase.mockResolvedValue({ ok: false, pending: "owned" });
    await render();
    await openUpgrade();
    await payFromUpgrade();
    expect(panel()).toMatchObject({ state: "unconfirmed", owned: true });
    confirm.mockReturnValue(new Promise(() => {}));
    await act(async () => panel()!.onPrimary());
    expect(restoreStorePurchases).toHaveBeenCalledTimes(1);
    expect(panel()).toMatchObject({ state: "confirming", owned: true });
    expect(confirm.mock.calls.at(-1)![0]).toEqual({
        schedule: "store",
        sync: "afterFirst",
    });
});

it("keeps canceled and failed payments in the sheet and retries the same terms", async () => {
    purchase
        .mockResolvedValueOnce({ ok: false, canceled: true })
        .mockResolvedValueOnce({
            ok: false,
            message: "Belongs to another account",
            retryable: false,
        });
    await render();
    await openUpgrade();
    await payFromUpgrade("premiumYearly");
    expect(panel()).toMatchObject({ state: "canceled", tier: "premiumYearly" });
    await act(async () => panel()!.onPrimary());
    expect(purchase.mock.calls[1]!.slice(0, 2)).toEqual([
        "premiumYearly",
        { trialEligible: false, trial: false },
    ]);
    expect(panel()).toMatchObject({
        state: "error",
        message: "Belongs to another account",
        retryable: false,
    });
    await act(async () => panel()!.onSecondary());
    expect(renderer!.root.findByType("Dialog" as never).props.open).toBe(false);
    expect(panel()).toBeUndefined();
});

it("returns to the plan with the changed offer", async () => {
    jest.mocked(storeBilling).mockReturnValue("google_play");
    purchase.mockResolvedValue({ ok: false, offerChanged: { trial: true } });
    await render();
    await openUpgrade();
    await payFromUpgrade();
    expect(panel()).toBeUndefined();
    expect(
        renderer!.root.findByType("MembershipUpgrade" as never).props
            .offerTrial,
    ).toBe(true);
});

it("starts one purchase for a double tap", async () => {
    purchase.mockReturnValue(new Promise(() => {}));
    await render();
    await openUpgrade();
    await act(async () => {
        const upgrade = renderer!.root.findByType("MembershipUpgrade" as never);
        upgrade.props.onContinue("premiumMonthly", false);
        upgrade.props.onContinue("premiumMonthly", false);
    });
    expect(purchase).toHaveBeenCalledTimes(1);
});

it("moves confirmation to the Account card when the sheet closes and announces a late success", async () => {
    jest.mocked(storeBilling).mockReturnValue("google_play");
    const result = deferred<Awaited<ReturnType<typeof confirm>>>();
    confirm.mockReturnValue(result.promise);
    await render();
    await openUpgrade();
    await payFromUpgrade();
    await act(async () =>
        renderer!.root.findByType("Dialog" as never).props.onOpenChange(false),
    );
    expect(summary("overview").paymentStatus.props).toMatchObject({
        state: "confirming",
        compact: true,
    });
    await act(async () =>
        result.resolve({ subscription: paid, offline: false }),
    );
    expect(texts()).toContain("Your membership is active.");
    expect(summary("overview").paymentStatus).toBeNull();
});

it("checks an unconfirmed payment again on return, at most once a minute", async () => {
    jest.mocked(storeBilling).mockReturnValue("google_play");
    purchase.mockResolvedValue({ ok: false, pending: "sync" });
    await render();
    await openUpgrade();
    await payFromUpgrade();
    expect(panel()).toMatchObject({ state: "unconfirmed" });
    await state("background");
    await state("active");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1]![0]).toEqual({
        schedule: "once",
        sync: "always",
    });
    await state("background");
    await state("active");
    expect(confirm).toHaveBeenCalledTimes(2);
});

it("checks an offline payment again when the connection returns", async () => {
    jest.mocked(storeBilling).mockReturnValue("google_play");
    purchase.mockResolvedValue({ ok: false, pending: "sync" });
    confirm.mockResolvedValue({ subscription: null, offline: true });
    await render();
    await openUpgrade();
    await payFromUpgrade();
    const listener = jest.mocked(NetInfo.addEventListener).mock.calls[0]![0];
    await act(async () => listener({ isConnected: false } as never));
    expect(confirm).toHaveBeenCalledTimes(1);
    await act(async () => listener({ isConnected: true } as never));
    expect(confirm).toHaveBeenCalledTimes(2);
});

it("refreshes Google subscription management only after returning from the browser", async () => {
    jest.mocked(storeBilling).mockReturnValue("google_play");
    await render();
    await act(async () => summary("overview").onExternalBillingOpened());
    expect(mockRefetchSubscription).not.toHaveBeenCalled();
    await state("background");
    await state("active");
    expect(mockRefetchSubscription).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
});

it("shows a safe retry when reconnection succeeds but membership refresh fails", async () => {
    onlineServicesStore.set(onlineServicesDataAtom, null);
    jest.mocked(establishOnlineServicesSession).mockImplementationOnce(
        async () => {
            onlineServicesStore.set(onlineServicesDataAtom, {
                sessionToken: "new-token",
                remoteData: {},
            } as never);
        },
    );
    mockRefetchSubscription.mockRejectedValueOnce(
        new Error("private network error"),
    );
    await render();
    await act(async () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "overview")!
            .props.onOpenMembership(),
    );
    expect(renderer!.root.findAllByProps({ testID: "snackbar" })).toHaveLength(
        1,
    );
    expect(
        renderer!.root
            .findAllByType("Text" as never)
            .some(
                (node) =>
                    node.props.children ===
                    "Could not update your membership. Please try again.",
            ),
    ).toBe(true);
    expect(
        renderer!.root
            .findAllByType("Text" as never)
            .some((node) => node.props.children === "private network error"),
    ).toBe(false);
});

it("keeps one active snackbar host and clears it on logout", async () => {
    await render();
    const overview = renderer!.root
        .findAllByType("AccountSummary" as never)
        .find((node) => node.props.mode === "overview")!;
    await act(async () => overview.props.onOpenMembership());
    await act(async () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "membership")!
            .props.onMessage("Could not open billing portal."),
    );
    expect(renderer!.root.findAllByProps({ testID: "snackbar" })).toHaveLength(
        1,
    );
    await act(async () =>
        onlineServicesStore.set(onlineServicesDataAtom, null),
    );
    expect(renderer!.root.findAllByProps({ testID: "snackbar" })).toHaveLength(
        0,
    );
});

it("keeps a store-pending purchase through sheet reopening and blocks another checkout", async () => {
    jest.mocked(storeBilling).mockReturnValue("google_play");
    purchase.mockResolvedValue({ ok: false, pending: "store" });
    await render();
    await openUpgrade();
    await payFromUpgrade();
    await act(async () =>
        renderer!.root.findByType("Dialog" as never).props.onOpenChange(false),
    );
    await openUpgrade();
    expect(
        renderer!.root.findAllByType("MembershipUpgrade" as never),
    ).toHaveLength(0);
    expect(summary("membership").paymentStatus.props).toMatchObject({
        state: "storePending",
        compact: true,
    });
    expect(purchase).toHaveBeenCalledTimes(1);
});

it("does not let an old account completion release the new account refresh lock", async () => {
    const old = deferred<unknown>();
    const next = deferred<unknown>();
    mockRefetchSubscription
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(next.promise);
    await render();
    await act(async () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "overview")!
            .props.onOpenMembership(),
    );
    await act(async () =>
        getDefaultStore().set(unlockedVaultAtom, {
            OnlineServices: { DeviceId: "device-b", UserID: "user-b" },
        } as never),
    );
    expect(mockRefetchSubscription).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve({ data: free }));
    await act(async () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "membership")!
            .props.onRefresh(),
    );
    expect(mockRefetchSubscription).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findByType("Dialog" as never).props.loading).toBe(
        true,
    );
    await act(async () => next.resolve({ data: free }));
    expect(renderer!.root.findByType("Dialog" as never).props.loading).toBe(
        false,
    );
});

it("discards a retained signup kit when its bound account is replaced in the same vault", async () => {
    mockRemoteConfig = { root: true, recoveryTokenCreatedAt: null };
    await render();
    await act(async () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "overview")!
            .props.onOpenUpgrade(),
    );
    expect(
        renderer!.root.findAllByType("SubscriptionSignup" as never),
    ).toHaveLength(1);
    await act(async () =>
        getDefaultStore().set(unlockedVaultAtom, {
            OnlineServices: null,
        } as never),
    );
    expect(
        renderer!.root.findAllByType("SubscriptionSignup" as never),
    ).toHaveLength(0);
    await act(async () =>
        getDefaultStore().set(unlockedVaultAtom, {
            OnlineServices: { DeviceId: "device-b", UserID: "user-b" },
        } as never),
    );
    expect(
        renderer!.root.findAllByType("SubscriptionSignup" as never),
    ).toHaveLength(0);
});

it("releases refresh loading on logout and keeps a newer reconnect request guarded", async () => {
    const old = deferred<unknown>();
    const next = deferred<unknown>();
    mockRefetchSubscription
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(next.promise);
    await render();
    await act(async () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "overview")!
            .props.onOpenMembership(),
    );
    expect(renderer!.root.findByType("Dialog" as never).props.loading).toBe(
        true,
    );
    await act(async () =>
        onlineServicesStore.set(onlineServicesDataAtom, null),
    );
    expect(renderer!.root.findByType("Dialog" as never).props.loading).toBe(
        false,
    );
    jest.mocked(establishOnlineServicesSession).mockImplementationOnce(
        async () => {
            onlineServicesStore.set(onlineServicesDataAtom, {
                sessionToken: "next-token",
                remoteData: {},
            } as never);
        },
    );
    await act(async () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "membership")!
            .props.onRefresh(),
    );
    expect(mockRefetchSubscription).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve({ data: free }));
    expect(renderer!.root.findByType("Dialog" as never).props.loading).toBe(
        true,
    );
    await act(async () => next.resolve({ data: free }));
    expect(renderer!.root.findByType("Dialog" as never).props.loading).toBe(
        false,
    );
});

it("keeps newer billing locks and pending payments when old callbacks arrive after same-account reconnect", async () => {
    jest.mocked(storeBilling).mockReturnValue("google_play");
    purchase.mockResolvedValue({ ok: false, pending: "store" });
    await render();
    await openUpgrade();
    await payFromUpgrade();
    await act(async () =>
        renderer!.root.findByType("Dialog" as never).props.onOpenChange(false),
    );
    const old = summary("overview");
    await act(async () =>
        onlineServicesStore.set(onlineServicesDataAtom, null),
    );
    await act(async () =>
        onlineServicesStore.set(onlineServicesDataAtom, {
            sessionToken: "reconnected-token",
            remoteData: {},
        } as never),
    );
    const current = renderer!.root
        .findAllByType("AccountSummary" as never)
        .find((node) => node.props.mode === "overview")!.props;
    expect(current.paymentStatus).toBeTruthy();
    await act(async () => current.onOpenMembership());
    await act(async () =>
        renderer!.root
            .findAllByType("AccountSummary" as never)
            .find((node) => node.props.mode === "membership")!
            .props.onBillingBusyChange(true),
    );
    expect(renderer!.root.findByType("Dialog" as never).props.dismissible).toBe(
        false,
    );
    jest.mocked(router.setParams).mockClear();
    await act(async () => {
        old.onBillingBusyChange(false);
        old.onExternalBillingOpened();
    });
    expect(renderer!.root.findByType("Dialog" as never).props.dismissible).toBe(
        false,
    );
    expect(renderer!.root.findByType("Dialog" as never).props.open).toBe(true);
    expect(router.setParams).not.toHaveBeenCalled();
    expect(summary("membership").paymentStatus).toBeTruthy();
});
