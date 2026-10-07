import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { Linking } from "react-native";
import Constants from "expo-constants";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/utils/trpc";
import { syncOnlineServicesRemoteConfiguration } from "@/app_lib/auth-session";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";
import {
    checkoutReturnTarget,
    openCheckoutExternal,
    openCustomerPortalExternal,
    refreshSubscriptionAfterExternalBilling,
    type BillingConfirmation,
} from "@/app_lib/online-services-billing";

jest.mock("react-native", () => ({
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

const checkout = jest.mocked(trpc.v1.payment.checkoutSession.query);
const portal = jest.mocked(trpc.v1.payment.customerPortal.query);
const subscription = jest.mocked(trpc.v1.payment.subscription.query);
const free = { nonFree: false } as Awaited<ReturnType<typeof subscription>>;
const paid = { nonFree: true } as Awaited<ReturnType<typeof subscription>>;
const checkoutURL = "https://checkout.stripe.com/c/pay/cs_test_public";

function confirmation(): BillingConfirmation {
    return {
        generation: 1,
        deadline: Date.now() + 60000,
        nextPollAt: 0,
        attempts: 0,
        subscription: null,
    };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

beforeEach(() => {
    jest.useFakeTimers({ now: 1000 });
    jest.mocked(getVaultSessionGeneration).mockReset().mockReturnValue(1);
    jest.mocked(isSameActiveVaultSession).mockReset().mockReturnValue(true);
    Constants.expoConfig!.scheme = "cryptex";
    checkout.mockReset().mockResolvedValue(checkoutURL);
    portal
        .mockReset()
        .mockResolvedValue("https://billing.stripe.com/p/session/test");
    subscription.mockReset().mockResolvedValue(free);
    jest.mocked(syncOnlineServicesRemoteConfiguration)
        .mockReset()
        .mockResolvedValue(undefined);
    jest.mocked(Linking.canOpenURL).mockReset().mockResolvedValue(true);
    jest.mocked(Linking.openURL).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
    jest.useRealTimers();
});

it("opens hosted monthly checkout directly in the system browser with the production return target", async () => {
    await expect(openCheckoutExternal()).resolves.toEqual({ ok: true });
    expect(checkout).toHaveBeenCalledWith({
        tier: "premiumMonthly",
        uiMode: "hosted",
        returnTarget: "mobile-production",
    });
    expect(Linking.openURL).toHaveBeenCalledWith(checkoutURL);
});

it("uses the preprod return target for yearly checkout and customer portal", async () => {
    Constants.expoConfig!.scheme = "cryptex-preprod";
    await expect(openCheckoutExternal("premiumYearly")).resolves.toEqual({
        ok: true,
    });
    expect(checkout).toHaveBeenCalledWith({
        tier: "premiumYearly",
        uiMode: "hosted",
        returnTarget: "mobile-preprod",
    });
    await expect(openCustomerPortalExternal()).resolves.toEqual({ ok: true });
    expect(portal).toHaveBeenCalledWith({ returnTarget: "mobile-preprod" });
});

it("rejects missing or unknown app schemes before making a checkout request", async () => {
    Constants.expoConfig!.scheme = "attacker";
    expect(checkoutReturnTarget).toThrow(
        "This app's checkout return scheme is not configured.",
    );
    await expect(openCheckoutExternal()).resolves.toMatchObject({ ok: false });
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
    await expect(openCheckoutExternal()).resolves.toMatchObject({ ok: false });
    expect(Linking.openURL).not.toHaveBeenCalled();
});

it("rejects an arbitrary portal URL and handles unavailable portals", async () => {
    portal
        .mockResolvedValueOnce("https://app.cryptex.test/app")
        .mockResolvedValueOnce(null);
    await expect(openCustomerPortalExternal()).resolves.toMatchObject({
        ok: false,
    });
    await expect(openCustomerPortalExternal()).resolves.toMatchObject({
        ok: false,
    });
    expect(Linking.openURL).not.toHaveBeenCalled();
});

it("does not launch a browser when the active vault expires while the request is pending", async () => {
    const request = deferred<string>();
    checkout.mockReturnValue(request.promise);
    const opening = openCheckoutExternal();
    jest.mocked(isSameActiveVaultSession).mockReturnValue(false);
    request.resolve(checkoutURL);
    await expect(opening).resolves.toMatchObject({ ok: false });
    expect(Linking.openURL).not.toHaveBeenCalled();
});

it("does not request checkout or portal after the vault deadline has passed", async () => {
    jest.mocked(isSameActiveVaultSession).mockReturnValue(false);
    await expect(openCheckoutExternal()).resolves.toMatchObject({ ok: false });
    await expect(openCustomerPortalExternal()).resolves.toMatchObject({
        ok: false,
    });
    expect(checkout).not.toHaveBeenCalled();
    expect(portal).not.toHaveBeenCalled();
});

it("polls authoritative membership at ten-second intervals then synchronizes entitlements once", async () => {
    subscription
        .mockResolvedValueOnce(free)
        .mockResolvedValueOnce(free)
        .mockResolvedValueOnce(paid);
    const result = refreshSubscriptionAfterExternalBilling(
        "success",
        new AbortController().signal,
    );
    await jest.advanceTimersByTimeAsync(19999);
    expect(subscription).toHaveBeenCalledTimes(2);
    expect(syncOnlineServicesRemoteConfiguration).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(paid);
    expect(subscription).toHaveBeenCalledTimes(3);
    expect(syncOnlineServicesRemoteConfiguration).toHaveBeenCalledTimes(1);
});

it("finishes pending after seven checks over sixty seconds without trusting the success callback", async () => {
    const result = refreshSubscriptionAfterExternalBilling(
        "success",
        new AbortController().signal,
    );
    await jest.advanceTimersByTimeAsync(60000);
    await expect(result).resolves.toEqual(free);
    expect(subscription).toHaveBeenCalledTimes(7);
    expect(jest.getTimerCount()).toBe(0);
});

it.each(["cancel", "resume"] as const)(
    "refreshes %s once without polling",
    async (outcome) => {
        await expect(
            refreshSubscriptionAfterExternalBilling(
                outcome,
                new AbortController().signal,
            ),
        ).resolves.toEqual(free);
        expect(subscription).toHaveBeenCalledTimes(1);
        expect(syncOnlineServicesRemoteConfiguration).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    },
);

it.each(["cancel", "resume"] as const)(
    "retries an interrupted %s refresh within the shared request budget",
    async (outcome) => {
        const state = confirmation();
        const request = deferred<typeof free>();
        subscription.mockReturnValueOnce(request.promise);
        const controller = new AbortController();
        const interrupted = refreshSubscriptionAfterExternalBilling(
            outcome,
            controller.signal,
            state,
        );
        controller.abort();
        request.resolve(free);
        await expect(interrupted).resolves.toBeNull();
        expect(state.subscription).toBeNull();
        expect(syncOnlineServicesRemoteConfiguration).not.toHaveBeenCalled();

        const resumed = refreshSubscriptionAfterExternalBilling(
            outcome,
            new AbortController().signal,
            state,
        );
        await jest.advanceTimersByTimeAsync(9999);
        expect(subscription).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        await expect(resumed).resolves.toEqual(free);
        expect(subscription).toHaveBeenCalledTimes(2);
        expect(state.attempts).toBe(2);
        expect(syncOnlineServicesRemoteConfiguration).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    },
);

it.each(["cancel", "resume"] as const)(
    "reuses a completed %s result when configuration refresh was interrupted",
    async (outcome) => {
        const state = { ...confirmation(), attempts: 1, subscription: free };
        await expect(
            refreshSubscriptionAfterExternalBilling(
                outcome,
                new AbortController().signal,
                state,
            ),
        ).resolves.toEqual(free);
        expect(subscription).not.toHaveBeenCalled();
        expect(syncOnlineServicesRemoteConfiguration).toHaveBeenCalledTimes(1);
    },
);

it("keeps its deadline, next poll time and request budget across three rapid background returns", async () => {
    const state = confirmation();
    for (let cycle = 0; cycle < 3; cycle++) {
        const controller = new AbortController();
        const result = refreshSubscriptionAfterExternalBilling(
            "success",
            controller.signal,
            state,
        );
        await jest.advanceTimersByTimeAsync(1000);
        controller.abort();
        await expect(result).resolves.toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    }
    expect(subscription).toHaveBeenCalledTimes(1);
    const finalResult = refreshSubscriptionAfterExternalBilling(
        "success",
        new AbortController().signal,
        state,
    );
    await jest.advanceTimersByTimeAsync(57000);
    await expect(finalResult).resolves.toEqual(free);
    expect(subscription).toHaveBeenCalledTimes(7);
    expect(state.deadline).toBe(61000);
});

it("never installs a cached result or polls when confirmation belongs to an earlier vault", async () => {
    const state = { ...confirmation(), attempts: 7, subscription: paid };
    jest.mocked(getVaultSessionGeneration).mockReturnValue(2);
    await expect(
        refreshSubscriptionAfterExternalBilling(
            "success",
            new AbortController().signal,
            state,
        ),
    ).resolves.toBeNull();
    expect(subscription).not.toHaveBeenCalled();
    expect(syncOnlineServicesRemoteConfiguration).not.toHaveBeenCalled();
});

it("does not synchronize a query that completes after actual vault expiry", async () => {
    const request = deferred<typeof paid>();
    subscription.mockReturnValue(request.promise);
    const result = refreshSubscriptionAfterExternalBilling(
        "success",
        new AbortController().signal,
    );
    jest.mocked(isSameActiveVaultSession).mockReturnValue(false);
    request.resolve(paid);
    await expect(result).resolves.toBeNull();
    expect(syncOnlineServicesRemoteConfiguration).not.toHaveBeenCalled();
});

it("does not emit a result when the vault changes during configuration synchronization", async () => {
    subscription.mockResolvedValue(paid);
    const request = deferred<void>();
    jest.mocked(syncOnlineServicesRemoteConfiguration).mockReturnValue(
        request.promise,
    );
    const result = refreshSubscriptionAfterExternalBilling(
        "success",
        new AbortController().signal,
    );
    await jest.advanceTimersByTimeAsync(0);
    jest.mocked(isSameActiveVaultSession).mockReturnValue(false);
    request.resolve();
    await expect(result).resolves.toBeNull();
});

it("does not issue a subscription request after the confirmation deadline", async () => {
    const state = {
        ...confirmation(),
        deadline: Date.now() - 1,
        subscription: free,
    };
    await expect(
        refreshSubscriptionAfterExternalBilling(
            "success",
            new AbortController().signal,
            state,
        ),
    ).resolves.toEqual(free);
    expect(subscription).not.toHaveBeenCalled();
});

it("backs off a rate-limited response instead of retrying immediately", async () => {
    const rateLimit = new TRPCClientError("Please wait.", {
        result: {
            error: {
                message: "Please wait.",
                code: -32029,
                data: { code: "TOO_MANY_REQUESTS" },
            },
        },
    });
    subscription.mockRejectedValueOnce(rateLimit).mockResolvedValueOnce(paid);
    const result = refreshSubscriptionAfterExternalBilling(
        "success",
        new AbortController().signal,
    );
    await jest.advanceTimersByTimeAsync(9999);
    expect(subscription).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(paid);
});
