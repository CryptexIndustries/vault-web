import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
    HUMAN_CHECK_TIMEOUT_MS,
    useTurnstileTokenRequest,
} from "@/components/account/turnstile-challenge";
import { onlineServicesLog } from "@/utils/logging";

jest.mock("react-native", () => ({
    View: "View",
    ActivityIndicator: "Spinner",
    AppState: { addEventListener: () => ({ remove: () => undefined }) },
}));
jest.mock("react-native-webview", () => ({ WebView: "WebView" }));
jest.mock("lucide-react-native", () => ({ AlertCircle: "AlertCircle" }));
jest.mock("@/components/ui/button", () => ({ Button: "Button" }));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedButton: "Button",
}));
jest.mock("@/components/ui/text", () => ({ Text: "Text" }));
jest.mock("@/components/ui/dialog", () => ({
    Dialog: "Dialog",
    DialogContent: "DialogContent",
    DialogDescription: "DialogDescription",
    DialogFooter: "DialogFooter",
    DialogHeader: "DialogHeader",
    DialogTitle: "DialogTitle",
}));
jest.mock("@/components/account/status-panel", () => ({
    StatusPanel: "StatusPanel",
}));
jest.mock("@/components/account/turnstile-bridge", () => ({
    isTurnstileConfigured: () => true,
    createTurnstileInstanceNonce: () => `nonce-${++mockNonces}`,
    buildTurnstileBridgeUrl: (nonce: string) =>
        `https://app.test/turnstile/mobile?nonce=${nonce}`,
    assertTurnstileBridgeUrlAllowed: () => true,
    isAllowedTurnstileMessageSource: () => true,
    isAllowedTurnstileNavigationUrl: () => true,
    parseTurnstileBridgeMessage: (data: string) => JSON.parse(data),
}));
jest.mock("@/utils/logging", () => ({
    onlineServicesLog: { info: jest.fn(), warn: jest.fn() },
}));

let mockNonces = 0;
let renderer: ReactTestRenderer;
let human: ReturnType<typeof useTurnstileTokenRequest>;

function Harness() {
    human = useTurnstileTokenRequest({ inline: true });
    return createElement("Screen", null, human.dialog);
}

function request() {
    const result: { token?: string | null } = {};
    void human.requestToken("auth_recover").then((token) => {
        result.token = token;
    });
    return result;
}

beforeEach(async () => {
    jest.useFakeTimers();
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => {
        renderer = create(createElement(Harness));
    });
});
afterEach(async () => {
    await act(async () => renderer.unmount());
    jest.useRealTimers();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
});

it("ends a human check that never finishes with no token, so the caller is never left waiting", async () => {
    let check!: ReturnType<typeof request>;
    await act(async () => {
        check = request();
    });
    expect(renderer.root.findAllByType("WebView" as never)).toHaveLength(1);
    await act(async () => {
        jest.advanceTimersByTime(HUMAN_CHECK_TIMEOUT_MS - 1);
    });
    expect(check).toEqual({});
    await act(async () => {
        jest.advanceTimersByTime(1);
    });
    expect(check).toEqual({ token: null });
    expect(renderer.root.findAllByType("WebView" as never)).toHaveLength(0);
    expect(onlineServicesLog.warn).toHaveBeenCalledWith(
        "Human check ended without a result",
        { action: "auth_recover", reason: "timed out" },
    );
});

it("ends an earlier check when a new one starts, and on cancel", async () => {
    let first!: ReturnType<typeof request>;
    let second!: ReturnType<typeof request>;
    await act(async () => {
        first = request();
    });
    await act(async () => {
        second = request();
    });
    expect(first).toEqual({ token: null });
    expect(second).toEqual({});
    await act(async () => human.cancel());
    expect(second).toEqual({ token: null });
    expect(
        jest
            .mocked(onlineServicesLog.warn)
            .mock.calls.map(
                ([, details]) => (details as { reason: string }).reason,
            ),
    ).toEqual(["replaced", "closed"]);
});

it("never lets a superseded challenge answer the next request", async () => {
    let second!: ReturnType<typeof request>;
    await act(async () => {
        request();
    });
    const oldUri = renderer.root.findByType("WebView" as never).props.source
        .uri as string;
    const oldNonce = new URL(oldUri).searchParams.get("nonce");
    await act(async () => {
        second = request();
    });
    // A late success from the first challenge, delivered through the current view.
    const current = renderer.root.findByType("WebView" as never).props;
    expect(current.source.uri).not.toBe(oldUri);
    await act(async () =>
        current.onMessage({
            nativeEvent: {
                url: current.source.uri,
                data: JSON.stringify({
                    type: "success",
                    instanceNonce: oldNonce,
                    token: "old-token",
                }),
            },
        }),
    );
    expect(second).toEqual({});
});
