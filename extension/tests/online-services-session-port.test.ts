/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockEnsureFreshOnlineServicesSessionViaSW = jest.fn(async () => true);
const mockForceReauthenticateOnlineServicesSessionViaSW = jest.fn(
    async () => false,
);

jest.mock("../src/utils/online-services-session-client", () => ({
    ensureFreshOnlineServicesSessionViaSW:
        mockEnsureFreshOnlineServicesSessionViaSW,
    forceReauthenticateOnlineServicesSessionViaSW:
        mockForceReauthenticateOnlineServicesSessionViaSW,
}));

import { onlineServicesSessionPort } from "../src/app_lib/online-services-session/extension";

describe("onlineServicesSessionPort (extension)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("delegates ensureFresh to the SW session client", async () => {
        mockEnsureFreshOnlineServicesSessionViaSW.mockResolvedValueOnce(true);

        await expect(onlineServicesSessionPort.ensureFresh()).resolves.toBe(
            true,
        );
        expect(mockEnsureFreshOnlineServicesSessionViaSW).toHaveBeenCalledTimes(
            1,
        );
    });

    it("delegates forceReauthenticate to the SW session client", async () => {
        mockForceReauthenticateOnlineServicesSessionViaSW.mockResolvedValueOnce(
            true,
        );

        await expect(
            onlineServicesSessionPort.forceReauthenticate(),
        ).resolves.toBe(true);
        expect(
            mockForceReauthenticateOnlineServicesSessionViaSW,
        ).toHaveBeenCalledTimes(1);
    });
});
