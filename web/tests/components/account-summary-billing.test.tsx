/** @jest-environment jsdom */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";

const mockOpenCustomerPortal = jest.fn();

jest.mock("next/dynamic", () => ({
    __esModule: true,
    default: () => () => null,
}));

jest.mock("@/app_lib/online-services", () => ({
    openCustomerPortal: () => mockOpenCustomerPortal(),
}));

jest.mock("@/components/vault-dashboard/subscription-legal-notice", () => ({
    SubscriptionLegalNotice: () => null,
}));

jest.mock("@/components/vault-dashboard/checkout-tier-picker", () => ({
    CheckoutTierPicker: () => null,
}));

import { AccountSummary } from "@/components/vault-dashboard/account-dialog/account-summary";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("account billing management", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        mockOpenCustomerPortal.mockReset();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    async function renderSummary(
        subscription: ComponentProps<typeof AccountSummary>["subscription"],
    ) {
        await act(async () => {
            root.render(
                <AccountSummary
                    tierName="Online Services"
                    subscriptionStatus="active"
                    subscription={subscription}
                    remoteConfig={null}
                    hasSession
                    deviceId="device"
                    userId="user"
                    onlineServicesBound
                    isConnected
                />,
            );
        });
    }

    const manageBilling = () =>
        Array.from(container.querySelectorAll("a, button")).find(
            (element) => element.textContent === "Manage billing",
        );

    it("opens the Stripe portal for a Stripe subscription", async () => {
        await renderSummary({ nonFree: true, provider: "stripe" });
        const button = manageBilling() as HTMLButtonElement;
        expect(button.tagName).toBe("BUTTON");
        expect(button.disabled).toBe(false);
        act(() => button.click());
        expect(mockOpenCustomerPortal).toHaveBeenCalledTimes(1);
        expect(container.textContent).not.toContain("Billed through");
    });

    it("links a Google Play subscription to Google Play subscriptions", async () => {
        await renderSummary({ nonFree: true, provider: "google_play" });
        const link = manageBilling() as HTMLAnchorElement;
        expect(link.tagName).toBe("A");
        expect(link.href).toBe(
            "https://play.google.com/store/account/subscriptions",
        );
        expect(link.rel).toBe("noopener noreferrer");
        expect(container.textContent).toContain("Billed through Google Play.");
        expect(mockOpenCustomerPortal).not.toHaveBeenCalled();
    });

    it("explains where an App Store subscription is managed", async () => {
        await renderSummary({ nonFree: true, provider: "app_store" });
        expect(manageBilling()).toBeUndefined();
        expect(container.textContent).toContain(
            "Billed through the App Store.",
        );
    });

    it("shows the trial end date instead of a renewal", async () => {
        await renderSummary({
            nonFree: true,
            provider: "stripe",
            status: "trialing",
            trialEndsAt: "2026-11-05T12:00:00Z",
            expiresAt: "2026-11-05T12:00:00Z",
        });
        expect(container.textContent).toContain("Free trial");
        expect(container.textContent).toContain("Trial ends");
        expect(container.textContent).not.toContain("Renews");
    });

    it("says a cancelled trial ends without a charge", async () => {
        await renderSummary({
            nonFree: true,
            provider: "stripe",
            status: "trialing",
            trialEndsAt: "2026-11-05T12:00:00Z",
            cancelAtPeriodEnd: true,
        });
        expect(container.textContent).toContain("Access ends");
        expect(container.textContent).toContain("You won't be charged.");
    });

    it("hides billing for a free account", async () => {
        await renderSummary({ nonFree: false, provider: null });
        expect(manageBilling()).toBeUndefined();
        expect(container.textContent).not.toContain("Billed through");
    });
});
