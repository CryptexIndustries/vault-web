// Runs only through native-crypto-entry, with real native WebRTC and no RTC mocks.
import { RTCPeerConnection } from "react-native-webrtc";
import { completedLocalDescription } from "./native-webrtc-sdp";

type NativeDataChannel = ReturnType<RTCPeerConnection["createDataChannel"]>;
type Payload = string | Uint8Array;
const largeMessageBytes = 128 * 1024 + 17;

function check(value: unknown, message: string): asserts value {
    if (!value) throw new Error(`Native WebRTC: ${message}`);
}

async function bounded<T>(operation: Promise<T>, deadline: number, label: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Native WebRTC timed out: ${label}`)), Math.max(0, deadline - Date.now()));
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

function checkPayloads(actual: unknown[], expected: Payload[], direction: string) {
    check(actual.length === expected.length, `${direction} message count changed`);
    expected.forEach((payload, index) => {
        const received = actual[index];
        if (typeof payload === "string") {
            const codePoints = (value: unknown) => typeof value === "string"
                ? Array.from(value, character => `U+${character.codePointAt(0)!.toString(16).toUpperCase()}`).join(" ")
                : "not a string";
            const actualType = received instanceof ArrayBuffer ? "ArrayBuffer" : typeof received;
            check(received === payload, `${direction} text ${index} changed or arrived out of order; expectedType=string actualType=${actualType}; expected=${JSON.stringify(payload)} actual=${JSON.stringify(received)}; expectedCodePoints=${codePoints(payload)} actualCodePoints=${codePoints(received)}`);
        } else {
            check(received instanceof ArrayBuffer, `${direction} binary ${index} is not an ArrayBuffer; actualType=${typeof received} actual=${JSON.stringify(received)}`);
            const bytes = new Uint8Array(received);
            check(bytes.length === payload.length, `${direction} binary ${index} length changed; expectedBytes=${payload.length} actualBytes=${bytes.length}`);
            const mismatch = bytes.findIndex((byte, offset) => byte !== payload[offset]);
            check(mismatch === -1, `${direction} binary ${index} changed; offset=${mismatch} expectedByte=${payload[mismatch]} actualByte=${bytes[mismatch]}`);
        }
    });
}

async function runRound(round: number) {
    const deadline = Date.now() + 30_000;
    const peers: RTCPeerConnection[] = [];
    const channels: NativeDataChannel[] = [];
    const gathered = new Map<RTCPeerConnection, NonNullable<RTCPeerConnection["localDescription"]>>();
    let failure: Error | undefined;
    const wait = async (condition: () => boolean, label: string) => {
        while (true) {
            if (failure) throw failure;
            check(!peers.some(peer => peer.connectionState === "failed"), `${label}: peer connection failed`);
            if (condition()) return;
            check(Date.now() < deadline, `round ${round} timed out: ${label}`);
            await new Promise<void>(resolve => setTimeout(resolve, 25));
        }
    };
    const collect = (channel: NativeDataChannel, messages: unknown[]) => {
        channels.push(channel);
        channel.binaryType = "arraybuffer";
        channel.onmessage = (event: { data: unknown }) => { messages.push(event.data); };
        channel.onerror = () => { failure = new Error(`Native WebRTC: round ${round} channel error`); };
    };
    const localDescription = async (peer: RTCPeerConnection) => {
        // Exchange completed SDP including ICE candidates, avoiding early trickle races.
        let description: RTCPeerConnection["localDescription"] | undefined;
        await wait(() => {
            description = completedLocalDescription(peer.iceGatheringState, peer.localDescription, gathered.get(peer));
            return description !== undefined;
        }, "ICE gathering and completed candidate SDP");
        check(description, "completed local description missing");
        const media = description.sdp.split(/\r?\n/).filter(line => line.startsWith("m="));
        check(media.length === 1 && media[0].startsWith("m=application "), "SDP must be application-only");
        check(description.sdp.includes("a=candidate:"), "completed SDP has no ICE candidate");
        return description;
    };
    try {
        // Host candidates on the device are enough; this test never contacts STUN/TURN servers.
        const left = new RTCPeerConnection({ iceServers: [] });
        peers.push(left);
        const right = new RTCPeerConnection({ iceServers: [] });
        peers.push(right);
        for (const peer of peers) {
            // Retain valid completed SDP if an older setLocalDescription result arrives later.
            const retainCompleted = () => {
                const description = completedLocalDescription(peer.iceGatheringState, peer.localDescription, gathered.get(peer));
                if (description) gathered.set(peer, description);
            };
            peer.onicegatheringstatechange = retainCompleted;
            peer.onicecandidate = retainCompleted;
        }
        const receivedOnLeft: unknown[] = [];
        const receivedOnRight: unknown[] = [];
        const sender = left.createDataChannel(`native-transport-${round}`, { ordered: true });
        collect(sender, receivedOnLeft);
        const earlyHello = `${round}:initiator:immediate-hello`;
        let earlyHelloSends = 0;
        // Do not wait for the remote JS ondatachannel event before the first send.
        sender.onopen = () => {
            try {
                sender.send(earlyHello);
                earlyHelloSends++;
            } catch (error) {
                failure = new Error(`Native WebRTC immediate hello failed: ${String(error)}`);
            }
        };
        const remoteChannels: NativeDataChannel[] = [];
        right.ondatachannel = (event: { channel: NativeDataChannel }) => {
            remoteChannels.push(event.channel);
            collect(event.channel, receivedOnRight);
        };

        const offer = await bounded(left.createOffer(), deadline, "create offer");
        await bounded(left.setLocalDescription(offer), deadline, "set local offer");
        await bounded(right.setRemoteDescription(await localDescription(left)), deadline, "set remote offer");
        const answer = await bounded(right.createAnswer(), deadline, "create answer");
        await bounded(right.setLocalDescription(answer), deadline, "set local answer");
        await bounded(left.setRemoteDescription(await localDescription(right)), deadline, "set remote answer");
        await wait(() => sender.readyState === "open" && remoteChannels.some(channel => channel.readyState === "open"), "data channels open");
        check(remoteChannels.length === 1, "unexpected additional remote data channel");
        check(earlyHelloSends === 1, "initiator open callback must send exactly one immediate hello");
        await wait(() => receivedOnRight.length > 0, "immediate initiator hello");
        check(receivedOnRight[0] === earlyHello, "immediate hello was lost or was not the first receiver message");
        const receiver = remoteChannels[0];
        check(left.getTransceivers().length === 0 && right.getTransceivers().length === 0, "unexpected media transceiver");
        for (const channel of [sender, receiver]) {
            check(channel.ordered, "channel must preserve ordering");
            check((channel.maxRetransmits ?? -1) === -1 && (channel.maxPacketLifeTime ?? -1) === -1, "channel must use reliable delivery");
        }

        const payloads = (direction: string, seed: number): Payload[] => {
            // Nonzero byteOffset detects a bridge that mistakenly sends the entire backing buffer.
            const backing = new Uint8Array(largeMessageBytes + 12);
            const large = backing.subarray(7, 7 + largeMessageBytes);
            large.forEach((_, index) => { large[index] = (index * 137 + seed) & 255; });
            return [
                `${round}:${direction}:first`, `${round}:${direction}:UTF-8 ✓ 🔐`,
                `${round}:${direction}:NUL-before\0NUL-after`, `${round}:${direction}:last`,
                Uint8Array.from([0, 255, 128, 1, 42, seed, 13, 10, 0]), large,
            ];
        };
        const leftToRight = payloads("left-to-right", 11 + round);
        const rightToLeft = payloads("right-to-left", 71 + round);
        const send = (channel: NativeDataChannel, payload: Payload, index: number) => {
            if (typeof payload === "string") channel.send(payload);
            else if (index === 4) channel.send(payload.buffer as ArrayBuffer);
            else channel.send(payload);
        };
        leftToRight.forEach((payload, index) => {
            send(sender, payload, index);
            send(receiver, rightToLeft[index], index);
        });
        await wait(() => receivedOnLeft.length >= rightToLeft.length && receivedOnRight.length >= leftToRight.length + 1, "bidirectional payloads");
        checkPayloads(receivedOnRight, [earlyHello, ...leftToRight], "left-to-right");
        checkPayloads(receivedOnLeft, rightToLeft, "right-to-left");
        if (round === 2) {
            for (const peer of peers) peer.close();
            // The native wrapper disposes the peer and removes listeners on signaling close.
            await wait(() => peers.every(peer => peer.signalingState === "closed"), "peer-first close");
        }
        for (const channel of channels) channel.close();
        await wait(() => channels.every(channel => channel.readyState === "closed"), "channel close");
        if (round === 1) {
            for (const peer of peers) peer.close();
            await wait(() => peers.every(peer => peer.signalingState === "closed"), "channel-first peer close");
        }
        check(peers.every(peer => peer.signalingState === "closed") && channels.every(channel => channel.readyState === "closed"), "peer/channel teardown incomplete");
        console.info(`CRYPTEX_WEBRTC_ROUND ${round} passed`);
    } finally {
        // Attempt every close even if negotiation, transfer, or another close fails.
        for (const channel of channels) channel.onopen = null;
        for (const peer of peers) peer.ondatachannel = null;
        for (const resource of [...channels, ...peers]) {
            try { resource.close(); } catch (error) { console.warn(`Native WebRTC cleanup: ${String(error)}`); }
        }
    }
}

export async function runNativeWebRTCTests() {
    await runRound(1);
    await runRound(2);
    return { rounds: 2, applicationOnly: true, immediateHellos: 2, textMessages: 18, binaryBytes: 4 * (largeMessageBytes + 9), largeMessageBytes };
}
