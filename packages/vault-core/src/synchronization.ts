import Pusher, { type Channel } from "pusher-js";
import { ulid } from "ulidx";

import { ONLINE_SERVICES_SELECTION_ID } from "./consts";
import { constructSyncPresenceChannelName } from "./presence";
import { authorizePresenceChannel } from "./pusher-auth";
import { getVaultCoreRuntime } from "./runtime";
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
import {
    decapsulateSyncKem,
    encapsulateSyncKem,
} from "./vault-utils/post-quantum-kem";
import { signSyncBytes, verifySyncBytes } from "./vault-utils/sync-signing";
import {
    buildSyncKeyBundle,
    createSessionId,
    deriveAeadKey,
    hashTranscript,
    openAead,
    sealAead,
    syncMessageAad,
    syncSessionAcceptTranscript,
    syncSessionInitTranscript,
    SYNC_PROTOCOL_VERSION,
} from "./vault-utils/sync-crypto";

const syncLog = {
    debug: (message: string, context?: Record<string, unknown>) =>
        getVaultCoreRuntime().syncLog.debug(message, context),
    info: (message: string, context?: Record<string, unknown>) =>
        getVaultCoreRuntime().syncLog.info(message, context),
    warn: (message: string, context?: Record<string, unknown>) =>
        getVaultCoreRuntime().syncLog.warn(message, context),
    error: (message: string, context?: Record<string, unknown>) =>
        getVaultCoreRuntime().syncLog.error(message, context),
};

const signalingLog = {
    debug: (message: string, context?: Record<string, unknown>) =>
        getVaultCoreRuntime().signalingLog.debug(message, context),
    info: (message: string, context?: Record<string, unknown>) =>
        getVaultCoreRuntime().signalingLog.info(message, context),
    warn: (message: string, context?: Record<string, unknown>) =>
        getVaultCoreRuntime().signalingLog.warn(message, context),
    error: (message: string, context?: Record<string, unknown>) =>
        getVaultCoreRuntime().signalingLog.error(message, context),
};

const webrtcLog = {
    debug: (message: string, context?: Record<string, unknown>) =>
        getVaultCoreRuntime().webrtcLog.debug(message, context),
    info: (message: string, context?: Record<string, unknown>) =>
        getVaultCoreRuntime().webrtcLog.info(message, context),
    warn: (message: string, context?: Record<string, unknown>) =>
        getVaultCoreRuntime().webrtcLog.warn(message, context),
    error: (message: string, context?: Record<string, unknown>) =>
        getVaultCoreRuntime().webrtcLog.error(message, context),
};

const env = {
    get NEXT_PUBLIC_PUSHER_APP_KEY() {
        return getVaultCoreRuntime().env.NEXT_PUBLIC_PUSHER_APP_KEY;
    },
    get NEXT_PUBLIC_PUSHER_APP_HOST() {
        return getVaultCoreRuntime().env.NEXT_PUBLIC_PUSHER_APP_HOST;
    },
    get NEXT_PUBLIC_PUSHER_APP_PORT() {
        return getVaultCoreRuntime().env.NEXT_PUBLIC_PUSHER_APP_PORT;
    },
    get NEXT_PUBLIC_PUSHER_APP_TLS() {
        return getVaultCoreRuntime().env.NEXT_PUBLIC_PUSHER_APP_TLS;
    },
};

function onlineServicesApi() {
    return getVaultCoreRuntime().onlineServicesApi;
}

function onlineServicesSessionPort() {
    return getVaultCoreRuntime().onlineServicesSessionPort;
}

/**
 * Interface for vault operations that the VaultItemSynchronization class needs
 */
export interface VaultOperations {
    getCredentialVersionVectors(): Promise<VaultUtilTypes.VersionVector[]>;
    getDirectoryVersionVectors(): Promise<VaultUtilTypes.VersionVector[]>;
    getItems(
        items: VaultUtilTypes.SyncItemReference[],
    ): Promise<VaultUtilTypes.SyncDataResponseMessage>;
    updateItems(
        directories: VaultUtilTypes.Directory[],
        credentials: VaultUtilTypes.Credential[],
    ): Promise<void>;
    getSynchronizationConfig(): Promise<VaultUtilTypes.LinkedDevices>;
    getSyncSigningPublicKey(): Promise<string | null>;
    getSyncSigningPrivateKey(): Promise<string | null>;
    getSyncKemPublicKey(): Promise<string | null>;
    getSyncKemPrivateKey(): Promise<string | null>;
    getRemoteSyncPublicKey(linkedDeviceId: string): Promise<string | null>;
    getRemoteSyncKemPublicKey(linkedDeviceId: string): Promise<string | null>;
}

export type InitWebRTCOptions = {
    /** Required when using Cryptex Online Services TURN (no custom TURN servers). */
    syncId?: string;
};

const constructSyncChannelName = constructSyncPresenceChannelName;

const MAX_PENDING_SYNC_DATA_REQUESTS_PER_DEVICE = 32;
const PENDING_SYNC_DATA_REQUEST_TTL_MS = 2 * 60 * 1000;
const SYNC_SESSION_ACCEPT_TIMEOUT_MS = 15_000;

function createReadySignal(): {
    promise: Promise<void>;
    resolve: () => void;
} {
    let resolveReady: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
        resolveReady = resolve;
    });

    if (!resolveReady) {
        throw new Error("Failed to initialize readiness signal.");
    }

    return {
        promise,
        resolve: resolveReady,
    };
}

export const initWebRTC = async (
    stunServers: VaultUtilTypes.STUNServerConfiguration[],
    turnServers: VaultUtilTypes.TURNServerConfiguration[],
    options?: InitWebRTCOptions,
): Promise<RTCPeerConnection> => {
    const _stunServers =
        stunServers.length === 0
            ? []
            : stunServers.map((stunServer) => ({
                  urls: `stun:${stunServer.Host}`,
              }));

    let _turnServers: RTCIceServer[];
    if (turnServers.length === 0) {
        if (!options?.syncId) {
            throw new Error(
                "syncId is required to fetch Online Services TURN credentials",
            );
        }

        await onlineServicesSessionPort().ensureFresh();

        const syncId = options.syncId;
        const fetchTurnCredentials = () =>
            onlineServicesApi().getTurnCredentials(syncId);
        let turnCredentials: Awaited<ReturnType<typeof fetchTurnCredentials>>;
        try {
            turnCredentials = await fetchTurnCredentials();
        } catch (error) {
            const reauthenticated =
                await onlineServicesSessionPort().forceReauthenticate();
            if (!reauthenticated) {
                throw error;
            }

            turnCredentials = await fetchTurnCredentials();
        }
        _turnServers = turnCredentials.iceServers;
    } else {
        _turnServers = turnServers.map((turnServer) => ({
            urls: `turn:${turnServer.Host}`,
            username: turnServer.Username,
            credential: turnServer.Password,
        }));
    }

    return new RTCPeerConnection({
        iceServers: [..._stunServers, ..._turnServers],
    });
};

/**
 * Should not be used directly. Use the initPusherInstance function instead
 * @param syncID - The sync ID to use when connecting to the Online Services signaling server
 * @returns A new Pusher instance
 */
const onlineServicesPusherInstance = (_syncID: string): Pusher => {
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
            customHandler: (req, _next) => {
                signalingLog.debug("Pusher auth request", { request: req });
                // return next(req);
            },
        },
        channelAuthorization: {
            transport: "ajax",
            endpoint: "",
            customHandler: async (req, next) => {
                const authorizeChannel = () =>
                    onlineServicesApi().authorizeSignalingChannel({
                        channelName: req.channelName,
                        socketId: req.socketId,
                    });

                try {
                    const data = await authorizeChannel();

                    return next(null, data);
                } catch (e) {
                    const reauthenticated =
                        await onlineServicesSessionPort().forceReauthenticate();
                    if (reauthenticated) {
                        try {
                            const data = await authorizeChannel();
                            return next(null, data);
                        } catch (retryError) {
                            signalingLog.warn(
                                "Failed to authorize Pusher channel after Online Services reauthentication",
                                { error: retryError },
                            );
                            return next(retryError as Error, null);
                        }
                    }

                    signalingLog.warn(
                        "Failed to authorize Pusher channel with Online Services",
                        { error: e },
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
                signalingLog.debug(
                    "Custom signaling server channel auth request",
                    { channelName: req.channelName },
                );

                const userData = {
                    user_id: user_id,
                    user_info: {
                        id: user_id,
                    },
                };

                try {
                    const data = await authorizePresenceChannel({
                        key: signalingServer.Key,
                        secret: signalingServer.Secret,
                        socketId: req.socketId,
                        channelName: req.channelName,
                        userData,
                    });
                    return next(null, data);
                } catch (error) {
                    return next(
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                        null,
                    );
                }
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
        this._vaultItemSynchronization = new VaultItemSynchronization(
            vaultOperations,
            this,
        );

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
            { serverId: id },
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
        webrtcLog.info(`Tearing down WebRTC connection for device ${id}`, {
            deviceId: id,
        });

        // if (
        //     instance.dataChannel &&
        //     instance.dataChannel.readyState !== "closed"
        // ) {
        instance.dataChannel?.close();
        // }

        instance.connection.close();

        this._webRTConnections.delete(id);
        this._webRTCStatus.delete(id);
        this._vaultItemSynchronization.clearPendingSyncDataRequests(id);
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
                {
                    serverId: server.ID,
                    serverName: server.Name,
                    syncId: syncID,
                },
            );
        else
            signalingLog.info(
                `Connecting to Online Services signaling server with sync ID: ${syncID}`,
                { syncId: syncID },
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
                    {
                        previous: state.previous,
                        current: state.current,
                        serverId: serverID,
                    },
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
        webRTCReady?: Promise<void>,
    ) {
        //console.debug(channelName, signalingServerConn.allChannels());
        // Check if we're already subscribed to this channel
        const existing = signalingServerConn
            .allChannels()
            .find((c) => c.name === channelName);
        if (existing) {
            signalingLog.debug(
                `Already subscribed to channel, cleaning up and resubscribing`,
                { channelName },
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
                signalingLog.info(`Channel subscription succeeded`, {
                    channelName,
                    memberCount: context.count,
                });
            },
        );

        channel.bind(
            this._signalingEventName,
            async (data: SignalingServerMessage) => {
                signalingLog.debug(`Received signaling event: ${data.type}`, {
                    type: data.type,
                    deviceId: device.ID,
                });

                this._processSignalingData(channel, device, data);
            },
        );

        channel.bind("pusher:member_added", async (data: { id: string }) => {
            signalingLog.info(`Member joined channel`, {
                memberId: data.id,
                channelName,
            });

            await webRTCReady;
            if (!this._webRTConnections.has(device.ID)) {
                signalingLog.warn(
                    "Skipping WebRTC offer because connection setup is unavailable",
                    { memberId: data.id, channelName },
                );
                return;
            }

            // Create a WebRTC offer and send it to the new device to initiate the connection
            const offer = await this._craftWebRTCOffer(device.ID);
            if (!offer) return;

            channel.trigger(this._signalingEventName, {
                type: SignalingServerMessageType.Offer,
                data: offer,
            });

            signalingLog.debug("Sent WebRTC offer to new member", {
                memberId: data.id,
            });
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
                { deviceId: deviceID },
            );

            return;
        }

        const offer = await webRTC.connection.createOffer();
        await webRTC.connection.setLocalDescription(offer);

        signalingLog.debug(`Crafted WebRTC offer for device ${deviceID}`, {
            deviceId: deviceID,
            offer: offer,
        });

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
                { deviceId: device.ID, deviceName: device.Name },
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
                    { deviceId: device.ID, deviceName: device.Name },
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

                signalingLog.debug("Sent WebRTC answer", {
                    deviceId: device.ID,
                });
            }
        } else if (data.type === SignalingServerMessageType.ICECompleted) {
            signalingLog.debug("Received ICE completed event from peer", {
                deviceId: device.ID,
            });
        } else {
            signalingLog.error("Received unknown signaling message type", {
                type: data.type,
                deviceId: device.ID,
            });
        }
    }

    private async _setupWebRTCConnection(
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

        const webRTC = await initWebRTC(stun, turn, {
            syncId: device.SyncID,
        });

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
                this._vaultItemSynchronization.clearPendingSyncDataRequests(
                    device.ID,
                );
            } else if (webRTC.connectionState === "failed") {
                newWebRTCStatus = WebRTCStatus.Failed;
                this._vaultItemSynchronization.clearPendingSyncDataRequests(
                    device.ID,
                );
            } else {
                webrtcLog.warn(`Received unknown connection state`, {
                    state: webRTC.connectionState,
                    deviceId: device.ID,
                    deviceName: device.Name,
                });
                newWebRTCStatus = WebRTCStatus.Failed;
            }

            this._webRTCStatus.set(device.ID, newWebRTCStatus);
            if (
                newWebRTCStatus === WebRTCStatus.Disconnected ||
                newWebRTCStatus === WebRTCStatus.Failed
            ) {
                this._vaultItemSynchronization.clearPendingSyncDataRequests(
                    device.ID,
                );
            }
            webrtcLog.info(
                `Connection state changed ${WebRTCStatus[newWebRTCStatus]}`,
                {
                    deviceId: device.ID,
                    deviceName: device.Name,
                    state: webRTC.connectionState,
                },
            );
            this.broadcastWebRTCConnectionEvent(device.ID, newWebRTCStatus);
        };

        let iceCandidatesWeGenerated = 0;
        webRTC.onicecandidate = async (event) => {
            if (event && event.candidate) {
                signalingLog.debug(`Sending ICE candidate`, {
                    deviceId: device.ID,
                    deviceName: device.Name,
                    candidateType: event.candidate.type,
                });

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
                    {
                        deviceId: device.ID,
                        deviceName: device.Name,
                        candidatesGenerated: iceCandidatesWeGenerated,
                    },
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
                this._vaultItemSynchronization.clearPendingSyncDataRequests(
                    device.ID,
                );
                signalingLog.error(`Failed to generate any ICE candidates`, {
                    deviceId: device.ID,
                    deviceName: device.Name,
                });
                this.broadcastWebRTCConnectionEvent(
                    device.ID,
                    WebRTCStatus.Failed,
                );
            }
        };

        const dataChannelOnOpen =
            (dataChannel: RTCDataChannel) => (_event: Event) => {
                webrtcLog.info(`Data channel opened`, {
                    deviceId: device.ID,
                    deviceName: device.Name,
                    channelLabel: dataChannel.label,
                });

                // Save the data channel in the WebRTC connections map
                const currentConnection = this._webRTConnections.get(device.ID);
                if (currentConnection) {
                    currentConnection.dataChannel = dataChannel;
                    this._webRTConnections.set(device.ID, currentConnection);
                }

                if (device.AutoSync) {
                    this.transmitSyncHello(device.ID);
                }
            };

        const dataChannelOnClose = () => (_event: Event) => {
            webrtcLog.info(`Data channel closed`, {
                deviceId: device.ID,
                deviceName: device.Name,
            });

            // Broadcast the disconnection - we treat this as a general disconnect event
            // NOTE: Even though we could probably recover from this state by  opening a new data channel?
            // Should investigate possible connection recovery procedures
            this._webRTCStatus.set(device.ID, WebRTCStatus.Disconnected);
            this._vaultItemSynchronization.clearPendingSyncDataRequests(
                device.ID,
            );
            webrtcLog.info(`Data channel closed`, {
                deviceId: device.ID,
                deviceName: device.Name,
            });
            this.broadcastWebRTCConnectionEvent(
                device.ID,
                WebRTCStatus.Disconnected,
            );
        };

        const dataChannelOnError = () => (_event: Event) => {
            webrtcLog.error(`Data channel error`, {
                deviceId: device.ID,
                deviceName: device.Name,
            });

            // Broadcast the failure - we treat this as a general WebRTC failure
            // NOTE: Even though we could probably recover from this state by opening a new data channel?
            // Should investigate possible connection recovery procedures
            this._webRTCStatus.set(device.ID, WebRTCStatus.Failed);
            this._vaultItemSynchronization.clearPendingSyncDataRequests(
                device.ID,
            );
            webrtcLog.error(`Data channel error`, {
                deviceId: device.ID,
                deviceName: device.Name,
            });
            this.broadcastWebRTCConnectionEvent(device.ID, WebRTCStatus.Failed);
        };

        const dataChannelOnMessage =
            (dataChannel: RTCDataChannel) => (event: MessageEvent) => {
                webrtcLog.debug(`Received data channel message`, {
                    deviceId: device.ID,
                    deviceName: device.Name,
                    dataSize: event.data?.length ?? 0,
                });

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
            webrtcLog.info(`Remote data channel received`, {
                deviceId: device.ID,
                deviceName: device.Name,
                channelLabel: dataChannel.label,
            });

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
        const linkedDevicesConfig =
            await this._vaultOperations.getSynchronizationConfig();
        const device = linkedDevicesConfig.Devices.find(
            (i) => i.ID === deviceID,
        );

        if (!device) {
            syncLog.error("Device not found", { deviceId: deviceID });
            return false;
        }

        syncLog.info("Initiating device connection", {
            deviceId: deviceID,
            deviceName: device.Name,
        });

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
                    {
                        deviceId: device.ID,
                        signalingServerId: device.SignalingServerID,
                    },
                );
                return false;
            }

            signalingServerConn = this._connectSignalingServer(
                device.SyncID,
                signalingServerConfig ?? null, // If this comes out to null - it's an Online Services server
            );
        }

        if (!signalingServerConn) {
            signalingLog.error("Signaling connection instantiation failed", {
                deviceId: device.ID,
            });
            return false;
        }

        const existingWebRTC = this._webRTConnections.get(device.ID);

        if (
            existingWebRTC &&
            (existingWebRTC.connection.connectionState === "connected" ||
                existingWebRTC.connection.connectionState === "connecting")
        ) {
            webrtcLog.debug(`Existing connection found, skipping`, {
                deviceId: device.ID,
                state: existingWebRTC.connection.connectionState,
            });
            return false;
        }

        // Clean up the existing connection handlers
        if (existingWebRTC) {
            this._teardownWebRTCConnection(device.ID, existingWebRTC);
        }

        const channelName = constructSyncChannelName(device.SyncID);
        const webRTCReady = createReadySignal();

        const channel = this._setupSignalingSubscriptions(
            signalingServerConn,
            device,
            channelName,
            webRTCReady.promise,
        );

        let webRTC: RTCPeerConnection;
        try {
            webRTC = await this._setupWebRTCConnection(
                linkedDevicesConfig,
                channel,
                device,
            );
        } catch (error) {
            webRTCReady.resolve();
            channel.unsubscribe();
            channel.unbind();
            webrtcLog.error("Failed to initialize WebRTC connection", {
                deviceId: device.ID,
                error,
            });
            this._webRTCStatus.set(device.ID, WebRTCStatus.Failed);
            this.broadcastWebRTCConnectionEvent(device.ID, WebRTCStatus.Failed);
            return false;
        }

        this._webRTConnections.set(device.ID, {
            connection: webRTC,
            dataChannel: null,
        });
        webRTCReady.resolve();

        return true;
    }

    public async disconnectDevice(device: VaultUtilTypes.LinkedDevice) {
        syncLog.info(`Disconnecting device`, {
            deviceId: device.ID,
            deviceName: device.Name,
        });

        const signalingServer = this._signalingServers.get(
            device.SignalingServerID,
        );

        // Check if the signaling server is used for anything, if not - tear the connection down
        if (signalingServer) {
            const linkedDevicesConfig =
                await this._vaultOperations.getSynchronizationConfig();

            // Get all devices specifying the same Signaling server
            const linkedDevicesUsingSS = linkedDevicesConfig.Devices.filter(
                (i) => i.SignalingServerID === device.SignalingServerID,
            ).map((i) => i.ID);

            const webRTCInstances = Array.from(
                this._webRTConnections.entries(),
            );
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
            webrtcLog.debug(`No WebRTC handle found for disconnection`, {
                deviceId: device.ID,
            });
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
            { serverId: serverID, status: SignalingStatus[connectionState] },
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
            { deviceId: deviceID, status: WebRTCStatus[connectionState] },
        );

        // deviceEventHandler({
        //     type: SyncConnectionControllerEventType.ConnectionStatus,
        //     data: {
        //         connectionState: connectionState,
        //     },
        // });
        deviceEventHandler({
            type: SyncConnectionControllerEventType.ConnectionStatus,
            connectionState,
        });
    }

    public broadcastWebRTCSyncErrorEvent(deviceID: string) {
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

        syncLog.info(`Synchronization completed`, { deviceId: deviceID });

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
            webrtcLog.warn(`No WebRTC connection for sync hello`, {
                deviceId: deviceID,
            });

            return;
        }

        // Get the WebRTC data channel
        const dataChannel = webRTC.dataChannel;
        if (!dataChannel) {
            webrtcLog.warn(`No data channel available for sync hello`, {
                deviceId: deviceID,
            });

            return;
        }

        this._vaultItemSynchronization.transmitSyncHello(deviceID, dataChannel);
    }
}

type SyncSessionState = {
    sessionID: string;
    key: CryptoKey;
    sendSequence: number;
    receiveSequence: number;
    ready: boolean;
    initiatorBundle: VaultUtilTypes.SyncKeyBundle;
    responderBundle: VaultUtilTypes.SyncKeyBundle;
    localBundle: VaultUtilTypes.SyncKeyBundle;
    remoteBundle: VaultUtilTypes.SyncKeyBundle;
    kemCiphertext: Uint8Array;
    transcriptHash: Uint8Array;
    readyPromise?: Promise<void>;
    resolveReady?: () => void;
    rejectReady?: (error: Error) => void;
};

/**
 * Handles vault item synchronization operations using callbacks instead of global state
 */
class VaultItemSynchronization {
    private readonly vaultOps: VaultOperations;
    private readonly context: SyncConnectionController;
    private readonly pendingSyncDataRequests = new Map<
        string,
        Map<string, number>
    >();
    private readonly syncSessions = new Map<string, SyncSessionState>();

    constructor(
        vaultOperations: VaultOperations,
        context: SyncConnectionController,
    ) {
        this.vaultOps = vaultOperations;
        this.context = context;
    }

    public clearPendingSyncDataRequests(linkedDeviceId: string): void {
        this.pendingSyncDataRequests.delete(linkedDeviceId);
    }

    private prunePendingSyncDataRequests(
        linkedDeviceId: string,
        now = Date.now(),
    ): Map<string, number> | undefined {
        const pending = this.pendingSyncDataRequests.get(linkedDeviceId);
        if (!pending) {
            return undefined;
        }

        for (const [envelopeId, createdAt] of pending) {
            if (now - createdAt > PENDING_SYNC_DATA_REQUEST_TTL_MS) {
                pending.delete(envelopeId);
            }
        }

        while (pending.size > MAX_PENDING_SYNC_DATA_REQUESTS_PER_DEVICE) {
            const oldestEnvelopeId = pending.keys().next().value;
            if (!oldestEnvelopeId) {
                break;
            }
            pending.delete(oldestEnvelopeId);
        }

        if (pending.size === 0) {
            this.pendingSyncDataRequests.delete(linkedDeviceId);
            return undefined;
        }

        return pending;
    }

    private trackPendingSyncDataRequest(
        linkedDeviceId: string,
        envelopeId: string,
    ): void {
        let pending = this.prunePendingSyncDataRequests(linkedDeviceId);
        if (!pending) {
            pending = new Map();
            this.pendingSyncDataRequests.set(linkedDeviceId, pending);
        }
        pending.set(envelopeId, Date.now());
        this.prunePendingSyncDataRequests(linkedDeviceId);
    }

    private consumePendingSyncDataRequest(
        linkedDeviceId: string,
        envelopeId: string,
    ): boolean {
        const pending = this.prunePendingSyncDataRequests(linkedDeviceId);
        if (!pending?.has(envelopeId)) {
            return false;
        }
        pending.delete(envelopeId);
        if (pending.size === 0) {
            this.pendingSyncDataRequests.delete(linkedDeviceId);
        }
        return true;
    }

    private async getLocalKeyMaterial(): Promise<{
        signingPublicKey: string;
        signingPrivateKey: string;
        kemPublicKey: string;
        kemPrivateKey: string;
    } | null> {
        const [
            signingPublicKey,
            signingPrivateKey,
            kemPublicKey,
            kemPrivateKey,
        ] = await Promise.all([
            this.vaultOps.getSyncSigningPublicKey(),
            this.vaultOps.getSyncSigningPrivateKey(),
            this.vaultOps.getSyncKemPublicKey(),
            this.vaultOps.getSyncKemPrivateKey(),
        ]);

        if (
            !signingPublicKey ||
            !signingPrivateKey ||
            !kemPublicKey ||
            !kemPrivateKey
        ) {
            return null;
        }

        return {
            signingPublicKey,
            signingPrivateKey,
            kemPublicKey,
            kemPrivateKey,
        };
    }

    private async getRemoteKeyBundle(
        linkedDeviceId: string,
    ): Promise<VaultUtilTypes.SyncKeyBundle | null> {
        const [signingPublicKey, kemPublicKey] = await Promise.all([
            this.vaultOps.getRemoteSyncPublicKey(linkedDeviceId),
            this.vaultOps.getRemoteSyncKemPublicKey(linkedDeviceId),
        ]);
        if (!signingPublicKey || !kemPublicKey) {
            return null;
        }
        return buildSyncKeyBundle(signingPublicKey, kemPublicKey);
    }

    private async ensureOutboundSession(
        remoteDeviceID: string,
        dataChannel: RTCDataChannel,
    ): Promise<SyncSessionState | null> {
        const current = this.syncSessions.get(remoteDeviceID);
        if (current?.ready) {
            return current;
        }
        if (current?.readyPromise) {
            await current.readyPromise;
            return current;
        }

        const localKeys = await this.getLocalKeyMaterial();
        const remoteBundle = await this.getRemoteKeyBundle(remoteDeviceID);
        if (!localKeys || !remoteBundle) {
            syncLog.info(
                "Cannot start encrypted sync session - sync keys are unavailable",
                {
                    deviceId: remoteDeviceID,
                    localKeysAvailable: !!localKeys,
                    remoteBundleAvailable: !!remoteBundle,
                },
            );
            return null;
        }

        const initiatorBundle = buildSyncKeyBundle(
            localKeys.signingPublicKey,
            localKeys.kemPublicKey,
        );
        const sessionID = createSessionId();
        const { kemCiphertext, sharedSecret } = encapsulateSyncKem(
            remoteBundle.SyncKemPublicKey,
        );
        const initTranscript = syncSessionInitTranscript(
            sessionID,
            initiatorBundle,
            remoteBundle,
            kemCiphertext,
        );
        const initTranscriptHash = await hashTranscript(initTranscript);
        const handshakeSignature = await signSyncBytes(
            localKeys.signingPrivateKey,
            initTranscript,
        );
        const key = await deriveAeadKey(sharedSecret, initTranscript);

        let resolveReady: (() => void) | undefined;
        let rejectReady: ((error: Error) => void) | undefined;
        const readyPromise = new Promise<void>((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        const session: SyncSessionState = {
            sessionID,
            key,
            sendSequence: 0,
            receiveSequence: 0,
            ready: false,
            initiatorBundle,
            responderBundle: remoteBundle,
            localBundle: initiatorBundle,
            remoteBundle,
            kemCiphertext,
            transcriptHash: initTranscriptHash,
            readyPromise,
            resolveReady,
            rejectReady,
        };
        this.syncSessions.set(remoteDeviceID, session);

        const envelope = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: sessionID,
            Command: VaultUtilTypes.SyncWireMessageCommand.SyncSessionInit,
            ProtocolVersion: SYNC_PROTOCOL_VERSION,
            SessionID: sessionID,
            Sequence: 0,
            Nonce: new Uint8Array(),
            Ciphertext: new Uint8Array(),
            KemCiphertext: kemCiphertext,
            HandshakeSignature: handshakeSignature,
        }).finish();
        dataChannel.send(this.toArrayBuffer(envelope));

        await Promise.race([
            readyPromise,
            new Promise<never>((_, reject) =>
                globalThis.setTimeout(
                    () => reject(new Error("SYNC_SESSION_ACCEPT_TIMEOUT")),
                    SYNC_SESSION_ACCEPT_TIMEOUT_MS,
                ),
            ),
        ]);

        return session;
    }

    private async sendEncryptedPlaintextMessage(
        remoteDeviceID: string,
        dataChannel: RTCDataChannel,
        envelopeID: string,
        command: VaultUtilTypes.VaultItemSynchronizationMessageCommand,
        plaintext: Uint8Array,
    ): Promise<boolean> {
        let session: SyncSessionState | null;
        try {
            session = await this.ensureOutboundSession(
                remoteDeviceID,
                dataChannel,
            );
        } catch (error) {
            this.syncSessions.delete(remoteDeviceID);
            syncLog.info("Encrypted sync session setup failed", {
                deviceId: remoteDeviceID,
                error,
            });
            return false;
        }
        if (!session?.ready) {
            return false;
        }

        session.sendSequence += 1;
        const sealed = await sealAead(
            session.key,
            plaintext,
            syncMessageAad(
                session.sessionID,
                envelopeID,
                session.sendSequence,
                session.localBundle.SyncSigningPublicKey,
                session.remoteBundle.SyncSigningPublicKey,
                session.transcriptHash,
            ),
        );
        const envelope = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: envelopeID,
            Command: VaultUtilTypes.SyncWireMessageCommand.SyncEncryptedMessage,
            ProtocolVersion: SYNC_PROTOCOL_VERSION,
            SessionID: session.sessionID,
            Sequence: session.sendSequence,
            Nonce: sealed.nonce,
            Ciphertext: sealed.ciphertext,
            KemCiphertext: new Uint8Array(),
            HandshakeSignature: new Uint8Array(),
        }).finish();
        dataChannel.send(this.toArrayBuffer(envelope));
        return true;
    }

    private async handleSessionInit(
        remoteDeviceID: string,
        dataChannel: RTCDataChannel,
        envelope: VaultUtilTypes.SynchronizationEnvelope,
    ): Promise<void> {
        const localKeys = await this.getLocalKeyMaterial();
        const remoteBundle = await this.getRemoteKeyBundle(remoteDeviceID);
        if (!localKeys || !remoteBundle) {
            syncLog.info(
                "Dropped sync session init - sync keys are unavailable",
                {
                    deviceId: remoteDeviceID,
                    localKeysAvailable: !!localKeys,
                    remoteBundleAvailable: !!remoteBundle,
                },
            );
            return;
        }

        const localBundle = buildSyncKeyBundle(
            localKeys.signingPublicKey,
            localKeys.kemPublicKey,
        );
        const initTranscript = syncSessionInitTranscript(
            envelope.SessionID,
            remoteBundle,
            localBundle,
            envelope.KemCiphertext,
        );
        const initTranscriptHash = await hashTranscript(initTranscript);
        const valid = await verifySyncBytes(
            remoteBundle.SyncSigningPublicKey,
            envelope.HandshakeSignature,
            initTranscript,
        );
        if (!valid) {
            syncLog.info("Dropped sync session init - invalid signature", {
                deviceId: remoteDeviceID,
            });
            return;
        }

        const sharedSecret = decapsulateSyncKem(
            envelope.KemCiphertext,
            localKeys.kemPrivateKey,
        );
        const key = await deriveAeadKey(sharedSecret, initTranscript);
        const session: SyncSessionState = {
            sessionID: envelope.SessionID,
            key,
            sendSequence: 0,
            receiveSequence: 0,
            ready: true,
            initiatorBundle: remoteBundle,
            responderBundle: localBundle,
            localBundle,
            remoteBundle,
            kemCiphertext: envelope.KemCiphertext,
            transcriptHash: initTranscriptHash,
        };
        this.syncSessions.set(remoteDeviceID, session);

        const acceptTranscript = syncSessionAcceptTranscript(
            envelope.SessionID,
            remoteBundle,
            localBundle,
            envelope.KemCiphertext,
        );
        const signature = await signSyncBytes(
            localKeys.signingPrivateKey,
            acceptTranscript,
        );
        const accept = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: envelope.SessionID,
            Command: VaultUtilTypes.SyncWireMessageCommand.SyncSessionAccept,
            ProtocolVersion: SYNC_PROTOCOL_VERSION,
            SessionID: envelope.SessionID,
            Sequence: 0,
            Nonce: new Uint8Array(),
            Ciphertext: new Uint8Array(),
            KemCiphertext: envelope.KemCiphertext,
            HandshakeSignature: signature,
        }).finish();
        dataChannel.send(this.toArrayBuffer(accept));

        syncLog.debug("Sent sync session accept", {
            deviceId: remoteDeviceID,
            sessionId: envelope.SessionID,
        });
    }

    private async handleSessionAccept(
        remoteDeviceID: string,
        envelope: VaultUtilTypes.SynchronizationEnvelope,
    ): Promise<void> {
        const session = this.syncSessions.get(remoteDeviceID);
        if (!session || session.sessionID !== envelope.SessionID) {
            syncLog.info("Dropped sync session accept - no pending session", {
                deviceId: remoteDeviceID,
                sessionId: envelope.SessionID,
            });
            return;
        }

        const transcript = syncSessionAcceptTranscript(
            session.sessionID,
            session.initiatorBundle,
            session.responderBundle,
            session.kemCiphertext,
        );
        const valid = await verifySyncBytes(
            session.responderBundle.SyncSigningPublicKey,
            envelope.HandshakeSignature,
            transcript,
        );
        if (!valid) {
            session.rejectReady?.(new Error("SYNC_SESSION_ACCEPT_INVALID"));
            this.syncSessions.delete(remoteDeviceID);

            syncLog.info("Dropped sync session accept - invalid signature", {
                deviceId: remoteDeviceID,
            });
            return;
        }

        session.ready = true;
        session.readyPromise = undefined;
        session.resolveReady?.();

        syncLog.debug("Accepted sync session", {
            deviceId: remoteDeviceID,
            sessionId: envelope.SessionID,
        });
    }

    private async openEncryptedMessage(
        remoteDeviceID: string,
        envelope: VaultUtilTypes.SynchronizationEnvelope,
    ): Promise<Uint8Array | null> {
        const session = this.syncSessions.get(remoteDeviceID);
        if (!session?.ready || session.sessionID !== envelope.SessionID) {
            syncLog.info("Dropped encrypted sync message - no active session", {
                deviceId: remoteDeviceID,
                sessionId: envelope.SessionID,
            });
            return null;
        }
        if (envelope.Sequence !== session.receiveSequence + 1) {
            syncLog.info("Dropped encrypted sync message - invalid sequence", {
                deviceId: remoteDeviceID,
                sessionId: envelope.SessionID,
                sequence: envelope.Sequence,
            });
            return null;
        }

        try {
            const plaintext = await openAead(
                session.key,
                { nonce: envelope.Nonce, ciphertext: envelope.Ciphertext },
                syncMessageAad(
                    envelope.SessionID,
                    envelope.ID,
                    envelope.Sequence,
                    session.remoteBundle.SyncSigningPublicKey,
                    session.localBundle.SyncSigningPublicKey,
                    session.transcriptHash,
                ),
            );
            session.receiveSequence = envelope.Sequence;
            return plaintext;
        } catch (error) {
            syncLog.info(
                "Dropped encrypted sync message - authentication failed",
                {
                    deviceId: remoteDeviceID,
                    sessionId: envelope.SessionID,
                    error,
                },
            );
            return null;
        }
    }

    private toArrayBuffer(data: Uint8Array): ArrayBuffer {
        return data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
        ) as ArrayBuffer;
    }

    private updateLastSync(deviceID: string): void {
        // The actual device object field is modified by the Device UI component
        this.context.broadcastWebRTCSynchronizedEvent(deviceID);
    }

    private getCredentialVersionVectors() {
        return this.vaultOps.getCredentialVersionVectors();
    }

    private getDirectoryVersionVectors() {
        return this.vaultOps.getDirectoryVersionVectors();
    }

    public async transmitSyncHello(
        deviceID: string,
        dataChannel: RTCDataChannel,
    ): Promise<void> {
        const { envelopeID, data } =
            await SynchronizationEnvelope.createSyncHelloMessage(
                await this.getCredentialVersionVectors(),
                await this.getDirectoryVersionVectors(),
            );

        const sent = await this.sendEncryptedPlaintextMessage(
            deviceID,
            dataChannel,
            envelopeID,
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHello,
            data,
        );
        if (!sent) {
            syncLog.warn(
                "Failed to send sync hello - encrypted session unavailable",
                {
                    deviceId: deviceID,
                },
            );
            return;
        }

        syncLog.debug("Sent a sync hello message to remote device", {
            messageId: envelopeID,
            deviceId: deviceID,
        });
    }

    public async onDataChannelMessage(
        remoteDeviceID: string,
        dataChannel: RTCDataChannel,
        event: MessageEvent,
    ): Promise<void> {
        let envelope: VaultUtilTypes.SynchronizationEnvelope;
        try {
            envelope = VaultUtilTypes.SynchronizationEnvelope.decode(
                new Uint8Array(event.data),
            );
        } catch {
            syncLog.info(
                "Dropped sync message - plaintext or malformed envelope",
                { deviceId: remoteDeviceID },
            );
            this.context.broadcastWebRTCSyncErrorEvent(remoteDeviceID);
            return;
        }

        if (envelope.ProtocolVersion !== SYNC_PROTOCOL_VERSION) {
            syncLog.info(
                "Dropped sync message - unsupported protocol version",
                {
                    deviceId: remoteDeviceID,
                    protocolVersion: envelope.ProtocolVersion,
                },
            );
            this.context.broadcastWebRTCSyncErrorEvent(remoteDeviceID);
            return;
        }

        if (
            envelope.Command ===
            VaultUtilTypes.SyncWireMessageCommand.SyncSessionInit
        ) {
            await this.handleSessionInit(remoteDeviceID, dataChannel, envelope);
            return;
        }
        if (
            envelope.Command ===
            VaultUtilTypes.SyncWireMessageCommand.SyncSessionAccept
        ) {
            await this.handleSessionAccept(remoteDeviceID, envelope);
            return;
        }
        if (
            envelope.Command !==
            VaultUtilTypes.SyncWireMessageCommand.SyncEncryptedMessage
        ) {
            syncLog.info("Dropped sync message - invalid wire command", {
                deviceId: remoteDeviceID,
                command: envelope.Command,
            });
            return;
        }

        const plaintext = await this.openEncryptedMessage(
            remoteDeviceID,
            envelope,
        );
        if (!plaintext) return;

        const deserializedMessageResult =
            await SynchronizationEnvelope.deserialize(
                this.toArrayBuffer(plaintext),
            );

        if (deserializedMessageResult.isErr()) {
            const error = deserializedMessageResult.error;
            syncLog.error("Failed to deserialize sync message", {
                error: error,
                dataSize: plaintext.byteLength,
                deviceId: remoteDeviceID,
            });

            this.context.broadcastWebRTCSyncErrorEvent(remoteDeviceID);
            return;
        }

        const deserializedMessage = deserializedMessageResult.value;

        const command = deserializedMessage.command;
        const commandString =
            VaultUtilTypes.VaultItemSynchronizationMessageCommand[command];

        syncLog.debug(`Received a valid sync message: '${commandString}'`, {
            messageId: deserializedMessage.id,
            command: commandString,
            deviceId: remoteDeviceID,
        });

        switch (command) {
            case VaultUtilTypes.VaultItemSynchronizationMessageCommand
                .SyncHello:
                // Send the SyncHello back
                const envelope =
                    await SynchronizationEnvelope.createSyncHelloEchoMessage(
                        await this.getCredentialVersionVectors(),
                        await this.getDirectoryVersionVectors(),
                    );
                await this.sendEncryptedPlaintextMessage(
                    remoteDeviceID,
                    dataChannel,
                    envelope.envelopeID,
                    VaultUtilTypes.VaultItemSynchronizationMessageCommand
                        .SyncHelloEcho,
                    envelope.data,
                );
                syncLog.debug(
                    `Sent a sync hello echo message to the remote device`,
                    {
                        messageId: envelope.envelopeID,
                        deviceId: remoteDeviceID,
                    },
                );

                await this.handleSyncHelloMessage(
                    remoteDeviceID,
                    dataChannel,
                    deserializedMessage.id,
                    deserializedMessage.data,
                );
                break;
            case VaultUtilTypes.VaultItemSynchronizationMessageCommand
                .SyncDataRequest:
                await this.handleSyncDataRequestMessage(
                    remoteDeviceID,
                    dataChannel,
                    deserializedMessage.id,
                    deserializedMessage.data,
                );
                break;
            case VaultUtilTypes.VaultItemSynchronizationMessageCommand
                .SyncDataResponse:
                await this.handleSyncDataResponseMessage(
                    remoteDeviceID,
                    dataChannel,
                    deserializedMessage.id,
                    deserializedMessage.data,
                );
                break;

            case VaultUtilTypes.VaultItemSynchronizationMessageCommand
                .SyncHelloEcho:
                // NOTE: This is a response to our SyncHello message, treat it as a regular SyncHello message, but without sending a response back
                await this.handleSyncHelloMessage(
                    remoteDeviceID,
                    dataChannel,
                    deserializedMessage.id,
                    deserializedMessage.data,
                );
                break;

            // NOTE: Envelope deserialization will handle the invalid command case, but have this here for completeness
            default:
                syncLog.error(
                    "Received an invalid sync message command after envelope deserialization. A sync message handler is not implemented for this command.",
                    {
                        command: commandString,
                        deviceId: remoteDeviceID,
                        message: deserializedMessage,
                    },
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
        const versionVectors = [
            ...message.CredentialVersionVectors.map((vector) => ({
                ...vector,
                ID: `credential:${vector.ID}`,
            })),
            ...message.DirectoryVersionVectors.map((vector) => ({
                ...vector,
                ID: `directory:${vector.ID}`,
            })),
        ];

        syncLog.info(`Received a sync hello message from the remote device`, {
            envelopeId: envelopeID,
            versionVectors: versionVectors,
            deviceId: remoteDeviceID,
        });

        // Compare the version vectors with the local version vectors so that we can determine if we need to send a sync data request message
        const localVersionVectors = [
            ...(await this.getCredentialVersionVectors()).map((vector) => ({
                ...vector,
                ID: `credential:${vector.ID}`,
            })),
            ...(await this.getDirectoryVersionVectors()).map((vector) => ({
                ...vector,
                ID: `directory:${vector.ID}`,
            })),
        ];

        const versionVectorsMatchingIDs = versionVectors.filter((vector) =>
            localVersionVectors.some(
                (localVector) => localVector.ID === vector.ID,
            ),
        );
        const versionVectorsNotMatchingLocalVersionVectors =
            versionVectors.filter(
                (vector) =>
                    !localVersionVectors.some(
                        (localVector) => localVector.ID === vector.ID,
                    ),
            );
        // const ourVersionVectorsNotMatchingRemoteVersionVectors = localVersionVectors.filter(vector => !versionVectors.some(remoteVector => remoteVector.ID === vector.ID));

        syncLog.debug("Version vectors matching IDs", {
            envelopeId: envelopeID,
            versionVectorsMatchingIDsCount: versionVectorsMatchingIDs.length,
            versionVectorsMatchingIDs,
            deviceId: remoteDeviceID,
        });
        syncLog.debug("Version vectors not matching local version vectors", {
            envelopeId: envelopeID,
            versionVectorsNotMatchingLocalVersionVectorsCount:
                versionVectorsNotMatchingLocalVersionVectors.length,
            versionVectorsNotMatchingLocalVersionVectors,
            deviceId: remoteDeviceID,
        });
        // syncLog.debug(
        //     `Version vectors not matching remote version vectors: ${ourVersionVectorsNotMatchingRemoteVersionVectors.length}`,
        //     { envelopeId: envelopeID, ourVersionVectorsNotMatchingRemoteVersionVectorsCount: ourVersionVectorsNotMatchingRemoteVersionVectors.length, deviceId: deviceID }
        // );

        const idsToRequest: string[] = [];

        // Add the version vectors that are not matching IDs to the IDs to request
        // NOTE: This is a list of IDs that we don't have locally, but the remote device does
        if (versionVectorsNotMatchingLocalVersionVectors.length > 0) {
            idsToRequest.push(
                ...versionVectorsNotMatchingLocalVersionVectors.map(
                    (vector) => vector.ID,
                ),
            );
            syncLog.debug("IDs to request", {
                envelopeId: envelopeID,
                idsToRequestCount: idsToRequest.length,
                idsToRequest,
                deviceId: remoteDeviceID,
            });
        }

        // NOTE: We're not sending any credentials to the remote device in this message.

        // Compare the versions of the version vectors that are matching IDs
        const versionsLargerThanLocal = versionVectorsMatchingIDs.filter(
            (vector) => {
                const localVector = localVersionVectors.find(
                    (localVector) => localVector.ID === vector.ID,
                );
                return (
                    localVector !== undefined &&
                    localVector.Version < vector.Version
                );
            },
        );
        if (versionsLargerThanLocal.length > 0) {
            idsToRequest.push(
                ...versionsLargerThanLocal.map((vector) => vector.ID),
            );
            syncLog.debug(
                "Version vectors matching IDs but with local version lower than remote version",
                {
                    envelopeId: envelopeID,
                    versionsLargerThanLocalCount:
                        versionsLargerThanLocal.length,
                    versionsLargerThanLocal,
                    deviceId: remoteDeviceID,
                },
            );
        }

        // Compare the hashes of the version vectors that are matching IDs and have the same version
        const hashesNotMatching = versionVectorsMatchingIDs.filter(
            (vector) =>
                localVersionVectors.find(
                    (localVector) => localVector.ID === vector.ID,
                )?.Version === vector.Version &&
                localVersionVectors.find(
                    (localVector) => localVector.ID === vector.ID,
                )?.Hash !== vector.Hash,
        );
        if (hashesNotMatching.length > 0) {
            // Pseudo code:
            // if remote.datemodifiedtimestamp > local.datemodifiedtimestamp, then we need to request the item
            // else if remote.datemodifiedtimestamp < local.datemodifiedtimestamp, then we need to ignore it and the remote will request it from us
            // else, sort the hashes lexicographically and request the item from the lowest hash

            const tiebreakItems: string[] = [];

            const itemsToRequest = hashesNotMatching.filter((vector) => {
                const remoteVector = versionVectors.find(
                    (v) => v.ID === vector.ID,
                );
                const localVector = localVersionVectors.find(
                    (v) => v.ID === vector.ID,
                );
                if (
                    remoteVector?.DateModifiedTimestamp == null ||
                    localVector?.DateModifiedTimestamp == null
                ) {
                    return false;
                }

                if (
                    remoteVector.DateModifiedTimestamp >
                    localVector.DateModifiedTimestamp
                )
                    return true;
                else if (
                    remoteVector.DateModifiedTimestamp <
                    localVector.DateModifiedTimestamp
                )
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
                },
            );

            idsToRequest.push(...itemsToRequest.map((vector) => vector.ID));
        }

        if (idsToRequest.length > 0) {
            const { envelopeID: syncDataRequestEnvelopeID, data } =
                await SynchronizationEnvelope.createSyncDataRequestMessage(
                    idsToRequest.map((compositeID) => {
                        const [kind, ...idParts] = compositeID.split(":");
                        return {
                            Type:
                                kind === "directory"
                                    ? VaultUtilTypes.SyncItemType.DirectoryItem
                                    : VaultUtilTypes.SyncItemType
                                          .CredentialItem,
                            ID: idParts.join(":"),
                        };
                    }),
                );

            await this.sendEncryptedPlaintextMessage(
                remoteDeviceID,
                dataChannel,
                syncDataRequestEnvelopeID,
                VaultUtilTypes.VaultItemSynchronizationMessageCommand
                    .SyncDataRequest,
                data,
            );

            this.trackPendingSyncDataRequest(
                remoteDeviceID,
                syncDataRequestEnvelopeID,
            );

            syncLog.info(
                "Sent a sync data request message to the remote device",
                {
                    envelopeId: envelopeID,
                    syncDataRequestEnvelopeID,
                    idsToRequest: idsToRequest,
                    deviceId: remoteDeviceID,
                },
            );
        } else {
            syncLog.info(
                "No IDs to request, skipping sync data request message",
                { envelopeId: envelopeID, deviceId: remoteDeviceID },
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
        const items = message.Items;
        const itemIDs = items.map((item) => item.ID);

        syncLog.info(
            "Received a sync data request message from the remote device",
            {
                envelopeId: envelopeID,
                itemIDsCount: itemIDs.length,
                itemIDs,
                deviceId: remoteDeviceID,
            },
        );

        const response = await this.vaultOps.getItems(items);

        const envelope =
            await SynchronizationEnvelope.createSyncDataResponseMessage(
                envelopeID,
                response.Credentials,
                response.Directories,
            );

        await this.sendEncryptedPlaintextMessage(
            remoteDeviceID,
            dataChannel,
            envelopeID,
            VaultUtilTypes.VaultItemSynchronizationMessageCommand
                .SyncDataResponse,
            envelope,
        );

        syncLog.info("Sent a sync data response message to the remote device", {
            envelopeId: envelopeID,
            itemIDsCount: itemIDs.length,
            itemIDs,
            deviceId: remoteDeviceID,
        });
    }

    private async handleSyncDataResponseMessage(
        remoteDeviceID: string,
        dataChannel: RTCDataChannel,
        envelopeID: string,
        message: VaultUtilTypes.SyncDataResponseMessage,
    ) {
        if (!this.consumePendingSyncDataRequest(remoteDeviceID, envelopeID)) {
            syncLog.info("Dropped unsolicited sync data response", {
                envelopeId: envelopeID,
                deviceId: remoteDeviceID,
            });
            return;
        }

        const credentials = message.Credentials;
        const directories = message.Directories;

        syncLog.info(
            "Received a sync data response message from the remote device",
            {
                envelopeId: envelopeID,
                credentialsCount: credentials.length,
                credentialIds: credentials.map((c) => c.ID),
                deviceId: remoteDeviceID,
            },
        );

        // Directory state, especially tombstones, must be applied before
        // credential assignments from the same response.
        await this.vaultOps.updateItems(directories, credentials);

        syncLog.info("Updated credentials in the vault", {
            envelopeId: envelopeID,
            credentialsCount: credentials.length,
            credentialIds: credentials.map((c) => c.ID),
            deviceId: remoteDeviceID,
        });
        this.updateLastSync(remoteDeviceID);
    }
}
