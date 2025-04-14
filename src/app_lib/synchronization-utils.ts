import { ulid } from "ulidx";
import * as VaultUtilTypes from "./proto/vault";

/**
 * WebSocket signaling server connection status.
 */
export enum SignalingStatus {
    Disconnected,
    Connecting,
    Connected,
    Unavailable,
    Failed,
}

/**
 * Device - device WebRTC connection status.
 */
export enum WebRTCStatus {
    Disconnected,
    Connecting,
    Connected,
    Failed,
}

//#region Signaling Server Message
/**
 * Signaling server message types.
 * Messages that are sent over the WebSocket signaling server connection. These messages are used to establish a WebRTC connection between the two devices.
 */
export enum SignalingServerMessageType {
    ICECandidate = "ice-candidate",
    ICECompleted = "ice-completed",
    Offer = "offer",
    Answer = "answer",
}

/**
 * Interface representing a signaling server message.
 * The data field can be either an RTCSessionDescriptionInit or an RTCIceCandidateInit.
 * Type of the data can be determined by using the isRTCSessionDescriptionInit function.
 */
export interface SignalingServerMessage {
    type: SignalingServerMessageType;
    data: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

/**
 * A type guard function to check if the data received from the signaling server is of type <code>RTCSessionDescriptionInit</code>.
 * @param data Data received from the signaling server
 * @returns true if the data is of type <code>RTCSessionDescriptionInit</code>, false otherwise
 */
export const isRTCSessionDescriptionInit = (
    data: RTCSessionDescriptionInit | RTCIceCandidateInit,
): data is RTCSessionDescriptionInit => "type" in data;
//#endregion Signaling Server Message

//#region SyncConnectionController Event
export enum SyncConnectionControllerEventType {
    ConnectionStatus,
    SynchronizationMessage,
}

/**
 * <code>SyncConnectionController</code> emitted event payload data type for Signaling connection events.
 */
export interface SignalingEventData {
    connectionState: SignalingStatus;
}

/**
 * WebRTC message event types.
 * @description Used only when the SCCEvent type is SynchronizationMessage.
 */
export enum WebRTCMessageEventType {
    Synchronized,
    ManualSyncNecessary,
}

/**
 * <code>SyncConnectionController</code> emitted event payload data type for WebRTC connection events.
 */
export interface WebRTCEventData {
    connectionState: WebRTCStatus;
    event?: WebRTCMessageEventType;
    message?: VaultUtilTypes.VaultItemSynchronizationMessage;
}

/**
 * <code>SyncConnectionController</code> emits events using this interface.
 */
export interface SCCEvent<T extends SignalingEventData | WebRTCEventData> {
    type: SyncConnectionControllerEventType;
    data: T;
}

/**
 * Type of the function that handles <code>SyncConnectionController</code> Signaling connection events.
 */
export type SCCSignalingEventHandler = (
    event: SCCEvent<SignalingEventData>,
) => void;

/**
 * Type of the function that handles <code>SyncConnectionController</code> WebRTC connection events.
 */
export type SCCWebRTCEventHandler = (event: SCCEvent<WebRTCEventData>) => void;
//#endregion SyncConnectionController Event

/**
 * A class that represents a synchronization message.
 * A serialized version of this class is sent over a data channel to the remote device.
 */
export class VaultItemSynchronizationMessage
    implements VaultUtilTypes.VaultItemSynchronizationMessage
{
    ID: string;
    Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand;
    Hash?: string;
    Diffs: VaultUtilTypes.Diff[];
    LinkedDevices: VaultUtilTypes.LinkedDevice[];

    constructor(
        id: null | string,
        command: VaultUtilTypes.VaultItemSynchronizationMessageCommand,
        hash?: string,
        diffs?: VaultUtilTypes.Diff[],
        linkedDevices?: VaultUtilTypes.LinkedDevice[],
    ) {
        this.ID = id ?? ulid();
        this.Command = command;
        this.Hash = hash;
        this.Diffs = diffs ?? [];
        this.LinkedDevices = linkedDevices ?? [];
    }

    public static deserialize(
        data: ArrayBuffer,
    ): VaultItemSynchronizationMessage {
        const decoded = VaultUtilTypes.VaultItemSynchronizationMessage.decode(
            new Uint8Array(data),
        );

        return new VaultItemSynchronizationMessage(
            decoded.ID,
            decoded.Command,
            decoded.Hash,
            decoded.Diffs,
            decoded.LinkedDevices,
        );
    }

    public serialize(): Uint8Array {
        return VaultUtilTypes.VaultItemSynchronizationMessage.encode(
            this,
        ).finish();
    }
}
