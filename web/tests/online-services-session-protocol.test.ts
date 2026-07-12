import { beforeEach, describe, expect, it, jest } from "@jest/globals";

if (
    typeof (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64 !==
    "function"
) {
    Object.defineProperty(Uint8Array, "fromBase64", {
        value: (input: string) => new Uint8Array(Buffer.from(input, "base64")),
        writable: true,
        configurable: true,
    });
}

jest.mock("../src/app_lib/vault-utils/passkey", () => ({
    parseJwkFromString: jest.fn(() => ({})),
    signChallenge: jest.fn(async () => "signed-challenge"),
}));

import {
    createForcedReauthGate,
    createRefreshInFlightRunner,
    performOnlineServicesPasskeyAuth,
    refreshOnlineServicesSessionTokens,
    shouldRefreshOnlineServicesSession,
    type OnlineServicesAuthApi,
} from "../src/app_lib/online-services-session/protocol";

describe("online-services-session protocol", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("shouldRefreshOnlineServicesSession respects the lead window", () => {
        const now = 1_000_000;
        expect(shouldRefreshOnlineServicesSession(now + 30_000, now)).toBe(
            true,
        );
        expect(shouldRefreshOnlineServicesSession(now + 120_000, now)).toBe(
            false,
        );
    });

    it("performOnlineServicesPasskeyAuth runs challenge, sign, verify", async () => {
        const challenge: jest.MockedFunction<
            OnlineServicesAuthApi["challenge"]
        > = jest.fn(async () => ({
            challengeId: "ch_1",
            challenge: Buffer.from("abc").toString("base64"),
        }));
        const verify: jest.MockedFunction<OnlineServicesAuthApi["verify"]> =
            jest.fn(async () => ({
                sessionToken: "token_1",
                refreshToken: "refresh_1",
                expiresAt: 2_000_000,
                refreshExpiresAt: 9_000_000,
            }));

        const tokens = await performOnlineServicesPasskeyAuth(
            {
                challenge,
                verify,
                refresh: jest.fn<OnlineServicesAuthApi["refresh"]>(),
            },
            { deviceId: "dev_1", privateKeyJWK: "{}" },
        );

        expect(tokens).toEqual({
            sessionToken: "token_1",
            refreshToken: "refresh_1",
            expiresAt: 2_000_000,
            refreshExpiresAt: 9_000_000,
        });
        expect(challenge).toHaveBeenCalledWith("dev_1");
        expect(verify).toHaveBeenCalledWith({
            challengeId: "ch_1",
            signature: "signed-challenge",
            deviceId: "dev_1",
        });
    });

    it("refreshOnlineServicesSessionTokens returns null on failure", async () => {
        await expect(
            refreshOnlineServicesSessionTokens(
                {
                    challenge: jest.fn<OnlineServicesAuthApi["challenge"]>(),
                    verify: jest.fn<OnlineServicesAuthApi["verify"]>(),
                    refresh: jest.fn(async () => {
                        throw new Error("expired");
                    }),
                },
                "stale",
            ),
        ).resolves.toBeNull();
    });

    it("createRefreshInFlightRunner deduplicates concurrent work", async () => {
        const runner = createRefreshInFlightRunner();
        let runs = 0;

        const first = runner.run(async () => {
            runs += 1;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return true;
        });
        const second = runner.run(async () => {
            runs += 1;
            return false;
        });

        await expect(Promise.all([first, second])).resolves.toEqual([
            true,
            true,
        ]);
        expect(runs).toBe(1);
    });

    it("createForcedReauthGate enforces cooldown", () => {
        const gate = createForcedReauthGate(30_000);

        expect(gate.tryEnter(1_000)).toBe(true);
        expect(gate.tryEnter(2_000)).toBe(false);
        expect(gate.tryEnter(31_500)).toBe(true);
    });
});
