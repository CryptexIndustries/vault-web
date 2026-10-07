import { RTCPeerConnection } from "@/lib/webrtc";

/** Verify a STUN response or TURN allocation, without transferring vault data. */
export async function testIceServer(
    type: "stun" | "turn",
    server: { Host: string; Username?: string; Password?: string },
): Promise<{ ok: boolean; message: string }> {
    let peer: RTCPeerConnection | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const host = server.Host.trim();
        const urls = /^(stun|turn)s?:/i.test(host) ? host : `${type}:${host}`;
        const connection = new RTCPeerConnection({
            iceServers: [{ urls, username: server.Username, credential: server.Password }],
            iceTransportPolicy: type === "turn" ? "relay" : "all",
        });
        peer = connection;
        const candidateType = type === "turn" ? "relay" : "srflx";
        const reachable = await new Promise<boolean>((resolve, reject) => {
            timer = setTimeout(() => resolve(false), 15_000);
            connection.onicecandidate = (event: unknown) => {
                const candidate = (event as { candidate?: { candidate: string } }).candidate;
                if (candidate?.candidate.includes(` typ ${candidateType} `)) resolve(true);
            };
            connection.onicegatheringstatechange = () => {
                if (connection.iceGatheringState === "complete") resolve(false);
            };
            connection.createDataChannel("server-test");
            void connection.createOffer().then(offer => connection.setLocalDescription(offer)).catch(reject);
        });
        return reachable
            ? { ok: true, message: type === "turn" ? "TURN relay allocation succeeded." : "STUN connection test passed." }
            : { ok: false, message: "No response from this server. Check its address, credentials, and your connection." };
    } catch {
        return { ok: false, message: "Could not test this server. Check its configuration." };
    } finally {
        clearTimeout(timer);
        peer?.close();
    }
}
