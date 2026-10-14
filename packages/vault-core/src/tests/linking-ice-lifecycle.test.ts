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
    LinkingProcessController,
    LinkingProcessState,
    type LinkingProcessStatus,
} from "../vault-utils/linking";
import { initPusherInstance, initWebRTC } from "../synchronization";
import type { LinkingPackageBlob } from "../proto/vault";

jest.mock("../synchronization", () => ({
    initWebRTC: jest.fn(),
    initPusherInstance: jest.fn(),
}));
jest.mock("@scure/bip39", () => ({}));
jest.mock("@scure/bip39/wordlists/english.js", () => ({ wordlist: [] }));
jest.mock("../vault-utils/encryption", () => ({}));
jest.mock("../vault-utils/post-quantum-kem", () => ({}));
jest.mock("../vault-utils/sync-signing", () => ({}));
jest.mock("../vault-utils/sync-crypto", () => ({}));

async function receiver() {
    const peer = {
        connectionState: "new",
        onicecandidate: null as
            | ((event: { candidate: object | null }) => void)
            | null,
        onconnectionstatechange: null as (() => void) | null,
        ondatachannel: null as ((event: { channel: object }) => void) | null,
        close: jest.fn(() => {
            peer.connectionState = "closed";
        }),
    };
    const channel = { bind: jest.fn(), unbind: jest.fn(), trigger: jest.fn() };
    const signaling = {
        connection: { bind: jest.fn() },
        subscribe: jest.fn(() => channel),
        unsubscribe: jest.fn(),
        disconnect: jest.fn(),
        unbind: jest.fn(),
    };
    jest.mocked(initWebRTC).mockResolvedValue(
        peer as unknown as RTCPeerConnection,
    );
    jest.mocked(initPusherInstance).mockReturnValue(
        signaling as unknown as ReturnType<typeof initPusherInstance>,
    );
    const statuses: LinkingProcessStatus[] = [];
    const result = await LinkingProcessController.create(
        {
            SyncID: "receiver-test",
            STUNServers: [],
            TURNServers: [],
        } as unknown as LinkingPackageBlob,
        false,
        {
            signingPublicKey: "public",
            signingPrivateKey: "private",
            kemPublicKey: "kem-public",
            kemPrivateKey: "kem-private",
        },
        "fixture phrase",
        async (status) => {
            statuses.push(status);
        },
    );
    if (result.isErr()) throw result.error;
    return { peer, channel, signaling, statuses, controller: result.value };
}

const errors = (statuses: LinkingProcessStatus[]) =>
    statuses.filter((status) => status.State === LinkingProcessState.Error);

describe("receiver ICE grace lifecycle", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it("keeps the actual receiver alive for candidates published after an empty completion", async () => {
        const { peer, channel, statuses } = await receiver();
        peer.onicecandidate!({ candidate: null });
        expect(peer.close).not.toHaveBeenCalled();
        expect(errors(statuses)).toEqual([]);
        jest.advanceTimersByTime(8);
        const candidate = { candidate: "host-candidate" };
        peer.onicecandidate!({ candidate });
        expect(channel.trigger).toHaveBeenCalledWith("client-link", {
            type: "ice-candidate",
            data: candidate,
        });
        jest.advanceTimersByTime(5_000);
        expect(peer.close).not.toHaveBeenCalled();
        expect(errors(statuses)).toEqual([]);
    });

    it("cancels the actual controller's pending ICE failure on abort and ignores stale completion", async () => {
        const { peer, statuses, controller } = await receiver();
        peer.onicecandidate!({ candidate: null });
        expect(jest.getTimerCount()).toBe(1);
        controller.abortWaitingForDevice();
        expect(jest.getTimerCount()).toBe(0);
        peer.onicecandidate!({ candidate: null });
        jest.advanceTimersByTime(5_000);
        expect(peer.close).toHaveBeenCalledTimes(1);
        expect(errors(statuses)).toEqual([]);
        expect(jest.getTimerCount()).toBe(0);
    });

    it("preserves the genuine no-candidate error and closes the peer at the bounded deadline", async () => {
        const { peer, signaling, statuses } = await receiver();
        peer.onicecandidate!({ candidate: null });
        jest.advanceTimersByTime(4_999);
        expect(peer.close).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(errors(statuses)).toHaveLength(1);
        expect(errors(statuses)[0]?.LogMessage?.message).toBe(
            "Failed to generate ICE candidates. WebRTC failure.",
        );
        expect(peer.close).toHaveBeenCalledTimes(1);
        expect(signaling.disconnect).toHaveBeenCalledTimes(1);
    });

    it("cancels an empty-gather deadline when the receiver establishes its connection", async () => {
        const { peer, statuses } = await receiver();
        peer.onicecandidate!({ candidate: null });
        peer.connectionState = "connected";
        peer.onconnectionstatechange!();
        expect(jest.getTimerCount()).toBe(0);
        jest.advanceTimersByTime(5_000);
        expect(peer.close).not.toHaveBeenCalled();
        expect(errors(statuses)).toEqual([]);
    });

    it("cancels when the peer closes even without a data-channel close callback", async () => {
        const { peer, statuses } = await receiver();
        peer.onicecandidate!({ candidate: null });
        peer.connectionState = "closed";
        peer.onconnectionstatechange!();
        expect(jest.getTimerCount()).toBe(0);
        jest.advanceTimersByTime(5_000);
        expect(errors(statuses)).toEqual([]);
    });

    it.each(["connecting", "open"])(
        "cancels once an incoming %s data channel becomes open",
        async (readyState) => {
            const { peer, statuses } = await receiver();
            peer.onicecandidate!({ candidate: null });
            const channel = { readyState, onopen: null as (() => void) | null };
            peer.ondatachannel!({ channel });
            if (readyState === "connecting") channel.onopen!();
            expect(jest.getTimerCount()).toBe(0);
            jest.advanceTimersByTime(5_000);
            expect(peer.close).not.toHaveBeenCalled();
            expect(errors(statuses)).toEqual([]);
        },
    );

    it("does not fail an already connected peer while its state-change callback is delayed", async () => {
        const { peer, statuses } = await receiver();
        peer.onicecandidate!({ candidate: null });
        peer.connectionState = "connected";
        jest.advanceTimersByTime(5_000);
        expect(peer.close).not.toHaveBeenCalled();
        expect(errors(statuses)).toEqual([]);
    });
});
