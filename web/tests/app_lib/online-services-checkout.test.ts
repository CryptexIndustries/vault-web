/**
 * @jest-environment jsdom
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { TRPCClientError } from "@trpc/client";

const checkoutSessionQueryMock =
    jest.fn<(input?: { tier?: string }) => Promise<string>>();
const subscriptionQueryMock = jest.fn<() => Promise<{ nonFree: boolean }>>();
const syncRemoteConfigurationMock = jest.fn(async () => undefined);

const toastLoadingMock = jest.fn((..._args: unknown[]) => "toast-checkout");
const toastSuccessMock = jest.fn((..._args: unknown[]) => undefined);
const toastMessageMock = jest.fn((..._args: unknown[]) => undefined);
const toastErrorMock = jest.fn((..._args: unknown[]) => undefined);
const toastDismissMock = jest.fn((..._args: unknown[]) => undefined);

jest.mock("sonner", () => ({
    toast: {
        loading: (...args: unknown[]) => toastLoadingMock(...args),
        success: (...args: unknown[]) => toastSuccessMock(...args),
        message: (...args: unknown[]) => toastMessageMock(...args),
        error: (...args: unknown[]) => toastErrorMock(...args),
        dismiss: (...args: unknown[]) => toastDismissMock(...args),
    },
}));

jest.mock("../../src/utils/trpc", () => ({
    trpc: {
        v1: {
            payment: {
                checkoutSession: {
                    query: (input?: { tier?: string }) =>
                        checkoutSessionQueryMock(input),
                },
                subscription: {
                    query: () => subscriptionQueryMock(),
                },
            },
        },
    },
}));

jest.mock("../../src/app_lib/auth-session", () => ({
    syncOnlineServicesRemoteConfiguration: syncRemoteConfigurationMock,
}));

jest.mock("../../src/utils/logging", () => ({
    onlineServicesLog: {
        error: jest.fn(),
    },
}));

import {
    fetchCheckoutClientSecret,
    finalizeCheckoutCompletion,
} from "../../src/app_lib/online-services";
import { onlineServicesLog } from "../../src/utils/logging";

describe("fetchCheckoutClientSecret", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns the checkout session client secret", async () => {
        checkoutSessionQueryMock.mockResolvedValueOnce("cs_test_secret");

        await expect(fetchCheckoutClientSecret("premiumMonthly")).resolves.toBe(
            "cs_test_secret",
        );
        expect(checkoutSessionQueryMock).toHaveBeenCalledWith({
            tier: "premiumMonthly",
        });
    });

    it("throws when checkoutSession returns an empty string", async () => {
        checkoutSessionQueryMock.mockResolvedValueOnce("");

        await expect(fetchCheckoutClientSecret()).rejects.toThrow(
            "Failed to start checkout.",
        );
    });

    it("propagates TRPC errors such as PRECONDITION_FAILED", async () => {
        checkoutSessionQueryMock.mockRejectedValueOnce(
            new TRPCClientError(
                "You already have an active paid subscription.",
                {
                    result: {
                        error: {
                            message:
                                "You already have an active paid subscription.",
                            code: -32012,
                            data: {
                                code: "PRECONDITION_FAILED",
                                httpStatus: 412,
                            },
                        },
                    },
                },
            ),
        );

        await expect(fetchCheckoutClientSecret()).rejects.toBeInstanceOf(
            TRPCClientError,
        );
    });
});

describe("finalizeCheckoutCompletion", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("polls until premium is visible, then syncs client state and shows success", async () => {
        const callOrder: string[] = [];
        let pollCount = 0;

        subscriptionQueryMock.mockImplementation(async () => {
            pollCount += 1;
            callOrder.push("poll");
            return { nonFree: pollCount >= 2 };
        });
        syncRemoteConfigurationMock.mockImplementation(async () => {
            callOrder.push("sync");
        });
        const onSynced = jest.fn(async () => undefined);

        const promise = finalizeCheckoutCompletion({ onSynced });
        await jest.advanceTimersByTimeAsync(500);
        await promise;

        expect(callOrder).toEqual(["poll", "poll", "sync"]);
        expect(syncRemoteConfigurationMock).toHaveBeenCalledTimes(1);
        expect(onSynced).toHaveBeenCalledTimes(1);
        expect(toastLoadingMock).toHaveBeenCalledWith(
            "Activating subscription...",
        );
        expect(toastSuccessMock).toHaveBeenCalledWith(
            "Subscription upgraded.",
            {
                id: "toast-checkout",
            },
        );
    });

    it("still refreshes client state when activation polling times out", async () => {
        subscriptionQueryMock.mockResolvedValue({ nonFree: false });
        const onSynced = jest.fn(async () => undefined);

        const promise = finalizeCheckoutCompletion({ onSynced });
        await jest.advanceTimersByTimeAsync(500 * 120);
        await promise;

        expect(syncRemoteConfigurationMock).toHaveBeenCalledTimes(1);
        expect(onSynced).toHaveBeenCalledTimes(1);
        expect(toastMessageMock).toHaveBeenCalledWith(
            "Payment received. Your plan may take a moment to update.",
            { id: "toast-checkout" },
        );
        expect(toastSuccessMock).not.toHaveBeenCalled();
    });

    it("stops polling quietly when aborted (e.g. account dialog closed)", async () => {
        subscriptionQueryMock.mockResolvedValue({ nonFree: false });
        const onSynced = jest.fn(async () => undefined);
        const controller = new AbortController();

        const promise = finalizeCheckoutCompletion({
            onSynced,
            signal: controller.signal,
        });

        await Promise.resolve();
        controller.abort();
        await jest.advanceTimersByTimeAsync(500 * 120);
        await promise;

        expect(subscriptionQueryMock).toHaveBeenCalledTimes(1);
        expect(syncRemoteConfigurationMock).not.toHaveBeenCalled();
        expect(onSynced).not.toHaveBeenCalled();
        expect(toastDismissMock).toHaveBeenCalledWith("toast-checkout");
        expect(toastSuccessMock).not.toHaveBeenCalled();
        expect(toastMessageMock).not.toHaveBeenCalled();
        expect(toastErrorMock).not.toHaveBeenCalled();
    });

    it("shows an error toast when client refresh fails", async () => {
        subscriptionQueryMock.mockResolvedValueOnce({ nonFree: true });
        syncRemoteConfigurationMock.mockRejectedValueOnce(
            new Error("sync failed"),
        );

        await finalizeCheckoutCompletion();

        expect(toastErrorMock).toHaveBeenCalledWith(
            "Could not confirm subscription update.",
            { id: "toast-checkout" },
        );
        expect(onlineServicesLog.error).toHaveBeenCalledWith(
            "Checkout finalization failed",
            expect.objectContaining({
                error: expect.any(Error),
            }),
        );
    });
});
