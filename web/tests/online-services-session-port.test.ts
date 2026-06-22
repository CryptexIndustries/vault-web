/**
 * @jest-environment jsdom
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const ensureFreshOnlineServicesSession = jest.fn(async () => true);
const forceOnlineServicesSessionReauthentication = jest.fn(async () => false);

jest.mock("../src/app_lib/auth-session", () => ({
    ensureFreshOnlineServicesSession,
    forceOnlineServicesSessionReauthentication,
}));

import { onlineServicesSessionPort } from "../src/app_lib/online-services-session/web";

describe("onlineServicesSessionPort (web)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("delegates ensureFresh to auth-session", async () => {
        ensureFreshOnlineServicesSession.mockResolvedValueOnce(true);

        await expect(onlineServicesSessionPort.ensureFresh()).resolves.toBe(
            true,
        );
        expect(ensureFreshOnlineServicesSession).toHaveBeenCalledTimes(1);
    });

    it("delegates forceReauthenticate to auth-session", async () => {
        forceOnlineServicesSessionReauthentication.mockResolvedValueOnce(true);

        await expect(
            onlineServicesSessionPort.forceReauthenticate(),
        ).resolves.toBe(true);
        expect(
            forceOnlineServicesSessionReauthentication,
        ).toHaveBeenCalledTimes(1);
    });
});
