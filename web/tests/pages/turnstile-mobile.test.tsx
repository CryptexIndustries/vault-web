import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const FIRST_NONCE = "abcdef0123456789";
const SECOND_NONCE = "fedcba9876543210";

let mockRouter = {
    isReady: true,
    query: { nonce: FIRST_NONCE, action: "auth_register" },
};
type MockTurnstileProps = {
    onWidgetLoad: () => void;
    onSuccess: (token: string) => void;
    onTimeout: () => void;
    options: { action?: string; cData?: string };
};
let mockTurnstileProps: MockTurnstileProps;

jest.mock("next/head", () => ({
    __esModule: true,
    default: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("next/router", () => ({
    useRouter: () => mockRouter,
}));
jest.mock("@/env/public", () => ({
    env: { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key" },
}));
jest.mock("@marsidev/react-turnstile", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    return {
        Turnstile: React.forwardRef<unknown, MockTurnstileProps>(
            (props, _ref) => {
                mockTurnstileProps = props;
                return null;
            },
        ),
    };
});

import TurnstileMobileBridgePage from "@/pages/turnstile/mobile";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("mobile Turnstile bridge", () => {
    let container: HTMLDivElement;
    let root: Root;
    let postMessage: ReturnType<typeof jest.fn>;

    beforeEach(() => {
        jest.useFakeTimers();
        mockRouter = {
            isReady: true,
            query: { nonce: FIRST_NONCE, action: "auth_register" },
        };
        postMessage = jest.fn();
        window.ReactNativeWebView = { postMessage };
        container = document.createElement("div");
        root = createRoot(container);
        act(() => root.render(<TurnstileMobileBridgePage />));
    });

    afterEach(() => {
        act(() => root.unmount());
        delete window.ReactNativeWebView;
        jest.useRealTimers();
    });

    it("starts the timer when the widget loads and emits one terminal message", () => {
        expect(postMessage).not.toHaveBeenCalled();

        act(() => mockTurnstileProps.onWidgetLoad());
        expect(JSON.parse(postMessage.mock.calls[0]?.[0] ?? "null")).toEqual({
            type: "ready",
            instanceNonce: FIRST_NONCE,
        });

        act(() => {
            mockTurnstileProps.onTimeout();
            mockTurnstileProps.onSuccess("late-token");
            jest.runOnlyPendingTimers();
        });

        expect(postMessage).toHaveBeenCalledTimes(2);
        expect(JSON.parse(postMessage.mock.calls[1]?.[0] ?? "null")).toEqual({
            type: "timeout",
            instanceNonce: FIRST_NONCE,
        });
    });

    it("clears the watchdog after success", () => {
        act(() => {
            mockTurnstileProps.onWidgetLoad();
            mockTurnstileProps.onSuccess("token");
            jest.runOnlyPendingTimers();
        });

        expect(postMessage).toHaveBeenCalledTimes(2);
        expect(JSON.parse(postMessage.mock.calls[1]?.[0] ?? "null")).toEqual({
            type: "success",
            instanceNonce: FIRST_NONCE,
            token: "token",
        });
    });

    it("rejects unlabeled or non-allowlisted actions", () => {
        mockRouter = {
            isReady: true,
            query: { nonce: FIRST_NONCE, action: "mobile_auth" },
        };
        act(() => root.render(<TurnstileMobileBridgePage />));
        expect(
            JSON.parse(postMessage.mock.calls.at(-1)?.[0] ?? "null"),
        ).toEqual({
            type: "error",
            instanceNonce: FIRST_NONCE,
            message: "Missing or invalid challenge action.",
        });
        expect(mockTurnstileProps?.options?.action).not.toBe("mobile_auth");
    });

    it("resets terminal state and binds allowlisted action when nonce changes", () => {
        act(() => mockTurnstileProps.onTimeout());

        mockRouter = {
            isReady: true,
            query: { nonce: SECOND_NONCE, action: "auth_recover" },
        };
        act(() => root.render(<TurnstileMobileBridgePage />));
        expect(mockTurnstileProps.options).toMatchObject({
            action: "auth_recover",
        });
        expect(mockTurnstileProps.options.cData).toBeUndefined();

        act(() => {
            mockTurnstileProps.onWidgetLoad();
            mockTurnstileProps.onSuccess("new-token");
        });
        expect(
            JSON.parse(postMessage.mock.calls.at(-1)?.[0] ?? "null"),
        ).toEqual({
            type: "success",
            instanceNonce: SECOND_NONCE,
            token: "new-token",
        });
    });
});
