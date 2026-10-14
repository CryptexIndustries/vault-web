import { describe, expect, it, jest } from "@jest/globals";
import { env } from "@/env";

jest.mock("@/env", () => ({
    env: {
        APP_URL: "https://app.example.com",
        TURNSTILE_SITE_KEY: "site-key",
    },
}));

import {
    TURNSTILE_BRIDGE_PATH,
    assertTurnstileBridgeUrlAllowed,
    buildTurnstileBridgeUrl,
    createTurnstileInstanceNonce,
    isAllowedTurnstileNavigationUrl,
    isAllowedTurnstileMessageSource,
    parseTurnstileBridgeMessage,
} from "@/components/account/turnstile-bridge";

describe("turnstile bridge helpers", () => {
    it("builds bridge URL with nonce and allowlisted action", () => {
        const url = buildTurnstileBridgeUrl(
            "abcdef0123456789",
            "auth_register",
        );
        expect(url).toBe(
            `https://app.example.com${TURNSTILE_BRIDGE_PATH}?nonce=abcdef0123456789&action=auth_register`,
        );
        expect(assertTurnstileBridgeUrlAllowed(url)).toBe(true);
    });

    it("rejects bridge URLs without an allowlisted action", () => {
        expect(
            assertTurnstileBridgeUrlAllowed(
                `https://app.example.com${TURNSTILE_BRIDGE_PATH}?nonce=abcdef0123456789`,
            ),
        ).toBe(false);
        expect(
            assertTurnstileBridgeUrlAllowed(
                `https://app.example.com${TURNSTILE_BRIDGE_PATH}?nonce=abcdef0123456789&action=mobile_auth`,
            ),
        ).toBe(false);
        expect(() =>
            buildTurnstileBridgeUrl(
                "abcdef0123456789",
                "mobile_auth" as "auth_register",
            ),
        ).toThrow("Turnstile action is not allowlisted.");
    });

    it("allows HTTP loopback only for explicitly flagged review builds, retaining origin and path checks", () => {
        const mockEnv = env as { APP_URL: string };
        const previousOrigin = mockEnv.APP_URL;
        const previousFlag = process.env.EXPO_PUBLIC_CRYPTEX_E2E;
        const previousDev = __DEV__;
        try {
            (globalThis as { __DEV__?: boolean }).__DEV__ = false;
            mockEnv.APP_URL = "http://localhost:3000";
            delete process.env.EXPO_PUBLIC_CRYPTEX_E2E;
            const url = "http://localhost:3000/turnstile/mobile?action=auth_register";
            expect(assertTurnstileBridgeUrlAllowed(url)).toBe(false);
            process.env.EXPO_PUBLIC_CRYPTEX_E2E = "1";
            expect(assertTurnstileBridgeUrlAllowed(url)).toBe(true);
            expect(assertTurnstileBridgeUrlAllowed(url.replace(":3000", ":3300"))).toBe(false);
            expect(assertTurnstileBridgeUrlAllowed(url.replace("/turnstile/mobile", "/other"))).toBe(false);
            mockEnv.APP_URL = "http://review.local";
            expect(assertTurnstileBridgeUrlAllowed("http://review.local/turnstile/mobile?action=auth_register")).toBe(false);
            expect(isAllowedTurnstileNavigationUrl("http://challenges.cloudflare.com/challenge")).toBe(false);
        } finally {
            mockEnv.APP_URL = previousOrigin;
            (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
            if (previousFlag === undefined) delete process.env.EXPO_PUBLIC_CRYPTEX_E2E;
            else process.env.EXPO_PUBLIC_CRYPTEX_E2E = previousFlag;
        }
    });

    it("accepts modern origin-only and legacy full-URL message sources", () => {
        const bridgeUrl =
            "https://app.example.com/turnstile/mobile?nonce=abcdef0123456789&action=auth_register";

        expect(
            isAllowedTurnstileMessageSource(
                "https://app.example.com",
                bridgeUrl,
            ),
        ).toBe(true);
        expect(
            isAllowedTurnstileMessageSource(bridgeUrl, bridgeUrl),
        ).toBe(true);
        expect(
            isAllowedTurnstileMessageSource(
                "https://evil.example.com",
                bridgeUrl,
            ),
        ).toBe(false);
        expect(
            isAllowedTurnstileMessageSource(
                "https://app.example.com/other",
                bridgeUrl,
            ),
        ).toBe(false);
        expect(
            isAllowedTurnstileMessageSource("not a URL", bridgeUrl),
        ).toBe(false);
    });

    it("creates a hex nonce of expected length", () => {
        const nonce = createTurnstileInstanceNonce();
        expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    });

    it("parses allowlisted bridge messages and rejects garbage", () => {
        expect(
            parseTurnstileBridgeMessage(
                JSON.stringify({
                    type: "ready",
                    instanceNonce: "abcdef0123456789",
                }),
            ),
        ).toEqual({
            type: "ready",
            instanceNonce: "abcdef0123456789",
        });

        expect(
            parseTurnstileBridgeMessage(
                JSON.stringify({
                    type: "success",
                    instanceNonce: "abcdef0123456789",
                    token: "tok",
                }),
            ),
        ).toEqual({
            type: "success",
            instanceNonce: "abcdef0123456789",
            token: "tok",
        });

        expect(parseTurnstileBridgeMessage("{not-json")).toBeNull();
        expect(
            parseTurnstileBridgeMessage(
                JSON.stringify({ type: "success", instanceNonce: "short" }),
            ),
        ).toBeNull();
    });

    it("allowlists bridge HTTPS origin/path and Cloudflare challenge hosts over HTTPS only", () => {
        expect(
            assertTurnstileBridgeUrlAllowed(
                "https://evil.example.com/turnstile/mobile?nonce=abcdef0123456789&action=auth_register",
            ),
        ).toBe(false);
        expect(
            assertTurnstileBridgeUrlAllowed(
                "https://app.example.com/other?nonce=abcdef0123456789&action=auth_register",
            ),
        ).toBe(false);
        expect(
            isAllowedTurnstileNavigationUrl(
                "https://challenges.cloudflare.com/cdn-cgi/challenge",
            ),
        ).toBe(true);
        expect(
            isAllowedTurnstileNavigationUrl(
                "http://challenges.cloudflare.com/cdn-cgi/challenge",
            ),
        ).toBe(false);
        expect(isAllowedTurnstileNavigationUrl("about:blank")).toBe(true);
        expect(isAllowedTurnstileNavigationUrl("https://evil.example/x")).toBe(
            false,
        );
    });
});
