import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
    afterEach,
} from "@jest/globals";

const customerPortalQueryMock = jest.fn();
const checkoutURLQueryMock = jest.fn();

jest.mock("../../src/utils/trpc", () => ({
    trpc: {
        v1: {
            payment: {
                customerPortal: {
                    query: (...args: unknown[]) =>
                        customerPortalQueryMock(...(args as [])),
                },
                checkoutURL: {
                    query: (...args: unknown[]) =>
                        checkoutURLQueryMock(...(args as [])),
                },
            },
        },
    },
}));

import {
    constructLinkPresenceChannelName,
    navigateToCheckout,
    openCustomerPortal,
} from "../../src/app_lib/online-services";

describe("online-services", () => {
    let openSpy: jest.Mock;
    let originalOpen: typeof window.open | undefined;

    beforeEach(() => {
        jest.clearAllMocks();
        openSpy = jest.fn();
        originalOpen = window.open;
        Object.defineProperty(window, "open", {
            value: openSpy,
            configurable: true,
            writable: true,
        });
    });

    afterEach(() => {
        if (originalOpen) {
            Object.defineProperty(window, "open", {
                value: originalOpen,
                configurable: true,
                writable: true,
            });
        }
    });

    describe("openCustomerPortal", () => {
        it("opens window when a truthy URL is returned", async () => {
            customerPortalQueryMock.mockResolvedValueOnce(
                "https://billing.example.com/portal" as never,
            );
            await openCustomerPortal();
            expect(openSpy).toHaveBeenCalledWith(
                "https://billing.example.com/portal",
                "_blank",
            );
        });

        it("does not open window when URL is falsy (null)", async () => {
            customerPortalQueryMock.mockResolvedValueOnce(null as never);
            await openCustomerPortal();
            expect(openSpy).not.toHaveBeenCalled();
        });

        it("does not open window when URL is an empty string", async () => {
            customerPortalQueryMock.mockResolvedValueOnce("" as never);
            await openCustomerPortal();
            expect(openSpy).not.toHaveBeenCalled();
        });
    });

    describe("navigateToCheckout", () => {
        it("throws when the returned URL is empty", async () => {
            checkoutURLQueryMock.mockResolvedValueOnce("" as never);
            await expect(navigateToCheckout()).rejects.toThrow(
                "Failed to fetch checkout session URL.",
            );
            expect(openSpy).not.toHaveBeenCalled();
        });

        it("throws when the returned URL is undefined", async () => {
            checkoutURLQueryMock.mockResolvedValueOnce(undefined as never);
            await expect(navigateToCheckout()).rejects.toThrow(
                "Failed to fetch checkout session URL.",
            );
            expect(openSpy).not.toHaveBeenCalled();
        });

        it("opens window on the success path", async () => {
            checkoutURLQueryMock.mockResolvedValueOnce(
                "https://checkout.example.com/sess" as never,
            );
            await navigateToCheckout();
            expect(openSpy).toHaveBeenCalledWith(
                "https://checkout.example.com/sess",
                "_blank",
            );
        });
    });

    describe("constructLinkPresenceChannelName", () => {
        it("formats the channel name with the id", () => {
            expect(constructLinkPresenceChannelName("abc-123")).toBe(
                "presence-link-abc-123",
            );
        });

        it("returns the prefix-only string when id is empty", () => {
            expect(constructLinkPresenceChannelName("")).toBe("presence-link-");
        });
    });
});
