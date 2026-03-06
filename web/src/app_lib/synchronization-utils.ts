import { ulid } from "ulidx";
import * as VaultUtilTypes from "./proto/vault";
import { err, ok } from "neverthrow";

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
    Error,
}

/**
 * <code>SyncConnectionController</code> emitted event payload data type for WebRTC connection events.
 */
export type WebRTCEventDataPayload = 
    | { type: SyncConnectionControllerEventType.ConnectionStatus, connectionState: WebRTCStatus }
    | { type: SyncConnectionControllerEventType.SynchronizationMessage, event: WebRTCMessageEventType.Error }
    | { type: SyncConnectionControllerEventType.SynchronizationMessage, event: WebRTCMessageEventType.Synchronized }

/**
 * <code>SyncConnectionController</code> emits events using this interface.
 */
export interface SCCEvent<T extends SignalingEventData> {
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
export type SCCWebRTCEventHandler = (
    event: WebRTCEventDataPayload
) => void;
//#endregion SyncConnectionController Event

/**
 * A class that represents a synchronization message.
 * A serialized version of this class is sent over a data channel to the remote device.
 */
export class SynchronizationEnvelope
    implements VaultUtilTypes.SynchronizationEnvelope
{
    ID: string;
    Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand;
    Payload: Uint8Array;

    private constructor(
        id: string,
        command: VaultUtilTypes.VaultItemSynchronizationMessageCommand,
        payload: Uint8Array,
    ) {
        this.ID = id ?? ulid();
        this.Command = command;
        this.Payload = payload;
    }

    public static deserialize(
        data: ArrayBuffer,
    ) {
        let decoded: VaultUtilTypes.SynchronizationEnvelope;
        try {
            decoded = VaultUtilTypes.SynchronizationEnvelope.decode(
                new Uint8Array(data),
            );
        } catch {
            return err("SYNC_ENVELOPE_DESERIALIZATION_FAILED");
        }

        const message: SynchronizationEnvelope = {
            ID: decoded.ID,
            Command: decoded.Command,
            Payload: decoded.Payload,
        };

        // Based on the command, deserialize the payload
        switch (message.Command) {
            case VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHello:
                try {
                    const syncHelloMessage = VaultUtilTypes.SyncHelloMessage.decode(message.Payload);
                    return ok({
                        id: message.ID,
                        command: message.Command,
                        data: syncHelloMessage,
                    });
                } catch {
                    return err("SYNC_HELLO_DESERIALIZATION_FAILED");
                }
            case VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho:
                try {
                    const syncHelloEchoMessage = VaultUtilTypes.SyncHelloEchoMessage.decode(message.Payload);
                    return ok({
                        id: message.ID,
                        command: message.Command,
                        data: syncHelloEchoMessage,
                    });
                } catch {
                    return err("SYNC_HELLO_ECHO_DESERIALIZATION_FAILED");
                }
            case VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest:
                try {
                    const syncDataRequestMessage = VaultUtilTypes.SyncDataRequestMessage.decode(message.Payload);
                    return ok({
                        id: message.ID,
                        command: message.Command,
                        data: syncDataRequestMessage,
                    });
                } catch {
                    return err("SYNC_DATA_REQUEST_DESERIALIZATION_FAILED");
                }
            case VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataResponse:
                try {
                    const syncDataResponseMessage = VaultUtilTypes.SyncDataResponseMessage.decode(message.Payload);
                    return ok({
                        id: message.ID,
                        command: message.Command,
                        data: syncDataResponseMessage,
                    });
                } catch {
                    return err("SYNC_DATA_RESPONSE_DESERIALIZATION_FAILED");
                }
            default:
                return err("SYNC_INVALID_COMMAND");
        }
    }

    public static serialize(instance: SynchronizationEnvelope): Uint8Array {
        return VaultUtilTypes.SynchronizationEnvelope.encode(
            instance,
        ).finish();
    }

    public static createSyncHelloMessage(versionVectors: VaultUtilTypes.VersionVector[]) {
        const envelopeID = ulid();
        const data = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: envelopeID,
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHello,
            Payload: VaultUtilTypes.SyncHelloMessage.encode({
                VersionVectors: versionVectors,
            }).finish(),
        }).finish();

        return {
            envelopeID,
            data,
        };
    }

    public static createSyncHelloEchoMessage(versionVectors: VaultUtilTypes.VersionVector[]) {
        const envelopeID = ulid();
        const data = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: envelopeID,
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho,
            Payload: VaultUtilTypes.SyncHelloEchoMessage.encode({
                VersionVectors: versionVectors,
            }).finish(),
        }).finish();

        return {
            envelopeID,
            data,
        };
    }

    public static createSyncDataRequestMessage(itemIDs: string[]) {
        const envelopeID = ulid();
        const data = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: envelopeID,
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest,
            Payload: VaultUtilTypes.SyncDataRequestMessage.encode({
                ItemIDs: itemIDs,
            }).finish(),
        }).finish();

        return {
            envelopeID,
            data,
        };
    }

    public static createSyncDataResponseMessage(envelopeID: string, credentials: VaultUtilTypes.Credential[]) {
        const data = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: envelopeID,
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataResponse,
            Payload: VaultUtilTypes.SyncDataResponseMessage.encode({
                Credentials: credentials,
            }).finish(),
        }).finish();

        return data;
    }
}

/**
 * Options for manual synchronization item selection.
 * Used to determine the action to take when resolving a manual synchronization conflict.
 */
export enum ManualSyncItemOption {
    KeepOurs,
    KeepTheirs,
    KeepBoth,
    Remove,
    Keep,
}

/**
 * Data that is used by the manual conflict resolution dialog for initial display.
 */
export interface ManualConflictResolutionDialogData {
    ourCredentials: VaultUtilTypes.Credential[];
    theirCredentials: VaultUtilTypes.Credential[];
    dialogList: Map<string, ManualSyncItemOption>;
}

/**
 * Data that is used by the manual conflict resolution function to apply 
 * the differences to the vault, and send the differences to the remote device.
 */
export interface ManualConflictResolutionData {
    ourCredentials: VaultUtilTypes.Credential[];
    theirCredentials: VaultUtilTypes.Credential[];
    userChoices: Map<string, ManualSyncItemOption>;
}