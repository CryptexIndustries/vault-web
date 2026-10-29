import {
    createIceCandidateDiscovery,
    type IceCandidateDiscovery,
} from "./ice-candidate-discovery";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { err, ok, ResultAsync } from "neverthrow";
import * as VaultUtilTypes from "../proto/vault";
import * as VaultEncryption from "./encryption";
import { initPusherInstance, initWebRTC } from "../synchronization";
import { constructLinkPresenceChannelName } from "../presence";
import Pusher, { Channel } from "pusher-js";
import { base64ToUint8, uint8ToBase64 } from "../encoding";
import { decapsulateSyncKem } from "./post-quantum-kem";
import { verifySyncBytes } from "./sync-signing";
import {
    buildSyncKeyBundle,
    createLinkMac,
    createNonce,
    deriveAeadKey,
    linkReceiverBundleMacBytes,
    linkSenderHelloMacBytes,
    linkVaultTransferContext,
    openAead,
    type SyncKeyPair,
    verifyLinkMac,
} from "./sync-crypto";

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
        const mnemonic = bip39.generateMnemonic(wordlist, 128);
        const secret = new TextEncoder().encode(mnemonic);

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
            new TextEncoder().encode(secret),
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
    SyncKeyExchange,
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

// How long the receiver waits for the sending device before giving up.
export const LINK_OFFER_TIMEOUT_MS = 60_000;
export const LINK_CONNECT_TIMEOUT_MS = 45_000;
export const LINK_TRANSFER_SILENCE_MS = 60_000;

export type LinkingLogCode =
    | "ONLINE_SERVICES_CONNECTING"
    | "SIGNALING_CONNECTING"
    | "ONLINE_SERVICES_CONNECTED"
    | "SIGNALING_CONNECTED"
    | "PRIVATE_CONNECTION_SETUP_FAILED"
    | "SIGNALING_DROPPED"
    | "SIGNALING_AUTHORIZATION_FAILED"
    | "SENDER_DID_NOT_RESPOND"
    | "WAITING_FOR_SENDER"
    | "OFFER_RECEIVED"
    | "SENDER_CONNECT_FAILED"
    | "FINISHING_PRIVATE_CONNECTION"
    | "SENDER_STOPPED_RESPONDING"
    | "CLEANUP_COMPLETED"
    | "PRIVATE_CONNECTION_ESTABLISHED"
    | "PRIVATE_CONNECTION_FAILED"
    | "PRIVATE_CONNECTION_TERMINATED"
    | "PRIVATE_CHANNEL_OPEN"
    | "SENDER_AUTHENTICATED"
    | "RECEIVER_KEY_ACCEPTED"
    | "KEY_EXCHANGE_FAILED"
    | "RECEIVING_VAULT_TRANSFER"
    | "VAULT_TRANSFER_DECRYPTED"
    | "VAULT_READY"
    | "VAULT_TRANSFER_SIGNATURE_INVALID"
    | "VAULT_TRANSFER_DECRYPT_FAILED"
    | "CLEANUP_STARTED"
    | "SECURE_CHANNEL_ERROR"
    | "ICE_CANDIDATES_FAILED"
    | "ICE_CANDIDATE_SENT"
    | "WAITING_ABORTED";

export interface LinkingProcessStatus {
    Step: LinkingProcessStep;
    State: LinkingProcessState;
    VaultBinaryData?: Uint8Array;
    /** When the current wait gives up (epoch ms), for a countdown. */
    Deadline?: number;
    LogMessage?: {
        code: LinkingLogCode;
        message: string;
        timestamp: number;
        type: "debug" | "info" | "error";
        details?: LogDetails;
    };
}

export class LinkingProcessController {
    readonly linkingPackage: VaultUtilTypes.LinkingPackageBlob;
    readonly usesOnlineServices: boolean;
    readonly localKeyPair: SyncKeyPair;
    readonly linkSecret: string;
    readonly onStatusChange: (state: LinkingProcessStatus) => Promise<void>;

    private readonly signalingServer: Pusher;
    private readonly signalingServerChannel: Channel;
    private readonly webRTCConnection: RTCPeerConnection;
    private iceCandidateDiscovery: IceCandidateDiscovery | undefined;
    private hasDirectConnection = false;
    private hasTerminalError = false;
    private receiverKeyBundleSent = false;
    private senderKeyBundle: VaultUtilTypes.SyncKeyBundle | null = null;
    private waitTimer: ReturnType<typeof setTimeout> | undefined;

    private constructor(
        linkingBlob: VaultUtilTypes.LinkingPackageBlob,
        usesOnlineServices: boolean,
        localKeyPair: SyncKeyPair,
        linkSecret: string,
        onStatusChange: (state: LinkingProcessStatus) => Promise<void>,
        signalingServer: Pusher,
        signalingServerChannel: Channel,
        webRTCConnection: RTCPeerConnection,
    ) {
        this.linkingPackage = linkingBlob;
        this.usesOnlineServices = usesOnlineServices;
        this.localKeyPair = localKeyPair;
        this.linkSecret = linkSecret;
        this.onStatusChange = onStatusChange;
        this.signalingServer = signalingServer;
        this.signalingServerChannel = signalingServerChannel;
        this.webRTCConnection = webRTCConnection;
    }

    private disconnectSignalingServer(): void {
        this.signalingServer.disconnect();
        this.signalingServer.unbind();
    }

    /**
     * Fails the link unless the sending device moves it on within ms, and
     * returns the deadline for the status that starts the wait.
     */
    private giveUpAfter(
        ms: number,
        step: LinkingProcessStep,
        code: LinkingLogCode,
        message: string,
    ): number {
        this.stopWaiting();
        this.waitTimer = setTimeout(() => {
            this.waitTimer = undefined;
            if (this.hasTerminalError) return;
            this.hasTerminalError = true;
            this.iceCandidateDiscovery?.cancel();
            this.webRTCConnection.close();
            this.disconnectSignalingServer();
            this.onStatusChange({
                Step: step,
                State: LinkingProcessState.Error,
                LogMessage: {
                    code,
                    message,
                    timestamp: Date.now(),
                    type: "error",
                },
            });
        }, ms);
        return Date.now() + ms;
    }

    private stopWaiting(): void {
        clearTimeout(this.waitTimer);
        this.waitTimer = undefined;
    }

    public static create(
        linkingBlob: VaultUtilTypes.LinkingPackageBlob,
        usesOnlineServices: boolean,
        localKeyPair: SyncKeyPair,
        linkSecret: string,
        onStatusChange: (state: LinkingProcessStatus) => Promise<void>,
    ): ResultAsync<LinkingProcessController, Error> {
        return ResultAsync.fromPromise(
            (async () => {
                const webRTCConnection = await initWebRTC(
                    linkingBlob.STUNServers,
                    linkingBlob.TURNServers,
                    linkingBlob.TURNServers.length === 0
                        ? { syncId: linkingBlob.SyncID }
                        : undefined,
                );
                const signalingServer = initPusherInstance(
                    linkingBlob.SignalingServer ?? null,
                    linkingBlob.SyncID,
                );
                const channelName = constructLinkPresenceChannelName(
                    linkingBlob.SyncID,
                );
                const signalingServerChannel =
                    signalingServer.subscribe(channelName);
                const controller = new LinkingProcessController(
                    linkingBlob,
                    usesOnlineServices,
                    localKeyPair,
                    linkSecret,
                    onStatusChange,
                    signalingServer,
                    signalingServerChannel,
                    webRTCConnection,
                );

                controller.bindSignalingConnection(channelName);
                controller.bindWebRTCConnection();

                return controller;
            })(),
            (error) =>
                error instanceof Error ? error : new Error(String(error)),
        );
    }

    private bindSignalingConnection(channelName: string): void {
        type PusherInternalConnectionState =
            | "initialized"
            | "connecting"
            | "connected"
            | "unavailable"
            | "disconnected"
            | "failed";
        this.signalingServer.connection.bind(
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
                                code: this.usesOnlineServices
                                    ? "ONLINE_SERVICES_CONNECTING"
                                    : "SIGNALING_CONNECTING",
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
                                code: this.usesOnlineServices
                                    ? "ONLINE_SERVICES_CONNECTED"
                                    : "SIGNALING_CONNECTED",
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
                        this.iceCandidateDiscovery?.cancel();
                        this.hasTerminalError = true;
                        this.onStatusChange({
                            Step: LinkingProcessStep.Signaling,
                            State: LinkingProcessState.Error,
                            LogMessage: {
                                code: "PRIVATE_CONNECTION_SETUP_FAILED",
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
                        if (
                            !this.hasDirectConnection ||
                            this.hasTerminalError
                        ) {
                            break;
                        }

                        this.onStatusChange({
                            Step: LinkingProcessStep.SignalingCleanup,
                            State: LinkingProcessState.Completed,
                            LogMessage: {
                                code: "SIGNALING_DROPPED",
                                message: "Dropped Signaling Server connection.",
                                timestamp: Date.now(),
                                type: "info",
                            },
                        });
                        break;
                }
            },
        );

        this.signalingServerChannel.bind("pusher:subscription_error", () => {
            this.iceCandidateDiscovery?.cancel();
            this.hasTerminalError = true;
            this.onStatusChange({
                Step: LinkingProcessStep.Signaling,
                State: LinkingProcessState.Error,
                LogMessage: {
                    code: "SIGNALING_AUTHORIZATION_FAILED",
                    message: "Failed to authorize the signaling channel.",
                    timestamp: Date.now(),
                    type: "error",
                },
            });
            this.signalingServer.unsubscribe(channelName);
            this.signalingServer.disconnect();
        });

        this.signalingServerChannel.bind(
            "pusher:subscription_succeeded",
            () => {
                this.onStatusChange({
                    Step: LinkingProcessStep.SignalingWaitingOtherDevice,
                    State: LinkingProcessState.Active,
                    Deadline: this.giveUpAfter(
                        LINK_OFFER_TIMEOUT_MS,
                        LinkingProcessStep.SignalingWaitingOtherDevice,
                        "SENDER_DID_NOT_RESPOND",
                        "The sending device didn't respond.",
                    ),
                    LogMessage: {
                        code: "WAITING_FOR_SENDER",
                        message: "Waiting for other device to notice us...",
                        timestamp: Date.now(),
                        type: "info",
                    },
                });
            },
        );

        this.signalingServerChannel.bind(
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
                            code: "OFFER_RECEIVED",
                            message: "Received WebRTC offer from other device",
                            timestamp: Date.now(),
                            type: "debug",
                        },
                    });

                    this.onStatusChange({
                        Step: LinkingProcessStep.DirectConnection,
                        State: LinkingProcessState.Active,
                        Deadline: this.giveUpAfter(
                            LINK_CONNECT_TIMEOUT_MS,
                            LinkingProcessStep.DirectConnection,
                            "SENDER_CONNECT_FAILED",
                            "Couldn't connect to the sending device.",
                        ),
                        LogMessage: {
                            code: "FINISHING_PRIVATE_CONNECTION",
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
                    this.signalingServerChannel.trigger("client-link", {
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
    }

    private bindWebRTCConnection(): void {
        const webRTConnection = this.webRTCConnection;
        const transferDeadline = () =>
            this.giveUpAfter(
                LINK_TRANSFER_SILENCE_MS,
                LinkingProcessStep.VaultTransfer,
                "SENDER_STOPPED_RESPONDING",
                "The sending device stopped responding.",
            );
        const cleanup = () => {
            this.stopWaiting();
            this.iceCandidateDiscovery?.cancel();
            webRTConnection.close();
            this.disconnectSignalingServer();

            this.onStatusChange({
                Step: LinkingProcessStep.DirectConnectionCleanup,
                State: LinkingProcessState.Completed,
                LogMessage: {
                    code: "CLEANUP_COMPLETED",
                    message: "Cleanup completed",
                    timestamp: Date.now(),
                    type: "info",
                },
            });
        };

        webRTConnection.onconnectionstatechange = () => {
            if (webRTConnection.connectionState === "closed") {
                this.iceCandidateDiscovery?.cancel();
            }
            this.onStatusChange({
                Step: LinkingProcessStep.DirectConnection,
                State: LinkingProcessState.Active,
                // Internal WebRTC state churn is too noisy for the user-facing log.
                // Protocol milestones below explain what is happening.
                // LogMessage: {
                //     message: `WebRTC connection state changed: ${webRTConnection.connectionState}`,
                //     timestamp: Date.now(),
                //     type: "debug",
                // },
            });

            if (webRTConnection.connectionState === "connected") {
                this.iceCandidateDiscovery?.cancel();
                this.hasDirectConnection = true;
                this.onStatusChange({
                    Step: LinkingProcessStep.DirectConnection,
                    State: LinkingProcessState.Completed,
                    LogMessage: {
                        code: "PRIVATE_CONNECTION_ESTABLISHED",
                        message: "Private connection established.",
                        timestamp: Date.now(),
                        type: "info",
                    },
                });

                this.onStatusChange({
                    Step: LinkingProcessStep.VaultTransfer,
                    State: LinkingProcessState.Active,
                    Deadline: transferDeadline(),
                    // The receiver has not seen the encrypted vault yet; avoid
                    // logging this as transfer progress until bytes arrive.
                    // LogMessage: {
                    //     message: "Starting vault data transfer...",
                    //     timestamp: Date.now(),
                    //     type: "info",
                    // },
                });

                this.disconnectSignalingServer();
            } else if (webRTConnection.connectionState === "failed") {
                this.iceCandidateDiscovery?.cancel();
                this.hasTerminalError = true;
                this.onStatusChange({
                    Step: LinkingProcessStep.DirectConnection,
                    State: LinkingProcessState.Error,
                    LogMessage: {
                        code: "PRIVATE_CONNECTION_FAILED",
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
                this.iceCandidateDiscovery?.cancel();
                this.onStatusChange({
                    Step: LinkingProcessStep.DirectConnectionCleanup,
                    State: LinkingProcessState.Completed,
                    LogMessage: {
                        code: "PRIVATE_CONNECTION_TERMINATED",
                        message: "Private connection has been terminated.",
                        timestamp: Date.now(),
                        type: "info",
                    },
                });
            }
        };

        webRTConnection.ondatachannel = (event) => {
            this.onStatusChange({
                Step: LinkingProcessStep.SyncKeyExchange,
                State: LinkingProcessState.Active,
                Deadline: transferDeadline(),
                LogMessage: {
                    code: "PRIVATE_CHANNEL_OPEN",
                    message:
                        "Private channel open. Waiting for sender authentication...",
                    timestamp: Date.now(),
                    type: "info",
                },
            });

            const receiveChannel = event.channel;
            if (receiveChannel.readyState === "open") {
                this.iceCandidateDiscovery?.cancel();
            }
            receiveChannel.onopen = () => {
                this.iceCandidateDiscovery?.cancel();
            };
            receiveChannel.onmessage = async (event) => {
                if (!this.receiverKeyBundleSent) {
                    try {
                        const senderHello =
                            VaultUtilTypes.LinkSenderHello.decode(
                                new Uint8Array(event.data),
                            );
                        const packageBundle =
                            this.linkingPackage.SenderKeyBundle;
                        if (
                            !packageBundle ||
                            !packageBundle.SyncSigningPublicKey ||
                            !packageBundle.SyncKemPublicKey
                        ) {
                            throw new Error("LINK_SENDER_KEY_BUNDLE_INVALID");
                        }
                        const senderMacValid = await verifyLinkMac(
                            this.linkSecret,
                            linkSenderHelloMacBytes(
                                this.linkingPackage.SyncID,
                                packageBundle,
                                senderHello.Nonce,
                            ),
                            senderHello.Mac,
                        );
                        if (!senderMacValid) {
                            throw new Error("LINK_SENDER_MAC_INVALID");
                        }
                        this.onStatusChange({
                            Step: LinkingProcessStep.SyncKeyExchange,
                            State: LinkingProcessState.Active,
                            LogMessage: {
                                code: "SENDER_AUTHENTICATED",
                                message:
                                    "Sender authenticated. Sharing this device's post-quantum sync key...",
                                timestamp: Date.now(),
                                type: "info",
                            },
                        });

                        const receiverBundle = buildSyncKeyBundle(
                            this.localKeyPair.signingPublicKey,
                            this.localKeyPair.kemPublicKey,
                        );
                        const receiverNonce = createNonce();
                        const receiverMac = await createLinkMac(
                            this.linkSecret,
                            linkReceiverBundleMacBytes(
                                this.linkingPackage.SyncID,
                                packageBundle,
                                receiverBundle,
                                receiverNonce,
                            ),
                        );
                        receiveChannel.send(
                            toArrayBuffer(
                                VaultUtilTypes.LinkReceiverKeyBundle.encode({
                                    ReceiverKeyBundle: receiverBundle,
                                    Nonce: receiverNonce,
                                    Mac: receiverMac,
                                }).finish(),
                            ),
                        );
                        this.senderKeyBundle = packageBundle;
                        this.receiverKeyBundleSent = true;
                        this.onStatusChange({
                            Step: LinkingProcessStep.SyncKeyExchange,
                            State: LinkingProcessState.Completed,
                            Deadline: transferDeadline(),
                            LogMessage: {
                                code: "RECEIVER_KEY_ACCEPTED",
                                message:
                                    "Receiver key accepted. Waiting for encrypted vault transfer...",
                                timestamp: Date.now(),
                                type: "info",
                            },
                        });
                    } catch (e) {
                        this.hasTerminalError = true;
                        this.onStatusChange({
                            Step: LinkingProcessStep.SyncKeyExchange,
                            State: LinkingProcessState.Error,
                            LogMessage: {
                                code: "KEY_EXCHANGE_FAILED",
                                message:
                                    "Failed to authenticate link key exchange.",
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
                    return;
                }

                this.stopWaiting();
                this.onStatusChange({
                    Step: LinkingProcessStep.VaultTransfer,
                    State: LinkingProcessState.Active,
                    LogMessage: {
                        code: "RECEIVING_VAULT_TRANSFER",
                        message:
                            "Receiving encrypted vault transfer and checking authenticity...",
                        timestamp: Date.now(),
                        type: "info",
                    },
                });

                try {
                    if (!this.senderKeyBundle) {
                        throw new Error("LINK_SENDER_KEY_BUNDLE_MISSING");
                    }
                    const transfer = VaultUtilTypes.LinkVaultTransfer.decode(
                        new Uint8Array(event.data),
                    );
                    const receiverBundle = buildSyncKeyBundle(
                        this.localKeyPair.signingPublicKey,
                        this.localKeyPair.kemPublicKey,
                    );
                    const transferContext = linkVaultTransferContext(
                        this.linkingPackage.SyncID,
                        this.senderKeyBundle,
                        receiverBundle,
                        transfer.KemCiphertext,
                    );
                    const senderAuthenticated = await verifySyncBytes(
                        this.senderKeyBundle.SyncSigningPublicKey,
                        transfer.HandshakeSignature,
                        transferContext,
                    );
                    if (!senderAuthenticated) {
                        throw new Error(
                            "LINK_VAULT_TRANSFER_SIGNATURE_INVALID",
                        );
                    }
                    const sharedSecret = decapsulateSyncKem(
                        transfer.KemCiphertext,
                        this.localKeyPair.kemPrivateKey,
                    );
                    const transferKey = await deriveAeadKey(
                        sharedSecret,
                        transferContext,
                    );
                    const rawVaultMetadata = await openAead(
                        transferKey,
                        {
                            nonce: transfer.Nonce,
                            ciphertext: transfer.Ciphertext,
                        },
                        transferContext,
                    );

                    await this.onStatusChange({
                        Step: LinkingProcessStep.VaultTransfer,
                        State: LinkingProcessState.Completed,
                        VaultBinaryData: rawVaultMetadata,
                        LogMessage: {
                            code: "VAULT_TRANSFER_DECRYPTED",
                            message:
                                "Vault authenticity confirmed. Transfer decrypted successfully.",
                            timestamp: Date.now(),
                            type: "info",
                        },
                    });

                    this.onStatusChange({
                        Step: LinkingProcessStep.VaultSave,
                        State: LinkingProcessState.Completed,
                        LogMessage: {
                            code: "VAULT_READY",
                            message:
                                "Vault is ready to merge or save on this device.",
                            timestamp: Date.now(),
                            type: "info",
                        },
                    });
                } catch (e) {
                    const signatureInvalid =
                        e instanceof Error &&
                        e.message === "LINK_VAULT_TRANSFER_SIGNATURE_INVALID";
                    this.onStatusChange({
                        Step: LinkingProcessStep.VaultTransfer,
                        State: LinkingProcessState.Error,
                        LogMessage: {
                            code: signatureInvalid
                                ? "VAULT_TRANSFER_SIGNATURE_INVALID"
                                : "VAULT_TRANSFER_DECRYPT_FAILED",
                            message: signatureInvalid
                                ? "Vault transfer could not be authenticated. Update the sending device and try again."
                                : "Failed to decrypt vault transfer.",
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
                        code: "CLEANUP_STARTED",
                        message: "Starting cleanup of private connection...",
                        timestamp: Date.now(),
                        type: "info",
                    },
                });

                cleanup();
            };

            receiveChannel.onerror = (err) => {
                this.iceCandidateDiscovery?.cancel();
                this.onStatusChange({
                    Step: LinkingProcessStep.DirectConnection,
                    State: LinkingProcessState.Error,
                    LogMessage: {
                        code: "SECURE_CHANNEL_ERROR",
                        message: "Secure channel error",
                        timestamp: Date.now(),
                        type: "error",
                        details: {
                            type: "webrtc",
                            error: new Error(
                                err instanceof ErrorEvent
                                    ? err.message
                                    : "Secure channel error",
                            ),
                        },
                    },
                });
            };

            receiveChannel.onclose = () => {
                cleanup();
            };
        };

        const discovery = createIceCandidateDiscovery(() => {
            if (
                this.iceCandidateDiscovery !== discovery ||
                this.hasTerminalError ||
                webRTConnection.connectionState === "closed" ||
                webRTConnection.connectionState === "connected"
            )
                return;
            this.hasTerminalError = true;
            this.onStatusChange({
                Step: LinkingProcessStep.DirectConnection,
                State: LinkingProcessState.Error,
                LogMessage: {
                    code: "ICE_CANDIDATES_FAILED",
                    message:
                        "Failed to generate ICE candidates. WebRTC failure.",
                    timestamp: Date.now(),
                    type: "error",
                },
            });
            cleanup();
        });
        this.iceCandidateDiscovery = discovery;
        webRTConnection.onicecandidate = (event) => {
            if (event.candidate) {
                discovery.candidateReceived();
                this.onStatusChange({
                    Step: LinkingProcessStep.DirectConnection,
                    State: LinkingProcessState.Active,
                    LogMessage: {
                        code: "ICE_CANDIDATE_SENT",
                        message: "Sending WebRTC ice candidate",
                        timestamp: Date.now(),
                        type: "debug",
                    },
                });

                this.signalingServerChannel.trigger("client-link", {
                    type: "ice-candidate",
                    data: event.candidate,
                });
            } else {
                discovery.gatheringCompleted();
            }
        };
    }

    public abortWaitingForDevice() {
        this.stopWaiting();
        this.iceCandidateDiscovery?.cancel();
        this.signalingServerChannel.unbind();
        this.signalingServer.unsubscribe(
            constructLinkPresenceChannelName(this.linkingPackage.SyncID),
        );
        this.signalingServer.unbind();
        this.signalingServer.disconnect();
        this.webRTCConnection.close();

        this.onStatusChange({
            Step: LinkingProcessStep.SignalingWaitingOtherDevice,
            State: LinkingProcessState.Warning,
            LogMessage: {
                code: "WAITING_ABORTED",
                message: "Linking aborted while waiting for the other device.",
                timestamp: Date.now(),
                type: "info",
            },
        });
    }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
}
