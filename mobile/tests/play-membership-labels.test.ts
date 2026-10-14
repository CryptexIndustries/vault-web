import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement, type ComponentProps } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MembershipUpgrade } from "@/components/account/membership-upgrade";
import {
    isGooglePlayBuild,
    loadStorePlans,
    purchaseMembership,
    checkStorePurchaseStatus,
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
jest.mock("@/app_lib/online-services-billing", () => ({
    isGooglePlayBuild: jest.fn(() => true),
    loadStorePlans: jest.fn(),
    purchaseMembership: jest.fn(),
    checkStorePurchaseStatus: jest.fn(),
}));

let mockDimensions = { fontScale: 1, width: 390 };
let renderer: ReactTestRenderer;
const props = {
    canUpgrade: true,
    refreshing: false,
    onMessage: jest.fn(),
    onExternalBillingOpened: jest.fn(),
    onPendingChange: jest.fn(),
};
const plans = [
    { tier: "premiumMonthly" as const, price: "4,99 €" },
    { tier: "premiumYearly" as const, price: "49,99 €" },
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
    jest.mocked(isGooglePlayBuild).mockReturnValue(true);
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
    const onContinue = jest
        .fn<(tier: string) => Promise<void>>()
        .mockResolvedValue(undefined);
    await renderUpgrade({
        onContinue,
    });
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
    expect(onContinue).toHaveBeenCalledWith("premiumYearly");
    expect(purchaseMembership).not.toHaveBeenCalled();
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
    const onContinue = jest
        .fn<(tier: string) => Promise<void>>()
        .mockResolvedValue(undefined);
    await renderUpgrade({ onContinue });
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
    expect(onContinue).toHaveBeenCalledWith("premiumMonthly");
    expect(purchaseMembership).not.toHaveBeenCalled();
});

it("ignores price failures and retry actions from a replaced signup view", async () => {
    const prices = deferred<Awaited<ReturnType<typeof loadStorePlans>>>();
    jest.mocked(loadStorePlans).mockReturnValueOnce(prices.promise);
    const signupProps = { ...props, onContinue: async () => {} };
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

it("keeps the selected interval through loading, unavailable prices, retry, and a canceled native payment", async () => {
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
    const payment = deferred<Awaited<ReturnType<typeof purchaseMembership>>>();
    jest.mocked(purchaseMembership).mockReturnValueOnce(payment.promise);
    await press("Continue with yearly");
    expect(purchaseMembership).toHaveBeenCalledWith("premiumYearly");
    expect(radio("Yearly").props.disabled).toBe(true);
    expect(texts()).toContain("Yearly");
    await act(async () =>
        payment.resolve({ ok: false, canceled: true, message: "Canceled" }),
    );
    expect(radio("Yearly").props.disabled).toBe(false);
    expect(texts()).not.toContain("Canceled");
    expect(props.onMessage).toHaveBeenCalledTimes(1);
    expect(props.onExternalBillingOpened).not.toHaveBeenCalled();
});

it("keeps pending confirmation across failed and unpaid status checks and never starts another purchase", async () => {
    jest.mocked(purchaseMembership).mockResolvedValue({
        ok: false,
        pending: true,
        message: "Payment pending",
    });
    await renderUpgrade();
    await press("Continue with monthly");
    expect(props.onPendingChange).toHaveBeenCalledWith(true);
    expect(button("Continue with monthly")).toBeUndefined();
    expect(radio("Monthly").props.disabled).toBe(true);
    jest.mocked(checkStorePurchaseStatus).mockResolvedValueOnce({
        ok: false,
        message: "Could not connect.",
    });
    await press("Check status");
    expect(props.onMessage).toHaveBeenCalledWith(
        "Could not connect.",
        expect.objectContaining({ label: "Check status" }),
    );
    expect(button("Continue with monthly")).toBeUndefined();
    jest.mocked(checkStorePurchaseStatus).mockResolvedValueOnce({
        ok: false,
        pending: true,
        message: "Still confirming",
    });
    await press("Check status");
    expect(button("Continue with monthly")).toBeUndefined();
    jest.mocked(checkStorePurchaseStatus).mockResolvedValueOnce({ ok: true });
    await press("Check status");
    expect(props.onPendingChange).toHaveBeenLastCalledWith(false);
    expect(props.onExternalBillingOpened).toHaveBeenCalledWith("success");
    expect(purchaseMembership).toHaveBeenCalledTimes(1);
});

it("retries Play preflight failures through the same selected tier and expires actions with the sheet", async () => {
    jest.mocked(purchaseMembership)
        .mockResolvedValueOnce({ ok: false, message: "Billing unavailable" })
        .mockResolvedValueOnce({
            ok: false,
            canceled: true,
            message: "Canceled",
        });
    await renderUpgrade();
    await act(async () => radio("Yearly").props.onPress());
    await press("Continue with yearly");
    const recovery = props.onMessage.mock.calls[0]![1] as {
        label: string;
        onPress: () => void;
    };
    expect(recovery.label).toBe("Retry");
    await act(async () => recovery.onPress());
    expect(jest.mocked(purchaseMembership).mock.calls).toEqual([
        ["premiumYearly"],
        ["premiumYearly"],
    ]);
    expect(radio("Yearly").props.accessibilityState.checked).toBe(true);
    expect(props.onMessage).toHaveBeenCalledTimes(1);
    await act(async () =>
        renderer.update(
            createElement(MembershipUpgrade, {
                ...props,
                onMessage: jest.fn(),
            }),
        ),
    );
    await act(async () => recovery.onPress());
    expect(purchaseMembership).toHaveBeenCalledTimes(2);
});

it.each([true, false])(
    "ignores stale %p provider completion and recovers local busy state without clearing a new owner's busy flag",
    async (play) => {
        jest.mocked(isGooglePlayBuild).mockReturnValue(play);
        const payment =
            deferred<Awaited<ReturnType<typeof purchaseMembership>>>();
        jest.mocked(purchaseMembership).mockReturnValueOnce(payment.promise);
        const oldBusy = jest.fn(),
            newBusy = jest.fn(),
            newMessage = jest.fn();
        await renderUpgrade({ onBillingBusyChange: oldBusy });
        await press("Continue with monthly");
        await act(async () =>
            renderer.update(
                createElement(MembershipUpgrade, {
                    ...props,
                    onMessage: newMessage,
                    onBillingBusyChange: newBusy,
                }),
            ),
        );
        await act(async () => payment.resolve({ ok: true }));
        expect(oldBusy.mock.calls).toEqual([[true]]);
        expect(newBusy).not.toHaveBeenCalled();
        expect(props.onExternalBillingOpened).not.toHaveBeenCalled();
        expect(radio("Monthly").props.disabled).toBe(false);
        jest.mocked(purchaseMembership).mockResolvedValueOnce({
            ok: false,
            message: "Offline",
        });
        await press("Continue with monthly");
        expect(newBusy.mock.calls).toEqual([[true], [false]]);
        expect(newMessage).toHaveBeenCalledWith(
            "Offline",
            expect.objectContaining({ label: "Retry" }),
        );
    },
);

it("latches pending immediately when controlled parent props lag and clears on authoritative change", async () => {
    jest.mocked(purchaseMembership).mockResolvedValueOnce({
        ok: false,
        pending: true,
        message: "Pending",
    });
    await renderUpgrade({
        pendingConfirmation: false,
    });
    const oldPress = button("Continue with monthly").props.onPress;
    await press("Continue with monthly");
    await act(async () => oldPress());
    expect(purchaseMembership).toHaveBeenCalledTimes(1);
    expect(button("Check status")).toBeDefined();
    await act(async () =>
        renderer.update(
            createElement(MembershipUpgrade, {
                ...props,
                pendingConfirmation: true,
            }),
        ),
    );
    await act(async () =>
        renderer.update(
            createElement(MembershipUpgrade, {
                ...props,
                pendingConfirmation: false,
            }),
        ),
    );
    expect(button("Check status")).toBeUndefined();
    expect(button("Continue with monthly")).toBeDefined();
});

it("never renders an invented renewal price when the selected store plan is absent", async () => {
    jest.mocked(loadStorePlans).mockResolvedValueOnce([plans[0]!]);
    await renderUpgrade({
        onContinue: async () => {},
    });
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

it("reopens an account's pending paywall with Check status instead of purchase", async () => {
    await renderUpgrade({
        pendingConfirmation: true,
    });
    expect(button("Check status")).toBeDefined();
    expect(button("Continue with monthly")).toBeUndefined();
    expect(purchaseMembership).not.toHaveBeenCalled();
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

it("reports one Stripe busy lifecycle for duplicate taps and clears it on success or failure", async () => {
    jest.mocked(isGooglePlayBuild).mockReturnValue(false);
    const onBillingBusyChange = jest.fn();
    const checkout = deferred<Awaited<ReturnType<typeof purchaseMembership>>>();
    jest.mocked(purchaseMembership).mockReturnValueOnce(checkout.promise);
    await renderUpgrade({ onBillingBusyChange });
    await act(async () => {
        const onPress = button("Continue with monthly").props.onPress;
        onPress();
        onPress();
    });
    expect(purchaseMembership).toHaveBeenCalledTimes(1);
    expect(onBillingBusyChange.mock.calls).toEqual([[true]]);
    await act(async () => checkout.resolve({ ok: true }));
    expect(onBillingBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(props.onExternalBillingOpened).toHaveBeenCalledTimes(1);

    jest.mocked(purchaseMembership).mockRejectedValueOnce(
        new Error("Checkout unavailable"),
    );
    await press("Continue with monthly");
    expect(onBillingBusyChange.mock.calls).toEqual([
        [true],
        [false],
        [true],
        [false],
    ]);
    expect(props.onMessage).toHaveBeenCalledWith(
        "Could not open checkout. Please try again.",
        expect.objectContaining({ label: "Retry" }),
    );
    expect(props.onExternalBillingOpened).toHaveBeenCalledTimes(1);
});
