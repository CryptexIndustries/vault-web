import { describe, expect, it } from "@jest/globals";
import {
    createContentSecurityPolicy,
    turnstileMobileContentSecurityPolicy,
} from "../../src/env/content-security-policy";
import { createRuntimeConfigScript } from "../../src/env/runtime-config-script";

const cloudEnv = {
    NEXT_PUBLIC_APP_URL: "https://vault.example.test/app",
    NEXT_PUBLIC_CLOUD_ENABLED: true,
    NEXT_PUBLIC_ONLINE_SERVICES_API_URL: "https://cloud.example.test/trpc/path",
    NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN:
        "https://objects.example.test/bucket/path",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "turnstile-site-key",
    NEXT_PUBLIC_PUSHER_APP_ID: "pusher-app-id",
    NEXT_PUBLIC_PUSHER_APP_KEY: "pusher-app-key",
    NEXT_PUBLIC_PUSHER_APP_HOST: "pusher.example.test",
    NEXT_PUBLIC_PUSHER_APP_PORT: "443",
    NEXT_PUBLIC_PUSHER_APP_TLS: true,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_runtime",
    NEXT_PUBLIC_STRIPE_PREMIUM_PRODUCT_ID: "prod_runtime",
    NEXT_PUBLIC_STRIPE_PREMIUM_MONTHLY_PRICE_ID: "price_monthly_runtime",
    NEXT_PUBLIC_STRIPE_PREMIUM_YEARLY_PRICE_ID: "price_yearly_runtime",
};

describe("runtime client configuration", () => {
    it("adds only normalized runtime origins to the cloud CSP", () => {
        const policy = createContentSecurityPolicy(cloudEnv);

        expect(policy).toContain("https://cloud.example.test");
        expect(policy).toContain("https://objects.example.test");
        expect(policy).not.toContain("/trpc/path");
        expect(policy).not.toContain("/bucket/path");
    });

    it("does not allow cloud origins when online services are disabled", () => {
        const policy = createContentSecurityPolicy({
            ...cloudEnv,
            NEXT_PUBLIC_CLOUD_ENABLED: false,
        });

        expect(policy).not.toContain("cloud.example.test");
        expect(policy).not.toContain("objects.example.test");
    });

    it("keeps the mobile Turnstile bridge isolated from application APIs", () => {
        expect(turnstileMobileContentSecurityPolicy).toContain(
            "https://challenges.cloudflare.com",
        );
        expect(turnstileMobileContentSecurityPolicy).not.toContain(
            "https://api.stripe.com",
        );
        expect(turnstileMobileContentSecurityPolicy).not.toContain(
            "cloud.example.test",
        );
    });

    it("serializes hostile values without creating executable markup", () => {
        const script = createRuntimeConfigScript({
            value: "</script><script>alert('xss')</script>&\u2028",
        });

        expect(script).not.toContain("</script>");
        expect(script).not.toContain("<script>");
        expect(script).toContain("\\u003c/script\\u003e");

        const assignedValue = JSON.parse(
            script.slice(
                "globalThis.__CRYPTEX_RUNTIME_CONFIG__=Object.freeze(".length,
                -3,
            ),
        );
        expect(assignedValue).toEqual({
            value: "</script><script>alert('xss')</script>&\u2028",
        });
    });
});
