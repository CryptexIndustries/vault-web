/** @jest-environment node */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import {
    SyncConnectionController,
    type VaultOperations,
} from "../synchronization";
import {
    WebRTCStatus,
    SignalingServerMessageType,
} from "../synchronization-utils";
import type * as Types from "../proto/vault";
import type { Channel } from "pusher-js";

jest.mock("../vault-utils/post-quantum-kem", () => ({}));
jest.mock("../vault-utils/sync-signing", () => ({}));
jest.mock("../vault-utils/sync-crypto", () => ({}));
jest.mock("../runtime", () => ({
    getVaultCoreRuntime: () => {
        const log = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        return { syncLog: log, signalingLog: log, webrtcLog: log };
    },
}));

class Peer {
    connectionState = "new";
    onicecandidate?: (event: { candidate: object | null }) => Promise<void>;
    onconnectionstatechange?: () => void;
    ondatachannel?: (event: {
        channel: ReturnType<Peer["createDataChannel"]>;
    }) => void;
    channels: ReturnType<Peer["createDataChannel"]>[] = [];
    close = jest.fn(() => {
        this.connectionState = "closed";
    });
    createDataChannel(): {
        label: string;
        binaryType: string;
        readyState: string;
        onopen: (() => void) | null;
        onclose: (() => void) | null;
        onerror: (() => void) | null;
        onmessage: null;
        close: ReturnType<typeof jest.fn>;
    } {
        const channel = {
            label: "fixture",
            binaryType: "",
            readyState: "connecting",
            onopen: null as (() => void) | null,
            onclose: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onmessage: null,
            close: jest.fn(),
        };
        this.channels.push(channel);
        return channel;
    }
}
type Manager = {
    _setupWebRTCConnection(
        config: Types.LinkedDevices,
        channel: Channel,
        device: Types.LinkedDevice,
    ): Promise<RTCPeerConnection>;
    _webRTConnections: Map<
        string,
        { connection: RTCPeerConnection; dataChannel: RTCDataChannel | null }
    >;
    _lifecycleGeneration: number;
};
const device = {
    ID: "peer",
    Name: "Fixture peer",
    SyncID: "fixture",
    STUNServerIDs: [],
    TURNServerIDs: ["turn"],
} as unknown as Types.LinkedDevice;
const config = {
    Devices: [device],
    STUNServers: [],
    TURNServers: [
        {
            ID: "turn",
            Host: "localhost:3478",
            Username: "fixture",
            Password: "fixture",
        },
    ],
} as unknown as Types.LinkedDevices;
async function fixture() {
    const controller = new SyncConnectionController({
        getSynchronizationConfig: async () => config,
    } as VaultOperations);
    const manager = controller as unknown as Manager;
    const channel = {
        trigger: jest.fn(),
        unsubscribe: jest.fn(),
        unbind: jest.fn(),
    };
    const peer = (await manager._setupWebRTCConnection(
        config,
        channel as unknown as Channel,
        device,
    )) as unknown as Peer;
    manager._webRTConnections.set(device.ID, {
        connection: peer as unknown as RTCPeerConnection,
        dataChannel: null,
    });
    return { controller, manager, peer, channel };
}
const originalPeer = globalThis.RTCPeerConnection;
describe("regular synchronization ICE grace lifecycle", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        globalThis.RTCPeerConnection =
            Peer as unknown as typeof RTCPeerConnection;
    });
    afterEach(() => {
        jest.useRealTimers();
        globalThis.RTCPeerConnection = originalPeer;
    });
    it("keeps the actual manager alive for a candidate arriving after empty completion", async () => {
        const { controller, peer, channel } = await fixture();
        await peer.onicecandidate!({ candidate: null });
        expect(controller.getWebRTCStatus(device.ID)).not.toBe(
            WebRTCStatus.Failed,
        );
        jest.advanceTimersByTime(8);
        await peer.onicecandidate!({ candidate: { candidate: "host" } });
        jest.advanceTimersByTime(5_000);
        expect(controller.getWebRTCStatus(device.ID)).not.toBe(
            WebRTCStatus.Failed,
        );
        expect(channel.trigger).not.toHaveBeenCalledWith(
            "client-private-connection-setup",
            { type: SignalingServerMessageType.ICECandidate, data: null },
        );
    });
    it("reports the genuine empty gather once at five seconds", async () => {
        const { controller, peer, channel } = await fixture();
        await peer.onicecandidate!({ candidate: null });
        jest.advanceTimersByTime(4_999);
        expect(controller.getWebRTCStatus(device.ID)).not.toBe(
            WebRTCStatus.Failed,
        );
        jest.advanceTimersByTime(1);
        expect(controller.getWebRTCStatus(device.ID)).toBe(WebRTCStatus.Failed);
        expect(channel.trigger).toHaveBeenCalledWith(
            "client-private-connection-setup",
            { type: SignalingServerMessageType.ICECandidate, data: null },
        );
        await peer.onicecandidate!({ candidate: null });
        jest.advanceTimersByTime(5_000);
        expect(
            channel.trigger.mock.calls.filter(
                ([, data]) => (data as { data?: unknown }).data === null,
            ),
        ).toHaveLength(1);
    });
    for (const teardown of ["pause", "dispose", "unlink"] as const)
        it(`cancels pending failure on ${teardown}`, async () => {
            const { controller, peer, channel } = await fixture();
            await peer.onicecandidate!({ candidate: null });
            if (teardown === "pause") controller.pauseConnections();
            else if (teardown === "dispose") controller.teardown();
            else await controller.disconnectDevice(device);
            expect(jest.getTimerCount()).toBe(0);
            jest.advanceTimersByTime(5_000);
            expect(channel.trigger).not.toHaveBeenCalledWith(
                "client-private-connection-setup",
                { type: SignalingServerMessageType.ICECandidate, data: null },
            );
            expect(jest.getTimerCount()).toBe(0);
        });
    it("does not fail an already connected peer before its state callback arrives", async () => {
        const { controller, peer, channel } = await fixture();
        await peer.onicecandidate!({ candidate: null });
        peer.connectionState = "connected";
        jest.advanceTimersByTime(5_000);
        expect(controller.getWebRTCStatus(device.ID)).not.toBe(
            WebRTCStatus.Failed,
        );
        expect(channel.trigger).not.toHaveBeenCalledWith(
            "client-private-connection-setup",
            { type: SignalingServerMessageType.ICECandidate, data: null },
        );
    });
    it("cancels when an incoming data channel is already open", async () => {
        const { controller, peer, channel: signaling } = await fixture();
        await peer.onicecandidate!({ candidate: null });
        const channel = peer.createDataChannel();
        channel.readyState = "open";
        peer.ondatachannel!({ channel });
        expect(jest.getTimerCount()).toBe(0);
        jest.advanceTimersByTime(5_000);
        expect(controller.getWebRTCStatus(device.ID)).not.toBe(
            WebRTCStatus.Failed,
        );
        expect(signaling.trigger).not.toHaveBeenCalledWith(
            "client-private-connection-setup",
            { type: SignalingServerMessageType.ICECandidate, data: null },
        );
    });
    for (const state of ["connected", "failed", "disconnected", "closed"])
        it(`cancels on peer ${state}`, async () => {
            const { peer } = await fixture();
            await peer.onicecandidate!({ candidate: null });
            peer.connectionState = state;
            peer.onconnectionstatechange!();
            expect(jest.getTimerCount()).toBe(0);
        });
    for (const event of ["onopen", "onclose", "onerror"] as const)
        it(`cancels on local and remote channel ${event}`, async () => {
            for (const remote of [false, true]) {
                const { peer } = await fixture();
                const channel = remote
                    ? peer.createDataChannel()
                    : peer.channels[0];
                if (channel === undefined)
                    throw new Error(
                        "Expected a local data channel in the fixture.",
                    );
                if (remote) peer.ondatachannel!({ channel });
                await peer.onicecandidate!({ candidate: null });
                channel[event]!();
                expect(jest.getTimerCount()).toBe(0);
            }
        });
    it("never fails a replacement peer or a later vault generation", async () => {
        for (const changedGeneration of [false, true]) {
            const { manager, peer, channel } = await fixture();
            await peer.onicecandidate!({ candidate: null });
            if (changedGeneration) manager._lifecycleGeneration += 1;
            else
                manager._webRTConnections.set(device.ID, {
                    connection: new Peer() as unknown as RTCPeerConnection,
                    dataChannel: null,
                });
            jest.advanceTimersByTime(5_000);
            expect(channel.trigger).not.toHaveBeenCalledWith(
                "client-private-connection-setup",
                { type: SignalingServerMessageType.ICECandidate, data: null },
            );
        }
    });
});
