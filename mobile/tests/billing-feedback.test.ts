import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement, StrictMode, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AccessibilityInfo, Platform } from "react-native";
import {
    BillingSnackbar,
    useBillingFeedback,
} from "@/components/billing-feedback";

jest.mock("react-native", () => ({
    View: "View",
    Pressable: "Pressable",
    Platform: { OS: "android" },
    AccessibilityInfo: {
        announceForAccessibility: jest.fn(),
        getRecommendedTimeoutMillis: jest.fn(async () => 16000),
    },
}));
jest.mock("lucide-react-native", () => ({ X: "X" }));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedText: "Text",
}));
let renderer: ReactTestRenderer | undefined;
let current!: ReturnType<typeof useBillingFeedback>;
let scope = "vault-a";
let active = true;
let mounts = 0;
function Harness() {
    useEffect(() => {
        mounts++;
    }, []);
    current = useBillingFeedback(scope, active);
    return createElement(BillingSnackbar, {
        feedback: current.feedback,
        onDismiss: current.dismiss,
    });
}
async function render(strict = false) {
    await act(async () => {
        const tree = strict
            ? createElement(StrictMode, null, createElement(Harness))
            : createElement(Harness);
        if (renderer) renderer.update(tree);
        else
            renderer = create(
                tree,
                strict ? ({ unstable_strictMode: true } as never) : undefined,
            );
    });
}
async function advance(ms: number) {
    await act(async () => jest.advanceTimersByTime(ms));
}
function action(label: string) {
    return renderer!.root
        .findAllByType("Pressable" as never)
        .find((node) => node.props.accessibilityLabel === label)!;
}
beforeEach(() => {
    jest.useFakeTimers();
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    scope = "vault-a";
    active = true;
    mounts = 0;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    Platform.OS = "android";
    jest.mocked(
        AccessibilityInfo.getRecommendedTimeoutMillis,
    ).mockResolvedValue(16000);
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    jest.useRealTimers();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
});
it("shows one message and keeps an actionable recovery until it is used or dismissed", async () => {
    const retry = jest.fn<() => void>();
    await render();
    await act(async () =>
        current.show("Could not open payment.", {
            label: "Retry",
            onPress: retry,
        }),
    );
    await advance(60000);
    expect(
        renderer!.root.findAllByProps({ testID: "billing-snackbar" }),
    ).toHaveLength(1);
    expect(
        AccessibilityInfo.getRecommendedTimeoutMillis,
    ).not.toHaveBeenCalled();
    await act(async () => action("Retry").props.onPress());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(current.feedback).toBeNull();
});
it("uses the accessibility timeout for non-action feedback", async () => {
    await render();
    await act(async () => current.show("Billing could not be opened."));
    await advance(8000);
    expect(current.feedback).not.toBeNull();
    await advance(8000);
    expect(current.feedback).toBeNull();
});
it("clears the prior timer when replacing feedback", async () => {
    await render();
    await act(async () => current.show("First"));
    await advance(12000);
    await act(async () =>
        current.show("Second", {
            label: "Retry",
            onPress: jest.fn<() => void>(),
        }),
    );
    await advance(60000);
    expect(current.feedback?.message).toBe("Second");
    expect(
        renderer!.root.findAllByProps({ testID: "billing-snackbar" }),
    ).toHaveLength(1);
});
it("has accessible dismissal and live feedback without grouping away recovery controls", async () => {
    await render();
    await act(async () =>
        current.show("Could not open payment.", {
            label: "Retry",
            onPress: jest.fn<() => void>(),
        }),
    );
    expect(
        renderer!.root
            .findAllByType("Text" as never)
            .find((node) => node.props.children === "Could not open payment.")!
            .props.accessibilityLiveRegion,
    ).toBe("polite");
    expect(action("Retry").props.accessibilityRole).toBe("button");
    await act(async () => action("Dismiss message").props.onPress());
    expect(current.feedback).toBeNull();
});
it("announces on iOS and leaves Android announcements to the live region", async () => {
    Platform.OS = "ios";
    await render();
    await act(async () => current.show("Could not open payment."));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        "Could not open payment.",
    );
});
it("drops old reporters after an account or view scope changes", async () => {
    await render();
    const oldReporter = current.show;
    await act(async () => current.show("Old account"));
    scope = "vault-b";
    await render();
    await act(async () =>
        oldReporter("Late result", {
            label: "Retry",
            onPress: jest.fn<() => void>(),
        }),
    );
    expect(current.feedback).toBeNull();
    await act(async () => current.show("Current account"));
    expect(current.feedback?.message).toBe("Current account");
});
it("drops a prior reporter after closing and reopening the same sheet", async () => {
    await render();
    const oldReporter = current.show;
    active = false;
    await render();
    active = true;
    await render();
    await act(async () => oldReporter("Old checkout"));
    expect(current.feedback).toBeNull();
});
it("keeps the current reporter usable after StrictMode replays effects", async () => {
    await render(true);
    expect(mounts).toBe(2);
    await act(async () => current.show("Current checkout"));
    expect(current.feedback?.message).toBe("Current checkout");
});
it("cleans up expiry timers and rejects emissions after unmount", async () => {
    await render();
    const oldReporter = current.show;
    await act(async () => current.show("One"));
    await advance(0);
    const expiry = jest.spyOn(globalThis, "clearTimeout");
    await act(async () => renderer!.unmount());
    renderer = undefined;
    await advance(0);
    expect(expiry).toHaveBeenCalled();
    expiry.mockRestore();
    await act(async () => oldReporter("Late checkout"));
});
