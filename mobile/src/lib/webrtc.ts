import { registerGlobals } from "react-native-webrtc";

export { RTCPeerConnection } from "react-native-webrtc";

/** Installs native WebRTC globals for shared vault-core synchronization. */
export function installWebRTCGlobals(): void {
    registerGlobals();
}
