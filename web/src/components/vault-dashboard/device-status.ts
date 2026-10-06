import {
    WebRTCStatus,
    SignalingStatus,
} from "@cryptex-industries/vault-core/synchronization-utils";
export type DeviceConnectionTone =
    | "connected"
    | "connecting"
    | "error"
    | "idle";

type DeviceConnectionDisplay = {
    label: string;
    title: string;
    tone: DeviceConnectionTone;
};

export function getDeviceConnectionDisplay({
    webRTCStatus,
    signalingServerStatus,
    lastSyncLabel,
}: {
    webRTCStatus: WebRTCStatus;
    signalingServerStatus: SignalingStatus;
    lastSyncLabel: string;
}): DeviceConnectionDisplay {
    if (webRTCStatus === WebRTCStatus.Connected) {
        return {
            label: `Connected - ${lastSyncLabel}`,
            title: "Device connection active",
            tone: "connected",
        };
    }

    if (
        webRTCStatus === WebRTCStatus.Failed ||
        signalingServerStatus === SignalingStatus.Failed
    ) {
        return {
            label:
                signalingServerStatus === SignalingStatus.Failed
                    ? "Signaling failed"
                    : "Connection failed",
            title:
                signalingServerStatus === SignalingStatus.Failed
                    ? "Signaling server connection failed"
                    : "WebRTC device connection failed",
            tone: "error",
        };
    }

    if (webRTCStatus === WebRTCStatus.Connecting) {
        return {
            label: "Connecting...",
            title: "Opening device connection",
            tone: "connecting",
        };
    }

    if (signalingServerStatus === SignalingStatus.Connecting) {
        return {
            label: "Connecting to signaling...",
            title: "Connecting to signaling server",
            tone: "connecting",
        };
    }

    if (signalingServerStatus === SignalingStatus.Connected) {
        return {
            label: "Ready to connect",
            title: "Signaling connected; device connection not active",
            tone: "connecting",
        };
    }

    if (signalingServerStatus === SignalingStatus.Unavailable) {
        return {
            label: "Signaling unavailable",
            title: "Signaling server unavailable",
            tone: "idle",
        };
    }

    return {
        label: `Disconnected - ${lastSyncLabel}`,
        title: "Device connection closed",
        tone: "idle",
    };
}
