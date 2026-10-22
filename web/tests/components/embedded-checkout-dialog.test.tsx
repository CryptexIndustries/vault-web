/** @jest-environment jsdom */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const subscriptionFetchMock =
    jest.fn<
        (
            input: undefined,
            opts: { staleTime: number },
        ) => Promise<{ trialEligible: boolean }>
    >();

jest.mock("@/utils/trpc", () => {
    const utils = {
        v1: { payment: { subscription: { fetch: subscriptionFetchMock } } },
    };
    return { trpcReact: { useUtils: () => utils } };
});

jest.mock("@/app_lib/online-services", () => ({
    // Checkout never finishes loading; only the notice matters here.
    fetchCheckoutClientSecret: () => new Promise(() => undefined),
}));

jest.mock("@/env/public", () => ({
    env: { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test" },
}));

jest.mock("@stripe/stripe-js", () => ({ loadStripe: jest.fn() }));

jest.mock("@stripe/react-stripe-js", () => ({
    EmbeddedCheckout: () => null,
    EmbeddedCheckoutProvider: () => null,
}));

import { EmbeddedCheckoutDialog } from "@/components/vault-dashboard/embedded-checkout-dialog";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const TRIAL_SENTENCE = "It starts with a 14-day free trial.";
const PAID_SENTENCE = "You will be charged the price shown at checkout.";

describe("EmbeddedCheckoutDialog legal notice", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        subscriptionFetchMock.mockReset();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("waits for a fresh subscription read before naming trial or paid terms", async () => {
        let resolveFetch!: (value: { trialEligible: boolean }) => void;
        subscriptionFetchMock.mockReturnValue(
            new Promise((resolve) => {
                resolveFetch = resolve;
            }),
        );

        await act(async () => {
            root.render(
                <EmbeddedCheckoutDialog open onOpenChange={() => undefined} />,
            );
        });

        expect(subscriptionFetchMock).toHaveBeenCalledWith(undefined, {
            staleTime: 0,
        });
        expect(document.body.textContent).toContain("auto-renews");
        expect(document.body.textContent).not.toContain(TRIAL_SENTENCE);
        expect(document.body.textContent).not.toContain(PAID_SENTENCE);

        await act(async () => {
            resolveFetch({ trialEligible: true });
        });

        expect(document.body.textContent).toContain(TRIAL_SENTENCE);
        expect(document.body.textContent).not.toContain(PAID_SENTENCE);
    });
});
