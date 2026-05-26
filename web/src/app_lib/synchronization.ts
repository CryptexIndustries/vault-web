import PusherAuth from "pusher";
import Pusher, { type Channel } from "pusher-js";
import { ulid } from "ulidx";

import { env } from "../env/client.mjs";
import { ONLINE_SERVICES_SELECTION_ID } from "../utils/consts";
import { syncLog, signalingLog, webrtcLog } from "../utils/logging";
import { trpc } from "../utils/trpc";
import { createBareAuthHeader, ensureFreshOnlineServicesSession } from "./auth-session";
import * as VaultUtilTypes from "./proto/vault";
import {
    // ManualConflictResolutionDialogData,
    SignalingServerMessageType,
    SignalingStatus,
    SyncConnectionControllerEventType,
    SynchronizationEnvelope,
    WebRTCMessageEventType,
    WebRTCStatus,
    isRTCSessionDescriptionInit,
    type SCCSignalingEventHandler,
    type SCCWebRTCEventHandler,
    type SignalingServerMessage,
} from "./synchronization-utils";


/**
 * Interface for vault operations that the VaultItemSynchronization class needs
 */
export interface VaultOperations {
    getItemVersionVectors(): Promise<VaultUtilTypes.VersionVector[]>;
    getItemCredentials(itemIDs: string[]): Promise<VaultUtilTypes.Credential[]>;
    updateCredentials(credentials: VaultUtilTypes.Credential[]): Promise<void>;
    getSynchronizationConfig(): Promise<VaultUtilTypes.LinkedDevices>;
}

const onlineServicesSTUN = [
    // {
    //     urls: "stun:localhost:5349",
    // },
    {
        urls: "stun:rtc.cryptex-vault.com:5349",
    },
    {
        urls: "stun:stun.l.google.com:19302",
    },
    {
        urls: "stun:stun1.l.google.com:19302",
    },
    {
        urls: "stun:stun2.l.google.com:19302",
    },
];

const onlineServicesTURN = [
    {
        urls: "turn:rtc.cryptex-vault.com:5349",
        username: "cryx",
        credential: "cryx",
    },
];

const constructSyncChannelName = (
    syncID: string,
): string => {
    return `presence-sync-${syncID}`;
};

export const initWebRTC = (
    stunServers: VaultUtilTypes.STUNServerConfiguration[],
    turnServers: VaultUtilTypes.TURNServerConfiguration[],
): RTCPeerConnection => {
    // In case there are no STUN servers selected, use the default (Cryptex Vault Online Services) ones
    const _stunServers =
        stunServers.length == 0
            ? onlineServicesSTUN
            : stunServers.map((stunServer) => ({
                  urls: `stun:${stunServer.Host}`,
              }));

    // In case there are no TURN servers selected, use the default (Cryptex Vault Online Services) ones
    const _turnServers =
        turnServers.length == 0
            ? onlineServicesTURN
            : turnServers.map((turnServer) => ({
                  urls: `turn:${turnServer.Host}`,
                  username: turnServer.Username,
                  credential: turnServer.Password,
              }));

    // Return the initialized RTCPeerConnection
    return new RTCPeerConnection({
        iceServers: [..._stunServers, ..._turnServers],
    });
};

/**
 * Should not be used directly. Use the initPusherInstance function instead
 * @param syncID - The sync ID to use when connecting to the Online Services signaling server
 * @returns A new Pusher instance
 */
const onlineServicesPusherInstance = (syncID: string): Pusher => {
    return new Pusher(env.NEXT_PUBLIC_PUSHER_APP_KEY, {
        wsHost: env.NEXT_PUBLIC_PUSHER_APP_HOST,
        wsPort: parseInt(env.NEXT_PUBLIC_PUSHER_APP_PORT) ?? 6001,
        wssPort: parseInt(env.NEXT_PUBLIC_PUSHER_APP_PORT) ?? 6001,
        forceTLS: env.NEXT_PUBLIC_PUSHER_APP_TLS,
        // encrypted: true,
        enableStats: false,
        enabledTransports: ["ws", "wss"],
        cluster: "",
        userAuthentication: {
            transport: "ajax",
            endpoint: "",
            headersProvider: createBareAuthHeader,
            customHandler: (req, next) => {
                signalingLog.debug("Pusher auth request", { request: req });
                // return next(req);
            },
        },
        channelAuthorization: {
            transport: "ajax",
            endpoint: "",
            headersProvider: createBareAuthHeader,
            customHandler: async (req, next) => {
                try {
                    const data =
                        await trpc.v1.device.signalingAuthChannel.query({
                            channel_name: req.channelName,
                            socket_id: req.socketId,
                        });

                    return next(null, data);
                } catch (e) {
                    signalingLog.warn(
                        "Failed to authorize Pusher channel with Online Services",
                        { error: e }
                    );
                    return next(e as Error, null);
                }
            },
        },
    });
};

/**
 * Initializes a Pusher instance.
 * @param signalingServer - The signaling server configuration to use. If null, the default (Cryptex Vault Online Services) will be used.
 * @param syncID - The sync ID to use when connecting to the signaling server
 * @returns A Pusher instance
 */
export const initPusherInstance = (
    signalingServer: VaultUtilTypes.SignalingServerConfiguration | null,
    syncID: string,
): Pusher => {
    // In case the signaling server is not defined, we'll use the default (Cryptex Vault Online Services) one
    if (!signalingServer) {
        return onlineServicesPusherInstance(syncID);
    }

    // TODO: Remove this workaround. Each device should have a unique user_id
    // The user should be able to choose their own user_id
    const user_id = ulid();

    const usingTLS = parseInt(signalingServer.SecureServicePort) != 0;

    // Else, use the signaling server provided
    return new Pusher(signalingServer.Key, {
        wsHost: signalingServer.Host,
        wsPort: parseInt(signalingServer.ServicePort) ?? 6001,
        wssPort: parseInt(signalingServer.SecureServicePort) ?? 6001,
        forceTLS: usingTLS,
        enableStats: false,
        enabledTransports: ["ws", "wss"],
        cluster: "",
        userAuthentication: undefined,
        channelAuthorization: {
            transport: "jsonp",
            endpoint: "",
            // headersProvider: createAuthHeader,
            customHandler: async (req, next) => {
                signalingLog.debug("Custom signaling server channel auth request", { channelName: req.channelName });

                // Craft the authorization data
                const pusherAuth = new PusherAuth({
                    appId: signalingServer.AppID,
                    key: signalingServer.Key,
                    secret: signalingServer.Secret,
                    useTLS: usingTLS,
                    host: signalingServer.Host,
                    port: usingTLS
                        ? signalingServer.SecureServicePort
                        : signalingServer.ServicePort,
                });

                const userData = {
                    user_id: user_id,
                    user_info: {
                        id: user_id,
                    },
                };

                const data = pusherAuth.authorizeChannel(
                    req.socketId,
                    req.channelName,
                    userData,
                );

                return next(null, data);
            },
        },
    });
};

/**
 * This object manages the signaling and WebRTC connections.
 * A shorthand for "Synchronization Connection Controller" is "SCC".
 */
export class SyncConnectionController {
    // Immutable signaling server event name, over which we transport the signaling data
    private readonly _signalingEventName = "client-private-connection-setup";

    // Map<serverID, Pusher>
    private _signalingServers: Map<string, Pusher>;

    // Map<serverID, status>
    private _signalingServerConnectionStatus: Map<string, SignalingStatus>;

    // Map<serverID, Map<uniqueID, handler>>
    private _syncSignalingConnectionEventHandlers: Map<
        string,
        Map<string, SCCSignalingEventHandler>
    >;

    // Map<deviceID, { connection: RTCPeerConnection; dataChannel: RTCDataChannel | null }>
    private _webRTConnections: Map<
        string,
        { connection: RTCPeerConnection; dataChannel: RTCDataChannel | null }
    >;

    // Map<deviceID, status>
    private _webRTCStatus: Map<string, WebRTCStatus>;

    // Map<deviceID, handler>
    private _syncWebRTCEventHandlers: Map<string, SCCWebRTCEventHandler>;

    // Vault operations interface
    private _vaultOperations: VaultOperations;

    // Vault item synchronization handler
    private _vaultItemSynchronization: VaultItemSynchronization;

    constructor(vaultOperations: VaultOperations) {
        this._vaultOperations = vaultOperations;
        this._vaultItemSynchronization = new VaultItemSynchronization(vaultOperations, this);

        this._signalingServers = new Map();
        this._signalingServerConnectionStatus = new Map();

        this._syncSignalingConnectionEventHandlers = new Map();
        this._syncWebRTCEventHandlers = new Map();

        this._webRTConnections = new Map();
        this._webRTCStatus = new Map();
    }

    public init() {
        syncLog.info("SyncConnectionController initialized");
    }

    public teardown() {
        syncLog.info("Tearing down signaling and WebRTC connections");

        // Tear down the signaling servers
        this._signalingServers.forEach((server, id) => {
            this._teardownSignalingConnection(id, server);
        });

        this._syncSignalingConnectionEventHandlers.forEach(
            (handlers, serverID) => {
                handlers.forEach((_, uniqueID) => {
                    this.removeSyncSignalingHandler(serverID, uniqueID);
                });
            },
        );
        this._syncSignalingConnectionEventHandlers.clear();

        // Tear down the WebRTC connections
        this._webRTConnections.forEach((connPackage, id) => {
            this._teardownWebRTCConnection(id, connPackage);
        });

        this._syncWebRTCEventHandlers.forEach((_, id) => {
            this.removeSyncWebRTCHandler(id);
        });
        this._syncWebRTCEventHandlers.clear();

        syncLog.info("SyncConnectionController torn down");
    }

    private _teardownSignalingConnection(id: string, instance: Pusher) {
        signalingLog.info(
            `Tearing down signaling connection for server ${id}`,
            { serverId: id }
        );

        instance.connection.unbind();
        instance.disconnect();
        instance.unbind_global();

        this._signalingServers.delete(id);
        this._signalingServerConnectionStatus.delete(id);
    }

    private _teardownWebRTCConnection(
        id: string,
        instance: {
            connection: RTCPeerConnection;
            dataChannel: RTCDataChannel | null;
        },
    ) {
        webrtcLog.info(
            `Tearing down WebRTC connection for device ${id}`,
            { deviceId: id }
        );

        // if (
        //     instance.dataChannel &&
        //     instance.dataChannel.readyState !== "closed"
        // ) {
        instance.dataChannel?.close();
        // }

        instance.connection.close();

        this._webRTConnections.delete(id);
        this._webRTCStatus.delete(id);
    }

    public getSignalingStatus(serverID: string): SignalingStatus {
        return (
            this._signalingServerConnectionStatus.get(serverID) ??
            SignalingStatus.Disconnected
        );
    }

    public getWebRTCStatus(deviceID: string): WebRTCStatus {
        return this._webRTCStatus.get(deviceID) ?? WebRTCStatus.Disconnected;
    }

    /**
     * Connects to the signaling server.
     * @param syncID - The device synchronization relationship identifier
     * @param server - The signaling server configuration to use. If null, the default (Cryptex Vault Online Services) will be used.
     * @returns A Pusher instance
     */
    private _connectSignalingServer(
        syncID: string,
        server: VaultUtilTypes.SignalingServerConfiguration | null,
    ) {
        const id = server?.ID ?? ONLINE_SERVICES_SELECTION_ID;

        if (server)
            signalingLog.info(
                `Connecting to signaling server - ID: ${server.ID} | Name: ${server.Name} | Sync ID: ${syncID}`,
                { serverId: server.ID, serverName: server.Name, syncId: syncID }
            );
        else
            signalingLog.info(
                `Connecting to Online Services signaling server with sync ID: ${syncID}`,
                { syncId: syncID }
            );

        this._signalingServerConnectionStatus.set(
            id,
            SignalingStatus.Disconnected,
        );

        this.broadcastSignalingServerEvent(id, SignalingStatus.Disconnected);

        const signalingServerConn = initPusherInstance(server, syncID);

        this._bindSignalingServerConnectionEvents(signalingServerConn, id);

        this._signalingServers.set(id, signalingServerConn);

        return signalingServerConn;
    }

    private _bindSignalingServerConnectionEvents(
        signalingServerConn: Pusher,
        serverID: string,
    ) {
        type PusherInternalConnectionState =
            | "initialized"
            | "connecting"
            | "connected"
            | "unavailable"
            | "disconnected"
            | "failed";
        signalingServerConn.connection.bind(
            "state_change",
            (state: {
                previous: PusherInternalConnectionState;
                current: PusherInternalConnectionState;
            }) => {
                let newSignalingStatus: SignalingStatus;
                switch (state.current) {
                    case "connecting":
                        newSignalingStatus = SignalingStatus.Connecting;
                        break;
                    case "connected":
                        newSignalingStatus = SignalingStatus.Connected;
                        break;
                    case "unavailable":
                        newSignalingStatus = SignalingStatus.Unavailable;
                        break;
                    case "failed":
                        newSignalingStatus = SignalingStatus.Failed;
                        break;
                    case "initialized":
                    case "disconnected":
                    default:
                        newSignalingStatus = SignalingStatus.Disconnected;
                        break;
                }

                signalingLog.debug(
                    `Connection state changed: ${state.previous} -> ${state.current}`,
                    { previous: state.previous, current: state.current, serverId: serverID }
                );

                this._signalingServerConnectionStatus.set(
                    serverID,
                    newSignalingStatus,
                );

                this.broadcastSignalingServerEvent(
                    serverID,
                    newSignalingStatus,
                );
            },
        );
    }

    private _setupSignalingSubscriptions(
        signalingServerConn: Pusher,
        device: VaultUtilTypes.LinkedDevice,
        channelName: string,
    ) {
        //console.debug(channelName, signalingServerConn.allChannels());
        // Check if we're already subscribed to this channel
        const existing = signalingServerConn
            .allChannels()
            .find((c) => c.name === channelName);
        if (existing) {
            signalingLog.debug(
                `Already subscribed to channel, cleaning up and resubscribing`,
                { channelName }
            );

            // Remove the old channel subscription
            existing.unsubscribe();
            existing.unbind();
        }

        // Subscribe to correct topics and trigger WebRTC connection setup
        const channel = signalingServerConn.subscribe(channelName);
        channel.bind(
            "pusher:subscription_succeeded",
            async (context: { count: number }) => {
                signalingLog.info(
                    `Channel subscription succeeded`,
                    { channelName, memberCount: context.count }
                );
            },
        );

        channel.bind(
            this._signalingEventName,
            async (data: SignalingServerMessage) => {
                signalingLog.debug(
                    `Received signaling event: ${data.type}`,
                    { type: data.type, deviceId: device.ID }
                );

                this._processSignalingData(channel, device, data);
            },
        );

        channel.bind("pusher:member_added", async (data: { id: string }) => {
            signalingLog.info(
                `Member joined channel`,
                { memberId: data.id, channelName }
            );

            // Create a WebRTC offer and send it to the new device to initiate the connection
            const offer = await this._craftWebRTCOffer(device.ID);
            channel.trigger(this._signalingEventName, {
                type: SignalingServerMessageType.Offer,
                data: offer,
            });

            signalingLog.debug("Sent WebRTC offer to new member", { memberId: data.id });
        });
        return channel;
    }

    private async _craftWebRTCOffer(deviceID: string) {
        // Get the WebRTC connection for the device
        const webRTC = this._webRTConnections.get(deviceID);

        // If there is no WebRTC connection, we can't do anything
        if (!webRTC) {
            signalingLog.error(
                `No initialized WebRTC connection found for device while crafting offer`,
                { deviceId: deviceID }
            );

            return;
        }

        const offer = await webRTC.connection.createOffer();
        await webRTC.connection.setLocalDescription(offer);

        signalingLog.debug(
            `Crafted WebRTC offer for device ${deviceID}`,
            { deviceId: deviceID, offer: offer }
        );

        return offer;
    }

    private async _processSignalingData(
        signalingChannel: Channel,
        device: VaultUtilTypes.LinkedDevice,
        data: SignalingServerMessage,
    ) {
        // Get the WebRTC connection for the device
        const webRTC = this._webRTConnections.get(device.ID);

        // If there is no WebRTC connection, we can't do anything
        if (!webRTC) {
            signalingLog.error(
                `No initialized WebRTC connection found for device while processing signaling data`,
                { deviceId: device.ID, deviceName: device.Name }
            );

            // Not sure if this needs to be broadcast, so leave it alone ATM
            //this.broadcastWebRTCConnectionEvent(device.ID, WebRTCStatus.Failed, "Received an ICE candidate with no data. Failed to exchange ICE candidates.");
            //this.broadcastSignalingServerEvent(device.SignalingServerID, SignalingStatus.Connected, `Could not find an initialized WebRTC connection for device "${device.ID}", but received a signaling message. This should never happen.`);
            return;
        }

        // Configure the WebRTC connection
        if (data.type === SignalingServerMessageType.ICECandidate) {
            if (!data.data) {
                signalingLog.error(
                    `Received an ICE candidate with no data. Failed to exchange ICE candidates.`,
                    { deviceId: device.ID, deviceName: device.Name }
                );
                this.broadcastWebRTCConnectionEvent(
                    device.ID,
                    WebRTCStatus.Failed,
                );
                return;
            }

            // The data needs to be an ICE candidate object
            if (isRTCSessionDescriptionInit(data.data)) return;

            await webRTC.connection.addIceCandidate(data.data);
        } else if (
            data.data &&
            (data.type === SignalingServerMessageType.Offer ||
                data.type === SignalingServerMessageType.Answer)
        ) {
            // Make sure that the data isn't an ICE candidate object
            if (!isRTCSessionDescriptionInit(data.data)) return;

            await webRTC.connection.setRemoteDescription(data.data);

            const isOffer = data.type === SignalingServerMessageType.Offer;
            if (isOffer) {
                const answer = await webRTC.connection.createAnswer();
                await webRTC.connection.setLocalDescription(answer);

                signalingChannel.trigger(this._signalingEventName, {
                    type: SignalingServerMessageType.Answer,
                    data: answer,
                });

                signalingLog.debug(
                    "Sent WebRTC answer",
                    { deviceId: device.ID }
                );
            }
        } else if (data.type === SignalingServerMessageType.ICECompleted) {
            signalingLog.debug(
                "Received ICE completed event from peer",
                { deviceId: device.ID }
            );
        } else {
            signalingLog.error(
                "Received unknown signaling message type",
                { type: data.type, deviceId: device.ID }
            );
        }
    }

    private _setupWebRTCConnection(
        linkedDevices: VaultUtilTypes.LinkedDevices,
        signalingChannel: Channel,
        device: VaultUtilTypes.LinkedDevice,
    ) {
        const stun = linkedDevices.STUNServers.filter((server) =>
            device.STUNServerIDs.includes(server.ID),
        );
        const turn = linkedDevices.TURNServers.filter((server) =>
            device.TURNServerIDs.includes(server.ID),
        );

        // Instantiate the WebRTC object
        const webRTC = initWebRTC(stun, turn);

        webRTC.onconnectionstatechange = () => {
            let newWebRTCStatus: WebRTCStatus;
            if (webRTC.connectionState === "connected") {
                signalingChannel.unsubscribe();
                signalingChannel.unbind();

                newWebRTCStatus = WebRTCStatus.Connected;
            } else if (webRTC.connectionState === "connecting") {
                newWebRTCStatus = WebRTCStatus.Connecting;
            } else if (webRTC.connectionState === "disconnected") {
                newWebRTCStatus = WebRTCStatus.Disconnected;
            } else if (webRTC.connectionState === "failed") {
                newWebRTCStatus = WebRTCStatus.Failed;
            } else {
                webrtcLog.warn(
                    `Received unknown connection state`,
                    { state: webRTC.connectionState, deviceId: device.ID, deviceName: device.Name }
                );
                newWebRTCStatus = WebRTCStatus.Failed;
            }

            this._webRTCStatus.set(device.ID, newWebRTCStatus);
            webrtcLog.info(
                `Connection state changed ${WebRTCStatus[newWebRTCStatus]}`,
                { deviceId: device.ID, deviceName: device.Name, state: webRTC.connectionState }
            );
            this.broadcastWebRTCConnectionEvent(device.ID, newWebRTCStatus);
        };

        let iceCandidatesWeGenerated = 0;
        webRTC.onicecandidate = async (event) => {
            if (event && event.candidate) {
                signalingLog.debug(
                    `Sending ICE candidate`,
                    { deviceId: device.ID, deviceName: device.Name, candidateType: event.candidate.type }
                );

                signalingChannel.trigger(this._signalingEventName, {
                    type: SignalingServerMessageType.ICECandidate,
                    data: event.candidate,
                });

                iceCandidatesWeGenerated++;
            }

            // When the event.candidate object is null - we're done
            // NOTE: Might be helpful to send that to the other device so that we can show a notification
            if (event?.candidate == null) {
                signalingLog.debug(
                    `ICE gathering complete, sending ICE completed event`,
                    { deviceId: device.ID, deviceName: device.Name, candidatesGenerated: iceCandidatesWeGenerated }
                );

                signalingChannel.trigger(this._signalingEventName, {
                    type: SignalingServerMessageType.ICECompleted,
                });
            }

            // If we haven't generated any ICE candidates, and this event was triggered without a candidate, we're done
            if (iceCandidatesWeGenerated === 0 && !event.candidate) {
                signalingChannel.trigger(this._signalingEventName, {
                    type: SignalingServerMessageType.ICECandidate,
                    data: null,
                });

                // Update the status, and clean up the connection
                this._webRTCStatus.set(device.ID, WebRTCStatus.Failed);
                signalingLog.error(
                    `Failed to generate any ICE candidates`,
                    { deviceId: device.ID, deviceName: device.Name }
                );
                this.broadcastWebRTCConnectionEvent(
                    device.ID,
                    WebRTCStatus.Failed,
                );
            }
        };

        const dataChannelOnOpen =
            (dataChannel: RTCDataChannel) => (event: Event) => {
                webrtcLog.info(
                    `Data channel opened`,
                    { deviceId: device.ID, deviceName: device.Name, channelLabel: dataChannel.label }
                );

                // Save the data channel in the WebRTC connections map
                const currentConnection = this._webRTConnections.get(device.ID);
                if (currentConnection) {
                    currentConnection.dataChannel = dataChannel;
                    this._webRTConnections.set(device.ID, currentConnection);
                }
            };

        const dataChannelOnClose = () => (event: Event) => {
            webrtcLog.info(
                `Data channel closed`,
                { deviceId: device.ID, deviceName: device.Name }
            );

            // Broadcast the disconnection - we treat this as a general disconnect event
            // NOTE: Even though we could probably recover from this state by  opening a new data channel?
            // Should investigate possible connection recovery procedures
            this._webRTCStatus.set(device.ID, WebRTCStatus.Disconnected);
            webrtcLog.info(
                `Data channel closed`,
                { deviceId: device.ID, deviceName: device.Name }
            );
            this.broadcastWebRTCConnectionEvent(
                device.ID,
                WebRTCStatus.Disconnected,
            );
        };

        const dataChannelOnError = () => (event: Event) => {
            webrtcLog.error(
                `Data channel error`,
                { deviceId: device.ID, deviceName: device.Name }
            );

            // Broadcast the failure - we treat this as a general WebRTC failure
            // NOTE: Even though we could probably recover from this state by opening a new data channel?
            // Should investigate possible connection recovery procedures
            this._webRTCStatus.set(device.ID, WebRTCStatus.Failed);
            webrtcLog.error(
                `Data channel error`,
                { deviceId: device.ID, deviceName: device.Name }
            );
            this.broadcastWebRTCConnectionEvent(device.ID, WebRTCStatus.Failed);
        };

        const dataChannelOnMessage =
            (dataChannel: RTCDataChannel) => (event: MessageEvent) => {
                webrtcLog.debug(
                    `Received data channel message`,
                    { deviceId: device.ID, deviceName: device.Name, dataSize: event.data?.length ?? 0 }
                );

                this._vaultItemSynchronization.onDataChannelMessage(
                    device.ID,
                    dataChannel,
                    event,
                );
            };

        // NOTE: This event is not triggered for local data channels
        // Meaning, this is used when the remote device creates a data channel, and we connect to it
        webRTC.ondatachannel = (event) => {
            const dataChannel = event.channel;
            webrtcLog.info(
                `Remote data channel received`,
                { deviceId: device.ID, deviceName: device.Name, channelLabel: dataChannel.label }
            );

            dataChannel.onopen = dataChannelOnOpen(dataChannel);
            dataChannel.onclose = dataChannelOnClose();
            dataChannel.onerror = dataChannelOnError();
            dataChannel.onmessage = dataChannelOnMessage(dataChannel);
        };

        // Create a data channel - will be used if we're the first to create it
        const dataChannel = webRTC.createDataChannel("data-channel");

        dataChannel.onmessage = dataChannelOnMessage(dataChannel);

        // FIXME: These binds caused duplicated events to be triggered
        // FIXME: ??Does the onDataChannel actually trigger for both vaults??
        // dataChannel.onopen = dataChannelOnOpen(dataChannel);
        // dataChannel.onclose = dataChannelOnClose(dataChannel);
        // dataChannel.onerror = dataChannelOnError(dataChannel);

        return webRTC;
    }

    /**
     * Connects to the given device.
     * Initiates the signaling server connection if necessary (if the connection hasn't been established yet).
     * Also sets up the WebRTC connection object that will be used when the signaling server connection is established.
     * @param deviceID - The ID of the device to connect to
     * @returns A boolean indicating whether the connection was successful or not
     */
    public async connectDevice(deviceID: string) {
        const linkedDevicesConfig = await this._vaultOperations.getSynchronizationConfig();
        const device = linkedDevicesConfig.Devices.find((i) => i.ID === deviceID);

        if (!device) {
            syncLog.error(
                "Device not found",
                { deviceId: deviceID }
            );
            return false;
        }

        syncLog.info(
            "Initiating device connection",
            { deviceId: deviceID, deviceName: device.Name }
        );

        // Check if we have a signaling server for the current device
        let signalingServerConn = this._signalingServers.get(
            device.SignalingServerID,
        );

        // When the signaling server connection doesn't exist or is faulty - try to create a new one
        if (
            !signalingServerConn ||
            (signalingServerConn.connection.state !== "connecting" &&
                signalingServerConn.connection.state !== "connected")
        ) {
            const signalingServerConfig =
                linkedDevicesConfig.SignalingServers.find(
                    (i) => i.ID === device.SignalingServerID,
                );

            if (
                !signalingServerConfig &&
                device.SignalingServerID !== ONLINE_SERVICES_SELECTION_ID
            ) {
                signalingLog.error(
                    "Device configured to use unknown signaling server",
                    { deviceId: device.ID, signalingServerId: device.SignalingServerID }
                );
                return false;
            }

            signalingServerConn = this._connectSignalingServer(
                device.SyncID,
                signalingServerConfig ?? null, // If this comes out to null - it's an Online Services server
            );
        }

        if (!signalingServerConn) {
            signalingLog.error(
                "Signaling connection instantiation failed",
                { deviceId: device.ID }
            );
            return false;
        }

        const existingWebRTC = this._webRTConnections.get(device.ID);

        if (
            existingWebRTC &&
            (existingWebRTC.connection.connectionState === "connected" ||
                existingWebRTC.connection.connectionState === "connecting")
        ) {
            webrtcLog.debug(
                `Existing connection found, skipping`,
                { deviceId: device.ID, state: existingWebRTC.connection.connectionState }
            );
            return false;
        }

        // Clean up the existing connection handlers
        if (existingWebRTC) {
            this._teardownWebRTCConnection(device.ID, existingWebRTC);
        }

        const channelName = constructSyncChannelName(device.SyncID);

        const channel = this._setupSignalingSubscriptions(
            signalingServerConn,
            device,
            channelName,
        );

        // Trigger the WebRTC connection setup
        const webRTC = this._setupWebRTCConnection(
            linkedDevicesConfig,
            channel,
            device,
        );

        // Add the WebRTC connection to the list of WebRTC connections
        this._webRTConnections.set(device.ID, {
            connection: webRTC,
            dataChannel: null,
        });

        return true;
    }

    public async disconnectDevice(device: VaultUtilTypes.LinkedDevice) {
        syncLog.info(
            `Disconnecting device`,
            { deviceId: device.ID, deviceName: device.Name }
        );

        const signalingServer = this._signalingServers.get(
            device.SignalingServerID,
        );

        // Check if the signaling server is used for anything, if not - tear the connection down
        if (signalingServer) {
            const linkedDevicesConfig = await this._vaultOperations.getSynchronizationConfig();

            // Get all devices specifying the same Signaling server
            const linkedDevicesUsingSS = linkedDevicesConfig.Devices.filter(
                (i) => i.SignalingServerID === device.SignalingServerID,
            ).map((i) => i.ID);

            const webRTCInstances = this._webRTConnections.entries();
            const youngConnectionExists = webRTCInstances
                .filter((i) => linkedDevicesUsingSS.includes(i[0]))
                .some((i) => i[1].connection.connectionState === "new");

            // If any connection is in the "new" state, it means that it still needs to be established
            // Therefore, we should not kill it's signaling server
            if (!youngConnectionExists) {
                this._teardownSignalingConnection(
                    device.SignalingServerID,
                    signalingServer,
                );
            }
        }

        // Try to get a WebRTC connection
        const webRTC = this._webRTConnections.get(device.ID);

        if (!webRTC) {
            webrtcLog.debug(
                `No WebRTC handle found for disconnection`,
                { deviceId: device.ID }
            );
            return false;
        }

        // Clean up the webRTC connection
        this._teardownWebRTCConnection(device.ID, webRTC);
        return true;
    }

    public registerSyncSignalingHandler(
        serverID: string,
        handler: SCCSignalingEventHandler,
    ) {
        // If the signaling server event handlers map doesn't exist, create it
        if (!this._syncSignalingConnectionEventHandlers.has(serverID)) {
            this._syncSignalingConnectionEventHandlers.set(serverID, new Map());
        }

        const handlerList =
            this._syncSignalingConnectionEventHandlers.get(serverID);

        // If the handler list doesn't exist, return null (this should never happen since we created it above just in case)
        if (!handlerList) return null;

        // Generate a unique ID for the event handler
        const uniqueID = ulid();

        // Remove the event handler if it already exists
        if (handlerList.has(uniqueID)) {
            // NOTE: Just remove the reference to the event handler
            // leave it to the GC to clean it up
            handlerList.delete(uniqueID);
        }

        // Create the event handlers map for the device ID
        handlerList.set(uniqueID, handler);
        this._syncSignalingConnectionEventHandlers.set(serverID, handlerList);

        return uniqueID;
    }

    public removeSyncSignalingHandler(serverID: string, handlerID: string) {
        // Remove the event handler if it exists
        if (!this._syncSignalingConnectionEventHandlers.has(serverID)) return;

        const handlerList =
            this._syncSignalingConnectionEventHandlers.get(serverID);

        // If the handler list doesn't exist, return
        if (!handlerList) return;

        // NOTE: Just remove the reference to the event handler
        // leave it to the GC to clean it up
        handlerList.delete(handlerID);

        this._syncSignalingConnectionEventHandlers.set(serverID, handlerList);
    }

    public registerSyncWebRTCHandler(
        deviceID: string,
        handler: SCCWebRTCEventHandler,
    ) {
        // Remove the event handler if it already exists
        if (this._syncWebRTCEventHandlers.has(deviceID)) {
            // NOTE: Just remove the reference to the event handler
            // leave it to the GC to clean it up
            this._syncWebRTCEventHandlers.delete(deviceID);
        }

        // Create the event handlers map for the device ID
        this._syncWebRTCEventHandlers.set(deviceID, handler);
    }

    public removeSyncWebRTCHandler(deviceID: string) {
        // Remove the event handler if it exists
        if (!this._syncWebRTCEventHandlers.has(deviceID)) {
            return;
        }

        // NOTE: Just remove the reference to the event handler
        // leave it to the GC to clean it up
        this._syncWebRTCEventHandlers.delete(deviceID);
    }

    private broadcastSignalingServerEvent(
        serverID: string,
        connectionState: SignalingStatus,
    ) {
        // Get the signaling server event handlers for the server ID
        const deviceEventHandlers =
            this._syncSignalingConnectionEventHandlers.get(serverID);

        if (!deviceEventHandlers) return;

        signalingLog.debug(
            `Broadcasting signaling status: ${SignalingStatus[connectionState]}`,
            { serverId: serverID, status: SignalingStatus[connectionState] }
        );

        deviceEventHandlers.forEach((handler) => {
            handler({
                type: SyncConnectionControllerEventType.ConnectionStatus,
                data: {
                    connectionState: connectionState,
                },
            });
        });
    }

    private broadcastWebRTCConnectionEvent(
        deviceID: string,
        connectionState: WebRTCStatus,
    ) {
        if (!this._webRTCStatus.has(deviceID)) return;

        // Get the WebRTC status event handlers for the device ID
        const deviceEventHandler = this._syncWebRTCEventHandlers.get(deviceID);

        // In case there is no event handler for the device, we can just return
        if (!deviceEventHandler) return;

        webrtcLog.debug(
            `Broadcasting WebRTC status: ${WebRTCStatus[connectionState]}`,
            { deviceId: deviceID, status: WebRTCStatus[connectionState] }
        );

        // deviceEventHandler({
        //     type: SyncConnectionControllerEventType.ConnectionStatus,
        //     data: {
        //         connectionState: connectionState,
        //     },
        // });
        deviceEventHandler({
            type: SyncConnectionControllerEventType.ConnectionStatus,
            connectionState
        });
    }

    public broadcastWebRTCSyncErrorEvent(
        deviceID: string,
    ) {
        if (!this._webRTCStatus.has(deviceID)) return;

        // Get the WebRTC status event handlers for the device ID
        const deviceEventHandler = this._syncWebRTCEventHandlers.get(deviceID);

        // In case there is no event handler for the device, we can just return
        if (!deviceEventHandler) return;

        deviceEventHandler({
            type: SyncConnectionControllerEventType.SynchronizationMessage,
            event: WebRTCMessageEventType.Error,
        });
    }

    public broadcastWebRTCSynchronizedEvent(deviceID: string) {
        if (!this._webRTCStatus.has(deviceID)) return;

        // Get the WebRTC status event handlers for the device ID
        const deviceEventHandler = this._syncWebRTCEventHandlers.get(deviceID);

        // In case there is no event handler for the device, we can just return
        if (!deviceEventHandler) return;

        syncLog.info(
            `Synchronization completed`,
            { deviceId: deviceID }
        );

        deviceEventHandler({
            type: SyncConnectionControllerEventType.SynchronizationMessage,
            event: WebRTCMessageEventType.Synchronized,
        });
    }

    public transmitSyncHello(deviceID: string) {
        // Get the WebRTC connection for the device
        const webRTC = this._webRTConnections.get(deviceID);

        // If there is no WebRTC connection, we can't do anything
        if (!webRTC) {
            webrtcLog.warn(
                `No WebRTC connection for sync hello`,
                { deviceId: deviceID }
            );

            return;
        }

        // Get the WebRTC data channel
        const dataChannel = webRTC.dataChannel;
        if (!dataChannel) {
            webrtcLog.warn(
                `No data channel available for sync hello`,
                { deviceId: deviceID }
            );

            return;
        }

        this._vaultItemSynchronization.transmitSyncHello(deviceID, dataChannel);
    }
}

/**
 * Handles vault item synchronization operations using callbacks instead of global state
 */
class VaultItemSynchronization {
    private readonly vaultOps: VaultOperations;
    private readonly context: SyncConnectionController;

    constructor(vaultOperations: VaultOperations, context: SyncConnectionController) {
        this.vaultOps = vaultOperations;
        this.context = context;
    }

    private updateLastSync(deviceID: string): void {
        // The actual device object field is modified by the Device UI component
        this.context.broadcastWebRTCSynchronizedEvent(deviceID);
    }

    public async transmitSyncHello(deviceID: string, dataChannel: RTCDataChannel): Promise<void> {
        // TODO: For additional security, save the generated envelopeID so that we can validate responses from the remote device
        const { envelopeID, data } = SynchronizationEnvelope.createSyncHelloMessage(
            await this.vaultOps.getItemVersionVectors(),
        );

        // Serialize the message and send it to the remote device
        dataChannel.send(data);

        syncLog.debug(
            `Sent a sync hello message to the remote device`,
            { messageId: envelopeID, deviceId: deviceID }
        );
    }

    public async onDataChannelMessage(
        remoteDeviceID: string,
        dataChannel: RTCDataChannel,
        event: MessageEvent,
    ): Promise<void> {
        const deserializedMessageResult = SynchronizationEnvelope.deserialize(
            event.data,
        );

        if (deserializedMessageResult.isErr()) {
            const error = deserializedMessageResult.error;
            syncLog.error(
                "Failed to deserialize sync message",
                { 
                    error: error, 
                    data: event.data,
                    deviceId: remoteDeviceID,
                }
            );

            this.context.broadcastWebRTCSyncErrorEvent(remoteDeviceID);
            return;
        }

        const deserializedMessage = deserializedMessageResult.value;

        const command = deserializedMessage.command;
        const commandString = VaultUtilTypes.VaultItemSynchronizationMessageCommand[command];

        syncLog.debug(
            `Received a valid sync message: '${commandString}'`,
            { messageId: deserializedMessage.id, command: commandString, deviceId: remoteDeviceID }
        );

        switch (command) {
            case VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHello:
                // Send the SyncHello back
                const envelope = SynchronizationEnvelope.createSyncHelloEchoMessage(
                    await this.vaultOps.getItemVersionVectors(),
                );
                dataChannel.send(envelope.data);
                syncLog.debug(
                    `Sent a sync hello echo message to the remote device`,
                    { messageId: envelope.envelopeID, deviceId: remoteDeviceID }
                );

                await this.handleSyncHelloMessage(remoteDeviceID, dataChannel, deserializedMessage.id, deserializedMessage.data);
                break;
            case VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest:
                await this.handleSyncDataRequestMessage(remoteDeviceID, dataChannel, deserializedMessage.id, deserializedMessage.data);
                break;
            case VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataResponse:
                await this.handleSyncDataResponseMessage(remoteDeviceID, dataChannel, deserializedMessage.id, deserializedMessage.data);
                break;
            
            case VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho:
                // NOTE: This is a response to our SyncHello message, treat it as a regular SyncHello message, but without sending a response back
                await this.handleSyncHelloMessage(remoteDeviceID, dataChannel, deserializedMessage.id, deserializedMessage.data);
                break;

            // NOTE: Envelope deserialization will handle the invalid command case, but have this here for completeness
            default:
                syncLog.error(
                    "Received an invalid sync message command after envelope deserialization. A sync message handler is not implemented for this command.",
                    { command: commandString, deviceId: remoteDeviceID, message: deserializedMessage }
                );
                return;
        }
    }

    private async handleSyncHelloMessage(
        remoteDeviceID: string,
        dataChannel: RTCDataChannel,
        envelopeID: string,
        message: VaultUtilTypes.SyncHelloMessage,
    ) {
        const versionVectors = message.VersionVectors;

        syncLog.info(
            `Received a sync hello message from the remote device`,
            { envelopeId: envelopeID, versionVectors: versionVectors, deviceId: remoteDeviceID }
        );

        // Compare the version vectors with the local version vectors so that we can determine if we need to send a sync data request message
        const localVersionVectors = await this.vaultOps.getItemVersionVectors();

        const versionVectorsMatchingIDs = versionVectors.filter(vector => localVersionVectors.some(localVector => localVector.ID === vector.ID));
        const versionVectorsNotMatchingLocalVersionVectors = versionVectors.filter(vector => !localVersionVectors.some(localVector => localVector.ID === vector.ID));
        // const ourVersionVectorsNotMatchingRemoteVersionVectors = localVersionVectors.filter(vector => !versionVectors.some(remoteVector => remoteVector.ID === vector.ID));

        syncLog.debug(
            "Version vectors matching IDs",
            { envelopeId: envelopeID, versionVectorsMatchingIDsCount: versionVectorsMatchingIDs.length, versionVectorsMatchingIDs, deviceId: remoteDeviceID }
        );
        syncLog.debug(
            "Version vectors not matching local version vectors",
            { envelopeId: envelopeID, versionVectorsNotMatchingLocalVersionVectorsCount: versionVectorsNotMatchingLocalVersionVectors.length, versionVectorsNotMatchingLocalVersionVectors, deviceId: remoteDeviceID }
        );
        // syncLog.debug(
        //     `Version vectors not matching remote version vectors: ${ourVersionVectorsNotMatchingRemoteVersionVectors.length}`,
        //     { envelopeId: envelopeID, ourVersionVectorsNotMatchingRemoteVersionVectorsCount: ourVersionVectorsNotMatchingRemoteVersionVectors.length, deviceId: deviceID }
        // );

        const idsToRequest: string[] = [];

        // Add the version vectors that are not matching IDs to the IDs to request
        // NOTE: This is a list of IDs that we don't have locally, but the remote device does
        if (versionVectorsNotMatchingLocalVersionVectors.length > 0) {
            idsToRequest.push(...versionVectorsNotMatchingLocalVersionVectors.map(vector => vector.ID));
            syncLog.debug(
                "IDs to request",
                { envelopeId: envelopeID, idsToRequestCount: idsToRequest.length, idsToRequest, deviceId: remoteDeviceID }
            );
        }

        // NOTE: We're not sending any credentials to the remote device in this message.

        // Compare the versions of the version vectors that are matching IDs
        const versionsLargerThanLocal = versionVectorsMatchingIDs.filter(vector => {
            // NOTE: Asserting that the local version vector exists because we filtered out the version vectors that don't match IDs
            const localVersion = localVersionVectors.find(localVector => localVector.ID === vector.ID)!.Version;
            return localVersion < vector.Version;
        });
        if (versionsLargerThanLocal.length > 0) {
            idsToRequest.push(...versionsLargerThanLocal.map(vector => vector.ID));
            syncLog.debug(
                "Version vectors matching IDs but with local version lower than remote version",
                { envelopeId: envelopeID, versionsLargerThanLocalCount: versionsLargerThanLocal.length, versionsLargerThanLocal, deviceId: remoteDeviceID }
            );
        }

        // Compare the hashes of the version vectors that are matching IDs and have the same version
        const hashesNotMatching = versionVectorsMatchingIDs.filter(
            vector => 
                localVersionVectors.find(
                    localVector => localVector.ID === vector.ID
                )?.Version === vector.Version &&
                localVersionVectors.find(
                    localVector => localVector.ID === vector.ID
                )?.Hash !== vector.Hash
        );
        if (hashesNotMatching.length > 0) {
            // Pseudo code:
            // if remote.datemodifiedtimestamp > local.datemodifiedtimestamp, then we need to request the item
            // else if remote.datemodifiedtimestamp < local.datemodifiedtimestamp, then we need to ignore it and the remote will request it from us
            // else, sort the hashes lexicographically and request the item from the lowest hash

            const tiebreakItems: string[] = [];

            const itemsToRequest = hashesNotMatching.filter(vector => {
                const remoteVector = versionVectors.find(v => v.ID === vector.ID);
                const localVector = localVersionVectors.find(v => v.ID === vector.ID);
                if (
                    remoteVector?.DateModifiedTimestamp == null ||
                    localVector?.DateModifiedTimestamp == null
                ) {
                    return false;
                }

                if (remoteVector.DateModifiedTimestamp > localVector.DateModifiedTimestamp)
                    return true;
                else if (remoteVector.DateModifiedTimestamp < localVector.DateModifiedTimestamp)
                    return false;
                else {
                    if (remoteVector.Hash < localVector.Hash)
                        tiebreakItems.push(vector.ID);
                    return remoteVector.Hash < localVector.Hash;
                }
            });

            syncLog.debug(
                "Version vectors matching IDs, have the same version, but with different hashes. Items to request",
                { 
                    envelopeId: envelopeID, 
                    itemsToRequestCount: itemsToRequest.length, 
                    itemsToRequest, 
                    deviceId: remoteDeviceID, 
                    tiebreakItemsCount: tiebreakItems.length,
                    tiebreakItems,
                }
            );

            idsToRequest.push(...itemsToRequest.map(vector => vector.ID));
        }

        if (idsToRequest.length > 0) {
            const { envelopeID: syncDataRequestEnvelopeID, data } = SynchronizationEnvelope.createSyncDataRequestMessage(
                idsToRequest,
            );

            // TODO: Same envelopeID must appear on the SyncDataResponse message. Implement at a later stage.

            dataChannel.send(data);

            syncLog.info(
                "Sent a sync data request message to the remote device",
                { envelopeId: envelopeID, syncDataRequestEnvelopeID, idsToRequest: idsToRequest, deviceId: remoteDeviceID }
            );
        } else {
            syncLog.info(
                "No IDs to request, skipping sync data request message",
                { envelopeId: envelopeID, deviceId: remoteDeviceID }
            );
            this.updateLastSync(remoteDeviceID);
        }

        return {
            versionVectorsMatchingIDs,
            versionVectorsNotMatchingLocalVersionVectors,
            versionsLargerThanLocal,
            hashesNotMatching,
            idsToRequest,
        };
    }

    private async handleSyncDataRequestMessage(
        remoteDeviceID: string,
        dataChannel: RTCDataChannel,
        envelopeID: string,
        message: VaultUtilTypes.SyncDataRequestMessage,
    ) {
        const itemIDs = message.ItemIDs;

        syncLog.info(
            "Received a sync data request message from the remote device",
            { envelopeId: envelopeID, itemIDsCount: itemIDs.length, itemIDs, deviceId: remoteDeviceID }
        );

        const credentials = await this.vaultOps.getItemCredentials(itemIDs);
        
        const envelope = SynchronizationEnvelope.createSyncDataResponseMessage(
            envelopeID,
            credentials,
        );

        dataChannel.send(envelope);

        syncLog.info(
            "Sent a sync data response message to the remote device",
            { envelopeId: envelopeID, itemIDsCount: itemIDs.length, itemIDs, deviceId: remoteDeviceID }
        );
    }

    private async handleSyncDataResponseMessage(
        remoteDeviceID: string,
        dataChannel: RTCDataChannel,
        envelopeID: string,
        message: VaultUtilTypes.SyncDataResponseMessage,
    ) {
        const credentials = message.Credentials;

        syncLog.info(
            "Received a sync data response message from the remote device",
            { envelopeId: envelopeID, credentialsCount: credentials.length, credentials, deviceId: remoteDeviceID }
        );

        await this.vaultOps.updateCredentials(credentials);

        syncLog.info(
            "Updated credentials in the vault",
            { envelopeId: envelopeID, credentialsCount: credentials.length, credentials, deviceId: remoteDeviceID }
        );
        this.updateLastSync(remoteDeviceID);
    }
}
