import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement, type ComponentProps } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MembershipUpgrade } from "@/components/account/membership-upgrade";
import {
    storeBilling,
    loadStorePlans,
} from "@/app_lib/online-services-billing";

jest.mock("react-native", () => ({
    View: "View",
    Text: "NativeText",
    Pressable: "Pressable",
    ActivityIndicator: "Spinner",
    useWindowDimensions: () => mockDimensions,
}));
jest.mock("lucide-react-native", () => ({ Check: "Check" }));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    // Use the real button's native Text wrapping rather than accepting raw string arrays.
    UnlockedButton: jest.requireActual<typeof import("@/components/ui/button")>(
        "@/components/ui/button",
    ).Button,
    UnlockedText: "NativeText",
}));
jest.mock("@/components/account/membership-benefits", () => ({
    MembershipBenefits: () => null,
}));
jest.mock("@/components/account/payment-status", () => ({
    PaymentStatus: "PaymentStatus",
}));
jest.mock("@/app_lib/online-services-billing", () => ({
    storeBilling: jest.fn(() => "google_play"),
    loadStorePlans: jest.fn(),
}));

let mockDimensions = { fontScale: 1, width: 390 };
let renderer: ReactTestRenderer;
const props = {
    canUpgrade: true,
    refreshing: false,
    onMessage: jest.fn(),
    onContinue: jest.fn(),
};
const plans = [
    { tier: "premiumMonthly" as const, price: "4,99 €", trial: false },
    { tier: "premiumYearly" as const, price: "49,99 €", trial: false },
];
function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}
function radio(period: string) {
    return renderer.root
        .findAllByType("Pressable" as never)
        .find(
            (node) =>
                node.props.accessibilityRole === "radio" &&
                node.props.accessibilityLabel.startsWith(period),
        )!;
}
function button(label: string) {
    return renderer.root
        .findAllByType("Pressable" as never)
        .find((node) =>
            node
                .findAllByType("NativeText" as never)
                .some((text) => text.props.children === label),
        )!;
}
function texts() {
    return renderer.root
        .findAllByType("NativeText" as never)
        .map((node) => node.props.children);
}
async function press(label: string) {
    await act(async () => button(label).props.onPress());
}
async function renderUpgrade(
    overrides: Partial<ComponentProps<typeof MembershipUpgrade>> = {},
) {
    await act(async () => {
        renderer = create(
            createElement(MembershipUpgrade, { ...props, ...overrides }),
        );
    });
}
beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(storeBilling).mockReturnValue("google_play");
    mockDimensions = { fontScale: 1, width: 390 };
    jest.mocked(loadStorePlans).mockResolvedValue(plans);
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
    await act(async () => renderer.unmount());
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
});

it("loads localized prices before account setup without blocking registration or starting a purchase", async () => {
    const prices = deferred<Awaited<ReturnType<typeof loadStorePlans>>>();
    jest.mocked(loadStorePlans).mockReturnValueOnce(prices.promise);
    const onContinue = jest.fn();
    await renderUpgrade({ setup: true, onContinue });
    expect(texts()).toContain("Monthly");
    expect(texts()).toContain("Yearly");
    expect(radio("Monthly").props.accessibilityLabel).toBe("Monthly, Loading…");
    expect(radio("Monthly").props.accessibilityState.checked).toBe(true);
    expect(radio("Monthly").props.style.backgroundColor).not.toBe(
        "transparent",
    );
    expect(loadStorePlans).toHaveBeenCalledTimes(1);
    expect(button("Continue").props.disabled).toBe(false);
    await act(async () => radio("Yearly").props.onPress());
    await press("Continue");
    expect(onContinue).toHaveBeenCalledWith("premiumYearly", false);
    await act(async () => prices.resolve(plans));
    expect(radio("Monthly").props.accessibilityLabel).toBe(
        "Monthly, 4,99 € per month",
    );
    expect(radio("Yearly").props.accessibilityLabel).toBe(
        "Yearly, 49,99 € per year",
    );
    expect(radio("Yearly").props.accessibilityState.checked).toBe(true);
    expect(texts()).toContain(
        "No email required. Save your Recovery Kit before payment.",
    );
    expect(texts()).toContain("Billed monthly");
    expect(texts()).toContain("Billed yearly");
    expect(texts()).toContain(
        "49,99 € charged every year. Automatically renews until canceled. Cancel anytime in Google Play Subscriptions. Access continues until the end of the paid period.",
    );
    expect(
        texts().some(
            (value) => typeof value === "string" && value.startsWith("Save €"),
        ),
    ).toBe(false);
});

it("keeps Continue available on price failure and retries through snackbar feedback", async () => {
    jest.mocked(loadStorePlans).mockRejectedValueOnce(
        new Error("Internal store diagnostics"),
    );
    const onContinue = jest.fn();
    await renderUpgrade({ setup: true, onContinue });
    expect(radio("Monthly").props.accessibilityLabel).toBe(
        "Monthly, Unavailable",
    );
    expect(button("Continue").props.disabled).toBe(false);
    expect(button("Retry prices")).toBeUndefined();
    expect(props.onMessage).toHaveBeenCalledWith(
        "Could not load Google Play prices. Please try again.",
        expect.objectContaining({ label: "Retry prices" }),
    );
    expect(texts()).not.toContain("Internal store diagnostics");
    expect(texts()).not.toContain(
        "Could not load Google Play prices. Please try again.",
    );
    const prices = deferred<Awaited<ReturnType<typeof loadStorePlans>>>();
    jest.mocked(loadStorePlans).mockReturnValueOnce(prices.promise);
    const retry = props.onMessage.mock.calls[0]![1] as { onPress: () => void };
    await act(async () => retry.onPress());
    expect(radio("Monthly").props.accessibilityLabel).toBe("Monthly, Loading…");
    expect(button("Continue").props.disabled).toBe(false);
    await act(async () => prices.resolve(plans));
    expect(radio("Monthly").props.accessibilityLabel).toBe(
        "Monthly, 4,99 € per month",
    );
    await press("Continue");
    expect(onContinue).toHaveBeenCalledWith("premiumMonthly", false);
});

it("ignores price failures and retry actions from a replaced signup view", async () => {
    const prices = deferred<Awaited<ReturnType<typeof loadStorePlans>>>();
    jest.mocked(loadStorePlans).mockReturnValueOnce(prices.promise);
    const signupProps = { ...props, setup: true };
    await act(async () => {
        renderer = create(createElement(MembershipUpgrade, signupProps));
    });
    await act(async () => renderer.update(createElement("View")));
    await act(async () => prices.reject(new Error("Expired catalog request")));
    expect(props.onMessage).not.toHaveBeenCalled();

    jest.mocked(loadStorePlans).mockRejectedValueOnce(new Error("Offline"));
    await act(async () =>
        renderer.update(createElement(MembershipUpgrade, signupProps)),
    );
    const retry = props.onMessage.mock.calls[0]![1] as { onPress: () => void };
    await act(async () =>
        renderer.update(
            createElement(MembershipUpgrade, {
                ...signupProps,
                onMessage: jest.fn(),
            }),
        ),
    );
    expect(loadStorePlans).toHaveBeenCalledTimes(3);
    await act(async () => retry.onPress());
    expect(loadStorePlans).toHaveBeenCalledTimes(3);
    expect(props.onMessage).toHaveBeenCalledTimes(1);
    expect(radio("Monthly").props.accessibilityLabel).toBe(
        "Monthly, 4,99 € per month",
    );
});

it("keeps the selected interval through loading, unavailable prices and retry", async () => {
    const prices = deferred<Awaited<ReturnType<typeof loadStorePlans>>>();
    jest.mocked(loadStorePlans).mockReturnValueOnce(prices.promise);
    await renderUpgrade();
    await act(async () => radio("Yearly").props.onPress());
    await act(async () =>
        renderer.update(
            createElement(MembershipUpgrade, {
                ...props,
                refreshing: true,
            }),
        ),
    );
    expect(radio("Yearly").props.accessibilityState).toEqual({
        checked: true,
        disabled: true,
    });
    expect(radio("Yearly").props.accessibilityLabel).toBe("Yearly, Loading…");
    await act(async () =>
        prices.reject(new Error("Internal store diagnostics")),
    );
    await act(async () =>
        renderer.update(createElement(MembershipUpgrade, props)),
    );
    expect(radio("Yearly").props.accessibilityLabel).toBe(
        "Yearly, Unavailable",
    );
    expect(button("Retry prices").props.disabled).toBe(false);
    expect(texts()).not.toContain("Internal store diagnostics");
    expect(props.onMessage).toHaveBeenCalledTimes(1);
    await press("Retry prices");
    expect(radio("Yearly").props.accessibilityLabel).toBe(
        "Yearly, 49,99 € per year",
    );
    expect(radio("Monthly").props.accessibilityLabel).toBe(
        "Monthly, 4,99 € per month",
    );
    expect(radio("Yearly").props.accessibilityState.checked).toBe(true);
    await press("Continue with yearly");
    expect(props.onContinue).toHaveBeenCalledWith("premiumYearly", false);
    expect(props.onMessage).toHaveBeenCalledTimes(1);
});

it("never renders an invented renewal price when the selected store plan is absent", async () => {
    jest.mocked(loadStorePlans).mockResolvedValueOnce([plans[0]!]);
    await renderUpgrade({ setup: true });
    await act(async () => radio("Yearly").props.onPress());
    expect(
        texts().some(
            (value) => typeof value === "string" && value.includes("undefined"),
        ),
    ).toBe(false);
    expect(
        texts().some(
            (value) =>
                typeof value === "string" && value.includes("charged every"),
        ),
    ).toBe(false);
});

it.each([
    { width: 320, fontScale: 1 },
    { width: 390, fontScale: 3 },
])(
    "uses full-width cards without oversized minimums at %p",
    async (dimensions) => {
        await act(async () => {
            renderer = create(createElement(MembershipUpgrade, props));
        });
        expect(radio("Monthly").props.style.flexBasis).toBeUndefined();
        mockDimensions = dimensions;
        await act(async () =>
            renderer.update(
                createElement(MembershipUpgrade, {
                    ...props,
                    refreshing: true,
                }),
            ),
        );
        for (const period of ["Monthly", "Yearly"]) {
            expect(radio(period).props.style).toMatchObject({
                flexBasis: "100%",
                minWidth: 0,
            });
            expect(
                radio(period).findAllByType("NativeText" as never)[0]!.props
                    .style.flexShrink,
            ).toBe(1);
        }
    },
);

it("shows a changed offer above the reloaded plans and continues with the new terms", async () => {
    jest.mocked(loadStorePlans).mockResolvedValueOnce(
        plans.map((plan) => ({ ...plan, trial: true })),
    );
    await renderUpgrade({ trialEligible: true, offerTrial: true });
    expect(loadStorePlans).toHaveBeenCalledWith(true);
    expect(
        renderer.root.findByType("PaymentStatus" as never).props,
    ).toMatchObject({ state: "offerChanged", trial: true, compact: true });
    await press("Start 14-day free trial");
    expect(props.onContinue).toHaveBeenCalledWith("premiumMonthly", true);
});
