/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { validateProductionEnv } from "../src/utils/production-env";

const production = {
    VITE_APP_URL: "https://cryptex-vault.com",
    VITE_PUSHER_APP_ID: "production-app",
    VITE_PUSHER_APP_KEY: "public-app-key",
    VITE_PUSHER_APP_HOST: "signaling.cryptex-vault.com",
    VITE_PUSHER_APP_PORT: "443",
    VITE_PUSHER_APP_TLS: "true",
};

describe("production extension configuration", () => {
    it("accepts production settings with optional values omitted", () => {
        expect(() => validateProductionEnv(production)).not.toThrow();
    });

    it("accepts custom ports and explicit cloud settings", () => {
        expect(() =>
            validateProductionEnv({
                ...production,
                VITE_APP_URL: "https://app.example.com:8443/",
                VITE_PUSHER_APP_PORT: "6001",
                VITE_PUSHER_APP_TLS: "FALSE",
                VITE_CLOUD_ENABLED: "false",
                VITE_ONLINE_SERVICES_API_URL: "https://cloud.example.com",
            }),
        ).not.toThrow();
    });

    it.each([
        ["VITE_PUSHER_APP_KEY", undefined],
        ["VITE_PUSHER_APP_ID", "REPLACE_ME"],
        ["VITE_PUSHER_APP_KEY", " public-app-key "],
        ["VITE_APP_URL", "https://"],
        ["VITE_APP_URL", "http://example.com"],
        ["VITE_APP_URL", "https://user:password@example.com"],
        ["VITE_APP_URL", "https://example.com/api"],
        ["VITE_ONLINE_SERVICES_API_URL", "http://cloud.example.com"],
        ["VITE_PUSHER_APP_HOST", "https://signaling.example.com"],
        ["VITE_PUSHER_APP_HOST", "signaling.example.com:443"],
        ["VITE_PUSHER_APP_PORT", "not-a-port"],
        ["VITE_PUSHER_APP_PORT", "0"],
        ["VITE_PUSHER_APP_PORT", "65536"],
        ["VITE_PUSHER_APP_TLS", undefined],
        ["VITE_PUSHER_APP_TLS", "tru"],
        ["VITE_CLOUD_ENABLED", "yes"],
    ] as const)("rejects %s=%s", (key, value) => {
        expect(() =>
            validateProductionEnv({ ...production, [key]: value }),
        ).toThrow(key);
    });
});
