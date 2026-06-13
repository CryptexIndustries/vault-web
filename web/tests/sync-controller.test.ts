/**
 * @jest-environment jsdom
 *
 * Covers SyncConnectionController (the outer class) WebRTC/Pusher orchestration.
 * VaultItemSynchronization is exercised separately in synchronization.test.ts.
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";

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
            urls: "turn:test.example.com:5349",
            username: "test-user",
            credential: "test-cred",
        },
    ],
    expiresAt: Date.now() + 300_000,
}));

jest.mock("../src/utils/trpc", () => ({
    trpc: {
        v1: {
            device: {
                signalingAuthChannel: {
                    query: jest.fn(async () => ({ auth: "stub-auth" })),
                },
                turnCredentials: {
                    mutate: turnCredentialsMutate,
                },
            },
        },
    },
}));

jest.mock("../src/app_lib/auth-session", () => ({
    createBareAuthHeader: jest.fn(() => ({ Authorization: "Bearer token_1" })),
    ensureFreshOnlineServicesSession: jest.fn(async () => true),
}));

jest.mock("pusher", () => ({
    __esModule: true,
    default: class {
        authorizeChannel = jest.fn(() => ({ auth: "stub" }));
    },
}));

const pusherConstructorMock = jest.fn();
jest.mock("pusher-js", () => ({
    __esModule: true,
    default: class {
        public connection = {
            bind: jest.fn(),
            unbind: jest.fn(),
            state: "initialized" as string,
        };
        public allChannels = jest.fn(() => [] as { name: string }[]);
        public subscribe = jest.fn();
        public unsubscribe = jest.fn();
        public unbind_global = jest.fn();
        public unbind = jest.fn();
        public disconnect = jest.fn();
        constructor(...args: unknown[]) {
            pusherConstructorMock(...args);
        }
    },
}));

import * as VaultUtilTypes from "../src/app_lib/proto/vault";
import { SyncConnectionController } from "../src/app_lib/synchronization";
import {
    SignalingStatus,
    SyncConnectionControllerEventType,
    SignalingServerMessageType,
    WebRTCMessageEventType,
    WebRTCStatus,
} from "../src/app_lib/synchronization-utils";

type VaultOps = {
    getItemVersionVectors: jest.MockedFunction<
        () => Promise<VaultUtilTypes.VersionVector[]>
    >;
    getItemCredentials: jest.MockedFunction<
        (ids: string[]) => Promise<VaultUtilTypes.Credential[]>
    >;
    updateCredentials: jest.MockedFunction<
        (cs: VaultUtilTypes.Credential[]) => Promise<void>
    >;
    getSynchronizationConfig: jest.MockedFunction<
        () => Promise<VaultUtilTypes.LinkedDevices>
    >;
};

function buildVaultOps(): VaultOps {
    return {
        getItemVersionVectors: jest.fn(async () => []),
        getItemCredentials: jest.fn(async () => []),
        updateCredentials: jest.fn(async () => undefined),
        getSynchronizationConfig: jest.fn(
            async () =>
                ({
                    Devices: [],
                    SignalingServers: [],
                    STUNServers: [],
                    TURNServers: [],
                }) as unknown as VaultUtilTypes.LinkedDevices,
        ),
    };
}

type FakePusher = {
    connection: {
        bind: jest.Mock;
        unbind: jest.Mock;
        state: string;
    };
    allChannels: jest.Mock;
    subscribe: jest.Mock;
    unsubscribe: jest.Mock;
    unbind: jest.Mock;
    unbind_global: jest.Mock;
    disconnect: jest.Mock;
};

type FakeChannel = {
    name: string;
    bind: jest.Mock;
    unbind: jest.Mock;
    unsubscribe: jest.Mock;
    trigger: jest.Mock;
};

type FakePeer = Partial<RTCPeerConnection> & {
    onconnectionstatechange?: (() => void) | null;
    ondatachannel?: ((e: unknown) => void) | null;
    onicecandidate?: ((e: unknown) => void) | null;
    connectionState: RTCPeerConnectionState;
};

function makeFakePusher(): FakePusher {
    return {
        connection: {
            bind: jest.fn(),
            unbind: jest.fn(),
            state: "initialized",
        },
        allChannels: jest.fn(() => [] as { name: string }[]),
        subscribe: jest.fn(),
        unsubscribe: jest.fn(),
        unbind: jest.fn(),
        unbind_global: jest.fn(),
        disconnect: jest.fn(),
    };
}

function makeFakeChannel(name: string): FakeChannel {
    return {
        name,
        bind: jest.fn(),
        unbind: jest.fn(),
        unsubscribe: jest.fn(),
        trigger: jest.fn(),
    };
}

function makeFakePeer(): FakePeer {
    return {
        connectionState: "new" as RTCPeerConnectionState,
        close: jest.fn(),
        createOffer: jest.fn(async () => ({
            type: "offer" as const,
            sdp: "v=0",
        })),
        createAnswer: jest.fn(async () => ({
            type: "answer" as const,
            sdp: "v=0",
        })),
        setLocalDescription: jest.fn(async () => undefined),
        setRemoteDescription: jest.fn(async () => undefined),
        addIceCandidate: jest.fn(async () => undefined),
        createDataChannel: jest.fn(() => ({
            send: jest.fn(),
            close: jest.fn(),
            label: "data-channel",
        })),
    };
}

function injectInternalState(
    controller: SyncConnectionController,
    overrides: {
        signalingServers?: Map<string, FakePusher>;
        webRTConnections?: Map<
            string,
            { connection: FakePeer; dataChannel: RTCDataChannel | null }
        >;
    },
) {
    const c = controller as unknown as {
        _signalingServers: Map<string, unknown>;
        _webRTConnections: Map<string, unknown>;
    };
    if (overrides.signalingServers) {
        c._signalingServers = overrides.signalingServers as Map<
            string,
            unknown
        >;
    }
    if (overrides.webRTConnections) {
        c._webRTConnections = overrides.webRTConnections as Map<
            string,
            unknown
        >;
    }
}

describe("SyncConnectionController orchestration", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("init logs and teardown clears internal maps", () => {
        const controller = new SyncConnectionController(buildVaultOps());
        controller.init();

        const fakePusher = makeFakePusher();
        const fakePeer = makeFakePeer();
        injectInternalState(controller, {
            signalingServers: new Map([["server-1", fakePusher]]),
            webRTConnections: new Map([
                [
                    "device-1",
                    {
                        connection: fakePeer,
                        dataChannel: null,
                    },
                ],
            ]),
        });

        controller.teardown();

        expect(fakePusher.connection.unbind).toHaveBeenCalled();
        expect(fakePusher.disconnect).toHaveBeenCalled();
        expect(fakePeer.close).toHaveBeenCalled();
    });

    it("getSignalingStatus + getWebRTCStatus default to Disconnected when unknown", () => {
        const controller = new SyncConnectionController(buildVaultOps());
        expect(controller.getSignalingStatus("server-x")).toBe(
            SignalingStatus.Disconnected,
        );
        expect(controller.getWebRTCStatus("device-x")).toBe(
            WebRTCStatus.Disconnected,
        );
    });

    it("registers and removes signaling and webRTC handlers", () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const handler = jest.fn();
        const sigId = controller.registerSyncSignalingHandler(
            "server-1",
            handler,
        );
        expect(sigId).toMatch(/^[0-9A-Z]+$/);

        controller.removeSyncSignalingHandler("server-1", sigId!);

        controller.registerSyncWebRTCHandler("device-1", handler);
        controller.registerSyncWebRTCHandler("device-1", handler);
        controller.removeSyncWebRTCHandler("device-1");
        controller.removeSyncWebRTCHandler("missing-device");
        controller.removeSyncSignalingHandler("missing-server", "any");
    });

    it("broadcasts signaling state changes to all registered handlers", () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const handler = jest.fn();
        controller.registerSyncSignalingHandler("server-1", handler);

        const broadcast = (
            controller as unknown as {
                broadcastSignalingServerEvent: (
                    s: string,
                    st: SignalingStatus,
                ) => void;
            }
        ).broadcastSignalingServerEvent.bind(controller);
        broadcast("server-1", SignalingStatus.Connected);

        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({
                type: SyncConnectionControllerEventType.ConnectionStatus,
                data: expect.objectContaining({
                    connectionState: SignalingStatus.Connected,
                }),
            }),
        );
    });

    it("does not broadcast WebRTC events when device has no status entry", () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const handler = jest.fn();
        controller.registerSyncWebRTCHandler("device-1", handler);
        controller.broadcastWebRTCSyncErrorEvent("device-1");
        controller.broadcastWebRTCSynchronizedEvent("device-1");
        expect(handler).not.toHaveBeenCalled();
    });

    it("broadcasts WebRTC error / synchronized events when status entry exists", () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const handler = jest.fn();
        controller.registerSyncWebRTCHandler("device-1", handler);
        (
            controller as unknown as {
                _webRTCStatus: Map<string, WebRTCStatus>;
            }
        )._webRTCStatus.set("device-1", WebRTCStatus.Connected);

        controller.broadcastWebRTCSyncErrorEvent("device-1");
        controller.broadcastWebRTCSynchronizedEvent("device-1");

        const events = handler.mock.calls.map(
            (c) => c[0] as { event?: WebRTCMessageEventType },
        );
        expect(events.some((e) => e.event === WebRTCMessageEventType.Error)).toBe(
            true,
        );
        expect(
            events.some(
                (e) => e.event === WebRTCMessageEventType.Synchronized,
            ),
        ).toBe(true);
    });

    it("transmitSyncHello returns when no connection or no data channel exists", () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const sync = (
            controller as unknown as {
                _vaultItemSynchronization: {
                    transmitSyncHello: jest.Mock;
                };
            }
        )._vaultItemSynchronization;
        sync.transmitSyncHello = jest.fn();

        controller.transmitSyncHello("missing");
        expect(sync.transmitSyncHello).not.toHaveBeenCalled();

        injectInternalState(controller, {
            webRTConnections: new Map([
                [
                    "device-1",
                    { connection: makeFakePeer(), dataChannel: null },
                ],
            ]),
        });
        controller.transmitSyncHello("device-1");
        expect(sync.transmitSyncHello).not.toHaveBeenCalled();

        const dataChannel = { send: jest.fn() } as unknown as RTCDataChannel;
        injectInternalState(controller, {
            webRTConnections: new Map([
                [
                    "device-1",
                    {
                        connection: makeFakePeer(),
                        dataChannel,
                    },
                ],
            ]),
        });
        controller.transmitSyncHello("device-1");
        expect(sync.transmitSyncHello).toHaveBeenCalledWith(
            "device-1",
            dataChannel,
        );
    });

    it("connectDevice returns false when device not found in config", async () => {
        const vaultOps = buildVaultOps();
        const controller = new SyncConnectionController(vaultOps);
        await expect(controller.connectDevice("missing")).resolves.toBe(false);
    });

    it("disconnectDevice returns false when WebRTC handle missing", async () => {
        const vaultOps = buildVaultOps();
        const controller = new SyncConnectionController(vaultOps);

        const device = {
            ID: "device-1",
            Name: "Device",
            SignalingServerID: "online-services",
            SyncID: "sync-1",
            STUNServerIDs: [],
            TURNServerIDs: [],
        } as unknown as VaultUtilTypes.LinkedDevice;

        await expect(controller.disconnectDevice(device)).resolves.toBe(false);
    });

    it("disconnectDevice tears down webRTC handle when present and signaling server is unused", async () => {
        const vaultOps = buildVaultOps();
        vaultOps.getSynchronizationConfig.mockResolvedValue({
            Devices: [],
            SignalingServers: [],
            STUNServers: [],
            TURNServers: [],
        } as unknown as VaultUtilTypes.LinkedDevices);

        const controller = new SyncConnectionController(vaultOps);
        const signalingServer = makeFakePusher();
        const peer = makeFakePeer();
        peer.connectionState = "connected";

        injectInternalState(controller, {
            signalingServers: new Map([["server-x", signalingServer]]),
            webRTConnections: new Map([
                ["device-1", { connection: peer, dataChannel: null }],
            ]),
        });

        const device = {
            ID: "device-1",
            Name: "Device",
            SignalingServerID: "server-x",
            SyncID: "sync-1",
            STUNServerIDs: [],
            TURNServerIDs: [],
        } as unknown as VaultUtilTypes.LinkedDevice;

        await expect(controller.disconnectDevice(device)).resolves.toBe(true);
        expect(signalingServer.disconnect).toHaveBeenCalled();
        expect(peer.close).toHaveBeenCalled();
    });

    it("_processSignalingData ignores when no WebRTC connection for device", async () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const channel = makeFakeChannel("presence-sync-x");
        const device = {
            ID: "missing",
            Name: "x",
        } as unknown as VaultUtilTypes.LinkedDevice;

        await (
            controller as unknown as {
                _processSignalingData: (
                    ch: unknown,
                    dev: unknown,
                    data: unknown,
                ) => Promise<void>;
            }
        )._processSignalingData(channel, device, {
            type: SignalingServerMessageType.Offer,
            data: { type: "offer", sdp: "" },
        });
        expect(channel.trigger).not.toHaveBeenCalled();
    });

    it("_processSignalingData ICECandidate without data broadcasts WebRTC failed", async () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const peer = makeFakePeer();
        injectInternalState(controller, {
            webRTConnections: new Map([
                [
                    "device-1",
                    { connection: peer, dataChannel: null },
                ],
            ]),
        });
        (
            controller as unknown as {
                _webRTCStatus: Map<string, WebRTCStatus>;
            }
        )._webRTCStatus.set("device-1", WebRTCStatus.Connecting);

        const handler = jest.fn();
        controller.registerSyncWebRTCHandler("device-1", handler);

        const channel = makeFakeChannel("presence-sync-x");
        await (
            controller as unknown as {
                _processSignalingData: (
                    ch: unknown,
                    dev: unknown,
                    data: unknown,
                ) => Promise<void>;
            }
        )._processSignalingData(
            channel,
            { ID: "device-1", Name: "d" } as VaultUtilTypes.LinkedDevice,
            {
                type: SignalingServerMessageType.ICECandidate,
                data: null,
            },
        );

        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({
                connectionState: WebRTCStatus.Failed,
            }),
        );
    });

    it("_processSignalingData ICECandidate with candidate adds to peer", async () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const peer = makeFakePeer();
        injectInternalState(controller, {
            webRTConnections: new Map([
                [
                    "device-1",
                    { connection: peer, dataChannel: null },
                ],
            ]),
        });

        const candidate = { candidate: "abc" };
        const channel = makeFakeChannel("presence-sync-x");
        await (
            controller as unknown as {
                _processSignalingData: (
                    ch: unknown,
                    dev: unknown,
                    data: unknown,
                ) => Promise<void>;
            }
        )._processSignalingData(
            channel,
            { ID: "device-1", Name: "d" } as VaultUtilTypes.LinkedDevice,
            {
                type: SignalingServerMessageType.ICECandidate,
                data: candidate,
            },
        );
        expect(peer.addIceCandidate).toHaveBeenCalledWith(candidate);
    });

    it("_processSignalingData Offer sets remote description and sends Answer", async () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const peer = makeFakePeer();
        injectInternalState(controller, {
            webRTConnections: new Map([
                [
                    "device-1",
                    { connection: peer, dataChannel: null },
                ],
            ]),
        });
        const channel = makeFakeChannel("presence-sync-x");
        const offer = { type: "offer", sdp: "v=0" };

        await (
            controller as unknown as {
                _processSignalingData: (
                    ch: unknown,
                    dev: unknown,
                    data: unknown,
                ) => Promise<void>;
            }
        )._processSignalingData(
            channel,
            { ID: "device-1", Name: "d" } as VaultUtilTypes.LinkedDevice,
            {
                type: SignalingServerMessageType.Offer,
                data: offer,
            },
        );
        expect(peer.setRemoteDescription).toHaveBeenCalledWith(offer);
        expect(peer.createAnswer).toHaveBeenCalled();
        expect(channel.trigger).toHaveBeenCalledWith(
            "client-private-connection-setup",
            expect.objectContaining({
                type: SignalingServerMessageType.Answer,
            }),
        );
    });

    it("_processSignalingData Answer sets remote description without trigger", async () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const peer = makeFakePeer();
        injectInternalState(controller, {
            webRTConnections: new Map([
                [
                    "device-1",
                    { connection: peer, dataChannel: null },
                ],
            ]),
        });
        const channel = makeFakeChannel("presence-sync-x");
        const answer = { type: "answer", sdp: "v=0" };

        await (
            controller as unknown as {
                _processSignalingData: (
                    ch: unknown,
                    dev: unknown,
                    data: unknown,
                ) => Promise<void>;
            }
        )._processSignalingData(
            channel,
            { ID: "device-1", Name: "d" } as VaultUtilTypes.LinkedDevice,
            {
                type: SignalingServerMessageType.Answer,
                data: answer,
            },
        );
        expect(peer.setRemoteDescription).toHaveBeenCalledWith(answer);
        expect(channel.trigger).not.toHaveBeenCalled();
    });

    it("_processSignalingData ICECompleted is logged and does nothing", async () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const peer = makeFakePeer();
        injectInternalState(controller, {
            webRTConnections: new Map([
                [
                    "device-1",
                    { connection: peer, dataChannel: null },
                ],
            ]),
        });
        const channel = makeFakeChannel("presence-sync-x");
        await (
            controller as unknown as {
                _processSignalingData: (
                    ch: unknown,
                    dev: unknown,
                    data: unknown,
                ) => Promise<void>;
            }
        )._processSignalingData(
            channel,
            { ID: "device-1", Name: "d" } as VaultUtilTypes.LinkedDevice,
            { type: SignalingServerMessageType.ICECompleted, data: null },
        );
        expect(peer.setRemoteDescription).not.toHaveBeenCalled();
        expect(peer.addIceCandidate).not.toHaveBeenCalled();
    });

    it("_bindSignalingServerConnectionEvents maps state_change to SignalingStatus", () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const handler = jest.fn();
        controller.registerSyncSignalingHandler("server-1", handler);

        const fakeServer = makeFakePusher();
        (
            controller as unknown as {
                _bindSignalingServerConnectionEvents: (
                    server: unknown,
                    id: string,
                ) => void;
            }
        )._bindSignalingServerConnectionEvents(fakeServer, "server-1");

        const stateHandler = fakeServer.connection.bind.mock.calls.find(
            (c) => c[0] === "state_change",
        )?.[1] as (s: { previous: string; current: string }) => void;
        expect(stateHandler).toBeDefined();

        const cases: [string, SignalingStatus][] = [
            ["connecting", SignalingStatus.Connecting],
            ["connected", SignalingStatus.Connected],
            ["unavailable", SignalingStatus.Unavailable],
            ["failed", SignalingStatus.Failed],
            ["disconnected", SignalingStatus.Disconnected],
            ["initialized", SignalingStatus.Disconnected],
        ];
        for (const [state, expected] of cases) {
            handler.mockClear();
            stateHandler({ previous: "x", current: state });
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: { connectionState: expected },
                }),
            );
        }
    });

    it("_setupSignalingSubscriptions resubscribes when channel already exists", () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const fakeServer = makeFakePusher();
        const oldChannel = {
            name: "presence-sync-1",
            unsubscribe: jest.fn(),
            unbind: jest.fn(),
        };
        fakeServer.allChannels.mockReturnValueOnce([oldChannel]);
        const newChannel = makeFakeChannel("presence-sync-1");
        fakeServer.subscribe.mockReturnValueOnce(newChannel);

        const channel = (
            controller as unknown as {
                _setupSignalingSubscriptions: (
                    server: unknown,
                    device: unknown,
                    name: string,
                ) => unknown;
            }
        )._setupSignalingSubscriptions(
            fakeServer,
            { ID: "device-1", Name: "d" } as VaultUtilTypes.LinkedDevice,
            "presence-sync-1",
        );
        expect(oldChannel.unsubscribe).toHaveBeenCalled();
        expect(oldChannel.unbind).toHaveBeenCalled();
        expect(channel).toBe(newChannel);
        expect(newChannel.bind).toHaveBeenCalledWith(
            "pusher:subscription_succeeded",
            expect.any(Function),
        );
        expect(newChannel.bind).toHaveBeenCalledWith(
            "client-private-connection-setup",
            expect.any(Function),
        );
        expect(newChannel.bind).toHaveBeenCalledWith(
            "pusher:member_added",
            expect.any(Function),
        );
    });

    it("_setupSignalingSubscriptions member_added crafts and sends offer", async () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const peer = makeFakePeer();
        injectInternalState(controller, {
            webRTConnections: new Map([
                [
                    "device-1",
                    { connection: peer, dataChannel: null },
                ],
            ]),
        });
        const fakeServer = makeFakePusher();
        const newChannel = makeFakeChannel("presence-sync-1");
        fakeServer.subscribe.mockReturnValueOnce(newChannel);
        (
            controller as unknown as {
                _setupSignalingSubscriptions: (
                    server: unknown,
                    device: unknown,
                    name: string,
                ) => unknown;
            }
        )._setupSignalingSubscriptions(
            fakeServer,
            { ID: "device-1", Name: "d" } as VaultUtilTypes.LinkedDevice,
            "presence-sync-1",
        );

        const memberHandler = newChannel.bind.mock.calls.find(
            (c) => c[0] === "pusher:member_added",
        )?.[1] as (data: { id: string }) => Promise<void>;
        await memberHandler({ id: "other-device" });

        expect(peer.createOffer).toHaveBeenCalled();
        expect(peer.setLocalDescription).toHaveBeenCalled();
        expect(newChannel.trigger).toHaveBeenCalledWith(
            "client-private-connection-setup",
            expect.objectContaining({
                type: SignalingServerMessageType.Offer,
            }),
        );
    });

    it("_connectSignalingServer constructs a Pusher instance and tracks it for the given server ID", () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const beforeCount = pusherConstructorMock.mock.calls.length;

        const server = {
            ID: "ss-1",
            Name: "Custom",
            Host: "localhost",
            Key: "key",
            Secret: "secret",
            AppID: "app",
            ServicePort: "6001",
            SecureServicePort: "6002",
        } as unknown as VaultUtilTypes.SignalingServerConfiguration;

        const conn = (
            controller as unknown as {
                _connectSignalingServer: (
                    syncID: string,
                    server: VaultUtilTypes.SignalingServerConfiguration | null,
                ) => unknown;
            }
        )._connectSignalingServer("sync-id", server);

        expect(pusherConstructorMock.mock.calls.length).toBe(beforeCount + 1);
        expect(conn).toBeDefined();

        const tracked = (
            controller as unknown as {
                _signalingServers: Map<string, unknown>;
                _signalingServerConnectionStatus: Map<string, SignalingStatus>;
            }
        );
        expect(tracked._signalingServers.get("ss-1")).toBe(conn);
        // Status is initialized to Disconnected immediately on connect.
        expect(tracked._signalingServerConnectionStatus.get("ss-1")).toBe(
            SignalingStatus.Disconnected,
        );
    });

    it("_connectSignalingServer falls back to Online Services key when server is null", () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const beforeCount = pusherConstructorMock.mock.calls.length;

        (
            controller as unknown as {
                _connectSignalingServer: (
                    syncID: string,
                    server: null,
                ) => unknown;
            }
        )._connectSignalingServer("sync-id", null);

        expect(pusherConstructorMock.mock.calls.length).toBe(beforeCount + 1);
        const tracked = (
            controller as unknown as {
                _signalingServers: Map<string, unknown>;
            }
        )._signalingServers;
        // Falls back to ONLINE_SERVICES_SELECTION_ID — some value must be tracked.
        expect(tracked.size).toBeGreaterThanOrEqual(1);
    });

    it("connectDevice success path: subscribes channel + creates WebRTC entry for the device", async () => {
        const vaultOps = buildVaultOps();
        const device = {
            ID: "device-target",
            Name: "Target",
            SignalingServerID: "ss-existing",
            SyncID: "sync-1",
            STUNServerIDs: [],
            TURNServerIDs: [],
        } as unknown as VaultUtilTypes.LinkedDevice;
        vaultOps.getSynchronizationConfig.mockResolvedValue({
            Devices: [device],
            SignalingServers: [],
            STUNServers: [],
            TURNServers: [],
        } as unknown as VaultUtilTypes.LinkedDevices);

        const controller = new SyncConnectionController(vaultOps);

        // Pre-populate a "connected" Pusher so connectDevice does NOT create a new
        // instance — keeps the test independent of the real RTCPeerConnection global.
        const fakeServer = makeFakePusher();
        fakeServer.connection.state = "connected";
        const subscribedChannel = makeFakeChannel("presence-sync-sync-1");
        fakeServer.subscribe.mockReturnValue(subscribedChannel);

        // RTCPeerConnection is referenced by initWebRTC inside _setupWebRTCConnection.
        // Provide a minimal fake so the call doesn't throw.
        const peerCloseSpy = jest.fn();
        const peerCreateDataChannelSpy = jest.fn(() => ({
            send: jest.fn(),
            close: jest.fn(),
            onmessage: null,
            label: "data-channel",
        }));
        const originalRTC = (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection;
        (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection =
            function FakeRTCPeerConnection() {
                return {
                    onconnectionstatechange: null,
                    onicecandidate: null,
                    ondatachannel: null,
                    connectionState: "new",
                    close: peerCloseSpy,
                    createDataChannel: peerCreateDataChannelSpy,
                };
            } as unknown as typeof RTCPeerConnection;

        injectInternalState(controller, {
            signalingServers: new Map([["ss-existing", fakeServer]]),
        });

        try {
            await expect(controller.connectDevice("device-target")).resolves.toBe(
                true,
            );
            expect(fakeServer.subscribe).toHaveBeenCalledWith(
                "presence-sync-sync-1",
            );
            // WebRTC entry must be tracked.
            const conns = (
                controller as unknown as {
                    _webRTConnections: Map<string, unknown>;
                }
            )._webRTConnections;
            expect(conns.has("device-target")).toBe(true);
            expect(peerCreateDataChannelSpy).toHaveBeenCalledWith("data-channel");
        } finally {
            if (originalRTC === undefined) {
                delete (globalThis as { RTCPeerConnection?: unknown })
                    .RTCPeerConnection;
            } else {
                (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection =
                    originalRTC;
            }
        }
    });

    it("connectDevice reports failed once when TURN credential fetch rejects", async () => {
        const vaultOps = buildVaultOps();
        const device = {
            ID: "device-target",
            Name: "Target",
            SignalingServerID: "ss-existing",
            SyncID: "sync-1",
            STUNServerIDs: [],
            TURNServerIDs: [],
        } as unknown as VaultUtilTypes.LinkedDevice;
        vaultOps.getSynchronizationConfig.mockResolvedValue({
            Devices: [device],
            SignalingServers: [],
            STUNServers: [],
            TURNServers: [],
        } as unknown as VaultUtilTypes.LinkedDevices);
        turnCredentialsMutate.mockRejectedValueOnce(new Error("TURN unavailable"));

        const controller = new SyncConnectionController(vaultOps);
        const handler = jest.fn();
        controller.registerSyncWebRTCHandler("device-target", handler);

        const fakeServer = makeFakePusher();
        fakeServer.connection.state = "connected";
        const subscribedChannel = makeFakeChannel("presence-sync-sync-1");
        fakeServer.subscribe.mockReturnValue(subscribedChannel);
        injectInternalState(controller, {
            signalingServers: new Map([["ss-existing", fakeServer]]),
        });

        await expect(controller.connectDevice("device-target")).resolves.toBe(
            false,
        );

        expect(turnCredentialsMutate).toHaveBeenCalledTimes(1);
        expect(subscribedChannel.unsubscribe).toHaveBeenCalled();
        expect(subscribedChannel.unbind).toHaveBeenCalled();
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({
                connectionState: WebRTCStatus.Failed,
            }),
        );
        expect(
            (
                controller as unknown as {
                    _webRTConnections: Map<string, unknown>;
                }
            )._webRTConnections.has("device-target"),
        ).toBe(false);
    });

    it("_processSignalingData logs and returns for unknown message type (default branch)", async () => {
        const controller = new SyncConnectionController(buildVaultOps());
        const peer = makeFakePeer();
        injectInternalState(controller, {
            webRTConnections: new Map([
                ["device-1", { connection: peer, dataChannel: null }],
            ]),
        });
        const channel = makeFakeChannel("presence-sync-x");

        await (
            controller as unknown as {
                _processSignalingData: (
                    ch: unknown,
                    dev: unknown,
                    data: unknown,
                ) => Promise<void>;
            }
        )._processSignalingData(
            channel,
            { ID: "device-1", Name: "d" } as VaultUtilTypes.LinkedDevice,
            { type: "garbage-type" as never, data: null },
        );

        // No peer operation triggered, no channel.trigger emitted.
        expect(peer.setRemoteDescription).not.toHaveBeenCalled();
        expect(peer.addIceCandidate).not.toHaveBeenCalled();
        expect(peer.createAnswer).not.toHaveBeenCalled();
        expect(channel.trigger).not.toHaveBeenCalled();
    });

    it("_setupWebRTCConnection wires data channel open/close/error/message handlers via ondatachannel", async () => {
        const vaultOps = buildVaultOps();
        const controller = new SyncConnectionController(vaultOps);

        const sync = (
            controller as unknown as {
                _vaultItemSynchronization: {
                    onDataChannelMessage: jest.Mock;
                };
            }
        )._vaultItemSynchronization;
        sync.onDataChannelMessage = jest.fn();

        // Track the data channel created in _setupWebRTCConnection so we can assert
        // its onmessage gets wired (for the locally-created data channel branch).
        const localDataChannel = {
            send: jest.fn(),
            close: jest.fn(),
            onmessage: null as ((e: unknown) => void) | null,
            label: "data-channel",
        };
        const peerCreateDataChannel = jest.fn(() => localDataChannel);
        const fakePeer: {
            onconnectionstatechange: null | (() => void);
            onicecandidate: null | ((e: unknown) => void);
            ondatachannel: null | ((e: { channel: unknown }) => void);
            connectionState: string;
            close: jest.Mock;
            createDataChannel: jest.Mock;
        } = {
            onconnectionstatechange: null,
            onicecandidate: null,
            ondatachannel: null,
            connectionState: "new",
            close: jest.fn(),
            createDataChannel: peerCreateDataChannel,
        };

        const originalRTC = (globalThis as { RTCPeerConnection?: unknown })
            .RTCPeerConnection;
        (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection =
            function FakeRTCPeerConnection() {
                return fakePeer;
            } as unknown as typeof RTCPeerConnection;

        try {
            const fakeChannel = makeFakeChannel("presence-sync-1");
            const device = {
                ID: "device-1",
                Name: "Device",
                SyncID: "sync-1",
                STUNServerIDs: [],
                TURNServerIDs: [],
            } as unknown as VaultUtilTypes.LinkedDevice;

            const linkedDevices = {
                STUNServers: [],
                TURNServers: [],
            } as unknown as VaultUtilTypes.LinkedDevices;

            await (
                controller as unknown as {
                    _setupWebRTCConnection: (
                        l: unknown,
                        c: unknown,
                        d: unknown,
                    ) => Promise<unknown>;
                }
            )._setupWebRTCConnection(linkedDevices, fakeChannel, device);

            expect(peerCreateDataChannel).toHaveBeenCalledWith("data-channel");

            // Locally-created data channel should have onmessage wired through to
            // VaultItemSynchronization.onDataChannelMessage.
            expect(localDataChannel.onmessage).toBeInstanceOf(Function);
            const messageEvent = {
                data: "hello",
            } as unknown as MessageEvent;
            (
                localDataChannel.onmessage as unknown as (
                    e: MessageEvent,
                ) => void
            )(messageEvent);
            expect(sync.onDataChannelMessage).toHaveBeenCalledWith(
                "device-1",
                localDataChannel,
                messageEvent,
            );

            // Simulate the remote-side data channel arriving via ondatachannel.
            expect(fakePeer.ondatachannel).toBeInstanceOf(Function);
            const remoteDataChannel = {
                onopen: null as ((e: Event) => void) | null,
                onclose: null as ((e: Event) => void) | null,
                onerror: null as ((e: Event) => void) | null,
                onmessage: null as ((e: MessageEvent) => void) | null,
                label: "remote-data-channel",
                send: jest.fn(),
                close: jest.fn(),
            };
            fakePeer.ondatachannel!({ channel: remoteDataChannel });

            expect(remoteDataChannel.onopen).toBeInstanceOf(Function);
            expect(remoteDataChannel.onclose).toBeInstanceOf(Function);
            expect(remoteDataChannel.onerror).toBeInstanceOf(Function);
            expect(remoteDataChannel.onmessage).toBeInstanceOf(Function);

            // onopen should persist the data channel in the WebRTC connections map.
            // First we need to seed the connections map (init done via connectDevice
            // would do that; we mimic it here).
            injectInternalState(controller, {
                webRTConnections: new Map([
                    [
                        "device-1",
                        {
                            connection: fakePeer as unknown as RTCPeerConnection,
                            dataChannel: null,
                        },
                    ],
                ]),
            });
            (remoteDataChannel.onopen as unknown as (e: Event) => void)(
                new Event("open"),
            );
            const trackedConn = (
                controller as unknown as {
                    _webRTConnections: Map<
                        string,
                        { dataChannel: unknown }
                    >;
                }
            )._webRTConnections.get("device-1");
            expect(trackedConn?.dataChannel).toBe(remoteDataChannel);

            // onclose should set WebRTCStatus to Disconnected and broadcast.
            const handler = jest.fn();
            controller.registerSyncWebRTCHandler("device-1", handler);
            (remoteDataChannel.onclose as unknown as (e: Event) => void)(
                new Event("close"),
            );
            expect(
                (
                    controller as unknown as {
                        _webRTCStatus: Map<string, WebRTCStatus>;
                    }
                )._webRTCStatus.get("device-1"),
            ).toBe(WebRTCStatus.Disconnected);

            // onerror should set WebRTCStatus to Failed and broadcast.
            handler.mockClear();
            (remoteDataChannel.onerror as unknown as (e: Event) => void)(
                new Event("error"),
            );
            expect(
                (
                    controller as unknown as {
                        _webRTCStatus: Map<string, WebRTCStatus>;
                    }
                )._webRTCStatus.get("device-1"),
            ).toBe(WebRTCStatus.Failed);

            // Remote-channel onmessage delegates to VaultItemSynchronization.
            sync.onDataChannelMessage.mockClear();
            const evt = { data: "remote-msg" } as unknown as MessageEvent;
            (
                remoteDataChannel.onmessage as unknown as (
                    e: MessageEvent,
                ) => void
            )(evt);
            expect(sync.onDataChannelMessage).toHaveBeenCalledWith(
                "device-1",
                remoteDataChannel,
                evt,
            );
        } finally {
            if (originalRTC === undefined) {
                delete (globalThis as { RTCPeerConnection?: unknown })
                    .RTCPeerConnection;
            } else {
                (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection =
                    originalRTC;
            }
        }
    });
});
