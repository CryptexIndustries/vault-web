/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/env/public", () => ({
    env: {
        NEXT_PUBLIC_PUSHER_APP_KEY: "test-key",
        NEXT_PUBLIC_PUSHER_APP_HOST: "localhost",
        NEXT_PUBLIC_PUSHER_APP_PORT: "6001",
        NEXT_PUBLIC_PUSHER_APP_TLS: false,
    },
}));

const ensureFresh = jest.fn(async () => true);
const initWebRTC = jest.fn(async () => ({
    close: jest.fn(),
    onconnectionstatechange: null,
    ondatachannel: null,
    onicecandidate: null,
    createDataChannel: jest.fn(),
    createOffer: jest.fn(),
    setLocalDescription: jest.fn(),
    setRemoteDescription: jest.fn(),
    addIceCandidate: jest.fn(),
    connectionState: "new",
}));

jest.mock("../src/app_lib/online-services-session", () => ({
    onlineServicesSessionPort: {
        ensureFresh,
        forceReauthenticate: jest.fn(async () => false),
    },
}));

jest.mock("@cryptex-industries/vault-core/synchronization", () => ({
    initWebRTC,
    initPusherInstance: jest.fn(() => {
        const channel = {
            bind: jest.fn(),
            unbind: jest.fn(),
            trigger: jest.fn(),
        };
        return {
            subscribe: jest.fn(() => channel),
            disconnect: jest.fn(),
            unbind: jest.fn(),
            connection: {
                bind: jest.fn(),
            },
        };
    }),
}));

jest.mock("@cryptex-industries/vault-core/presence", () => ({
    constructLinkPresenceChannelName: jest.fn((id: string) => `presence-${id}`),
}));

import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { LinkingProcessController } from "@cryptex-industries/vault-core/vault-utils/linking";
import { configureTestVaultCoreRuntime } from "./helpers/vault-core-runtime";

configureTestVaultCoreRuntime();

describe("LinkingProcessController Online Services bootstrap", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("creates controller for Online Services packages with empty TURN servers", async () => {
        const linkingBlob = VaultUtilTypes.LinkingPackageBlob.create({
            SyncID: "sync_rel_1",
            STUNServers: [],
            TURNServers: [],
            SignalingServer: undefined,
            SenderKeyBundle: {
                SyncSigningPublicKey: "sender-sign-pub",
                SyncKemPublicKey: "sender-kem-pub",
            },
        });

        const result = await LinkingProcessController.create(
            linkingBlob,
            true,
            {
                signingPublicKey: "local-sign-pub",
                signingPrivateKey: "local-sign-priv",
                kemPublicKey: "local-kem-pub",
                kemPrivateKey: "local-kem-priv",
            },
            "mnemonic words here",
            async () => {},
        );

        expect(result.isOk()).toBe(true);
        expect(initWebRTC).toHaveBeenCalledWith([], [], {
            syncId: "sync_rel_1",
        });
    });
});
