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

let mockCheckoutProps: { open: boolean; tier: string } | null = null;

jest.mock("next/dynamic", () => ({
    __esModule: true,
    default: () => (props: { open: boolean; tier: string }) => {
        mockCheckoutProps = props;
        return null;
    },
}));

jest.mock("@/app_lib/online-services", () => ({
    openCustomerPortal: jest.fn(),
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

describe("account purchase checkout", () => {
    let container: HTMLDivElement;
    let root: Root;
    let consumed: jest.Mock;

    beforeEach(() => {
        mockCheckoutProps = null;
        consumed = jest.fn();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const props = {
        tierName: "Free",
        subscriptionStatus: "Free",
        remoteConfig: null,
        hasSession: true,
        deviceId: "device",
        userId: "user",
        onlineServicesBound: true,
        isConnected: true,
    };

    async function renderSummary(
        overrides: Partial<ComponentProps<typeof AccountSummary>>,
    ) {
        await act(async () => {
            root.render(
                <AccountSummary
                    {...props}
                    subscription={undefined}
                    checkoutPlan={null}
                    onPurchaseHandled={consumed}
                    {...overrides}
                />,
            );
        });
    }

    it("waits for a fresh free subscription, then opens the selected yearly checkout once", async () => {
        await renderSummary({
            subscriptionReady: false,
            checkoutPlan: "yearly",
        });
        expect(mockCheckoutProps?.open).toBe(false);
        expect(consumed).not.toHaveBeenCalled();

        await renderSummary({
            subscription: null,
            subscriptionReady: true,
            checkoutPlan: "yearly",
        });
        expect(mockCheckoutProps?.open).toBe(false);

        await renderSummary({
            subscription: { nonFree: false },
            subscriptionReady: true,
            checkoutPlan: "yearly",
        });
        expect(mockCheckoutProps).toEqual(
            expect.objectContaining({ open: true, tier: "premiumYearly" }),
        );
        expect(consumed).toHaveBeenCalledTimes(1);

        await renderSummary({
            subscription: { nonFree: false },
            subscriptionReady: true,
        });
        expect(consumed).toHaveBeenCalledTimes(1);
    });

    it("consumes the purchase intent without checkout for a paid account", async () => {
        await renderSummary({
            subscription: { nonFree: true },
            subscriptionReady: true,
            checkoutPlan: "monthly",
        });
        expect(mockCheckoutProps?.open).toBe(false);
        expect(consumed).toHaveBeenCalledTimes(1);
    });

    it("keeps checkout closed while a new account still needs its Recovery Kit", async () => {
        await renderSummary({
            subscription: { nonFree: false },
            subscriptionReady: true,
            checkoutBlocked: true,
        });
        expect(mockCheckoutProps?.open).toBe(false);
        expect(
            (
                Array.from(container.querySelectorAll("button")).find(
                    (button) => button.textContent === "Upgrade",
                ) as HTMLButtonElement
            ).disabled,
        ).toBe(true);

        await renderSummary({
            subscription: { nonFree: false },
            subscriptionReady: true,
            checkoutPlan: "monthly",
        });
        expect(mockCheckoutProps).toEqual(
            expect.objectContaining({ open: true, tier: "premiumMonthly" }),
        );
        expect(consumed).toHaveBeenCalledTimes(1);
    });
});
