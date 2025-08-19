import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { err, ok } from "neverthrow";
import * as VaultUtilTypes from "../proto/vault";
import * as VaultEncryption from "./encryption";
import { initPusherInstance, initWebRTC } from "../synchronization";
import { constructLinkPresenceChannelName } from "../online-services";
import Pusher, { Channel } from "pusher-js";
import { base64ToUint8, uint8ToBase64 } from "@/lib/utils";

export class LinkingPackage implements VaultUtilTypes.LinkingPackage {
    Blob: Uint8Array;
    Salt: string;
    HeaderIV: string;

    constructor(blob: Uint8Array, salt: string, headerIV: string) {
        this.Blob = blob;
        this.Salt = salt;
        this.HeaderIV = headerIV;
    }

    public static async createNewPackage(
        blob: VaultUtilTypes.LinkingPackageBlob,
    ): Promise<{
        mnemonic: string;
        linkingPackage: LinkingPackage;
    }> {
        const mnemonic = bip39.generateMnemonic(wordlist, 256);
        const secret = await VaultEncryption.hashSecret(mnemonic);

        const newEncryptedBlob: VaultEncryption.EncryptedBlob =
            VaultEncryption.EncryptedBlob.CreateDefault();

        newEncryptedBlob.Blob =
            VaultUtilTypes.LinkingPackageBlob.encode(blob).finish();

        const _encryptedData = await VaultEncryption.EncryptDataBlob(
            newEncryptedBlob.Blob,
            secret,
            VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            VaultUtilTypes.KeyDerivationFunction.Argon2ID,
            newEncryptedBlob.KDFConfigArgon2ID as VaultUtilTypes.KeyDerivationConfigArgon2ID,
            newEncryptedBlob.KDFConfigPBKDF2 as VaultUtilTypes.KeyDerivationConfigPBKDF2,
        );

        const linkingPackage = new LinkingPackage(
            _encryptedData.Blob,
            _encryptedData.Salt,
            _encryptedData.HeaderIV,
        );

        return {
            mnemonic,
            linkingPackage,
        };
    }

    public async decryptPackage(secret: string) {
        // Create a default EncryptedBlob object and assign the encrypted data to it
        const encryptedBlob = VaultEncryption.EncryptedBlob.CreateDefault();
        encryptedBlob.Blob = this.Blob;
        encryptedBlob.Salt = this.Salt;
        encryptedBlob.HeaderIV = this.HeaderIV;

        const decryptedRes = await VaultEncryption.DecryptDataBlob(
            encryptedBlob,
            await VaultEncryption.hashSecret(secret),
            encryptedBlob.Algorithm,
            encryptedBlob.KeyDerivationFunc,
            encryptedBlob.KeyDerivationFunc ===
                VaultUtilTypes.KeyDerivationFunction.Argon2ID
                ? (encryptedBlob.KDFConfigArgon2ID as VaultUtilTypes.KeyDerivationConfigArgon2ID)
                : (encryptedBlob.KDFConfigPBKDF2 as VaultUtilTypes.KeyDerivationConfigPBKDF2),
        );

        if (decryptedRes.isErr()) return err(decryptedRes.error);

        return ok(VaultUtilTypes.LinkingPackageBlob.decode(decryptedRes.value));
    }

    public toBinary(): Uint8Array {
        const serializedVault =
            VaultUtilTypes.LinkingPackage.encode(this).finish();
        return serializedVault;
    }

    public toBase64(): string {
        const serializedVault = this.toBinary();

        // Same logic as in VaultEncryption.encryptBlob for the string output
        const b64Blob = uint8ToBase64(serializedVault);

        return b64Blob;
    }

    public static fromBinary(binary: Uint8Array): LinkingPackage {
        const deserialized = VaultUtilTypes.LinkingPackage.decode(binary);

        return new LinkingPackage(
            deserialized.Blob,
            deserialized.Salt,
            deserialized.HeaderIV,
        );
    }

    public static fromBase64(base64: string) {
        // Validate the data
        if (!base64?.length) {
            return err("DATA_INVALID");
        }

        const bin = base64ToUint8(base64);

        const newInstance = this.fromBinary(bin);

        return ok(newInstance);
    }
}

export enum LinkingProcessState {
    Pending,
    Active,
    Completed,
    Error,
    Warning,
}

export enum LinkingProcessStep {
    Signaling,
    SignalingWaitingOtherDevice,
    DirectConnection,
    SignalingCleanup,
    VaultTransfer,
    VaultSave,
    DirectConnectionCleanup,
}

export interface WebRTCErrorDetails {
    type: "webrtc";
    error: Error;
}

export interface ConnectionStateDetails {
    type: "connection_state";
    state: string;
}

export interface VaultErrorDetails {
    type: "vault";
    error: Error;
}

export type LogDetails =
    | WebRTCErrorDetails
    | ConnectionStateDetails
    | VaultErrorDetails;

export interface LinkingProcessStatus {
    Step: LinkingProcessStep;
    State: LinkingProcessState;
    VaultBinaryData?: Uint8Array;
    LogMessage?: {
        message: string;
        timestamp: number;
        type: "debug" | "info" | "error";
        details?: LogDetails;
    };
}

export class LinkingProcessController {
    linkingPackage: VaultUtilTypes.LinkingPackageBlob;
    usesOnlineServices: boolean;
    onStatusChange: (state: LinkingProcessStatus) => Promise<void>;

    signalingServer: Pusher;
    signalingServerChannel: Channel;
    webRTCConnection: RTCPeerConnection;

    public constructor(
        linkingBlob: VaultUtilTypes.LinkingPackageBlob,
        usesOnlineServices: boolean,
        onStatusChange: (state: LinkingProcessStatus) => Promise<void>,
    ) {
        this.linkingPackage = linkingBlob;
        this.usesOnlineServices = usesOnlineServices;
        this.onStatusChange = onStatusChange;

        const { signalingServer, signalingServerChannel } =
            this.setupSignalingConnection();
        this.signalingServer = signalingServer;
        this.signalingServerChannel = signalingServerChannel;

        this.webRTCConnection = this.setupWebRTC();
    }

    private setupSignalingConnection() {
        // Init the signaling server connection object
        const signalingServer = initPusherInstance(
            this.linkingPackage.SignalingServer ?? null,
            this.linkingPackage.ID,
        );

        type PusherInternalConnectionState =
            | "initialized"
            | "connecting"
            | "connected"
            | "unavailable"
            | "disconnected"
            | "failed";
        signalingServer.connection.bind(
            "state_change",
            (state: {
                previous: PusherInternalConnectionState;
                current: PusherInternalConnectionState;
            }) => {
                switch (state.current) {
                    case "connecting":
                        this.onStatusChange({
                            Step: LinkingProcessStep.Signaling,
                            State: LinkingProcessState.Active,
                            LogMessage: {
                                message: this.usesOnlineServices
                                    ? "Connecting to Cryptex Vault Online Services..."
                                    : "Connecting to the Signaling Server...",
                                timestamp: Date.now(),
                                type: "info",
                            },
                        });
                        break;
                    case "connected":
                        this.onStatusChange({
                            Step: LinkingProcessStep.Signaling,
                            State: LinkingProcessState.Completed,
                            LogMessage: {
                                message: this.usesOnlineServices
                                    ? "Connected to Cryptex Vault Online Services."
                                    : "Connected to the Signaling Server.",
                                timestamp: Date.now(),
                                type: "info",
                            },
                        });
                        break;
                    case "unavailable":
                    case "failed":
                        this.onStatusChange({
                            Step: LinkingProcessStep.Signaling,
                            State: LinkingProcessState.Error,
                            LogMessage: {
                                message:
                                    "An error occurred while setting up a private connection.",
                                timestamp: Date.now(),
                                type: "error",
                                details: {
                                    type: "connection_state",
                                    state: state.current,
                                },
                            },
                        });
                        break;
                    case "disconnected":
                        this.onStatusChange({
                            Step: LinkingProcessStep.SignalingCleanup,
                            State: LinkingProcessState.Completed,
                            LogMessage: {
                                message: "Dropped Signaling Server connection.",
                                timestamp: Date.now(),
                                type: "info",
                            },
                        });
                        break;
                }
            },
        );

        const channelName = constructLinkPresenceChannelName(
            this.usesOnlineServices && this.linkingPackage.APIKey
                ? this.linkingPackage.APIKey
                : this.linkingPackage.ID,
        );
        const signalingServerChannel = signalingServer.subscribe(channelName);
        signalingServerChannel.bind("pusher:subscription_succeeded", () => {
            this.onStatusChange({
                Step: LinkingProcessStep.SignalingWaitingOtherDevice,
                State: LinkingProcessState.Active,
                LogMessage: {
                    message: "Waiting for other device to notice us...",
                    timestamp: Date.now(),
                    type: "info",
                },
            });
        });

        signalingServerChannel.bind(
            "client-link",
            async (data: {
                type: "offer" | "ice-candidate";
                data: RTCIceCandidateInit | RTCSessionDescriptionInit;
            }) => {
                if (data.type === "offer") {
                    this.onStatusChange({
                        Step: LinkingProcessStep.SignalingWaitingOtherDevice,
                        State: LinkingProcessState.Completed,
                        LogMessage: {
                            message: "Received WebRTC offer from other device",
                            timestamp: Date.now(),
                            type: "debug",
                        },
                    });

                    this.onStatusChange({
                        Step: LinkingProcessStep.DirectConnection,
                        State: LinkingProcessState.Active,
                        LogMessage: {
                            message:
                                "Finishing establishing private connection...",
                            timestamp: Date.now(),
                            type: "info",
                        },
                    });

                    await this.webRTCConnection.setRemoteDescription(
                        data.data as RTCSessionDescriptionInit,
                    );

                    const answer = await this.webRTCConnection.createAnswer();
                    await this.webRTCConnection.setLocalDescription(answer);
                    signalingServerChannel.trigger("client-link", {
                        type: "answer",
                        data: answer,
                    });
                } else if (data.type === "ice-candidate") {
                    await this.webRTCConnection.addIceCandidate(
                        data.data as RTCIceCandidateInit,
                    );
                }
            },
        );

        return { signalingServer, signalingServerChannel };
    }

    private setupWebRTC() {
        const webRTConnection = initWebRTC(
            this.linkingPackage.STUNServers,
            this.linkingPackage.TURNServers,
        );

        const cleanup = () => {
            webRTConnection.close();
            this.signalingServer.disconnect();
            this.signalingServer.unbind();

            this.onStatusChange({
                Step: LinkingProcessStep.DirectConnectionCleanup,
                State: LinkingProcessState.Completed,
                LogMessage: {
                    message: "Cleanup completed",
                    timestamp: Date.now(),
                    type: "info",
                },
            });
        };

        webRTConnection.onconnectionstatechange = () => {
            this.onStatusChange({
                Step: LinkingProcessStep.DirectConnection,
                State: LinkingProcessState.Active,
                LogMessage: {
                    message: `WebRTC connection state changed: ${webRTConnection.connectionState}`,
                    timestamp: Date.now(),
                    type: "debug",
                },
            });

            if (webRTConnection.connectionState === "connected") {
                this.onStatusChange({
                    Step: LinkingProcessStep.DirectConnection,
                    State: LinkingProcessState.Completed,
                    LogMessage: {
                        message:
                            "Private connection established, dropping Signaling server connection...",
                        timestamp: Date.now(),
                        type: "info",
                    },
                });

                this.onStatusChange({
                    Step: LinkingProcessStep.VaultTransfer,
                    State: LinkingProcessState.Active,
                    LogMessage: {
                        message: "Starting vault data transfer...",
                        timestamp: Date.now(),
                        type: "info",
                    },
                });

                this.signalingServer.disconnect();
                this.signalingServer.unbind();
            } else if (webRTConnection.connectionState === "failed") {
                this.onStatusChange({
                    Step: LinkingProcessStep.DirectConnection,
                    State: LinkingProcessState.Error,
                    LogMessage: {
                        message: "Failed to establish private connection",
                        timestamp: Date.now(),
                        type: "error",
                        details: {
                            type: "connection_state",
                            state: webRTConnection.connectionState,
                        },
                    },
                });
            } else if (webRTConnection.connectionState === "disconnected") {
                this.onStatusChange({
                    Step: LinkingProcessStep.DirectConnectionCleanup,
                    State: LinkingProcessState.Completed,
                    LogMessage: {
                        message: "Private connection has been terminated.",
                        timestamp: Date.now(),
                        type: "info",
                    },
                });
            }
        };

        webRTConnection.ondatachannel = (event) => {
            this.onStatusChange({
                Step: LinkingProcessStep.VaultTransfer,
                State: LinkingProcessState.Active,
                LogMessage: {
                    message: "Received WebRTC data channel",
                    timestamp: Date.now(),
                    type: "debug",
                },
            });

            const receiveChannel = event.channel;
            receiveChannel.onmessage = async (event) => {
                this.onStatusChange({
                    Step: LinkingProcessStep.VaultTransfer,
                    State: LinkingProcessState.Active,
                    LogMessage: {
                        message: "Receiving Vault data...",
                        timestamp: Date.now(),
                        type: "info",
                    },
                });

                const rawVaultMetadata: Uint8Array = new Uint8Array(event.data);

                try {
                    await this.onStatusChange({
                        Step: LinkingProcessStep.VaultTransfer,
                        State: LinkingProcessState.Completed,
                        VaultBinaryData: rawVaultMetadata,
                        LogMessage: {
                            message: "Vault data received successfully",
                            timestamp: Date.now(),
                            type: "info",
                        },
                    });

                    this.onStatusChange({
                        Step: LinkingProcessStep.VaultSave,
                        State: LinkingProcessState.Completed,
                        LogMessage: {
                            message: "Vault saved successfully",
                            timestamp: Date.now(),
                            type: "info",
                        },
                    });
                } catch (e) {
                    this.onStatusChange({
                        Step: LinkingProcessStep.VaultSave,
                        State: LinkingProcessState.Error,
                        LogMessage: {
                            message: "Failed to save vault data",
                            timestamp: Date.now(),
                            type: "error",
                            details: {
                                type: "vault",
                                error:
                                    e instanceof Error
                                        ? e
                                        : new Error(String(e)),
                            },
                        },
                    });
                }

                this.onStatusChange({
                    Step: LinkingProcessStep.DirectConnectionCleanup,
                    State: LinkingProcessState.Active,
                    LogMessage: {
                        message: "Starting cleanup of private connection...",
                        timestamp: Date.now(),
                        type: "info",
                    },
                });

                cleanup();
            };

            receiveChannel.onerror = (err) => {
                this.onStatusChange({
                    Step: LinkingProcessStep.DirectConnection,
                    State: LinkingProcessState.Error,
                    LogMessage: {
                        message: "Secure channel error",
                        timestamp: Date.now(),
                        type: "error",
                        details: {
                            type: "webrtc",
                            error: new Error(err.toString()),
                        },
                    },
                });
            };

            receiveChannel.onclose = () => {
                cleanup();
            };
        };

        let iceCandidatesGenerated = 0;
        webRTConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.onStatusChange({
                    Step: LinkingProcessStep.DirectConnection,
                    State: LinkingProcessState.Active,
                    LogMessage: {
                        message: "Sending WebRTC ice candidate",
                        timestamp: Date.now(),
                        type: "debug",
                    },
                });

                this.signalingServerChannel.trigger("client-link", {
                    type: "ice-candidate",
                    data: event.candidate,
                });

                iceCandidatesGenerated++;
            }

            if (iceCandidatesGenerated === 0 && !event.candidate) {
                this.onStatusChange({
                    Step: LinkingProcessStep.DirectConnection,
                    State: LinkingProcessState.Error,
                    LogMessage: {
                        message:
                            "Failed to generate ICE candidates. WebRTC failure.",
                        timestamp: Date.now(),
                        type: "error",
                    },
                });

                cleanup();
            }
        };

        return webRTConnection;
    }
}
