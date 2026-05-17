/**
 * @jest-environment jsdom
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";

const initPusherInstanceMock = jest.fn();
const initWebRTCMock = jest.fn();
const constructLinkPresenceChannelNameMock = jest.fn(
    (id: string) => `presence-link-${id}`,
);

jest.mock("../../src/app_lib/synchronization", () => ({
    initPusherInstance: initPusherInstanceMock,
    initWebRTC: initWebRTCMock,
}));

jest.mock("../../src/app_lib/online-services", () => ({
    constructLinkPresenceChannelName: constructLinkPresenceChannelNameMock,
}));

jest.mock("pusher-js", () => ({
    __esModule: true,
    default: class {},
}));

jest.mock(
    "@/lib/utils",
    () => ({
        base64ToUint8: (value: string) =>
            new Uint8Array(Buffer.from(value, "base64")),
        uint8ToBase64: (value: Uint8Array) =>
            Buffer.from(value).toString("base64"),
    }),
    { virtual: true },
);

import {
    LinkingProcessController,
    LinkingProcessState,
    LinkingProcessStep,
} from "../../src/app_lib/vault-utils/linking";
import * as VaultUtilTypes from "../../src/app_lib/proto/vault";

type StateChangeHandler = (state: {
    previous: string;
    current: string;
}) => void;
type ClientLinkHandler = (data: {
    type: "offer" | "ice-candidate";
    data: unknown;
}) => Promise<void>;

function buildController() {
    const channelHandlers: Record<string, (...args: unknown[]) => unknown> = {};
    const connectionHandlers: Record<
        string,
        (...args: unknown[]) => unknown
    > = {};

    const channel = {
        bind: jest.fn((event: string, cb: (...args: unknown[]) => unknown) => {
            channelHandlers[event] = cb;
        }),
        unbind: jest.fn(),
        trigger: jest.fn(),
    };

    const signalingServer = {
        connection: {
            bind: jest.fn(
                (event: string, cb: (...args: unknown[]) => unknown) => {
                    connectionHandlers[event] = cb;
                },
            ),
        },
        subscribe: jest.fn(() => channel),
        unsubscribe: jest.fn(),
        unbind: jest.fn(),
        disconnect: jest.fn(),
    };

    initPusherInstanceMock.mockReturnValue(signalingServer);

    const peerConnection: Partial<RTCPeerConnection> & {
        onconnectionstatechange?: () => void;
        ondatachannel?: (event: unknown) => void;
        onicecandidate?: (event: unknown) => void;
        connectionState: RTCPeerConnectionState;
    } = {
        connectionState: "new",
        close: jest.fn(),
        setRemoteDescription: jest.fn(async () => undefined),
        setLocalDescription: jest.fn(async () => undefined),
        createAnswer: jest.fn(async () => ({
            type: "answer" as const,
            sdp: "v=0",
        })),
        addIceCandidate: jest.fn(async () => undefined),
    };
    initWebRTCMock.mockReturnValue(peerConnection);

    const onStatusChange = jest.fn(async () => undefined);

    const blob = VaultUtilTypes.LinkingPackageBlob.create({
        SyncID: "sync-1",
        STUNServers: [],
        TURNServers: [],
        OnlineServices: undefined,
        SignalingServer: undefined,
    });

    const controller = new LinkingProcessController(
        blob,
        false,
        onStatusChange,
    );

    return {
        controller,
        onStatusChange,
        channel,
        signalingServer,
        peerConnection,
        channelHandlers: channelHandlers as {
            "pusher:subscription_error"?: () => void;
            "pusher:subscription_succeeded"?: () => void;
            "client-link"?: ClientLinkHandler;
        },
        connectionHandlers: connectionHandlers as {
            state_change?: StateChangeHandler;
        },
    };
}

describe("LinkingProcessController", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("subscribes to channel and binds Pusher events", () => {
        const { signalingServer, channel } = buildController();
        expect(initPusherInstanceMock).toHaveBeenCalled();
        expect(signalingServer.subscribe).toHaveBeenCalledWith(
            "presence-link-sync-1",
        );
        expect(channel.bind).toHaveBeenCalledWith(
            "pusher:subscription_error",
            expect.any(Function),
        );
        expect(channel.bind).toHaveBeenCalledWith(
            "pusher:subscription_succeeded",
            expect.any(Function),
        );
        expect(channel.bind).toHaveBeenCalledWith(
            "client-link",
            expect.any(Function),
        );
    });

    it("emits Signaling Active on connecting and Completed on connected state_change", async () => {
        const { onStatusChange, connectionHandlers } = buildController();
        const handler = connectionHandlers.state_change;
        handler?.({ previous: "initialized", current: "connecting" });
        handler?.({ previous: "connecting", current: "connected" });

        const calls = onStatusChange.mock.calls.map(
            (c) => c[0] as { Step: number; State: number },
        );
        expect(
            calls.some(
                (c) =>
                    c.Step === LinkingProcessStep.Signaling &&
                    c.State === LinkingProcessState.Active,
            ),
        ).toBe(true);
        expect(
            calls.some(
                (c) =>
                    c.Step === LinkingProcessStep.Signaling &&
                    c.State === LinkingProcessState.Completed,
            ),
        ).toBe(true);
    });

    it("emits Error on failed/unavailable state_change", () => {
        const { onStatusChange, connectionHandlers } = buildController();
        const handler = connectionHandlers.state_change;
        handler?.({ previous: "connecting", current: "failed" });

        const errored = onStatusChange.mock.calls.some(
            (c) =>
                (c[0] as { State: number }).State ===
                LinkingProcessState.Error,
        );
        expect(errored).toBe(true);
    });

    it("ignores disconnected state_change before direct connection is established", () => {
        const { onStatusChange, connectionHandlers } = buildController();
        const handler = connectionHandlers.state_change;
        handler?.({ previous: "connecting", current: "disconnected" });
        const cleanupEmitted = onStatusChange.mock.calls.some(
            (c) =>
                (c[0] as { Step: number }).Step ===
                LinkingProcessStep.SignalingCleanup,
        );
        expect(cleanupEmitted).toBe(false);
    });

    it("emits SignalingCleanup Completed when disconnected after direct connection established", () => {
        const {
            onStatusChange,
            connectionHandlers,
            peerConnection,
        } = buildController();
        peerConnection.connectionState = "connected";
        peerConnection.onconnectionstatechange?.();
        const handler = connectionHandlers.state_change;
        handler?.({ previous: "connected", current: "disconnected" });
        const cleanup = onStatusChange.mock.calls.some(
            (c) =>
                (c[0] as { Step: number; State: number }).Step ===
                    LinkingProcessStep.SignalingCleanup &&
                (c[0] as { Step: number; State: number }).State ===
                    LinkingProcessState.Completed,
        );
        expect(cleanup).toBe(true);
    });

    it("handles subscription_error by disconnecting signaling server", () => {
        const {
            channelHandlers,
            signalingServer,
            onStatusChange,
        } = buildController();
        channelHandlers["pusher:subscription_error"]?.();
        expect(signalingServer.disconnect).toHaveBeenCalled();
        expect(signalingServer.unsubscribe).toHaveBeenCalledWith(
            "presence-link-sync-1",
        );
        const errored = onStatusChange.mock.calls.some(
            (c) =>
                (c[0] as { State: number }).State ===
                LinkingProcessState.Error,
        );
        expect(errored).toBe(true);
    });

    it("subscription_succeeded emits SignalingWaitingOtherDevice", () => {
        const { channelHandlers, onStatusChange } = buildController();
        channelHandlers["pusher:subscription_succeeded"]?.();
        const found = onStatusChange.mock.calls.some(
            (c) =>
                (c[0] as { Step: number }).Step ===
                LinkingProcessStep.SignalingWaitingOtherDevice,
        );
        expect(found).toBe(true);
    });

    it("handles client-link offer by negotiating and sending answer", async () => {
        const {
            channelHandlers,
            channel,
            peerConnection,
        } = buildController();
        const offer = { type: "offer", sdp: "v=0" };
        await channelHandlers["client-link"]?.({
            type: "offer",
            data: offer,
        });
        expect(peerConnection.setRemoteDescription).toHaveBeenCalledWith(offer);
        expect(peerConnection.createAnswer).toHaveBeenCalled();
        expect(peerConnection.setLocalDescription).toHaveBeenCalled();
        expect(channel.trigger).toHaveBeenCalledWith(
            "client-link",
            expect.objectContaining({ type: "answer" }),
        );
    });

    it("handles client-link ice-candidate by adding to peer connection", async () => {
        const { channelHandlers, peerConnection } = buildController();
        const candidate = { candidate: "abc" };
        await channelHandlers["client-link"]?.({
            type: "ice-candidate",
            data: candidate,
        });
        expect(peerConnection.addIceCandidate).toHaveBeenCalledWith(candidate);
    });

    it("connected connectionStateChange emits DirectConnection Completed + drops signaling", () => {
        const {
            peerConnection,
            signalingServer,
            onStatusChange,
        } = buildController();
        peerConnection.connectionState = "connected";
        peerConnection.onconnectionstatechange?.();
        expect(signalingServer.disconnect).toHaveBeenCalled();
        const completed = onStatusChange.mock.calls.some(
            (c) =>
                (c[0] as { Step: number; State: number }).Step ===
                    LinkingProcessStep.DirectConnection &&
                (c[0] as { Step: number; State: number }).State ===
                    LinkingProcessState.Completed,
        );
        expect(completed).toBe(true);
    });

    it("failed connectionStateChange emits Error", () => {
        const { peerConnection, onStatusChange } = buildController();
        peerConnection.connectionState = "failed";
        peerConnection.onconnectionstatechange?.();
        const errored = onStatusChange.mock.calls.some(
            (c) =>
                (c[0] as { Step: number; State: number }).Step ===
                    LinkingProcessStep.DirectConnection &&
                (c[0] as { Step: number; State: number }).State ===
                    LinkingProcessState.Error,
        );
        expect(errored).toBe(true);
    });

    it("disconnected connectionStateChange emits DirectConnectionCleanup Completed", () => {
        const { peerConnection, onStatusChange } = buildController();
        peerConnection.connectionState = "disconnected";
        peerConnection.onconnectionstatechange?.();
        const cleanup = onStatusChange.mock.calls.some(
            (c) =>
                (c[0] as { Step: number; State: number }).Step ===
                    LinkingProcessStep.DirectConnectionCleanup &&
                (c[0] as { Step: number; State: number }).State ===
                    LinkingProcessState.Completed,
        );
        expect(cleanup).toBe(true);
    });

    it("ondatachannel onmessage processes vault binary and triggers cleanup", async () => {
        const {
            peerConnection,
            onStatusChange,
            signalingServer,
        } = buildController();
        const recvChannel: {
            onmessage?: (e: { data: ArrayBuffer | Uint8Array }) => unknown;
            onerror?: (e: unknown) => unknown;
            onclose?: () => unknown;
        } = {};
        peerConnection.ondatachannel?.({ channel: recvChannel });

        const data = new Uint8Array([1, 2, 3]);
        await recvChannel.onmessage?.({ data: data.buffer });

        const vaultDelivered = onStatusChange.mock.calls.some(
            (c) =>
                (
                    c[0] as {
                        Step: number;
                        VaultBinaryData?: Uint8Array;
                    }
                ).Step === LinkingProcessStep.VaultTransfer &&
                (c[0] as { VaultBinaryData?: Uint8Array }).VaultBinaryData
                    ?.length === 3,
        );
        expect(vaultDelivered).toBe(true);
        expect(peerConnection.close).toHaveBeenCalled();
        expect(signalingServer.disconnect).toHaveBeenCalled();
    });

    it("ondatachannel onmessage swallows onStatusChange throw and emits VaultSave Error", async () => {
        const built = buildController();
        // First call always succeeds; on the success branch we throw.
        built.onStatusChange.mockImplementation(async (status) => {
            if (
                status.Step === LinkingProcessStep.VaultTransfer &&
                status.State === LinkingProcessState.Completed
            ) {
                throw new Error("save failure");
            }
        });

        const recvChannel: {
            onmessage?: (e: { data: ArrayBuffer | Uint8Array }) => unknown;
        } = {};
        built.peerConnection.ondatachannel?.({ channel: recvChannel });
        const data = new Uint8Array([7]);
        await recvChannel.onmessage?.({ data: data.buffer });

        const saveErrored = built.onStatusChange.mock.calls.some(
            (c) =>
                (c[0] as { Step: number; State: number }).Step ===
                    LinkingProcessStep.VaultSave &&
                (c[0] as { Step: number; State: number }).State ===
                    LinkingProcessState.Error,
        );
        expect(saveErrored).toBe(true);
    });

    it("ondatachannel onerror emits Error and onclose triggers cleanup", () => {
        const {
            peerConnection,
            onStatusChange,
        } = buildController();
        const recvChannel: {
            onmessage?: (e: { data: ArrayBuffer | Uint8Array }) => unknown;
            onerror?: (e: unknown) => unknown;
            onclose?: () => unknown;
        } = {};
        peerConnection.ondatachannel?.({ channel: recvChannel });

        recvChannel.onerror?.(new ErrorEvent("err", { message: "boom" }));
        const errored = onStatusChange.mock.calls.some(
            (c) =>
                (c[0] as { Step: number; State: number }).Step ===
                    LinkingProcessStep.DirectConnection &&
                (c[0] as { Step: number; State: number }).State ===
                    LinkingProcessState.Error,
        );
        expect(errored).toBe(true);

        recvChannel.onclose?.();
        expect(peerConnection.close).toHaveBeenCalled();
    });

    it("onicecandidate triggers client-link for non-null candidate", () => {
        const { peerConnection, channel } = buildController();
        peerConnection.onicecandidate?.({
            candidate: { candidate: "abc" },
        });
        expect(channel.trigger).toHaveBeenCalledWith(
            "client-link",
            expect.objectContaining({ type: "ice-candidate" }),
        );
    });

    it("onicecandidate with no candidates ever emits Error and cleanup", () => {
        const {
            peerConnection,
            onStatusChange,
            signalingServer,
        } = buildController();
        peerConnection.onicecandidate?.({ candidate: null });
        const errored = onStatusChange.mock.calls.some(
            (c) =>
                (c[0] as { Step: number; State: number }).Step ===
                    LinkingProcessStep.DirectConnection &&
                (c[0] as { Step: number; State: number }).State ===
                    LinkingProcessState.Error,
        );
        expect(errored).toBe(true);
        expect(peerConnection.close).toHaveBeenCalled();
        expect(signalingServer.disconnect).toHaveBeenCalled();
    });

    it("abortWaitingForDevice unbinds, unsubscribes, disconnects, and closes connection", () => {
        const {
            controller,
            channel,
            signalingServer,
            peerConnection,
            onStatusChange,
        } = buildController();
        controller.abortWaitingForDevice();
        expect(channel.unbind).toHaveBeenCalled();
        expect(signalingServer.unsubscribe).toHaveBeenCalledWith(
            "presence-link-sync-1",
        );
        expect(signalingServer.unbind).toHaveBeenCalled();
        expect(signalingServer.disconnect).toHaveBeenCalled();
        expect(peerConnection.close).toHaveBeenCalled();
        const warned = onStatusChange.mock.calls.some(
            (c) =>
                (c[0] as { State: number }).State ===
                LinkingProcessState.Warning,
        );
        expect(warned).toBe(true);
    });
});
