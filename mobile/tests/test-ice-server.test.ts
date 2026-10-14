import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockPeers: MockPeer[] = [];
class MockPeer {
    onicecandidate?: (event: { candidate: { candidate: string } }) => void;
    onicegatheringstatechange?: () => void;
    iceGatheringState = "gathering";
    close = jest.fn();
    createDataChannel = jest.fn();
    createOffer = jest.fn(async () => ({ type: "offer", sdp: "test" }));
    setLocalDescription = jest.fn(async () => {});
    constructor(public configuration: unknown) { mockPeers.push(this); }
}
jest.mock("@/lib/webrtc", () => ({ RTCPeerConnection: MockPeer }));
import { testIceServer } from "@/utils/test-ice-server";

beforeEach(() => { mockPeers.length = 0; jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe("custom ICE server verification", () => {
    it("requires a STUN response; a local host candidate does not imply reachability", async () => {
        const result = testIceServer("stun", { Host: "localhost:3478" });
        const peer = mockPeers[0];
        peer.onicecandidate!({ candidate: { candidate: "candidate:1 1 udp 1 127.0.0.1 1 typ host generation 0" } });
        await jest.advanceTimersByTimeAsync(15_000);
        expect((await result).ok).toBe(false);
        expect(peer.close).toHaveBeenCalledTimes(1);
    });

    it("accepts a server reflexive candidate and closes the test connection", async () => {
        const result = testIceServer("stun", { Host: "stun:localhost:3478" });
        const peer = mockPeers[0];
        peer.onicecandidate!({ candidate: { candidate: "candidate:1 1 udp 1 192.0.2.1 1 typ srflx raddr 127.0.0.1" } });
        expect((await result).ok).toBe(true);
        expect(peer.close).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it("tests a TURN allocation using the configured credentials and relay policy", async () => {
        const result = testIceServer("turn", { Host: "localhost:3478", Username: "review", Password: "test" });
        const peer = mockPeers[0];
        expect(peer.configuration).toEqual({ iceServers: [{ urls: "turn:localhost:3478", username: "review", credential: "test" }], iceTransportPolicy: "relay" });
        peer.onicecandidate!({ candidate: { candidate: "candidate:1 1 udp 1 192.0.2.1 1 typ relay raddr 127.0.0.1" } });
        expect((await result).ok).toBe(true);
        expect(peer.close).toHaveBeenCalledTimes(1);
    });

    it("fails promptly when gathering completes without a matching candidate", async () => {
        const result = testIceServer("turn", { Host: "localhost:3478" });
        const peer = mockPeers[0];
        peer.iceGatheringState = "complete";
        peer.onicegatheringstatechange!();
        expect((await result).ok).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
        expect(peer.close).toHaveBeenCalledTimes(1);
    });
});
