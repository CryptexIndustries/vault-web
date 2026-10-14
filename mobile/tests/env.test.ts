import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import {
    getOnlineServicesApiBaseUrl,
    isCloudServicesEnabled,
} from "@/utils/online-services-api-url";

const fields = [
    "EXPO_PUBLIC_APP_URL",
    "EXPO_PUBLIC_ONLINE_SERVICES_API_URL",
    "EXPO_PUBLIC_CLOUD_ENABLED",
] as const;
let previous: Array<string | undefined>;

beforeEach(() => {
    previous = fields.map((field) => process.env[field]);
    fields.forEach((field) => delete process.env[field]);
});

afterEach(() => {
    fields.forEach((field, index) => {
        const value = previous[index];
        if (value === undefined) delete process.env[field];
        else process.env[field] = value;
    });
});

describe("mobile Online Services configuration", () => {
    it("falls back to the app URL and strips trailing slashes", () => {
        expect(getOnlineServicesApiBaseUrl()).toBe("http://localhost:3000");
        process.env.EXPO_PUBLIC_APP_URL = "https://app.example.com///";
        expect(getOnlineServicesApiBaseUrl()).toBe("https://app.example.com");
        process.env.EXPO_PUBLIC_ONLINE_SERVICES_API_URL = "";
        expect(getOnlineServicesApiBaseUrl()).toBe("https://app.example.com");
    });

    it("uses an explicit API URL independently of cloud enablement", () => {
        process.env.EXPO_PUBLIC_APP_URL = "https://app.example.com";
        process.env.EXPO_PUBLIC_ONLINE_SERVICES_API_URL =
            "https://api.example.com///";
        process.env.EXPO_PUBLIC_CLOUD_ENABLED = "false";
        expect(getOnlineServicesApiBaseUrl()).toBe("https://api.example.com");
        expect(isCloudServicesEnabled()).toBe(false);
    });

    it("enables cloud by default and disables it only for false", () => {
        expect(isCloudServicesEnabled()).toBe(true);
        process.env.EXPO_PUBLIC_CLOUD_ENABLED = "FALSE";
        expect(isCloudServicesEnabled()).toBe(false);
        process.env.EXPO_PUBLIC_CLOUD_ENABLED = "true";
        expect(isCloudServicesEnabled()).toBe(true);
        process.env.EXPO_PUBLIC_CLOUD_ENABLED = "";
        expect(isCloudServicesEnabled()).toBe(true);
    });
});
