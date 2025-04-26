import { err, ok } from "neverthrow";
import PusherAuth from "pusher";
import Pusher, { type Channel } from "pusher-js";
import { ulid } from "ulidx";

import { env } from "../env/client.mjs";
import { vaultGet, vaultGetLinkedDevices } from "../utils/atoms";
import { ONLINE_SERVICES_SELECTION_ID } from "../utils/consts";
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
} from "./vault-utils/vault";

const onlineServicesSTUN = [
    {
        urls: "stun:localhost:5349",
    },
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
                console.debug("Pusher auth request", req, next);
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
                    console.warn(
                        "Failed to authorize Pusher channel with Online Services.",
                        e,
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
                console.debug("Pusher auth channel request", req);

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

    constructor() {
        this._signalingServers = new Map();
        this._signalingServerConnectionStatus = new Map();

        this._syncSignalingConnectionEventHandlers = new Map();
        this._syncWebRTCEventHandlers = new Map();

        this._webRTConnections = new Map();
        this._webRTCStatus = new Map();
    }

    public init() {
        console.debug("[SCC] Initialized.");
    }

    public teardown() {
        console.debug("[SCC] Tearing down signaling and WebRTC connections...");

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
            console.debug(
                `[SCC Signaling - Verbose] Trying to connect to Signaling server ID: ${server.Version} | Name: ${server.Name}...`,
            );
        else
            console.debug(
                `[SCC Signaling - Verbose] Trying to connect to the Online Services Signaling server...`,
            );

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

                console.debug(
                    `[SCC Signaling - Verbose] Connection state changed from ${state.previous} to ${state.current}.`,
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
            console.debug(
                "[SCC - Verbose Signaling] Already subscribed to channel",
                channelName,
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
                console.debug(
                    "[SCC - Verbose Signaling] Subscription succeeded",
                    context.count,
                    channelName,
                );
            },
        );

        channel.bind(
            this._signalingEventName,
            async (data: SignalingServerMessage) => {
                console.debug(
                    `[SCC - Verbose Signaling] Received signaling event - ${data.type}`,
                    data,
                );

                this._processSignalingData(channel, device, data);
            },
        );

        channel.bind("pusher:member_added", async (data: { id: string }) => {
            console.debug(
                `[SCC - Verbose Signaling] Received member added event - ${data.id}`,
                data,
            );

            // Create a WebRTC offer and send it to the new device to initiate the connection
            const offer = await this._craftWebRTCOffer(data.id);
            channel.trigger(this._signalingEventName, {
                type: SignalingServerMessageType.Offer,
                data: offer,
            });

            console.debug("[SCC - Verbose Signaling] Sent WebRTC offer", offer);
        });
        return channel;
    }

    private async _craftWebRTCOffer(deviceID: string) {
        // Get the WebRTC connection for the device
        const webRTC = this._webRTConnections.get(deviceID);

        // If there is no WebRTC connection, we can't do anything
        if (!webRTC) {
            console.error(
                `[SCC - Signaling] Could not find an initialized WebRTC connection for device "${deviceID}", but received a signaling message. This should never happen.`,
                deviceID,
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
            console.error(
                `[SCC - Signaling] Could not find an initialized WebRTC connection for device "${device.ID}", but received a signaling message. This should never happen.`,
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

                console.debug(
                    "[SCC - Verbose Signaling] Sent WebRTC answer",
                    answer,
                );
            }
        } else if (data.type === SignalingServerMessageType.ICECompleted) {
            console.debug(
                "[SCC - Verbose Signaling] Received ICE completed event",
                data.data,
            );
        } else {
            console.error(
                "[SCC - Signaling] Received unknown signaling message type",
                data.type,
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
            console.debug(
                `[SCC - Verbose WebRTC] Connection state for device "${device.Name}" (ID: ${device.ID}) changed to "${webRTC.connectionState}".`,
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
                console.warn(
                    `[SCC - Verbose WebRTC] Received unknown connection state change "${webRTC.connectionState}". Device ID: ${device.ID} | Name: ${device.Name}`,
                );
                newWebRTCStatus = WebRTCStatus.Failed;
            }

            this._webRTCStatus.set(device.ID, newWebRTCStatus);
            this.broadcastWebRTCConnectionEvent(device.ID, newWebRTCStatus);
        };

        let iceCandidatesWeGenerated = 0;
        webRTC.onicecandidate = async (event) => {
            if (event && event.candidate) {
                console.debug(
                    `[SCC - Verbose WebRTC] Sending ICE candidate. Device ID: ${device.ID} | Name: ${device.Name}`,
                    event.candidate,
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
                console.debug(
                    `[SCC - Verbose WebRTC] Sending ICE completed event. Device ID: ${device.ID} | Name: ${device.Name}`,
                    event.candidate,
                );

                signalingChannel.trigger(this._signalingEventName, {
                    type: SignalingServerMessageType.ICECompleted,
                });
            }

            // If we havent generated any ICE candidates, and this event was triggered without a candidate, we're done
            if (iceCandidatesWeGenerated === 0 && !event.candidate) {
                console.error(
                    `[SCC - WebRTC] Failed to generate ICE candidates. Device ID: ${device.ID} | Name: ${device.Name}`,
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
                console.debug(
                    `[SCC - Verbose WebRTC] Received data channel open event. Device ID: ${device.ID} | Name: ${device.Name}`,
                    event,
                );

                // Save the data channel in the WebRTC connections map
                const currentConnection = this._webRTConnections.get(device.ID);
                if (currentConnection) {
                    currentConnection.dataChannel = dataChannel;
                    this._webRTConnections.set(device.ID, currentConnection);
                }
            };

        const dataChannelOnClose = () => (event: Event) => {
            console.debug(
                `[SCC - Verbose WebRTC] Received data channel close event. Device ID: ${device.ID} | Name: ${device.Name}`,
                event,
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
            console.debug(
                `[SCC - Verbose WebRTC] Received data channel error event. Device ID: ${device.ID} | Name: ${device.Name}`,
                event,
            );

            // Broadcast the failure - we treat this as a general WebRTC failure
            // NOTE: Even though we could probably recover from this state by  opening a new data channel?
            // Should investigate possible connection recovery procedures
            this._webRTCStatus.set(device.ID, WebRTCStatus.Failed);
            this.broadcastWebRTCConnectionEvent(device.ID, WebRTCStatus.Failed);
        };

        const dataChannelOnMessage =
            (dataChannel: RTCDataChannel) => (event: MessageEvent) => {
                console.debug(
                    `[SCC - Verbose WebRTC] Received data channel message. Device ID: ${device.ID} | Name: ${device.Name}`,
                    event,
                );

                VaultItemSynchronization.onDataChannelMessage(
                    this,
                    device.ID,
                    dataChannel,
                    event,
                );
            };

        // NOTE: This event is not triggered for local data channels
        // Meaning, this is used when the remote device creates a data channel, and we connect to it
        webRTC.ondatachannel = (event) => {
            const dataChannel = event.channel;
            console.debug(
                "[SCC - Verbose WebRTC] Received data channel",
                dataChannel,
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
        console.debug(
            `[SCC - Verbose] Initiating device connection... ID: ${device.ID} | Name: ${device.Name}`,
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
            const linkedDevicesConfig = vaultGetLinkedDevices();
            const signalingServerConfig =
                linkedDevicesConfig.SignalingServers.find(
                    (i) => i.ID === device.SignalingServerID,
                );

            if (
                !signalingServerConfig &&
                device.SignalingServerID !== ONLINE_SERVICES_SELECTION_ID
            ) {
                console.error(
                    `[SCC - Signaling] Linked device (ID: ${device.ID}) is configured to use an unknown signaling server. Could not establish a connection.`,
                );
                return false;
            }

            signalingServerConn = this._connectSignalingServer(
                linkedDevicesConfig.ID,
                signalingServerConfig ?? null, // If this comes out to null - it's an Online Services server
            );
        }

        if (!signalingServerConn) {
            console.error(
                `[SCC - Signaling] It seems that connection object instantiation (ID: ${device.ID}) has failed. Will not be able to connect to the device. Escaping...`,
            );
            return false;
        }

        const existingWebRTC = this._webRTConnections.get(device.ID);

        if (
            existingWebRTC &&
            (existingWebRTC.connection.connectionState === "connected" ||
                existingWebRTC.connection.connectionState === "connecting")
        ) {
            console.debug(
                `[SCC] Found an established WebRTC connection for device ${device.ID}. Skipping...`,
            );
            return false;
        }

        // Clean up the existing connection handlers
        if (existingWebRTC) {
            this._teardownWebRTCConnection(device.ID, existingWebRTC);
        }

        const linkedDevicesConfig = vaultGetLinkedDevices();

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
        console.debug(
            `[SCC - Verbose] Initiating device disconnection and cleanup... ID: ${device.ID} | Name: ${device.Name}`,
        );

        const signalingServer = this._signalingServers.get(
            device.SignalingServerID,
        );

        // Check if the signaling server is used for anything, if not - tear the connection down
        if (signalingServer) {
            const linkedDevicesConfig = vaultGetLinkedDevices();

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
            console.debug(
                `[SCC - Verbose] Could not find a WebRTC handle (ID: ${device.ID}). Ignoring...`,
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

        console.debug(
            `[SCC - Verbose Signaling] Broadcasting signaling server event for Signaling ID: ${serverID} | Status: ${SignalingStatus[connectionState]}`,
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

        console.debug(
            `[SCC - Verbose WebRTC] Broadcasting WebRTC connection event to ${deviceID}: ${WebRTCStatus[connectionState]}`,
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

        console.debug(
            `[SCC - Verbose WebRTC] Broadcasting WebRTC message event to ${deviceID}: ${WebRTCMessageEventType[eventType]}`,
            messageData,
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

        console.debug(
            `[SCC - Verbose WebRTC] Broadcasting WebRTC Synchronized event to ${deviceID}`,
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

        console.debug(
            `[SCC - Verbose WebRTC] Broadcasting WebRTC VaultDataUpdate message event to "${deviceID}"`,
            vaultData,
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
            console.warn(
                `[SCC - Verbose WebRTC] Could not find an established WebRTC connection for device ID ${deviceID}, but received a sync request trigger.`,
                deviceID,
            );

            return;
        }

        // Get the WebRTC data channel
        const dataChannel = webRTC.dataChannel;
        if (!dataChannel) {
            console.warn(
                `[SCC - Verbose WebRTC] Could not find an established WebRTC data channel for device ID ${deviceID}, but received a sync request trigger.`,
                deviceID,
            );

            return;
        }

        VaultItemSynchronization.transmitSyncRequest(dataChannel);
    }

    public async applyManualSynchronization(diffs: VaultUtilTypes.Diff[]) {
        return await VaultItemSynchronization.applyDiffsToVault(diffs);
    }

    public transmitManualSyncSolve(
        deviceID: string,
        preparedDiffs: VaultUtilTypes.Diff[],
    ) {
        const webRTC = this._webRTConnections.get(deviceID);

        // If there is no WebRTC connection, we can't do anything
        if (!webRTC) {
            console.warn(
                `[SCC - Verbose WebRTC] Could not find an established WebRTC connection for device ID ${deviceID}, but received a manual synchronization solve trigger.`,
                deviceID,
            );

            return;
        }

        const dataChannel = webRTC.dataChannel;
        if (!dataChannel) {
            console.warn(
                `[SCC - Verbose WebRTC] Could not find an established WebRTC data channel for device ID ${deviceID}, but received a manual synchronization solve trigger.`,
                deviceID,
            );

            return;
        }

        VaultItemSynchronization.transmitManualSyncSolve(
            dataChannel,
            preparedDiffs,
        );
    }
}

class VaultItemSynchronization {
    private static getVaultCredentials() {
        return vaultGet().Credentials;
    }

    private static async getLastestVaultHash() {
        const creds = this.getVaultCredentials();
        return await hashCredentials(creds);
    }

    private static updateLastSync(
        context: SyncConnectionController,
        deviceID: string,
    ) {
        // The actual device object field is modified by the Device UI component
        context.broadcastWebRTCSynchronizedEvent(deviceID);
    }

    private static updateCredentialsList(
        context: SyncConnectionController,
        deviceID: string,
        credentials: VaultUtilTypes.Credential[],
        diffs: VaultUtilTypes.Diff[],
    ) {
        context.broadcastVaultDataUpdate(deviceID, {
            credentials,
            diffs,
        });
    }

    public static async applyDiffsToVault(diffs: VaultUtilTypes.Diff[]) {
        const currVault = vaultGet();
        const res = await applyDiffs(currVault.Credentials, diffs);
        if (res.isErr()) return err(res.error);

        // FIXME: We should apply the changes to the appropriate atoms, that way we cause a proper rerender
        currVault.Credentials = [...res.value.credentials];
        currVault.Diffs = [...currVault.Diffs, ...res.value.diffs];

        return ok({
            credentials: res.value.credentials,
            diffs: res.value.diffs,
        });
    }

    public static async transmitSyncRequest(dataChannel: RTCDataChannel) {
        // Serialize the message and send it to the remote device
        const message = new VaultItemSynchronizationMessage(
            null,
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncRequest,
            await this.getLastestVaultHash(),
            [],
            [],
        );

        dataChannel.send(message.serialize());
    }

    public static async transmitManualSyncSolve(
        dataChannel: RTCDataChannel,
        preparedDiffs: VaultUtilTypes.Diff[],
    ) {
        const message = new VaultItemSynchronizationMessage(
            null,
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.ManualSyncSolve,
            await this.getLastestVaultHash(),
            preparedDiffs,
        );

        dataChannel.send(message.serialize());
    }

    public static async onDataChannelMessage(
        context: SyncConnectionController,
        deviceID: string,
        dataChannel: RTCDataChannel,
        event: MessageEvent,
    ) {
        const deserializedMessage = VaultItemSynchronizationMessage.deserialize(
            event.data,
        );

        console.debug(
            `[SCC - Verbose WebRTC] DataChannel message ID: ${
                deserializedMessage.ID
            } Command: ${
                VaultUtilTypes.VaultItemSynchronizationMessageCommand[
                    deserializedMessage.Command
                ]
            }`,
            deserializedMessage,
        );

        // If the command doesn't exist in our enum, log an error and return
        if (
            !VaultUtilTypes.VaultItemSynchronizationMessageCommand[
                deserializedMessage.Command
            ]
        ) {
            console.error(
                `[SCC - Verbose WebRTC] Received unknown command: ${deserializedMessage.Command}. Ignoring the message...`,
            );
            return;
        }

        const currentVaultHash = await this.getLastestVaultHash();

        if (
            deserializedMessage.Command ===
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
                this.updateLastSync(context, deviceID);
                return;
            }

            // Sync case 3 - we're behind
            if (deserializedMessage.Diffs.length) {
                const mockedVault = await calculateMockedVaultHash(
                    this.getVaultCredentials(),
                    deserializedMessage.Diffs,
                );

                if (mockedVault.isErr()) {
                    context.broadcastWebRTCMessageEvent(
                        deviceID,
                        WebRTCMessageEventType.Error,
                        deserializedMessage,
                        mockedVault.error,
                    );
                    return;
                }

                if (mockedVault.value === deserializedMessage.Hash) {
                    console.debug(
                        "[SCC - Verbose WebRTC] Received sync request - test apply passed",
                    );

                    const applyRes = await this.applyDiffsToVault(
                        deserializedMessage.Diffs,
                    );
                    if (applyRes.isErr()) {
                        context.broadcastWebRTCMessageEvent(
                            deviceID,
                            WebRTCMessageEventType.Error,
                            deserializedMessage,
                            `[3] Failed while applying diffs to vault. Additional information: ${applyRes.error}`,
                        );
                        return;
                    }
                    this.updateCredentialsList(
                        context,
                        deviceID,
                        applyRes.value.credentials,
                        applyRes.value.diffs,
                    );
                    this.updateLastSync(context, deviceID);

                    // Send a SyncRequest message to the other device so that it updates the last sync date
                    await this.transmitSyncRequest(dataChannel);
                } else {
                    console.debug(
                        "[SCC - Verbose WebRTC] Received sync request - test apply failed",
                    );

                    context.broadcastWebRTCMessageEvent(
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
                vaultGet().Diffs,
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
            } else {
                // Sync case 3, 4 - we don't know about this hash - we're out of sync
                const message = new VaultItemSynchronizationMessage(
                    deserializedMessage.ID,
                    VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncResponse,
                    currentVaultHash,
                );
                dataChannel.send(message.serialize());
            }
        }

        // Sync case 4 - got here from ManualSyncDataRequest
        if (
            deserializedMessage.Command ===
                VaultUtilTypes.VaultItemSynchronizationMessageCommand
                    .SyncResponse &&
            deserializedMessage.Hash == null &&
            deserializedMessage.Diffs?.length
        ) {
            console.debug(
                "[SCC - Verbose WebRTC] Received ManualSyncDataRequest data",
            );

            context.broadcastWebRTCMessageEvent(
                deviceID,
                WebRTCMessageEventType.ManualSyncNecessary,
                deserializedMessage,
            );

            return;
        }

        if (
            deserializedMessage.Command ===
                VaultUtilTypes.VaultItemSynchronizationMessageCommand
                    .SyncResponse &&
            deserializedMessage.Hash != null // NOTE: Maybe pull this check out
        ) {
            // Sync case 1
            if (deserializedMessage.Hash === currentVaultHash) {
                // We're in sync
                console.debug(
                    "[SCC - Verbose WebRTC] Received sync response - we're in sync",
                );

                // Update the last sync date
                this.updateLastSync(context, deviceID);
                return;
            }

            console.debug(
                "[SCC - Verbose WebRTC] Received sync response - we're out of sync",
            );

            // Sync case 3, 4 - we only got a hash and no diffs
            if (!deserializedMessage.Diffs.length) {
                const differences = getDiffsSinceHash(
                    deserializedMessage.Hash,
                    vaultGet().Diffs,
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
                } else {
                    // Sync case 4 - we've diverged and need to trigger manual synchronization
                    const message = new VaultItemSynchronizationMessage(
                        deserializedMessage.ID,
                        VaultUtilTypes.VaultItemSynchronizationMessageCommand.ManualSyncDataRequest,
                    );
                    dataChannel.send(message.serialize());
                }

                return;
            }

            // Sync case 2 - our hashes don't match, got diffs - we're out of sync
            const mockedVault = await calculateMockedVaultHash(
                this.getVaultCredentials(),
                deserializedMessage.Diffs,
            );

            if (mockedVault.isErr()) {
                context.broadcastWebRTCMessageEvent(
                    deviceID,
                    WebRTCMessageEventType.Error,
                    deserializedMessage,
                    `[2] ${mockedVault.error}`,
                );
                return;
            }

            if (mockedVault.value === deserializedMessage.Hash) {
                console.debug(
                    "[SCC - Verbose WebRTC] Received sync response - test apply passed",
                );

                const applyRes = await this.applyDiffsToVault(
                    deserializedMessage.Diffs,
                );
                if (applyRes.isErr()) {
                    context.broadcastWebRTCMessageEvent(
                        deviceID,
                        WebRTCMessageEventType.Error,
                        deserializedMessage,
                        `[2] Failed while applying diffs to vault. Additional information: ${applyRes.error}`,
                    );
                    return;
                }
                this.updateCredentialsList(
                    context,
                    deviceID,
                    applyRes.value.credentials,
                    applyRes.value.diffs,
                );
                this.updateLastSync(context, deviceID);

                // Send a SyncRequest message to the other device so that it updates the last sync date
                await this.transmitSyncRequest(dataChannel);
            } else {
                console.debug(
                    "[SCC - Verbose WebRTC] Received sync response - test apply failed",
                );

                context.broadcastWebRTCMessageEvent(
                    deviceID,
                    WebRTCMessageEventType.Error,
                    deserializedMessage,
                    "[2] Could not apply the synchronization request. Please try again.",
                );
            }
        }

        if (
            deserializedMessage.Command ===
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
        }

        if (
            deserializedMessage.Command ===
            VaultUtilTypes.VaultItemSynchronizationMessageCommand
                .ManualSyncSolve
        ) {
            // Duplicated sync case 2. solution @ SyncResponse
            const mockedVault = await calculateMockedVaultHash(
                this.getVaultCredentials(),
                deserializedMessage.Diffs,
            );

            if (mockedVault.isErr()) {
                context.broadcastWebRTCMessageEvent(
                    deviceID,
                    WebRTCMessageEventType.Error,
                    deserializedMessage,
                    `[2m] ${mockedVault.error}`,
                );
                return;
            }

            if (mockedVault.value === deserializedMessage.Hash) {
                console.debug(
                    "[SCC - Verbose WebRTC] Received Manual synchronization Solve - test apply passed",
                );

                const applyRes = await this.applyDiffsToVault(
                    deserializedMessage.Diffs,
                );
                if (applyRes.isErr()) {
                    context.broadcastWebRTCMessageEvent(
                        deviceID,
                        WebRTCMessageEventType.Error,
                        deserializedMessage,
                        `[2m] Failed while applying diffs to vault. Additional information: ${applyRes.error}`,
                    );
                    return;
                }
                this.updateCredentialsList(
                    context,
                    deviceID,
                    applyRes.value.credentials,
                    applyRes.value.diffs,
                );
                this.updateLastSync(context, deviceID);

                // Send a SyncRequest message to the other device so that it updates the last sync date
                await this.transmitSyncRequest(dataChannel);
            } else {
                console.debug(
                    "[SCC - Verbose WebRTC] Received sync response - test apply failed",
                );

                context.broadcastWebRTCMessageEvent(
                    deviceID,
                    WebRTCMessageEventType.Error,
                    deserializedMessage,
                    "[2m] Could not apply the synchronization request. Please try again.",
                );
            }
        }
    }
}
