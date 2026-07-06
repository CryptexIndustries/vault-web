/**
 * @jest-environment jsdom
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("../src/env/client.mjs", () => ({
    env: {
        NEXT_PUBLIC_PUSHER_APP_KEY: "test-key",
        NEXT_PUBLIC_PUSHER_APP_HOST: "localhost",
        NEXT_PUBLIC_PUSHER_APP_PORT: "6001",
        NEXT_PUBLIC_PUSHER_APP_TLS: false,
    },
}));

const turnCredentialsMutate = jest.fn(async () => ({
    iceServers: [
        {
            urls: "turn:issued.example.com:5349",
            username: "issued-user",
            credential: "issued-cred",
        },
    ],
    expiresAt: Date.now() + 300_000,
}));
const ensureFresh = jest.fn(async () => true);
const forceReauthenticate = jest.fn(async () => false);

jest.mock("../src/utils/trpc", () => ({
    trpc: {
        v1: {
            device: {
                turnCredentials: {
                    mutate: turnCredentialsMutate,
                },
            },
        },
    },
}));

jest.mock("../src/app_lib/online-services-session", () => ({
    onlineServicesSessionPort: {
        ensureFresh,
        forceReauthenticate,
    },
}));

import { initWebRTC } from "../src/app_lib/synchronization";

describe("initWebRTC", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        ensureFresh.mockResolvedValue(true);
        forceReauthenticate.mockResolvedValue(false);
    });

    it("fetches Online Services TURN credentials when no custom servers are configured", async () => {
        const rtcConstructor = jest.fn(function FakeRTC(
            config: RTCConfiguration,
        ) {
            return {
                close: jest.fn(),
                iceServers: config.iceServers,
            };
        });
        const original = globalThis.RTCPeerConnection;
        globalThis.RTCPeerConnection =
            rtcConstructor as unknown as typeof RTCPeerConnection;

        try {
            await initWebRTC([], [], { syncId: "sync_rel_1" });

            expect(ensureFresh).toHaveBeenCalled();
            expect(turnCredentialsMutate).toHaveBeenCalledWith({
                syncId: "sync_rel_1",
            });
            expect(rtcConstructor).toHaveBeenCalledWith({
                iceServers: [
                    {
                        urls: "turn:issued.example.com:5349",
                        username: "issued-user",
                        credential: "issued-cred",
                    },
                ],
            });
        } finally {
            globalThis.RTCPeerConnection = original;
        }
    });

    it("uses custom TURN servers without calling turnCredentials", async () => {
        const rtcConstructor = jest.fn(function FakeRTC(
            config: RTCConfiguration,
        ) {
            return {
                close: jest.fn(),
                iceServers: config.iceServers,
            };
        });
        const original = globalThis.RTCPeerConnection;
        globalThis.RTCPeerConnection =
            rtcConstructor as unknown as typeof RTCPeerConnection;

        try {
            await initWebRTC(
                [],
                [
                    {
                        ID: "turn-1",
                        Name: "Custom",
                        Host: "turn.custom.example:5349",
                        Username: "custom-user",
                        Password: "custom-pass",
                        Version: 1,
                    },
                ],
            );

            expect(ensureFresh).not.toHaveBeenCalled();
            expect(turnCredentialsMutate).not.toHaveBeenCalled();
            expect(rtcConstructor).toHaveBeenCalledWith({
                iceServers: [
                    {
                        urls: "turn:turn.custom.example:5349",
                        username: "custom-user",
                        credential: "custom-pass",
                    },
                ],
            });
        } finally {
            globalThis.RTCPeerConnection = original;
        }
    });

    it("uses custom STUN/TURN servers without calling Online Services", async () => {
        const rtcConstructor = jest.fn(function FakeRTC(
            config: RTCConfiguration,
        ) {
            return {
                close: jest.fn(),
                iceServers: config.iceServers,
            };
        });
        const original = globalThis.RTCPeerConnection;
        globalThis.RTCPeerConnection =
            rtcConstructor as unknown as typeof RTCPeerConnection;

        try {
            await initWebRTC(
                [
                    {
                        ID: "stun-1",
                        Name: "Custom STUN",
                        Host: "stun.custom.example:3478",
                        Version: 1,
                    },
                ],
                [
                    {
                        ID: "turn-1",
                        Name: "Custom TURN",
                        Host: "turn.custom.example:5349",
                        Username: "custom-user",
                        Password: "custom-pass",
                        Version: 1,
                    },
                ],
            );

            expect(ensureFresh).not.toHaveBeenCalled();
            expect(turnCredentialsMutate).not.toHaveBeenCalled();
            expect(rtcConstructor).toHaveBeenCalledWith({
                iceServers: [
                    {
                        urls: "stun:stun.custom.example:3478",
                    },
                    {
                        urls: "turn:turn.custom.example:5349",
                        username: "custom-user",
                        credential: "custom-pass",
                    },
                ],
            });
        } finally {
            globalThis.RTCPeerConnection = original;
        }
    });

    it("propagates turnCredentials failure when reauthentication fails", async () => {
        const unauthorized = new Error("UNAUTHORIZED");
        turnCredentialsMutate.mockRejectedValueOnce(unauthorized);
        forceReauthenticate.mockResolvedValueOnce(false);

        await expect(
            initWebRTC([], [], { syncId: "sync_rel_1" }),
        ).rejects.toThrow("UNAUTHORIZED");

        expect(turnCredentialsMutate).toHaveBeenCalledTimes(1);
        expect(forceReauthenticate).toHaveBeenCalledTimes(1);
    });

    it("retries turnCredentials after successful reauthentication", async () => {
        turnCredentialsMutate
            .mockRejectedValueOnce(new Error("UNAUTHORIZED"))
            .mockResolvedValueOnce({
                iceServers: [
                    {
                        urls: "turn:retry.example.com:5349",
                        username: "retry-user",
                        credential: "retry-cred",
                    },
                ],
                expiresAt: Date.now() + 300_000,
            });
        forceReauthenticate.mockResolvedValueOnce(true);

        const rtcConstructor = jest.fn(function FakeRTC(
            config: RTCConfiguration,
        ) {
            return {
                close: jest.fn(),
                iceServers: config.iceServers,
            };
        });
        const original = globalThis.RTCPeerConnection;
        globalThis.RTCPeerConnection =
            rtcConstructor as unknown as typeof RTCPeerConnection;

        try {
            await initWebRTC([], [], { syncId: "sync_rel_1" });

            expect(turnCredentialsMutate).toHaveBeenCalledTimes(2);
            expect(forceReauthenticate).toHaveBeenCalledTimes(1);
        } finally {
            globalThis.RTCPeerConnection = original;
        }
    });
});
