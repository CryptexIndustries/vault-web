import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/utils/trpc";
import { syncOnlineServicesRemoteConfiguration } from "@/app_lib/auth-session";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";
import {
    billingManagement,
    checkoutReturnTarget,
    purchaseMembership,
    openBillingManagement,
    confirmMembership,
    confirmationSchedules,
    startConfirmation,
} from "@/app_lib/online-services-billing";

jest.mock("react-native", () => ({
    Platform: { OS: "android" },
    Linking: { canOpenURL: jest.fn(), openURL: jest.fn() },
}));
jest.mock("expo-constants", () => ({
    __esModule: true,
    default: { expoConfig: { scheme: "cryptex" } },
}));
jest.mock("@/utils/trpc", () => ({
    trpc: {
        v1: {
            payment: {
                checkoutSession: { query: jest.fn() },
                customerPortal: { query: jest.fn() },
                subscription: { query: jest.fn() },
                syncRevenueCat: { mutate: jest.fn() },
            },
        },
    },
}));
jest.mock("@/app_lib/auth-session", () => ({
    syncOnlineServicesRemoteConfiguration: jest.fn(),
}));
jest.mock("@/utils/vault-session", () => ({
    getVaultSessionGeneration: jest.fn(),
    isSameActiveVaultSession: jest.fn(),
}));
jest.mock("@/utils/logging", () => ({
    onlineServicesLog: { error: jest.fn() },
}));

jest.mock("@/app_lib/store-billing", () => ({
    purchasePlan: (...args: unknown[]) => mockPlayPurchase(...args),
}));
const mockPlayPurchase = jest.fn<(...args: unknown[]) => Promise<unknown>>();

const checkout = jest.mocked(trpc.v1.payment.checkoutSession.query);
const portal = jest.mocked(trpc.v1.payment.customerPortal.query);
const subscription = jest.mocked(trpc.v1.payment.subscription.query);
const sync = jest.mocked(trpc.v1.payment.syncRevenueCat.mutate);
const free = { nonFree: false } as Awaited<ReturnType<typeof subscription>>;
const paid = { nonFree: true } as Awaited<ReturnType<typeof subscription>>;
const checkoutURL = "https://checkout.stripe.com/c/pay/cs_test_public";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

beforeEach(() => {
    Object.assign(Platform, { OS: "android" });
    Constants.expoConfig!.extra = {
        buildDetails: { distribution: "standard" },
    };
    mockPlayPurchase.mockReset();
    jest.useFakeTimers({ now: 1000 });
    jest.mocked(getVaultSessionGeneration).mockReset().mockReturnValue(1);
    jest.mocked(isSameActiveVaultSession).mockReset().mockReturnValue(true);
    Constants.expoConfig!.scheme = "cryptex";
    checkout.mockReset().mockResolvedValue(checkoutURL);
    portal
        .mockReset()
        .mockResolvedValue("https://billing.stripe.com/p/session/test");
    subscription.mockReset().mockResolvedValue(free);
    sync.mockReset().mockResolvedValue(undefined);
    jest.mocked(syncOnlineServicesRemoteConfiguration)
        .mockReset()
        .mockResolvedValue(undefined);
    jest.mocked(Linking.canOpenURL).mockReset().mockResolvedValue(true);
    jest.mocked(Linking.openURL).mockReset().mockResolvedValue(undefined);
    delete Constants.expoConfig!.android;
    delete process.env.EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_PRODUCT_ID;
});
afterEach(() => {
    jest.useRealTimers();
});

it("opens hosted monthly checkout directly in the system browser with the production return target", async () => {
    await expect(purchaseMembership()).resolves.toEqual({ ok: true });
    expect(checkout).toHaveBeenCalledWith({
        tier: "premiumMonthly",
        uiMode: "hosted",
        returnTarget: "mobile-production",
    });
    expect(Linking.openURL).toHaveBeenCalledWith(checkoutURL);
});

it("uses the preprod return target for yearly checkout and customer portal", async () => {
    Constants.expoConfig!.scheme = "cryptex-preprod";
    await expect(purchaseMembership("premiumYearly")).resolves.toEqual({
        ok: true,
    });
    expect(checkout).toHaveBeenCalledWith({
        tier: "premiumYearly",
        uiMode: "hosted",
        returnTarget: "mobile-preprod",
    });
    await expect(openBillingManagement()).resolves.toEqual({ ok: true });
    expect(portal).toHaveBeenCalledWith({ returnTarget: "mobile-preprod" });
});

it("rejects missing or unknown app schemes before making a checkout request", async () => {
    Constants.expoConfig!.scheme = "attacker";
    expect(checkoutReturnTarget).toThrow(
        "This app's checkout return scheme is not configured.",
    );
    await expect(purchaseMembership()).resolves.toMatchObject({ ok: false });
    expect(checkout).not.toHaveBeenCalled();
});

it.each([
    "http://checkout.stripe.com/c/pay/test",
    "https://checkout.stripe.com.attacker.test/pay",
    "https://token@checkout.stripe.com/pay",
    "https://app.cryptex.test/app",
    "cs_test_client_secret",
])("rejects a non-Stripe hosted URL: %s", async (url) => {
    checkout.mockResolvedValue(url);
    await expect(purchaseMembership()).resolves.toMatchObject({ ok: false });
    expect(Linking.openURL).not.toHaveBeenCalled();
});

it("rejects an arbitrary portal URL and handles unavailable portals", async () => {
    portal
        .mockResolvedValueOnce("https://app.cryptex.test/app")
        .mockResolvedValueOnce(null);
    await expect(openBillingManagement()).resolves.toMatchObject({
        ok: false,
    });
    await expect(openBillingManagement()).resolves.toMatchObject({
        ok: false,
    });
    expect(Linking.openURL).not.toHaveBeenCalled();
});

it("does not launch a browser when the active vault expires while the request is pending", async () => {
    const request = deferred<string>();
    checkout.mockReturnValue(request.promise);
    const opening = purchaseMembership();
    jest.mocked(isSameActiveVaultSession).mockReturnValue(false);
    request.resolve(checkoutURL);
    await expect(opening).resolves.toMatchObject({ ok: false });
    expect(Linking.openURL).not.toHaveBeenCalled();
});

it("does not request checkout or portal after the vault deadline has passed", async () => {
    jest.mocked(isSameActiveVaultSession).mockReturnValue(false);
    await expect(purchaseMembership()).resolves.toMatchObject({ ok: false });
    await expect(openBillingManagement()).resolves.toMatchObject({
        ok: false,
    });
    expect(checkout).not.toHaveBeenCalled();
    expect(portal).not.toHaveBeenCalled();
});

it("reads a just-synced store purchase first, then syncs before each read until it gives up at 80 s", async () => {
    const result = confirmMembership(
        startConfirmation(confirmationSchedules.store, "afterFirst"),
        new AbortController().signal,
    );
    await jest.advanceTimersByTimeAsync(4999);
    expect(subscription).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(subscription).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(75000);
    await expect(result).resolves.toEqual({
        subscription: null,
        offline: false,
    });
    expect(subscription).toHaveBeenCalledTimes(7);
    // With the purchase's own sync, never more than five a minute.
    expect(sync).toHaveBeenCalledTimes(6);
    expect(jest.getTimerCount()).toBe(0);
});

it("reads Stripe membership without syncing, at most seven times a minute", async () => {
    const result = confirmMembership(
        startConfirmation(confirmationSchedules.stripe, "never"),
        new AbortController().signal,
    );
    await jest.advanceTimersByTimeAsync(59999);
    expect(subscription).toHaveBeenCalledTimes(7);
    await jest.advanceTimersByTimeAsync(20001);
    await expect(result).resolves.toEqual({
        subscription: null,
        offline: false,
    });
    expect(subscription).toHaveBeenCalledTimes(9);
    expect(sync).not.toHaveBeenCalled();
});

it("stops at the first paid read, syncs entitlements, and keeps confirming visible for 800 ms", async () => {
    subscription.mockResolvedValue(paid);
    let settled = false;
    const result = confirmMembership(
        startConfirmation(confirmationSchedules.returned, "never"),
        new AbortController().signal,
    ).then((value) => {
        settled = true;
        return value;
    });
    await jest.advanceTimersByTimeAsync(799);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({
        subscription: paid,
        offline: false,
    });
    expect(subscription).toHaveBeenCalledTimes(1);
    expect(syncOnlineServicesRemoteConfiguration).toHaveBeenCalledTimes(1);
});

it("resumes a paused loop on its original schedule, collapsing missed checks into one", async () => {
    const run = startConfirmation(confirmationSchedules.stripe, "never");
    const controller = new AbortController();
    const paused = confirmMembership(run, controller.signal);
    await jest.advanceTimersByTimeAsync(4000);
    controller.abort();
    await expect(paused).resolves.toBeNull();
    expect(subscription).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(20000);
    const resumed = confirmMembership(run, new AbortController().signal);
    await jest.advanceTimersByTimeAsync(0);
    expect(subscription).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(1000);
    expect(subscription).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(60000);
    await expect(resumed).resolves.toEqual({
        subscription: null,
        offline: false,
    });
});

it("treats a rate-limited check as not yet and pushes the rest back 15 s", async () => {
    const rateLimit = new TRPCClientError("Please wait.", {
        result: {
            error: {
                message: "Please wait.",
                code: -32029,
                data: { code: "TOO_MANY_REQUESTS" },
            },
        },
    });
    subscription.mockRejectedValueOnce(rateLimit);
    const result = confirmMembership(
        startConfirmation(confirmationSchedules.returned, "never"),
        new AbortController().signal,
    );
    await jest.advanceTimersByTimeAsync(19999);
    expect(subscription).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(subscription).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(10000);
    await expect(result).resolves.toEqual({
        subscription: null,
        offline: false,
    });
});

it("reports offline when the last check never reached the server", async () => {
    jest.setSystemTime(10_000_000);
    sync.mockRejectedValue(new TypeError("Network request failed"));
    subscription.mockRejectedValue(new TypeError("Network request failed"));
    const result = confirmMembership(
        startConfirmation(confirmationSchedules.once, "always"),
        new AbortController().signal,
    );
    await jest.advanceTimersByTimeAsync(15000);
    await expect(result).resolves.toEqual({
        subscription: null,
        offline: true,
    });
    expect(sync).toHaveBeenCalledTimes(1);
});

it("keeps manual checks 15 s apart", async () => {
    jest.setSystemTime(20_000_000);
    await confirmMembership(
        startConfirmation(confirmationSchedules.once, "never"),
        new AbortController().signal,
    );
    const second = confirmMembership(
        startConfirmation(confirmationSchedules.once, "never"),
        new AbortController().signal,
    );
    await jest.advanceTimersByTimeAsync(14999);
    expect(subscription).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toEqual({
        subscription: null,
        offline: false,
    });
    expect(subscription).toHaveBeenCalledTimes(2);
});

it("runs an interrupted final check again on resume", async () => {
    const request = deferred<typeof free>();
    subscription
        .mockResolvedValueOnce(free)
        .mockResolvedValueOnce(free)
        .mockReturnValueOnce(request.promise);
    const run = startConfirmation(confirmationSchedules.returned, "never");
    const controller = new AbortController();
    const interrupted = confirmMembership(run, controller.signal);
    await jest.advanceTimersByTimeAsync(15000);
    expect(subscription).toHaveBeenCalledTimes(3);
    controller.abort();
    request.resolve(free);
    await expect(interrupted).resolves.toBeNull();
    const resumed = confirmMembership(run, new AbortController().signal);
    await jest.advanceTimersByTimeAsync(0);
    await expect(resumed).resolves.toEqual({
        subscription: null,
        offline: false,
    });
    expect(subscription).toHaveBeenCalledTimes(4);
});

it("keeps RevenueCat syncs within five a minute across runs", async () => {
    jest.setSystemTime(30_000_000);
    const first = new AbortController();
    void confirmMembership(
        startConfirmation(confirmationSchedules.store, "always"),
        first.signal,
    );
    await jest.advanceTimersByTimeAsync(51000);
    expect(sync).toHaveBeenCalledTimes(5);
    first.abort();
    const second = new AbortController();
    void confirmMembership(
        startConfirmation(confirmationSchedules.store, "always"),
        second.signal,
    );
    await jest.advanceTimersByTimeAsync(8999);
    expect(sync).toHaveBeenCalledTimes(5);
    await jest.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(6);
    second.abort();
});

it("returns nothing when the vault session changes during a check", async () => {
    const request = deferred<typeof paid>();
    subscription.mockReturnValue(request.promise);
    const result = confirmMembership(
        startConfirmation(confirmationSchedules.stripe, "never"),
        new AbortController().signal,
    );
    await jest.advanceTimersByTimeAsync(0);
    jest.mocked(isSameActiveVaultSession).mockReturnValue(false);
    request.resolve(paid);
    await expect(result).resolves.toBeNull();
    expect(syncOnlineServicesRemoteConfiguration).not.toHaveBeenCalled();
});

it("keeps Play purchases and management out of Stripe, including unavailable billing", async () => {
    Constants.expoConfig!.extra!.buildDetails.distribution = "play";
    Constants.expoConfig!.android = { package: "com.cryptexindustries.vault" };
    process.env.EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_PRODUCT_ID = "online_services";
    mockPlayPurchase.mockResolvedValue({
        ok: false,
        message: "Not configured",
    });
    expect(await purchaseMembership("premiumYearly")).toEqual({
        ok: false,
        message: "Not configured",
    });
    expect(mockPlayPurchase).toHaveBeenCalledWith(
        "premiumYearly",
        { trialEligible: false, trial: false },
        undefined,
    );
    await openBillingManagement();
    expect(Linking.openURL).toHaveBeenCalledWith(
        "https://play.google.com/store/account/subscriptions?sku=online_services&package=com.cryptexindustries.vault",
    );
    expect(checkout).not.toHaveBeenCalled();
    expect(portal).not.toHaveBeenCalled();
});

it.each<
    [
        string,
        Parameters<typeof billingManagement>[0],
        ReturnType<typeof billingManagement>,
    ]
>([
    ["standard", "stripe", "stripe"],
    ["fdroid", "stripe", "stripe"],
    ["fdroid", "google_play", "google_play"],
    ["fdroid", "app_store", null],
    ["fdroid", undefined, "stripe"],
    ["play", "stripe", null],
    ["play", "google_play", "google_play"],
    ["play", "app_store", null],
    ["play", undefined, "google_play"],
])(
    "manages a %s build's %s subscription through %s",
    (distribution, provider, expected) => {
        Constants.expoConfig!.extra!.buildDetails.distribution = distribution;
        expect(billingManagement(provider)).toBe(expected);
    },
);

it.each<
    [
        Parameters<typeof billingManagement>[0],
        ReturnType<typeof billingManagement>,
    ]
>([
    ["stripe", null],
    ["google_play", null],
    ["app_store", "app_store"],
    [undefined, "app_store"],
])(
    "manages an iOS build's %s subscription through %s",
    (provider, expected) => {
        Object.assign(Platform, { OS: "ios" });
        expect(billingManagement(provider)).toBe(expected);
    },
);

it("sells and manages iOS memberships through the App Store, never Stripe", async () => {
    Object.assign(Platform, { OS: "ios" });
    mockPlayPurchase.mockResolvedValue({ ok: true });
    const terms = { trialEligible: true, trial: true };
    expect(await purchaseMembership("premiumMonthly", terms)).toEqual({
        ok: true,
    });
    expect(mockPlayPurchase).toHaveBeenCalledWith(
        "premiumMonthly",
        terms,
        undefined,
    );
    await openBillingManagement();
    expect(Linking.openURL).toHaveBeenCalledWith(
        "https://apps.apple.com/account/subscriptions",
    );
    expect(checkout).not.toHaveBeenCalled();
    expect(portal).not.toHaveBeenCalled();
});

it("keeps F-Droid Stripe management on the portal and sends Play subscribers to Google Play", async () => {
    Constants.expoConfig!.extra!.buildDetails.distribution = "fdroid";
    expect(await openBillingManagement(billingManagement("stripe"))).toEqual({
        ok: true,
    });
    expect(portal).toHaveBeenCalledTimes(1);
    expect(Linking.openURL).toHaveBeenLastCalledWith(
        "https://billing.stripe.com/p/session/test",
    );
    await openBillingManagement(billingManagement("google_play"));
    expect(Linking.openURL).toHaveBeenLastCalledWith(
        "https://play.google.com/store/account/subscriptions",
    );
    expect(portal).toHaveBeenCalledTimes(1);
});

it("opens nothing for a subscription this build cannot manage", async () => {
    Constants.expoConfig!.extra!.buildDetails.distribution = "play";
    const result = await openBillingManagement(billingManagement("stripe"));
    expect(result.ok).toBe(false);
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(portal).not.toHaveBeenCalled();
});

it.each([
    ["android", "fdroid"],
    ["web", "play"],
])("preserves existing billing on %s / %s", async (os, distribution) => {
    Object.assign(Platform, { OS: os });
    Constants.expoConfig!.extra!.buildDetails.distribution = distribution;
    await purchaseMembership();
    expect(checkout).toHaveBeenCalledTimes(1);
    expect(mockPlayPurchase).not.toHaveBeenCalled();
});
