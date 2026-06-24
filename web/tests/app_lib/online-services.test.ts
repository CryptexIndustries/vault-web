import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
    afterEach,
} from "@jest/globals";

const customerPortalQueryMock = jest.fn();
const toastErrorMock = jest.fn();

jest.mock("sonner", () => ({
    toast: {
        error: (...args: unknown[]) => toastErrorMock(...args),
    },
}));

jest.mock("../../src/utils/trpc", () => ({
    trpc: {
        v1: {
            payment: {
                customerPortal: {
                    query: (...args: unknown[]) =>
                        customerPortalQueryMock(...(args as [])),
                },
            },
        },
    },
}));

import {
    constructLinkPresenceChannelName,
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
                "noopener,noreferrer",
            );
        });

        it("does not open window when URL is falsy (null)", async () => {
            customerPortalQueryMock.mockResolvedValueOnce(null as never);
            await openCustomerPortal();
            expect(openSpy).not.toHaveBeenCalled();
            expect(toastErrorMock).toHaveBeenCalledWith(
                "Billing portal is not available yet.",
            );
        });

        it("does not open window when URL is an empty string", async () => {
            customerPortalQueryMock.mockResolvedValueOnce("" as never);
            await openCustomerPortal();
            expect(openSpy).not.toHaveBeenCalled();
            expect(toastErrorMock).toHaveBeenCalledWith(
                "Billing portal is not available yet.",
            );
        });

        it("shows an error toast when the portal request fails", async () => {
            customerPortalQueryMock.mockRejectedValueOnce(
                new Error("stripe outage") as never,
            );
            await openCustomerPortal();
            expect(openSpy).not.toHaveBeenCalled();
            expect(toastErrorMock).toHaveBeenCalledWith(
                "Could not open billing portal.",
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
