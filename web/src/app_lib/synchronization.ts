import { err, ok, type Result } from "neverthrow";
import PusherAuth from "pusher";
import Pusher, { type Channel } from "pusher-js";
import { ulid } from "ulidx";

import { env } from "../env/client.mjs";
import { ONLINE_SERVICES_SELECTION_ID } from "../utils/consts";
import { syncLog, signalingLog, webrtcLog } from "../utils/logging";
import { createAuthHeader, trpc } from "../utils/trpc";
import * as VaultUtilTypes from "./proto/vault";
import {
    SignalingServerMessageType,
    SignalingStatus,
    SyncConnectionControllerEventType,
    VaultData,
    VaultItemSynchronizationMessage,
    WebRTCMessageEventType,
    WebRTCStatus,
    isRTCSessionDescriptionInit,
    type SCCSignalingEventHandler,
    type SCCWebRTCEventHandler,
    type SignalingServerMessage,
} from "./synchronization-utils";
import {
    applyDiffs,
    calculateMockedVaultHash,
    credentialsAsDiffs,
    getDiffsSinceHash,
    hashCredentials,
    type Vault,
} from "./vault-utils/vault";

/**
 * Interface for vault operations that the VaultItemSynchronization class needs
 */
export interface VaultOperations {
    getVault(): Vault;
    getCredentials(): VaultUtilTypes.Credential[];
    updateCredentials(credentials: VaultUtilTypes.Credential[]): void;
    updateDiffs(diffs: VaultUtilTypes.Diff[]): void;
    saveVault(vault: Vault): Promise<void>;
    getSynchronizationConfig(): VaultUtilTypes.LinkedDevices;
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
    ourCreationTimestamp: number,
    ourID: string,
    otherDeviceID: string,
    linkedAtTimestamp: number,
): string => {
    // The senior device is the one that was created first
    const thisSenior = ourCreationTimestamp < linkedAtTimestamp;

    // If we're the senior device, we fill the senior device slot
    const seniorDevice = thisSenior ? ourID : otherDeviceID;

    // If we're the senior device, the other device is the junior device
    const juniorDevice = thisSenior ? otherDeviceID : ourID;

    return `presence-sync-${seniorDevice}_${juniorDevice}`;
};

/**
 * Should not be used directly. Use the initPusherInstance function instead
 * @returns A new Pusher instance
 */
const onlineServicesPusherInstance = (): Pusher => {
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
            headersProvider: createAuthHeader,
            customHandler: (req, next) => {
                signalingLog.debug("Pusher auth request", { request: req });
                // return next(req);
            },
        },
        channelAuthorization: {
            transport: "ajax",
            endpoint: "",
            headersProvider: createAuthHeader,
            customHandler: async (req, next) => {
                // console.debug("Pusher auth channel request", req, next);

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
 * Initializes a Pusher instance.
 * @param signalingServer - The signaling server configuration to use. If null, the default (Cryptex Vault Online Services) will be used.
 * @param deviceID - The ID of the device to connect to the signaling server for
 * @returns A Pusher instance
 */
export const initPusherInstance = (
    signalingServer: VaultUtilTypes.SignalingServerConfiguration | null,
    deviceID: string,
): Pusher => {
    // In case the signaling server is not defined, we'll use the default (Cryptex Vault Online Services) one
    if (!signalingServer) {
        return onlineServicesPusherInstance();
    }

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
                    user_id: deviceID,
                    user_info: {
                        id: deviceID,
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
    }

    private _teardownSignalingConnection(id: string, instance: Pusher) {
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
     * @param deviceID - The ID of the device to connect to the signaling server for
     * @param server - The signaling server configuration to use. If null, the default (Cryptex Vault Online Services) will be used.
     * @returns A Pusher instance
     */
    private _connectSignalingServer(
        deviceID: string,
        server: VaultUtilTypes.SignalingServerConfiguration | null,
    ) {
        const id = server?.ID ?? ONLINE_SERVICES_SELECTION_ID;

        if (server)
            signalingLog.info(
                `Connecting to signaling server - ID: ${server.ID} | Name: ${server.Name}`,
                { serverId: server.ID, serverName: server.Name }
            );
        else
            signalingLog.info("Connecting to Online Services signaling server");

        this._signalingServerConnectionStatus.set(
            id,
            SignalingStatus.Disconnected,
        );

        this.broadcastSignalingServerEvent(id, SignalingStatus.Disconnected);

        const signalingServerConn = initPusherInstance(server, deviceID);

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
                `Already subscribed to channel, resubscribing`,
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
                { memberId: data.id }
            );

            // Create a WebRTC offer and send it to the new device to initiate the connection
            const offer = await this._craftWebRTCOffer(data.id);
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
            webrtcLog.error(
                `No initialized WebRTC connection found for device while crafting offer`,
                { deviceId: deviceID }
            );

            return;
        }

        const offer = await webRTC.connection.createOffer();
        await webRTC.connection.setLocalDescription(offer);

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
                this.broadcastWebRTCConnectionEvent(
                    device.ID,
                    WebRTCStatus.Failed,
                    "Received an ICE candidate with no data. Failed to exchange ICE candidates.",
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
            webrtcLog.info(
                `Connection state changed: ${webRTC.connectionState}`,
                { deviceId: device.ID, deviceName: device.Name, state: webRTC.connectionState }
            );

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
            this.broadcastWebRTCConnectionEvent(device.ID, newWebRTCStatus);
        };

        let iceCandidatesWeGenerated = 0;
        webRTC.onicecandidate = async (event) => {
            if (event && event.candidate) {
                webrtcLog.debug(
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
                webrtcLog.debug(
                    `ICE gathering complete, sending ICE completed event`,
                    { deviceId: device.ID, deviceName: device.Name, candidatesGenerated: iceCandidatesWeGenerated }
                );

                signalingChannel.trigger(this._signalingEventName, {
                    type: SignalingServerMessageType.ICECompleted,
                });
            }

            // If we havent generated any ICE candidates, and this event was triggered without a candidate, we're done
            if (iceCandidatesWeGenerated === 0 && !event.candidate) {
                webrtcLog.error(
                    `Failed to generate any ICE candidates`,
                    { deviceId: device.ID, deviceName: device.Name }
                );

                signalingChannel.trigger(this._signalingEventName, {
                    type: SignalingServerMessageType.ICECandidate,
                    data: null,
                });

                // Update the status, and clean up the connection
                this._webRTCStatus.set(device.ID, WebRTCStatus.Failed);
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
            // NOTE: Even though we could probably recover from this state by  opening a new data channel?
            // Should investigate possible connection recovery procedures
            this._webRTCStatus.set(device.ID, WebRTCStatus.Failed);
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
     * @param device - The device to connect to
     * @returns A boolean indicating whether the connection was successful or not
     */
    public connectDevice(device: VaultUtilTypes.LinkedDevice) {
        syncLog.info(
            `Initiating device connection`,
            { deviceId: device.ID, deviceName: device.Name }
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
            const linkedDevicesConfig = this._vaultOperations.getSynchronizationConfig();
            const signalingServerConfig =
                linkedDevicesConfig.SignalingServers.find(
                    (i) => i.ID === device.SignalingServerID,
                );

            if (
                !signalingServerConfig &&
                device.SignalingServerID !== ONLINE_SERVICES_SELECTION_ID
            ) {
                signalingLog.error(
                    `Device configured to use unknown signaling server`,
                    { deviceId: device.ID, signalingServerId: device.SignalingServerID }
                );
                return false;
            }

            signalingServerConn = this._connectSignalingServer(
                linkedDevicesConfig.ID,
                signalingServerConfig ?? null, // If this comes out to null - it's an Online Services server
            );
        }

        if (!signalingServerConn) {
            signalingLog.error(
                `Signaling connection instantiation failed`,
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

        const linkedDevicesConfig = this._vaultOperations.getSynchronizationConfig();

        const channelName = constructSyncChannelName(
            linkedDevicesConfig.CreationTimestamp,
            linkedDevicesConfig.ID,
            device.ID,
            device.LinkedAtTimestamp,
        );

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

    public disconnectDevice(device: VaultUtilTypes.LinkedDevice) {
        syncLog.info(
            `Disconnecting device`,
            { deviceId: device.ID, deviceName: device.Name }
        );

        const signalingServer = this._signalingServers.get(
            device.SignalingServerID,
        );

        // Check if the signaling server is used for anything, if not - tear the connection down
        if (signalingServer) {
            const linkedDevicesConfig = this._vaultOperations.getSynchronizationConfig();

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
        additionalData?: string,
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

        deviceEventHandler({
            type: SyncConnectionControllerEventType.ConnectionStatus,
            data: {
                connectionState: connectionState,
                additionalData,
            },
        });
    }

    public broadcastWebRTCMessageEvent(
        deviceID: string,
        eventType: WebRTCMessageEventType,
        messageData: VaultUtilTypes.VaultItemSynchronizationMessage,
        additionalData?: string,
    ) {
        if (!this._webRTCStatus.has(deviceID)) return;

        // Get the WebRTC status event handlers for the device ID
        const deviceEventHandler = this._syncWebRTCEventHandlers.get(deviceID);

        // In case there is no event handler for the device, we can just return
        if (!deviceEventHandler) return;

        webrtcLog.debug(
            `Broadcasting WebRTC message event: ${WebRTCMessageEventType[eventType]}`,
            { deviceId: deviceID, eventType: WebRTCMessageEventType[eventType] }
        );

        deviceEventHandler({
            type: SyncConnectionControllerEventType.SynchronizationMessage,
            data: {
                event: eventType,
                message: messageData,
                additionalData,
            },
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
            data: {
                event: WebRTCMessageEventType.Synchronized,
            },
        });
    }

    public broadcastVaultDataUpdate(deviceID: string, vaultData: VaultData) {
        if (!this._webRTCStatus.has(deviceID)) return;

        // Get the WebRTC status event handlers for the device ID
        const deviceEventHandler = this._syncWebRTCEventHandlers.get(deviceID);

        // In case there is no event handler for the device, we can just return
        if (!deviceEventHandler) return;

        syncLog.info(
            `Broadcasting vault data update`,
            { deviceId: deviceID, credentialsCount: vaultData.credentials.length, diffsCount: vaultData.diffs.length }
        );

        deviceEventHandler({
            type: SyncConnectionControllerEventType.VaultDataUpdate,
            data: {
                vaultData,
            },
        });
    }

    public transmitSyncRequest(deviceID: string) {
        // Get the WebRTC connection for the device
        const webRTC = this._webRTConnections.get(deviceID);

        // If there is no WebRTC connection, we can't do anything
        if (!webRTC) {
            webrtcLog.warn(
                `No WebRTC connection for sync request`,
                { deviceId: deviceID }
            );

            return;
        }

        // Get the WebRTC data channel
        const dataChannel = webRTC.dataChannel;
        if (!dataChannel) {
            webrtcLog.warn(
                `No data channel available for sync request`,
                { deviceId: deviceID }
            );

            return;
        }

        this._vaultItemSynchronization.transmitSyncRequest(deviceID, dataChannel);
    }

    public async applyManualSynchronization(diffs: VaultUtilTypes.Diff[]) {
        return await this._vaultItemSynchronization.applyDiffsToVault(diffs);
    }

    public transmitManualSyncSolve(
        deviceID: string,
        preparedDiffs: VaultUtilTypes.Diff[],
    ) {
        const webRTC = this._webRTConnections.get(deviceID);

        // If there is no WebRTC connection, we can't do anything
        if (!webRTC) {
            webrtcLog.warn(
                `No WebRTC connection for manual sync solve`,
                { deviceId: deviceID }
            );

            return;
        }

        const dataChannel = webRTC.dataChannel;
        if (!dataChannel) {
            webrtcLog.warn(
                `No data channel available for manual sync solve`,
                { deviceId: deviceID }
            );

            return;
        }

        this._vaultItemSynchronization.transmitManualSyncSolve(
            dataChannel,
            preparedDiffs,
        );
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

    private getVaultCredentials(): VaultUtilTypes.Credential[] {
        return this.vaultOps.getCredentials();
    }

    private async getLatestVaultHash(): Promise<string> {
        const creds = this.getVaultCredentials();
        return await hashCredentials(creds);
    }

    private updateLastSync(deviceID: string): void {
        // The actual device object field is modified by the Device UI component
        this.context.broadcastWebRTCSynchronizedEvent(deviceID);
    }

    private updateCredentialsList(
        deviceID: string,
        credentials: VaultUtilTypes.Credential[],
        diffs: VaultUtilTypes.Diff[],
    ): void {
        this.context.broadcastVaultDataUpdate(deviceID, {
            credentials,
            diffs,
        });
    }

    public async applyDiffsToVault(diffs: VaultUtilTypes.Diff[]): Promise<Result<{credentials: VaultUtilTypes.Credential[], diffs: VaultUtilTypes.Diff[]}, string>> {
        const currVault = this.vaultOps.getVault();
        const res = await applyDiffs(currVault.Credentials, diffs);
        if (res.isErr()) return err(res.error);

        // Update the vault through callbacks
        this.vaultOps.updateCredentials([...res.value.credentials]);
        this.vaultOps.updateDiffs([...currVault.Diffs, ...res.value.diffs]);

        return ok({
            credentials: res.value.credentials,
            diffs: res.value.diffs,
        });
    }

    public async transmitSyncRequest(deviceID: string, dataChannel: RTCDataChannel): Promise<void> {
        // Serialize the message and send it to the remote device
        const message = new VaultItemSynchronizationMessage(
            null,
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncRequest,
            await this.getLatestVaultHash(),
            [],
            [],
        );

        dataChannel.send(message.serialize());

        syncLog.debug(
            `Sent a sync request message`,
            { messageId: message.ID, command: message.Command, deviceId: deviceID, message: message }
        );
    }

    public async transmitManualSyncSolve(
        dataChannel: RTCDataChannel,
        preparedDiffs: VaultUtilTypes.Diff[],
    ): Promise<void> {
        const message = new VaultItemSynchronizationMessage(
            null,
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.ManualSyncSolve,
            await this.getLatestVaultHash(),
            preparedDiffs,
        );

        dataChannel.send(message.serialize());
    }

    public async onDataChannelMessage(
        deviceID: string,
        dataChannel: RTCDataChannel,
        event: MessageEvent,
    ): Promise<void> {
        // TODO: Proper err handling here for the deserialization step
        const deserializedMessage = VaultItemSynchronizationMessage.deserialize(
            event.data,
        );

        // If the command is not a valid enum value, log an error and return
        if (
            !VaultUtilTypes.VaultItemSynchronizationMessageCommand[
                deserializedMessage.Command
            ]
        ) {
            syncLog.error(
                "Received an invalid sync message command",
                { messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, message: deserializedMessage }
            );
            return;
        }

        const command = deserializedMessage.Command;
        const commandString = VaultUtilTypes.VaultItemSynchronizationMessageCommand[command];

        syncLog.debug(
            `Received a valid sync message: '${commandString}'`,
            { messageId: deserializedMessage.ID, command: command, deviceId: deviceID }
        );

        const currentVaultHash = await this.getLatestVaultHash();

        if (
            command ===
                VaultUtilTypes.VaultItemSynchronizationMessageCommand
                    .SyncRequest &&
            deserializedMessage.Hash != null // NOTE: Maybe pull this check out
        ) {
            // Sync case 1
            if (deserializedMessage.Hash === currentVaultHash) {
                const message = new VaultItemSynchronizationMessage(
                    deserializedMessage.ID,
                    VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncResponse,
                    currentVaultHash,
                );

                dataChannel.send(message.serialize());
                this.updateLastSync(deviceID);

                syncLog.debug(
                    "[Case 1] Sent a sync response message",
                    { messageId: message.ID, command: message.Command, deviceId: deviceID, message: message }
                );

                return;
            }

            // Sync case 3 - we're behind
            if (deserializedMessage.Diffs.length) {
                const mockedVault = await calculateMockedVaultHash(
                    this.getVaultCredentials(),
                    deserializedMessage.Diffs,
                );

                if (mockedVault.isErr()) {
                    this.context.broadcastWebRTCMessageEvent(
                        deviceID,
                        WebRTCMessageEventType.Error,
                        deserializedMessage,
                        mockedVault.error,
                    );

                    syncLog.error(
                        "[Case 3] Sync request - test apply failed, mocked vault hash calculation failed",
                        { 
                            messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                            message: deserializedMessage, error: mockedVault.error
                        }
                    );

                    return;
                }

                if (mockedVault.value === deserializedMessage.Hash) {
                    syncLog.info(
                        "[Case 3] Sync request - test apply passed, applying diffs",
                        { 
                            messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                            diffsCount: deserializedMessage.Diffs.length
                        }
                    );

                    const applyRes = await this.applyDiffsToVault(
                        deserializedMessage.Diffs,
                    );
                    if (applyRes.isErr()) {
                        syncLog.error(
                            "[Case 3] Failed to apply diffs to vault",
                            { 
                                messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                                message: deserializedMessage, error: applyRes.error
                            }
                        );
                        this.context.broadcastWebRTCMessageEvent(
                            deviceID,
                            WebRTCMessageEventType.Error,
                            deserializedMessage,
                            `[3] Failed while applying diffs to vault. Additional information: ${applyRes.error}`,
                        );
                        return;
                    }
                    syncLog.info(
                        "[Case 3] Successfully applied diffs, updating credentials",
                        { 
                            messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID,
                            credentialsCount: applyRes.value.credentials.length
                        }
                    );
                    this.updateCredentialsList(
                        deviceID,
                        applyRes.value.credentials,
                        applyRes.value.diffs,
                    );
                    this.updateLastSync(deviceID);

                    // Send a SyncRequest message to the other device so that it updates the last sync date
                    await this.transmitSyncRequest(deviceID, dataChannel);
                } else {
                    syncLog.warn(
                        "[Case 3] Sync request - test apply failed, hash mismatch",
                        { 
                           messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID,
                           expectedHash: deserializedMessage.Hash, calculatedHash: mockedVault.value, message: deserializedMessage
                        }
                    );

                    this.context.broadcastWebRTCMessageEvent(
                        deviceID,
                        WebRTCMessageEventType.Error,
                        deserializedMessage,
                        "[3] Could not apply the synchronization request. Please try again.",
                    );
                }
                return;
            }

            // Sync case 2 - we're ahead - try to find the differences
            const differences = getDiffsSinceHash(
                deserializedMessage.Hash,
                this.vaultOps.getVault().Diffs,
            );
            // Sync case 2 - If we find any differences, we're ahead
            if (differences.length > 0) {
                const message = new VaultItemSynchronizationMessage(
                    deserializedMessage.ID,
                    VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncResponse,
                    currentVaultHash,
                    differences,
                );

                dataChannel.send(message.serialize());

                syncLog.debug("[Case 2] Sent a sync response message with differences", 
                    { messageId: message.ID, command: message.Command, deviceId: deviceID, message: message }
                );
            } else {
                // Sync case 3, 4 - we don't know about this hash - we're out of sync
                const message = new VaultItemSynchronizationMessage(
                    deserializedMessage.ID,
                    VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncResponse,
                    currentVaultHash,
                );
                dataChannel.send(message.serialize());

                syncLog.debug("[Case 3/4] Sent a sync response message without differences", 
                    { messageId: message.ID, command: message.Command, deviceId: deviceID, message: message }
                );
            }
        }

        // Sync case 4 - got here from ManualSyncDataRequest
        if (
            command ===
                VaultUtilTypes.VaultItemSynchronizationMessageCommand
                    .SyncResponse &&
            deserializedMessage.Hash == null &&
            deserializedMessage.Diffs?.length
        ) {
            syncLog.info(
                "[Case 4] Received ManualSyncDataRequest response - manual sync required",
                { 
                    messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                    diffsCount: deserializedMessage.Diffs.length, message: deserializedMessage 
                }
            );

            this.context.broadcastWebRTCMessageEvent(
                deviceID,
                WebRTCMessageEventType.ManualSyncNecessary,
                deserializedMessage,
            );

            return;
        }

        if (
            command ===
                VaultUtilTypes.VaultItemSynchronizationMessageCommand
                    .SyncResponse &&
            deserializedMessage.Hash != null // NOTE: Maybe pull this check out
        ) {
            // Sync case 1
            if (deserializedMessage.Hash === currentVaultHash) {
                // We're in sync
                syncLog.info(
                    "[Case 1] Received sync response - vaults are in sync",
                    { 
                        messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                        hash: currentVaultHash
                    }
                );

                // Update the last sync date
                this.updateLastSync(deviceID);
                return;
            }

            syncLog.info(
                "[Case 2/3/4] Received sync response - vaults are out of sync",
                { 
                    messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                    localHash: currentVaultHash, remoteHash: deserializedMessage.Hash, hasDiffs: deserializedMessage.Diffs.length > 0 
                }
            );

            // Sync case 3, 4 - we only got a hash and no diffs
            if (!deserializedMessage.Diffs.length) {
                const differences = getDiffsSinceHash(
                    deserializedMessage.Hash,
                    this.vaultOps.getVault().Diffs,
                );

                if (differences.length) {
                    // Sync case 3 - We have differences - send them
                    const message = new VaultItemSynchronizationMessage(
                        deserializedMessage.ID,
                        VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncRequest,
                        currentVaultHash,
                        differences,
                    );
                    dataChannel.send(message.serialize());

                    syncLog.debug("[Case 3] Sent a sync request message with differences", 
                        { messageId: message.ID, command: message.Command, deviceId: deviceID, message: message }
                    );
                } else {
                    // Sync case 4 - we've diverged and need to trigger manual synchronization
                    const message = new VaultItemSynchronizationMessage(
                        deserializedMessage.ID,
                        VaultUtilTypes.VaultItemSynchronizationMessageCommand.ManualSyncDataRequest,
                    );
                    dataChannel.send(message.serialize());

                    syncLog.debug("[Case 4] Sent a manual sync data request message since we could not find a common hash", 
                        { messageId: message.ID, command: message.Command, deviceId: deviceID }
                    );
                }

                return;
            }

            // Sync case 2 - our hashes don't match, got diffs - we're out of sync
            const mockedVault = await calculateMockedVaultHash(
                this.getVaultCredentials(),
                deserializedMessage.Diffs,
            );

            if (mockedVault.isErr()) {
                this.context.broadcastWebRTCMessageEvent(
                    deviceID,
                    WebRTCMessageEventType.Error,
                    deserializedMessage,
                    `[2] ${mockedVault.error}`,
                );

                syncLog.error(
                    "[Case 2] Sync response - mocked vault hash calculation failed",
                    { 
                        messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                        message: deserializedMessage, error: mockedVault.error 
                    }
                );
                return;
            }

            if (mockedVault.value === deserializedMessage.Hash) {
                syncLog.debug(
                    "[Case 2] Sync response - mocked vault hash calculation passed, applying diffs",
                    { 
                        messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                        diffsCount: deserializedMessage.Diffs.length
                    }
                );

                const applyRes = await this.applyDiffsToVault(
                    deserializedMessage.Diffs,
                );
                if (applyRes.isErr()) {
                    syncLog.error(
                        "[Case 2] Failed to apply diffs to vault",
                        { 
                            messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                            message: deserializedMessage, error: applyRes.error 
                        }
                    );
                    this.context.broadcastWebRTCMessageEvent(
                        deviceID,
                        WebRTCMessageEventType.Error,
                        deserializedMessage,
                        `[2] Failed while applying diffs to vault. Additional information: ${applyRes.error}`,
                    );
                    return;
                }
                syncLog.info(
                    "[Case 2] Successfully applied diffs, updating credentials",
                    { 
                        messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                        credentialsCount: applyRes.value.credentials.length 
                    }
                );
                this.updateCredentialsList(
                    deviceID,
                    applyRes.value.credentials,
                    applyRes.value.diffs,
                );
                this.updateLastSync(deviceID);

                // Send a SyncRequest message to the other device so that it updates the last sync date
                await this.transmitSyncRequest(deviceID, dataChannel);
            } else {
                syncLog.error(
                    "[Case 2] Sync response - test apply failed, hash mismatch",
                    { 
                        messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                        expectedHash: deserializedMessage.Hash, calculatedHash: mockedVault.value, message: deserializedMessage 
                    }
                );

                this.context.broadcastWebRTCMessageEvent(
                    deviceID,
                    WebRTCMessageEventType.Error,
                    deserializedMessage,
                    "[2] Could not apply the synchronization request. Please try again.",
                );
            }
        }

        if (
            command ===
            VaultUtilTypes.VaultItemSynchronizationMessageCommand
                .ManualSyncDataRequest
        ) {
            // Sync case 4 - Send the vault content (diff format), no hash - SyncResponse
            const message = new VaultItemSynchronizationMessage(
                deserializedMessage.ID,
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncResponse,
                undefined,
                await credentialsAsDiffs(this.getVaultCredentials()),
            );
            dataChannel.send(message.serialize());

            syncLog.debug("[Case 4] Sent a manual sync data request message", 
                { messageId: message.ID, command: message.Command, deviceId: deviceID, message: message }
            );
        }

        if (
            command ===
            VaultUtilTypes.VaultItemSynchronizationMessageCommand
                .ManualSyncSolve
        ) {
            // Duplicated sync case 2. solution @ SyncResponse
            const mockedVault = await calculateMockedVaultHash(
                this.getVaultCredentials(),
                deserializedMessage.Diffs,
            );

            if (mockedVault.isErr()) {
                this.context.broadcastWebRTCMessageEvent(
                    deviceID,
                    WebRTCMessageEventType.Error,
                    deserializedMessage,
                    `[2m] ${mockedVault.error}`,
                );

                syncLog.error(
                    "[Manual Sync] Manual sync solve - mocked vault hash calculation failed",
                    { 
                        messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                        message: deserializedMessage, error: mockedVault.error
                    }
                );
                return;
            }

            if (mockedVault.value === deserializedMessage.Hash) {
                syncLog.debug(
                    "[Manual Sync] Manual sync solve - test apply passed, applying diffs",
                    { 
                        messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                        diffsCount: deserializedMessage.Diffs.length 
                    }
                );

                const applyRes = await this.applyDiffsToVault(
                    deserializedMessage.Diffs,
                );
                if (applyRes.isErr()) {
                    syncLog.error(
                        "[Manual Sync] Failed to apply diffs to vault",
                        { 
                            messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                            message: deserializedMessage, error: applyRes.error 
                        }
                    );
                    this.context.broadcastWebRTCMessageEvent(
                        deviceID,
                        WebRTCMessageEventType.Error,
                        deserializedMessage,
                        `[2m] Failed while applying diffs to vault. Additional information: ${applyRes.error}`,
                    );
                    return;
                }
                syncLog.info(
                    "[Manual Sync] Successfully applied diffs, updating credentials",
                    { 
                        messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                        credentialsCount: applyRes.value.credentials.length 
                    }
                );
                this.updateCredentialsList(
                    deviceID,
                    applyRes.value.credentials,
                    applyRes.value.diffs,
                );
                this.updateLastSync(deviceID);

                // Send a SyncRequest message to the other device so that it updates the last sync date
                await this.transmitSyncRequest(deviceID, dataChannel);
            } else {
                syncLog.error(
                    "[Manual Sync] Manual sync solve - test apply failed, hash mismatch",
                    { 
                        messageId: deserializedMessage.ID, command: deserializedMessage.Command, deviceId: deviceID, 
                        expectedHash: deserializedMessage.Hash, calculatedHash: mockedVault.value, message: deserializedMessage 
                    }
                );

                this.context.broadcastWebRTCMessageEvent(
                    deviceID,
                    WebRTCMessageEventType.Error,
                    deserializedMessage,
                    "[2m] Could not apply the synchronization request. Please try again.",
                );
            }
        }
    }
}
