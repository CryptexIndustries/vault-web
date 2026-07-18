/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type SessionTokens = {
    sessionToken: string;
    refreshToken: string;
    expiresAt: number;
    refreshExpiresAt: number;
};

type ChallengeResult = {
    challengeId: string;
    challenge: string;
};

const challengeMutate =
    jest.fn<(input: { deviceId: string }) => Promise<ChallengeResult>>();
const verifyMutate =
    jest.fn<
        (input: {
            challengeId: string;
            signature: string;
            deviceId: string;
        }) => Promise<SessionTokens>
    >();
const refreshMutate =
    jest.fn<(input: { refreshToken: string }) => Promise<SessionTokens>>();
const logoutMutate =
    jest.fn<(input: { refreshToken?: string }) => Promise<{ success: true }>>();

jest.mock("@trpc/client", () => ({
    createTRPCClient: jest.fn(() => ({
        v1: {
            auth: {
                challenge: { mutate: challengeMutate },
                verify: { mutate: verifyMutate },
                refresh: { mutate: refreshMutate },
                logout: { mutate: logoutMutate },
            },
        },
    })),
    httpBatchLink: jest.fn(() => ({})),
}));

jest.mock("../src/env", () => ({
    env: {
        NEXT_PUBLIC_APP_URL: "https://app.example.test",
        NEXT_PUBLIC_ONLINE_SERVICES_API_URL: "https://api.example.test",
        NEXT_PUBLIC_CLOUD_ENABLED: true,
    },
}));

jest.mock("@/app_lib/vault-utils/device-signing-key", () => ({
    parseJwkFromString: jest.fn(() => ({ kty: "EC" })),
    signChallenge: jest.fn(async () => "signed-challenge"),
}));

const sessionStorage = new Map<string, unknown>();

Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
        storage: {
            session: {
                get: jest.fn(async (keys?: string | string[]) => {
                    const requested =
                        typeof keys === "string"
                            ? [keys]
                            : Array.isArray(keys)
                              ? keys
                              : [...sessionStorage.keys()];

                    return Object.fromEntries(
                        requested
                            .filter((key) => sessionStorage.has(key))
                            .map((key) => [key, sessionStorage.get(key)]),
                    );
                }),
                set: jest.fn(async (values: Record<string, unknown>) => {
                    Object.entries(values).forEach(([key, value]) => {
                        sessionStorage.set(key, value);
                    });
                }),
                remove: jest.fn(async (keys: string | string[]) => {
                    const requested = typeof keys === "string" ? [keys] : keys;
                    requested.forEach((key) => sessionStorage.delete(key));
                }),
            },
        },
    },
});

if (
    typeof (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64 !==
    "function"
) {
    Object.defineProperty(Uint8Array, "fromBase64", {
        configurable: true,
        value: (input: string) => new Uint8Array(Buffer.from(input, "base64")),
    });
}

import {
    allowOnlineServicesSessionEstablishment,
    ensureFreshOnlineServicesSession,
    ensureOnlineServicesSessionFromUnlockedVault,
    establishOnlineServicesSession,
    logoutOnlineServicesSession,
} from "../src/app_lib/auth-session-ext";
import {
    getOnlineServicesSession,
    setOnlineServicesSession,
} from "../src/utils/online-services-session-storage";
import {
    parseJwkFromString,
    signChallenge,
} from "../../web/src/app_lib/vault-utils/device-signing-key";

const mockParseJwkFromString = parseJwkFromString as jest.MockedFunction<
    typeof parseJwkFromString
>;
const mockSignChallenge = signChallenge as jest.MockedFunction<
    typeof signChallenge
>;

function tokens(suffix: string): SessionTokens {
    return {
        sessionToken: `session_${suffix}`,
        refreshToken: `refresh_${suffix}`,
        expiresAt: Date.now() + 15 * 60_000,
        refreshExpiresAt: Date.now() + 7 * 24 * 60 * 60_000,
    };
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
} {
    let resolve = (_value: T): void => undefined;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

async function waitUntil(assertion: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (assertion()) return;
        await Promise.resolve();
    }
    throw new Error("Expected asynchronous operation was not reached");
}

describe("service-worker online-services auth lifecycle", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sessionStorage.clear();
        allowOnlineServicesSessionEstablishment();
        challengeMutate.mockResolvedValue({
            challengeId: "challenge_1",
            challenge: Buffer.from("challenge-bytes").toString("base64"),
        });
        verifyMutate.mockResolvedValue(tokens("verified"));
        logoutMutate.mockResolvedValue({ success: true });
        mockParseJwkFromString.mockReturnValue({ kty: "EC" });
        mockSignChallenge.mockResolvedValue("signed-challenge");
    });

    it("establishes a session through challenge/verify and stores all credentials", async () => {
        await expect(
            establishOnlineServicesSession({
                deviceId: "device_1",
                privateKeyJWK: "private_jwk_1",
            }),
        ).resolves.toEqual({ ok: true });

        expect(challengeMutate).toHaveBeenCalledWith({ deviceId: "device_1" });
        expect(mockParseJwkFromString).toHaveBeenCalledWith("private_jwk_1");
        expect(mockSignChallenge).toHaveBeenCalledTimes(1);
        expect(verifyMutate).toHaveBeenCalledWith({
            challengeId: "challenge_1",
            signature: "signed-challenge",
            deviceId: "device_1",
        });
        await expect(getOnlineServicesSession()).resolves.toEqual({
            sessionToken: "session_verified",
            sessionExpiresAt: expect.any(Number),
            refreshToken: "refresh_verified",
            refreshExpiresAt: expect.any(Number),
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
    });

    it("lazily refreshes a near-expiry token and persists the rotated pair", async () => {
        await setOnlineServicesSession({
            sessionToken: "session_old",
            sessionExpiresAt: Date.now() + 10_000,
            refreshToken: "refresh_old",
            refreshExpiresAt: Date.now() + 7 * 24 * 60 * 60_000,
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
        refreshMutate.mockResolvedValue(tokens("rotated"));

        await expect(ensureFreshOnlineServicesSession()).resolves.toBe(true);

        expect(refreshMutate).toHaveBeenCalledWith({
            refreshToken: "refresh_old",
        });
        expect(challengeMutate).not.toHaveBeenCalled();
        await expect(getOnlineServicesSession()).resolves.toMatchObject({
            sessionToken: "session_rotated",
            refreshToken: "refresh_rotated",
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
    });

    it("rotates a near-expiry refresh token even while the access token is fresh", async () => {
        await setOnlineServicesSession({
            sessionToken: "session_fresh",
            sessionExpiresAt: Date.now() + 10 * 60_000,
            refreshToken: "refresh_near_expiry",
            refreshExpiresAt: Date.now() + 10_000,
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
        refreshMutate.mockResolvedValue(tokens("proactively_rotated"));

        await expect(ensureFreshOnlineServicesSession()).resolves.toBe(true);

        expect(refreshMutate).toHaveBeenCalledWith({
            refreshToken: "refresh_near_expiry",
        });
        expect(challengeMutate).not.toHaveBeenCalled();
        await expect(getOnlineServicesSession()).resolves.toMatchObject({
            sessionToken: "session_proactively_rotated",
            refreshToken: "refresh_proactively_rotated",
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
    });

    it("recovers a missing access token by using the stored refresh token", async () => {
        await setOnlineServicesSession({
            sessionToken: null,
            sessionExpiresAt: null,
            refreshToken: "refresh_surviving",
            refreshExpiresAt: Date.now() + 7 * 24 * 60 * 60_000,
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
        refreshMutate.mockResolvedValue(tokens("recovered"));

        await expect(ensureFreshOnlineServicesSession()).resolves.toBe(true);

        expect(refreshMutate).toHaveBeenCalledWith({
            refreshToken: "refresh_surviving",
        });
        expect(challengeMutate).not.toHaveBeenCalled();
        await expect(getOnlineServicesSession()).resolves.toMatchObject({
            sessionToken: "session_recovered",
            refreshToken: "refresh_recovered",
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
    });

    it("accepts a fresh session without making an auth network call", async () => {
        await setOnlineServicesSession({
            sessionToken: "session_fresh",
            sessionExpiresAt: Date.now() + 10 * 60_000,
            refreshToken: "refresh_fresh",
            refreshExpiresAt: Date.now() + 7 * 24 * 60 * 60_000,
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });

        await expect(ensureFreshOnlineServicesSession()).resolves.toBe(true);

        expect(challengeMutate).not.toHaveBeenCalled();
        expect(verifyMutate).not.toHaveBeenCalled();
        expect(refreshMutate).not.toHaveBeenCalled();
        expect(logoutMutate).not.toHaveBeenCalled();
    });

    it("revokes a cached session for another device and establishes the unlocked vault device", async () => {
        sessionStorage.set("UV", {
            OnlineServices: {
                DeviceId: "device_unlocked",
                PrivateKeyJWK: "private_jwk_unlocked",
            },
        });
        await setOnlineServicesSession({
            sessionToken: "session_old_device",
            sessionExpiresAt: Date.now() + 10 * 60_000,
            refreshToken: "refresh_old_device",
            refreshExpiresAt: Date.now() + 7 * 24 * 60 * 60_000,
            deviceId: "device_old",
            privateKeyJWK: "private_jwk_old",
        });
        verifyMutate.mockResolvedValue(tokens("unlocked_device"));

        await expect(ensureFreshOnlineServicesSession()).resolves.toBe(true);

        expect(logoutMutate).toHaveBeenCalledWith({
            refreshToken: "refresh_old_device",
        });
        expect(challengeMutate).toHaveBeenCalledWith({
            deviceId: "device_unlocked",
        });
        expect(mockParseJwkFromString).toHaveBeenCalledWith(
            "private_jwk_unlocked",
        );
        await expect(getOnlineServicesSession()).resolves.toMatchObject({
            sessionToken: "session_unlocked_device",
            refreshToken: "refresh_unlocked_device",
            deviceId: "device_unlocked",
            privateKeyJWK: "private_jwk_unlocked",
        });
    });

    it("clears a stale session when the unlocked vault is not bound to online services", async () => {
        sessionStorage.set("UV", {});
        await setOnlineServicesSession({
            sessionToken: "session_stale",
            sessionExpiresAt: Date.now() + 10 * 60_000,
            refreshToken: "refresh_stale",
            refreshExpiresAt: Date.now() + 7 * 24 * 60 * 60_000,
            deviceId: "device_stale",
            privateKeyJWK: "private_jwk_stale",
        });

        await expect(
            ensureOnlineServicesSessionFromUnlockedVault(),
        ).resolves.toBe(false);

        expect(logoutMutate).toHaveBeenCalledWith({
            refreshToken: "refresh_stale",
        });
        expect(challengeMutate).not.toHaveBeenCalled();
        expect(verifyMutate).not.toHaveBeenCalled();
        await expect(getOnlineServicesSession()).resolves.toMatchObject({
            sessionToken: null,
            refreshToken: null,
            deviceId: null,
            privateKeyJWK: null,
        });
    });

    it("falls back to stored device signing key credentials when refresh is rejected", async () => {
        await setOnlineServicesSession({
            sessionToken: "session_old",
            sessionExpiresAt: Date.now() + 10_000,
            refreshToken: "refresh_old",
            refreshExpiresAt: Date.now() + 7 * 24 * 60 * 60_000,
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
        refreshMutate.mockRejectedValue(new Error("refresh expired"));
        verifyMutate.mockResolvedValue(tokens("reauthenticated"));

        await expect(ensureFreshOnlineServicesSession()).resolves.toBe(true);

        expect(refreshMutate).toHaveBeenCalledWith({
            refreshToken: "refresh_old",
        });
        expect(challengeMutate).toHaveBeenCalledWith({ deviceId: "device_1" });
        await expect(getOnlineServicesSession()).resolves.toMatchObject({
            sessionToken: "session_reauthenticated",
            refreshToken: "refresh_reauthenticated",
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
    });

    it("deduplicates concurrent lazy refresh attempts", async () => {
        await setOnlineServicesSession({
            sessionToken: "session_old",
            sessionExpiresAt: Date.now() + 10_000,
            refreshToken: "refresh_old",
            refreshExpiresAt: Date.now() + 7 * 24 * 60 * 60_000,
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
        const pendingRefresh = deferred<SessionTokens>();
        refreshMutate.mockReturnValue(pendingRefresh.promise);

        const first = ensureFreshOnlineServicesSession();
        const second = ensureFreshOnlineServicesSession();

        await waitUntil(() => refreshMutate.mock.calls.length === 1);
        expect(refreshMutate).toHaveBeenCalledTimes(1);

        pendingRefresh.resolve(tokens("single_flight"));
        await expect(Promise.all([first, second])).resolves.toEqual([
            true,
            true,
        ]);
        expect(refreshMutate).toHaveBeenCalledTimes(1);
    });

    it("clears local auth before revoking the captured remote session", async () => {
        await setOnlineServicesSession({
            sessionToken: "session_active",
            sessionExpiresAt: Date.now() + 10 * 60_000,
            refreshToken: "refresh_active",
            refreshExpiresAt: Date.now() + 7 * 24 * 60 * 60_000,
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
        logoutMutate.mockImplementationOnce(async () => {
            await expect(getOnlineServicesSession()).resolves.toMatchObject({
                sessionToken: null,
                refreshToken: null,
            });
            return { success: true };
        });

        await logoutOnlineServicesSession();

        expect(logoutMutate).toHaveBeenCalledWith({
            refreshToken: "refresh_active",
        });
        await expect(getOnlineServicesSession()).resolves.toEqual({
            sessionToken: null,
            sessionExpiresAt: null,
            refreshToken: null,
            refreshExpiresAt: null,
            deviceId: null,
            privateKeyJWK: null,
        });
    });

    it("clears the local session when remote logout fails", async () => {
        await setOnlineServicesSession({
            sessionToken: "session_offline",
            sessionExpiresAt: Date.now() + 10 * 60_000,
            refreshToken: "refresh_offline",
            refreshExpiresAt: Date.now() + 7 * 24 * 60 * 60_000,
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
        logoutMutate.mockRejectedValue(new Error("network unavailable"));

        await expect(logoutOnlineServicesSession()).resolves.toBeUndefined();

        expect(logoutMutate).toHaveBeenCalledWith({
            refreshToken: "refresh_offline",
        });
        await expect(getOnlineServicesSession()).resolves.toEqual({
            sessionToken: null,
            sessionExpiresAt: null,
            refreshToken: null,
            refreshExpiresAt: null,
            deviceId: null,
            privateKeyJWK: null,
        });
    });

    it("does not restore a session when initial verification finishes after logout", async () => {
        const pendingVerify = deferred<SessionTokens>();
        verifyMutate.mockReturnValue(pendingVerify.promise);

        const establishing = establishOnlineServicesSession({
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
        await waitUntil(() => verifyMutate.mock.calls.length === 1);

        await logoutOnlineServicesSession();
        pendingVerify.resolve(tokens("too_late"));
        await establishing;

        await expect(getOnlineServicesSession()).resolves.toMatchObject({
            sessionToken: null,
            refreshToken: null,
            deviceId: null,
            privateKeyJWK: null,
        });
    });

    it("does not restore a refreshed session when refresh finishes after logout", async () => {
        await setOnlineServicesSession({
            sessionToken: "session_old",
            sessionExpiresAt: Date.now() + 10_000,
            refreshToken: "refresh_old",
            refreshExpiresAt: Date.now() + 7 * 24 * 60 * 60_000,
            deviceId: "device_1",
            privateKeyJWK: "private_jwk_1",
        });
        const pendingRefresh = deferred<SessionTokens>();
        refreshMutate.mockReturnValue(pendingRefresh.promise);

        const refreshing = ensureFreshOnlineServicesSession();
        await waitUntil(() => refreshMutate.mock.calls.length === 1);

        await logoutOnlineServicesSession();
        pendingRefresh.resolve(tokens("too_late"));
        await refreshing;

        await expect(getOnlineServicesSession()).resolves.toMatchObject({
            sessionToken: null,
            refreshToken: null,
            deviceId: null,
            privateKeyJWK: null,
        });
    });

    it("only commits the newest of two generation-separated establishments", async () => {
        const firstVerify = deferred<SessionTokens>();
        const secondVerify = deferred<SessionTokens>();
        verifyMutate.mockImplementation(({ deviceId }) => {
            return deviceId === "device_first"
                ? firstVerify.promise
                : secondVerify.promise;
        });

        const first = establishOnlineServicesSession({
            deviceId: "device_first",
            privateKeyJWK: "private_jwk_first",
        });
        await waitUntil(() => verifyMutate.mock.calls.length === 1);

        allowOnlineServicesSessionEstablishment();
        const second = establishOnlineServicesSession({
            deviceId: "device_second",
            privateKeyJWK: "private_jwk_second",
        });
        await waitUntil(() => verifyMutate.mock.calls.length === 2);

        secondVerify.resolve(tokens("second"));
        await expect(second).resolves.toEqual({ ok: true });
        firstVerify.resolve(tokens("first"));
        await expect(first).resolves.toEqual({
            ok: false,
            error: "SESSION_LIFECYCLE_CHANGED",
        });

        await expect(getOnlineServicesSession()).resolves.toMatchObject({
            sessionToken: "session_second",
            refreshToken: "refresh_second",
            deviceId: "device_second",
            privateKeyJWK: "private_jwk_second",
        });
    });
});
