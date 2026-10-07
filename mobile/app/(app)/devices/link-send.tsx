import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Pressable, View } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { UnlockedDialogTitle } from "@/components/unlocked/unlocked-ui";
import { router } from "expo-router";
import { useAtomValue } from "jotai";
import * as FileSystem from "expo-file-system/legacy";
import { deleteAppOwnedTempFile, writeSecretTempFile } from "@/utils/secret-temp-files";
import * as Sharing from "expo-sharing";
import QRCode from "react-native-qrcode-svg";
import { ulid } from "ulidx";
import { Settings2 } from "lucide-react-native";

import {
    createChunkedQRCodeFrames,
    DEFAULT_CHUNKED_QR_CYCLE_MS,
} from "@ui/lib/chunked-qr";

import { createIceCandidateDiscovery } from "@cryptex-industries/vault-core/vault-utils/ice-candidate-discovery";
import { LinkingPackage } from "@cryptex-industries/vault-core/vault-utils/linking";
import {
    buildSyncKeyBundle,
    createLinkMac,
    createNonce,
    deriveAeadKey,
    linkReceiverBundleMacBytes,
    linkSenderHelloMacBytes,
    linkVaultTransferContext,
    sealAead,
    verifyLinkMac,
} from "@cryptex-industries/vault-core/vault-utils/sync-crypto";
import {
    encapsulateSyncKem,
    ensureSyncKemKeypair,
} from "@cryptex-industries/vault-core/vault-utils/post-quantum-kem";
import {
    ensureSyncSigningKeypair,
    signSyncBytes,
} from "@cryptex-industries/vault-core/vault-utils/sync-signing";
import {
    generateKeyPair,
    privateKeyJwkToString,
    publicKeyJwkToString,
} from "@cryptex-industries/vault-core/vault-utils/device-signing-key";
import {
    LinkedDevices,
    OnlineServices,
    Vault,
    packageForLinking,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    ensureFreshOnlineServicesSession,
    hasOnlineServicesSession,
} from "@/app_lib/auth-session";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import * as Synchronization from "@cryptex-industries/vault-core/synchronization";
import { constructLinkPresenceChannelName } from "@cryptex-industries/vault-core/presence";
import {
    LINK_FILE_EXTENSION,
    ONLINE_SERVICES_SELECTION_ID,
} from "@cryptex-industries/vault-core/consts";
import {
    onlineServicesDataAtom,
    onlineServicesStore,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
} from "@/utils/atoms";
import { persistVaultMutation } from "@/utils/vault-mutations";
import {
    getVaultDEKFromSession,
    getVaultSessionGeneration,
    isSameActiveVaultSession,
    MISSING_VAULT_SECRET_ERROR,
} from "@/utils/vault-session";
import { onlineServicesLog, signalingLog } from "@/utils/logging";
import { trpcReact } from "@/utils/trpc";
import { uint8ToBase64 } from "@cryptex-industries/vault-core/encoding";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { hasValidServerSelections } from "@/utils/send-link-server-validation";
import { copyTextToClipboard } from "@/utils/clipboard";
import { normalizeEcJwk } from "@/utils/device-jwk";
import {
    invitationAccessError,
    removePendingInvitationDevice,
} from "@/utils/invitation-access";
import { Screen } from "@/components/screen";
import {
    UnlockedButton,
    UnlockedCheckbox,
    UnlockedInput,
    UnlockedLabel,
    UnlockedMenuRow,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { InlineNotice } from "@/components/inline-notice";
import { InvitationHeader } from "@/components/invitation-header";

const MISSING_SYNC_SIGNING_KEY_ERROR =
    "Vault sync keys are missing. Lock and unlock the vault, then try linking again.";

type LinkInvitation = {
    syncId: string;
    mnemonic: string;
    packageB64: string;
    stunServers: VaultUtilTypes.STUNServerConfiguration[];
    turnServers: VaultUtilTypes.TURNServerConfiguration[];
    signalingServer: VaultUtilTypes.SignalingServerConfiguration | null;
    peerOnlineServicesDeviceId: string | null;
};

type TransferPhase = "idle" | "active" | "success" | "error";
type LinkFlow = "prepare" | "connection" | "share" | "confirm";

function LinkSteps({ current }: { current: 0 | 1 | 2 }) {
    const labels = ["Prepare", "Share", "Transfer"];
    return (
        <View className="mb-6">
            <View className="mb-3 flex-row justify-between">
                <UnlockedText className="text-[10px] uppercase tracking-[1.3px] text-muted-foreground">
                    {labels[current]}
                </UnlockedText>
                <UnlockedText className="text-[10px] tracking-[1.3px] text-muted-foreground">
                    {String(current + 1).padStart(2, "0")} / 03
                </UnlockedText>
            </View>
            <View className="flex-row gap-1.5">
                {labels.map((label, index) => (
                    <View
                        key={label}
                        className={`h-0.5 flex-1 ${index <= current ? "bg-primary" : "bg-border"}`}
                    />
                ))}
            </View>
        </View>
    );
}

function requireLocalSyncKeyBundle(
    linkedDevices: VaultUtilTypes.LinkedDevices,
): VaultUtilTypes.SyncKeyBundle {
    if (
        !linkedDevices.SyncSigningPublicKey ||
        !linkedDevices.SyncSigningPrivateKey ||
        !linkedDevices.SyncKemPublicKey ||
        !linkedDevices.SyncKemPrivateKey
    ) {
        throw new Error(MISSING_SYNC_SIGNING_KEY_ERROR);
    }
    return buildSyncKeyBundle(
        linkedDevices.SyncSigningPublicKey,
        linkedDevices.SyncKemPublicKey,
    );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
}

function asUint8Array(data: unknown): Uint8Array {
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
    }
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error("Unsupported data channel payload.");
}

export default function LinkSendScreen() {
    const vault = useAtomValue(unlockedVaultAtom);
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const onlineServicesData = useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    });
    const cloudEnabled = isCloudServicesEnabled();
    const boundOs = Vault.isOnlineServicesBound(vault);
    const hasSession =
        !!onlineServicesData?.sessionToken?.length &&
        onlineServicesData.deviceId === vault.OnlineServices?.DeviceId;
    const hasCustomSignaling = vault.LinkedDevices.SignalingServers.length > 0;
    const hasCustomIce =
        vault.LinkedDevices.STUNServers.length > 0 ||
        vault.LinkedDevices.TURNServers.length > 0;

    const defaultSignalingId =
        cloudEnabled && boundOs
            ? ONLINE_SERVICES_SELECTION_ID
            : (vault.LinkedDevices.SignalingServers[0]?.ID ?? "");
    const defaultStunIds =
        cloudEnabled && boundOs
            ? [ONLINE_SERVICES_SELECTION_ID]
            : vault.LinkedDevices.STUNServers.map((s) => s.ID);
    const defaultTurnIds =
        cloudEnabled && boundOs
            ? [ONLINE_SERVICES_SELECTION_ID]
            : vault.LinkedDevices.TURNServers.map((s) => s.ID);
    const [status, setStatus] = useState("");
    const [qrFrames, setQrFrames] = useState<string[]>([]);
    const [activeFrameIndex, setActiveFrameIndex] = useState(0);
    const [invitation, setInvitation] = useState<LinkInvitation | null>(null);
    const [deviceName, setDeviceName] = useState("");
    const [makeRoot, setMakeRoot] = useState(false);
    const [busy, setBusy] = useState(false);
    const [transferPhase, setTransferPhase] = useState<TransferPhase>("idle");
    const [flow, setFlow] = useState<LinkFlow>("prepare");
    const [showTransferPhrase, setShowTransferPhrase] = useState(false);
    const [error, setError] = useState("");
    const [rollbackWarning, setRollbackWarning] = useState("");
    const [signalingServerID, setSignalingServerID] =
        useState(defaultSignalingId);
    const [stunServerIDs, setStunServerIDs] =
        useState<string[]>(defaultStunIds);
    const [turnServerIDs, setTurnServerIDs] =
        useState<string[]>(defaultTurnIds);

    const linkDeviceMut = trpcReact.v1.device.link.useMutation();
    const removeDeviceMut = trpcReact.v1.device.remove.useMutation();
    const setRootMut = trpcReact.v1.device.setRoot.useMutation();
    const promotedInvitations = useRef(new Set<string>());
    const completedInvitations = useRef(new Set<string>());

    const vaultTransferSentRef = useRef(false);
    const transferActiveRef = useRef(false);
    const teardownRef = useRef<(() => void) | null>(null);

    const selectionsValid = useMemo(
        () =>
            hasValidServerSelections(
                cloudEnabled && boundOs,
                signalingServerID,
                stunServerIDs,
                turnServerIDs,
                vault.LinkedDevices.SignalingServers,
                vault.LinkedDevices.STUNServers,
                vault.LinkedDevices.TURNServers,
            ),
        [
            boundOs,
            cloudEnabled,
            signalingServerID,
            stunServerIDs,
            turnServerIDs,
            vault.LinkedDevices.STUNServers,
            vault.LinkedDevices.SignalingServers,
            vault.LinkedDevices.TURNServers,
        ],
    );

    const usesOnlineServices =
        cloudEnabled &&
        boundOs &&
        (signalingServerID === ONLINE_SERVICES_SELECTION_ID ||
            stunServerIDs.includes(ONLINE_SERVICES_SELECTION_ID) ||
            turnServerIDs.includes(ONLINE_SERVICES_SELECTION_ID));

    const connectionMode =
        signalingServerID === ONLINE_SERVICES_SELECTION_ID &&
        (stunServerIDs.includes(ONLINE_SERVICES_SELECTION_ID) ||
            turnServerIDs.includes(ONLINE_SERVICES_SELECTION_ID))
            ? "online"
            : "custom";

    const selectOnlineServices = () => {
        setSignalingServerID(ONLINE_SERVICES_SELECTION_ID);
        setStunServerIDs([ONLINE_SERVICES_SELECTION_ID]);
        setTurnServerIDs([ONLINE_SERVICES_SELECTION_ID]);
        setError("");
    };

    const selectCustomServers = () => {
        setSignalingServerID(vault.LinkedDevices.SignalingServers[0]?.ID ?? "");
        setStunServerIDs(
            vault.LinkedDevices.STUNServers.map((server) => server.ID),
        );
        setTurnServerIDs(
            vault.LinkedDevices.TURNServers.map((server) => server.ID),
        );
        setError("");
    };

    const rollbackPeerDevice = async (deviceId: string | null | undefined) => {
        if (!deviceId || completedInvitations.current.has(deviceId)) return;
        try {
            await removePendingInvitationDevice(
                deviceId,
                promotedInvitations.current.has(deviceId),
                (input) => setRootMut.mutateAsync(input),
                (input) => removeDeviceMut.mutateAsync(input),
            );
            promotedInvitations.current.delete(deviceId);
        } catch (rollbackError) {
            setRollbackWarning(
                "Invitation cleanup failed. Review the pending device in Devices before linking again.",
            );
            onlineServicesLog.error(
                "Failed to roll back linked device registration",
                { deviceId, error: rollbackError },
            );
        }
    };

    const teardownLiveTransfer = () => {
        teardownRef.current?.();
        teardownRef.current = null;
        transferActiveRef.current = false;
    };

    useEffect(() => {
        return () => {
            teardownLiveTransfer();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only teardown
    }, []);

    useEffect(() => {
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active" || !transferActiveRef.current) return;
            teardownLiveTransfer();
            void rollbackPeerDevice(invitation?.peerOnlineServicesDeviceId);
            if (invitation?.peerOnlineServicesDeviceId) {
                setInvitation(null);
                setFlow("prepare");
            }
            setTransferPhase("error");
            setError("Linking stopped while the app was in the background. Start again.");
            setBusy(false);
        });
        return () => subscription.remove();
        // The current invitation identifies the only peer to roll back.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invitation?.peerOnlineServicesDeviceId]);

    useEffect(() => {
        if (!invitation) {
            setQrFrames([]);
            setActiveFrameIndex(0);
            return;
        }
        let cancelled = false;
        void createChunkedQRCodeFrames(invitation.packageB64).then((frames) => {
            if (cancelled) return;
            setQrFrames(frames);
            setActiveFrameIndex(0);
        });
        return () => {
            cancelled = true;
        };
    }, [invitation]);

    useEffect(() => {
        if (qrFrames.length <= 1) return;
        const interval = setInterval(
            () => setActiveFrameIndex((index) => (index + 1) % qrFrames.length),
            DEFAULT_CHUNKED_QR_CYCLE_MS,
        );
        return () => clearInterval(interval);
    }, [qrFrames.length]);

    const createInvitation = async () => {
        const sessionGeneration = getVaultSessionGeneration();
        setError("");
        setBusy(true);
        setTransferPhase("idle");
        setStatus("Preparing sync keys…");
        let registeredPeerDeviceId: string | null = null;
        try {
            if (!deviceName.trim() || deviceName.trim().length > 150) {
                throw new Error(
                    "Enter a device name between 1 and 150 characters.",
                );
            }
            if (!selectionsValid) {
                throw new Error(
                    "Select a valid signaling server and ICE (STUN and/or TURN) configuration.",
                );
            }

            const wantsOs =
                cloudEnabled &&
                boundOs &&
                (signalingServerID === ONLINE_SERVICES_SELECTION_ID ||
                    stunServerIDs.includes(ONLINE_SERVICES_SELECTION_ID) ||
                    turnServerIDs.includes(ONLINE_SERVICES_SELECTION_ID));

            if (wantsOs) {
                await ensureFreshOnlineServicesSession();
                if (!hasOnlineServicesSession()) {
                    throw new Error(
                        "Sign in to Online Services on Account before creating an Online Services invitation.",
                    );
                }
                const entitlement = onlineServicesStore.get(
                    onlineServicesDataAtom,
                )?.remoteData;
                const accessError = invitationAccessError({
                    usesOnlineServices: true,
                    hasSession: hasOnlineServicesSession(),
                    makeRoot,
                    permissions: entitlement,
                });
                if (accessError) throw new Error(accessError);
            } else if (
                signalingServerID === ONLINE_SERVICES_SELECTION_ID ||
                !hasCustomSignaling
            ) {
                if (!hasCustomSignaling || !hasCustomIce) {
                    throw new Error(
                        "Configure custom connectivity on Devices, or bind Online Services on Account.",
                    );
                }
            }

            const syncKeyResult = await persistVaultMutation(
                "vault.configuration",
                async (current) => {
                    const updated = Object.assign(new Vault(), current);
                    updated.LinkedDevices = LinkedDevices.fromGeneric(
                        current.LinkedDevices,
                    );
                    await ensureSyncSigningKeypair(updated.LinkedDevices);
                    await ensureSyncKemKeypair(updated.LinkedDevices);
                    return {
                        vault: updated,
                        result: updated.LinkedDevices,
                    };
                },
            );
            if (syncKeyResult.isErr()) {
                throw new Error("Failed to prepare sync keys.");
            }
            const linked = syncKeyResult.value;
            if (!linked.SyncSigningPublicKey || !linked.SyncKemPublicKey) {
                throw new Error("Sync public keys missing after generation.");
            }

            let syncId = ulid();
            let linkedPeerOnlineServices: OnlineServices | undefined;

            if (wantsOs && vault.OnlineServices) {
                setStatus("Registering peer device with Online Services…");
                const { publicKey, privateKey } = await generateKeyPair();
                // Some native WebCrypto implementations export padded base64
                // coordinates. Normalize them to the JWK-required base64url
                // form before the key is registered or put in the package.
                const publicKeyJWK = publicKeyJwkToString(
                    normalizeEcJwk(publicKey),
                );
                const privateKeyJWK = privateKeyJwkToString(
                    normalizeEcJwk(privateKey),
                );
                const ret = await linkDeviceMut.mutateAsync({ publicKeyJWK });
                syncId = ret.syncId;
                registeredPeerDeviceId = ret.deviceId;
                if (makeRoot) {
                    setStatus("Granting root access to the linked device…");
                    await setRootMut.mutateAsync({
                        id: ret.deviceId,
                        root: true,
                    });
                    promotedInvitations.current.add(ret.deviceId);
                }
                linkedPeerOnlineServices = new OnlineServices(
                    ret.deviceId,
                    vault.OnlineServices.UserID,
                    publicKeyJWK,
                    privateKeyJWK,
                    makeRoot,
                );
            }

            // Package only selected referenced configs (empty list → Online Services).
            const stunServers = linked.STUNServers.filter((server) =>
                stunServerIDs.includes(server.ID),
            );
            const turnServers = linked.TURNServers.filter((server) =>
                turnServerIDs.includes(server.ID),
            );
            const signalingServer =
                signalingServerID === ONLINE_SERVICES_SELECTION_ID
                    ? null
                    : (linked.SignalingServers.find(
                          (server) => server.ID === signalingServerID,
                      ) ?? null);

            setStatus("Encrypting link package…");
            const { linkingPackage, mnemonic: words } =
                await LinkingPackage.createNewPackage({
                    SyncID: syncId,
                    OnlineServices: linkedPeerOnlineServices,
                    STUNServers: stunServers,
                    TURNServers: turnServers,
                    SignalingServer: signalingServer ?? undefined,
                    SenderKeyBundle: buildSyncKeyBundle(
                        linked.SyncSigningPublicKey,
                        linked.SyncKemPublicKey,
                    ),
                });

            if (!isSameActiveVaultSession(sessionGeneration) || AppState.currentState !== "active") {
                throw new Error("Vault session expired. Unlock and try again.");
            }

            setInvitation({
                syncId,
                mnemonic: words,
                packageB64: linkingPackage.toBase64(),
                stunServers,
                turnServers,
                signalingServer,
                peerOnlineServicesDeviceId: registeredPeerDeviceId,
            });
            setShowTransferPhrase(false);
            setFlow("share");
            setStatus(
                "Invitation ready. Share QR or file with the other device, then start live transfer on this device.",
            );
        } catch (e) {
            await rollbackPeerDevice(registeredPeerDeviceId);
            setError(
                e instanceof Error
                    ? e.message
                    : "Failed to create link package.",
            );
            setInvitation(null);
        } finally {
            setBusy(false);
        }
    };

    const startLiveTransfer = async () => {
        const sessionGeneration = getVaultSessionGeneration();
        if (!isSameActiveVaultSession(sessionGeneration) || AppState.currentState !== "active") {
            setError("Vault session expired. Unlock and try again.");
            return;
        }
        if (!invitation) return;
        const cleanDeviceName = deviceName.trim();
        if (!cleanDeviceName) {
            setError("Device name cannot be empty.");
            return;
        }
        if (cleanDeviceName.length > 150) {
            setError("Device name cannot be longer than 150 characters.");
            return;
        }
        if (!vaultMetadata) {
            setError("Vault metadata is unavailable.");
            return;
        }
        if (transferActiveRef.current) return;

        setError("");
        setBusy(true);
        setTransferPhase("active");
        vaultTransferSentRef.current = false;
        transferActiveRef.current = true;

        const {
            syncId,
            mnemonic: linkSecret,
            stunServers,
            turnServers,
            signalingServer,
            peerOnlineServicesDeviceId,
        } = invitation;

        let signalingSetupTimeout: ReturnType<typeof setTimeout> | undefined;
        let signalingFailureReported = false;
        const signalingChannelReadyRef = { current: false };
        const remoteKeyBundleRef: {
            current: VaultUtilTypes.SyncKeyBundle | null;
        } = { current: null };

        const setProgress = (message: string) => {
            setStatus(message);
        };

        try {
            if (usesOnlineServices) {
                await ensureFreshOnlineServicesSession();
                if (!transferActiveRef.current || !isSameActiveVaultSession(sessionGeneration) || AppState.currentState !== "active") {
                    throw new Error("Vault session expired. Unlock and try again.");
                }
                if (!hasOnlineServicesSession()) {
                    throw new Error(
                        "Online Services session unavailable. Sign in on Account, then retry live transfer.",
                    );
                }
            }

            setProgress("Opening private connection…");
            const webRTConnection = await Synchronization.initWebRTC(
                stunServers,
                turnServers,
                turnServers.length === 0 ? { syncId } : undefined,
            );
            if (!transferActiveRef.current || !isSameActiveVaultSession(sessionGeneration) || AppState.currentState !== "active") {
                webRTConnection.close();
                throw new Error("Vault session expired. Unlock and try again.");
            }
            const webRTCDataChannel =
                webRTConnection.createDataChannel("linking");
            let iceCandidateDiscovery: ReturnType<typeof createIceCandidateDiscovery> | undefined;

            const signalingServerConnection =
                Synchronization.initPusherInstance(signalingServer, syncId);
            const channelName = constructLinkPresenceChannelName(syncId);
            const wsChannel = signalingServerConnection.subscribe(channelName);

            const clearSignalingSetupTimeout = () => {
                if (signalingSetupTimeout !== undefined) {
                    clearTimeout(signalingSetupTimeout);
                    signalingSetupTimeout = undefined;
                }
            };

            const teardownLinkingConnections = () => {
                clearSignalingSetupTimeout();
                iceCandidateDiscovery?.cancel();
                try {
                    webRTCDataChannel.close();
                } catch {
                    // ignore
                }
                try {
                    webRTConnection.close();
                } catch {
                    // ignore
                }
                try {
                    signalingServerConnection.disconnect();
                } catch {
                    // ignore
                }
            };

            teardownRef.current = teardownLinkingConnections;

            const failActiveLinking = async (message: string) => {
                if (!transferActiveRef.current) return;
                transferActiveRef.current = false;
                teardownLinkingConnections();
                teardownRef.current = null;
                await rollbackPeerDevice(peerOnlineServicesDeviceId);
                if (peerOnlineServicesDeviceId) {
                    setInvitation(null);
                    setFlow("prepare");
                }
                setTransferPhase("error");
                setError(message);
                setProgress(message);
                setBusy(false);
            };

            iceCandidateDiscovery = createIceCandidateDiscovery(() => {
                if (
                    teardownRef.current !== teardownLinkingConnections ||
                    !isSameActiveVaultSession(sessionGeneration) ||
                    AppState.currentState !== "active" ||
                    webRTConnection.connectionState === "closed" ||
                    webRTConnection.connectionState === "connected"
                ) return;
                void failActiveLinking("Failed to generate ICE candidates.");
            });

            const reportSignalingFailure = (message: string) => {
                if (
                    signalingFailureReported ||
                    vaultTransferSentRef.current ||
                    webRTConnection.connectionState === "connected"
                ) {
                    return;
                }
                signalingFailureReported = true;
                clearSignalingSetupTimeout();
                void failActiveLinking(message);
            };

            signalingSetupTimeout = setTimeout(() => {
                if (
                    !signalingFailureReported &&
                    !signalingChannelReadyRef.current
                ) {
                    reportSignalingFailure(
                        "Timed out connecting to the signaling server.",
                    );
                }
            }, 30_000);

            webRTConnection.onconnectionstatechange = () => {
                if (webRTConnection.connectionState === "closed") {
                    iceCandidateDiscovery?.cancel();
                    return;
                }
                if (webRTConnection.connectionState === "connected") {
                    iceCandidateDiscovery?.cancel();
                    setProgress(
                        "Private connection established. Closing signaling…",
                    );
                    signalingServerConnection.disconnect();
                    signalingServerConnection.unbind();
                } else if (
                    webRTConnection.connectionState === "disconnected" ||
                    webRTConnection.connectionState === "failed"
                ) {
                    if (!vaultTransferSentRef.current) {
                        void failActiveLinking(
                            "Private connection lost before vault transfer completed.",
                        );
                    }
                }
            };

            webRTCDataChannel.onmessage = async (event) => {
                try {
                    const message = VaultUtilTypes.LinkReceiverKeyBundle.decode(
                        asUint8Array(event.data),
                    );
                    if (!message.ReceiverKeyBundle) return;
                    const senderBundle = requireLocalSyncKeyBundle(
                        vault.LinkedDevices,
                    );
                    const macValid = await verifyLinkMac(
                        linkSecret,
                        linkReceiverBundleMacBytes(
                            syncId,
                            senderBundle,
                            message.ReceiverKeyBundle,
                            message.Nonce,
                        ),
                        message.Mac,
                    );
                    if (macValid) {
                        remoteKeyBundleRef.current = message.ReceiverKeyBundle;
                        setProgress(
                            "Receiver authenticated. Post-quantum sync key received.",
                        );
                    }
                } catch {
                    setProgress("Ignored malformed link key message.");
                }
            };

            webRTCDataChannel.onopen = async () => {
                if (!transferActiveRef.current || !isSameActiveVaultSession(sessionGeneration) || AppState.currentState !== "active") return;
                iceCandidateDiscovery?.cancel();
                setProgress(
                    "Private channel open. Authenticating the receiving device…",
                );

                const vaultSecret = getVaultDEKFromSession();
                if (vaultSecret.isErr()) {
                    void failActiveLinking(MISSING_VAULT_SECRET_ERROR);
                    return;
                }

                let senderKeyBundle: VaultUtilTypes.SyncKeyBundle;
                try {
                    senderKeyBundle = requireLocalSyncKeyBundle(
                        vault.LinkedDevices,
                    );
                } catch (e) {
                    void failActiveLinking(
                        e instanceof Error
                            ? e.message
                            : MISSING_SYNC_SIGNING_KEY_ERROR,
                    );
                    return;
                }

                try {
                    setProgress(
                        "Exchanging authenticated post-quantum sync keys…",
                    );
                    const senderNonce = createNonce();
                    const senderMac = await createLinkMac(
                        linkSecret,
                        linkSenderHelloMacBytes(
                            syncId,
                            senderKeyBundle,
                            senderNonce,
                        ),
                    );
                    if (!transferActiveRef.current || !isSameActiveVaultSession(sessionGeneration) || AppState.currentState !== "active") return;
                    webRTCDataChannel.send(
                        toArrayBuffer(
                            VaultUtilTypes.LinkSenderHello.encode({
                                Nonce: senderNonce,
                                Mac: senderMac,
                            }).finish(),
                        ),
                    );
                    setProgress(
                        "Waiting for receiver to prove it knows the mnemonic…",
                    );

                    const waitStartedAt = Date.now();
                    while (
                        !remoteKeyBundleRef.current &&
                        Date.now() - waitStartedAt < 15_000
                    ) {
                        await new Promise((resolve) => setTimeout(resolve, 50));
                    }

                    const remoteKeyBundle = remoteKeyBundleRef.current;
                    if (!remoteKeyBundle) {
                        void failActiveLinking(
                            "Timed out waiting for authenticated remote sync keys.",
                        );
                        return;
                    }
                    setProgress("Quantum-safe sync keys exchanged.");

                    setProgress("Preparing vault package…");
                    const exportedVault = packageForLinking(
                        vault,
                        syncId,
                        stunServers.map((server) => server.ID),
                        turnServers.map((server) => server.ID),
                        signalingServer?.ID ?? ONLINE_SERVICES_SELECTION_ID,
                        senderKeyBundle.SyncSigningPublicKey,
                        senderKeyBundle.SyncKemPublicKey,
                    );
                    const serializedVault =
                        vaultMetadata.exportForLinking(exportedVault);

                    setProgress(
                        "Encrypting vault for the authenticated receiver…",
                    );
                    const { kemCiphertext, sharedSecret } = encapsulateSyncKem(
                        remoteKeyBundle.SyncKemPublicKey,
                    );
                    const transferContext = linkVaultTransferContext(
                        syncId,
                        senderKeyBundle,
                        remoteKeyBundle,
                        kemCiphertext,
                    );
                    const transferKey = await deriveAeadKey(
                        sharedSecret,
                        transferContext,
                    );
                    const sealedVault = await sealAead(
                        transferKey,
                        new Uint8Array(serializedVault),
                        transferContext,
                    );
                    const handshakeSignature = await signSyncBytes(
                        vault.LinkedDevices.SyncSigningPrivateKey,
                        transferContext,
                    );

                    if (!transferActiveRef.current || !isSameActiveVaultSession(sessionGeneration) || AppState.currentState !== "active") return;

                    setProgress("Sending encrypted vault transfer…");
                    webRTCDataChannel.send(
                        toArrayBuffer(
                            VaultUtilTypes.LinkVaultTransfer.encode({
                                KemCiphertext: kemCiphertext,
                                Nonce: sealedVault.nonce,
                                Ciphertext: sealedVault.ciphertext,
                                HandshakeSignature: handshakeSignature,
                            }).finish(),
                        ),
                    );
                    vaultTransferSentRef.current = true;
                    setProgress("Encrypted vault transfer sent.");

                    const saveLinkedDeviceResult = await persistVaultMutation(
                        "vault.configuration",
                        (currentVault) => {
                            const updatedVault = Object.assign(
                                new Vault(),
                                currentVault,
                            );
                            updatedVault.LinkedDevices =
                                LinkedDevices.fromGeneric(
                                    currentVault.LinkedDevices,
                                );
                            LinkedDevices.addLinkedDevice(
                                updatedVault.LinkedDevices,
                                cleanDeviceName,
                                syncId,
                                remoteKeyBundle.SyncSigningPublicKey,
                                remoteKeyBundle.SyncKemPublicKey,
                                stunServers.map((server) => server.ID),
                                turnServers.map((server) => server.ID),
                                signalingServer?.ID,
                            );
                            return { vault: updatedVault, result: undefined };
                        },
                    );
                    if (saveLinkedDeviceResult.isErr()) {
                        throw new Error("Failed to persist linked device.");
                    }

                    transferActiveRef.current = false;
                    if (peerOnlineServicesDeviceId) {
                        completedInvitations.current.add(
                            peerOnlineServicesDeviceId,
                        );
                        promotedInvitations.current.delete(
                            peerOnlineServicesDeviceId,
                        );
                    }
                    iceCandidateDiscovery?.cancel();
                    setTransferPhase("success");
                    // Keep the data channel alive after send. The receiver
                    // closes it after processing; navigating away also runs
                    // the normal unmount teardown.
                    setProgress("Transfer sent. Device link saved.");
                    setBusy(false);
                } catch (e) {
                    void failActiveLinking(
                        e instanceof Error
                            ? e.message
                            : "Failed during vault transfer.",
                    );
                }
            };

            webRTCDataChannel.onerror = () => {
                if (vaultTransferSentRef.current) return;
                void failActiveLinking("Failed to send vault data.");
            };
            webRTCDataChannel.onclose = () => {
                iceCandidateDiscovery?.cancel();
                if (vaultTransferSentRef.current) {
                    webRTConnection.close();
                    return;
                }
                webRTConnection.close();
                if (transferActiveRef.current) {
                    void failActiveLinking("Private channel closed early.");
                }
            };

            webRTConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    iceCandidateDiscovery?.candidateReceived();
                    wsChannel.trigger("client-link", {
                        type: "ice-candidate",
                        data: event.candidate,
                    });
                } else {
                    iceCandidateDiscovery?.gatheringCompleted();
                }
            };

            signalingServerConnection.connection.bind(
                "state_change",
                (state: {
                    current:
                        | "initialized"
                        | "connecting"
                        | "connected"
                        | "unavailable"
                        | "disconnected"
                        | "failed";
                }) => {
                    switch (state.current) {
                        case "connecting":
                            setProgress("Connecting to signaling server…");
                            break;
                        case "connected":
                            setProgress("Connected to signaling server.");
                            break;
                        case "failed":
                        case "unavailable":
                            reportSignalingFailure(
                                "Could not connect to the signaling server. Check your connection settings.",
                            );
                            break;
                        case "disconnected":
                            if (
                                webRTConnection.connectionState ===
                                    "connected" ||
                                vaultTransferSentRef.current
                            ) {
                                break;
                            }
                            reportSignalingFailure(
                                "Lost connection to the signaling server before pairing completed.",
                            );
                            break;
                    }
                },
            );

            signalingServerConnection.connection.bind(
                "error",
                (err: unknown) => {
                    signalingLog.error(
                        "Signaling error during device linking",
                        { channelName, syncId, error: err },
                    );
                    reportSignalingFailure(
                        "Error while setting up private connection.",
                    );
                },
            );

            wsChannel.bind(
                "pusher:subscription_error",
                (subStatus: unknown) => {
                    signalingLog.error(
                        "Signaling channel subscription failed",
                        {
                            channelName,
                            syncId,
                            status: subStatus,
                        },
                    );
                    reportSignalingFailure(
                        "Failed to join the signaling channel. Check server credentials and network access.",
                    );
                },
            );

            wsChannel.bind("pusher:subscription_succeeded", () => {
                signalingChannelReadyRef.current = true;
                clearSignalingSetupTimeout();
                setProgress("Waiting for other device…");
                setBusy(false);
            });

            wsChannel.bind("pusher:member_added", async () => {
                setProgress("Other device found. Creating private connection…");
                const offer = await webRTConnection.createOffer();
                await webRTConnection.setLocalDescription(offer);
                wsChannel.trigger("client-link", {
                    type: "offer",
                    data: offer,
                });
            });

            wsChannel.bind(
                "client-link",
                async (data: {
                    type: "ice-candidate" | "answer";
                    data: RTCIceCandidateInit | RTCSessionDescriptionInit;
                }) => {
                    if (data.type === "ice-candidate") {
                        await webRTConnection.addIceCandidate(
                            data.data as RTCIceCandidateInit,
                        );
                    } else if (data.type === "answer") {
                        await webRTConnection.setRemoteDescription(
                            data.data as RTCSessionDescriptionInit,
                        );
                    }
                },
            );
        } catch (e) {
            transferActiveRef.current = false;
            teardownLiveTransfer();
            await rollbackPeerDevice(peerOnlineServicesDeviceId);
            if (peerOnlineServicesDeviceId) {
                setInvitation(null);
                setFlow("prepare");
            }
            setTransferPhase("error");
            setError(
                e instanceof Error
                    ? e.message
                    : "Failed to start live transfer.",
            );
            setBusy(false);
        }
    };

    const cancelLiveTransfer = async () => {
        const peerId = invitation?.peerOnlineServicesDeviceId ?? null;
        teardownLiveTransfer();
        await rollbackPeerDevice(peerId);
        if (peerId) {
            setInvitation(null);
            setFlow("prepare");
        }
        setTransferPhase("error");
        setError("Linking cancelled.");
        setStatus("Linking cancelled.");
        setBusy(false);
    };

    const sharePackageFile = async () => {
        const sessionGeneration = getVaultSessionGeneration();
        if (!isSameActiveVaultSession(sessionGeneration) || AppState.currentState !== "active") {
            setError("Vault session expired. Unlock and try again.");
            return;
        }
        if (!invitation?.packageB64) return;
        const parsed = LinkingPackage.fromBase64(invitation.packageB64);
        if (parsed.isErr()) {
            setError("Invalid package data.");
            return;
        }
        let path: string | undefined;
        try {
            path = await writeSecretTempFile(
                LINK_FILE_EXTENSION,
                uint8ToBase64(parsed.value.toBinary()),
                FileSystem.EncodingType.Base64,
            );
            if (!isSameActiveVaultSession(sessionGeneration) || AppState.currentState !== "active") return;
            if (!(await Sharing.isAvailableAsync())) {
                setError("Sharing is not available on this device.");
                return;
            }
            if (!isSameActiveVaultSession(sessionGeneration) || AppState.currentState !== "active") return;
            await Sharing.shareAsync(path, {
                mimeType: "application/octet-stream",
                dialogTitle: "Share Cryptex link package",
            });
        } catch {
            setError("Could not share the link package.");
        } finally {
            if (path) await deleteAppOwnedTempFile(path).catch(() => undefined);
        }
    };

    const transferInProgress = transferPhase === "active";

    const toggleId = (list: string[], id: string): string[] => {
        if (list.includes(id)) {
            return list.filter((entry) => entry !== id);
        }
        return [...list, id];
    };

    const focused = useIsFocused();
    const title =
        flow === "prepare" || flow === "connection"
            ? "Send an invitation"
            : flow === "share"
              ? "Share invitation"
              : "Live vault transfer";
    const invitationError = invitationAccessError({
        usesOnlineServices,
        hasSession,
        makeRoot,
        permissions: onlineServicesData?.remoteData,
    });

    const goBack = async () => {
        if (busy && !transferInProgress) return;
        if (transferPhase === "success") {
            router.dismissTo("/(app)/(tabs)/devices");
        } else if (flow === "prepare") router.back();
        else if (flow === "connection") setFlow("prepare");
        else if (flow === "share") {
            setBusy(true);
            try {
                await rollbackPeerDevice(
                    invitation?.peerOnlineServicesDeviceId,
                );
                setInvitation(null);
                setFlow("prepare");
            } finally {
                setBusy(false);
            }
        } else if (transferInProgress) {
            Alert.alert(
                "Transfer in progress",
                "Cancel the live transfer before returning to the invitation.",
            );
        } else setFlow("share");
    };

    return (
        <Screen
            scroll
            edges={["top", "left", "right", "bottom"]}
            taskTitle={title}
            onTaskBack={goBack}
            contentContainerClassName="px-[20px] pb-[28px] pt-[24px]"
        >
            {rollbackWarning ? (
                <InlineNotice tone="warning" message={rollbackWarning} />
            ) : null}
            {flow === "prepare" || flow === "connection" ? (
                <View>
                    <LinkSteps current={0} />
                    <View className="my-5">
                        <UnlockedLabel>Receiving device name</UnlockedLabel>
                        <UnlockedInput
                            value={deviceName}
                            onChangeText={setDeviceName}
                            autoCapitalize="words"
                            placeholder="e.g. Laptop"
                            accessibilityLabel="Receiving device name"
                            maxLength={150}
                        />
                    </View>
                    <View className="mb-5 border-l-2 border-muted pl-[13px]">
                        <UnlockedText className="text-xs leading-[18px] text-muted-foreground">
                            Keep both devices online. The invitation gives the
                            other device a way to request an encrypted vault
                            transfer.
                        </UnlockedText>
                    </View>
                    <UnlockedMenuRow
                        icon={Settings2}
                        title="Connection options"
                        subtitle="Choose services for this invitation"
                        value={
                            signalingServerID === ONLINE_SERVICES_SELECTION_ID
                                ? "Online Services"
                                : vault.LinkedDevices.SignalingServers.find(
                                      (server) =>
                                          server.ID === signalingServerID,
                                  )?.Name || "Custom"
                        }
                        onPress={() => setFlow("connection")}
                    />
                    <UnlockedButton
                        className="mt-6"
                        loading={busy}
                        disabled={
                            !deviceName.trim() ||
                            !selectionsValid ||
                            !!invitationError
                        }
                        onPress={() => void createInvitation()}
                    >
                        Create invitation
                    </UnlockedButton>
                    {invitationError ? (
                        <InlineNotice
                            tone="info"
                            message={invitationError}
                        />
                    ) : null}
                    {error ? (
                        <InlineNotice tone="error" message={error} />
                    ) : null}
                </View>
            ) : null}

            <Dialog
                open={flow === "connection" && focused}
                onOpenChange={(open) => {
                    if (!open) setFlow("prepare");
                }}
                placement="bottom"
                scroll
            >
                <DialogHeader>
                    <UnlockedDialogTitle>
                        Invitation connection
                    </UnlockedDialogTitle>
                </DialogHeader>
                <View>
                    <InvitationHeader title="Connect the two devices">
                        Only the services selected here are included in the
                        invitation.
                        {hasSession ? " Online Services is ready." : ""}
                    </InvitationHeader>
                    <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{
                            selected: connectionMode === "online",
                            disabled: !cloudEnabled || !boundOs,
                        }}
                        disabled={!cloudEnabled || !boundOs}
                        onPress={selectOnlineServices}
                        className="min-h-[58px] flex-row items-center gap-3 border-b border-border py-3"
                    >
                        <View
                            className={`h-[18px] w-[18px] items-center justify-center rounded-full border ${connectionMode === "online" ? "border-primary" : "border-muted"}`}
                        >
                            {connectionMode === "online" ? (
                                <View className="h-2.5 w-2.5 rounded-full bg-primary" />
                            ) : null}
                        </View>
                        <View className="flex-1">
                            <UnlockedText className="text-sm text-foreground">
                                Online Services
                            </UnlockedText>
                            <UnlockedText className="mt-1 text-xs leading-5 text-muted-foreground">
                                {hasSession
                                    ? "Use your signed-in account connection."
                                    : "Reconnect your account before using this option."}
                            </UnlockedText>
                        </View>
                    </Pressable>
                    <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{
                            selected: connectionMode === "custom",
                        }}
                        onPress={selectCustomServers}
                        className="min-h-[58px] flex-row items-center gap-3 border-b border-border py-3"
                    >
                        <View
                            className={`h-[18px] w-[18px] items-center justify-center rounded-full border ${connectionMode === "custom" ? "border-primary" : "border-muted"}`}
                        >
                            {connectionMode === "custom" ? (
                                <View className="h-2.5 w-2.5 rounded-full bg-primary" />
                            ) : null}
                        </View>
                        <View className="flex-1">
                            <UnlockedText className="text-sm text-foreground">
                                Custom servers
                            </UnlockedText>
                            <UnlockedText className="mt-1 text-xs leading-5 text-muted-foreground">
                                Requires signaling and an ICE path; STUN or TURN
                                can provide the connection.
                            </UnlockedText>
                        </View>
                    </Pressable>
                    <UnlockedText className="mb-[6px] mt-[26px] text-[10px] uppercase tracking-[1.1px] text-muted-foreground">
                        Custom services
                    </UnlockedText>
                    {vault.LinkedDevices.SignalingServers.map((server) => (
                        <UnlockedCheckbox
                            key={server.ID}
                            label={`Signaling: ${server.Name || server.Host}`}
                            checked={signalingServerID === server.ID}
                            onCheckedChange={() =>
                                setSignalingServerID((current) =>
                                    current === server.ID ? "" : server.ID,
                                )
                            }
                        />
                    ))}
                    {vault.LinkedDevices.STUNServers.map((server) => (
                        <UnlockedCheckbox
                            key={server.ID}
                            label={`STUN: ${server.Name || server.Host}`}
                            checked={stunServerIDs.includes(server.ID)}
                            onCheckedChange={() =>
                                setStunServerIDs((list) =>
                                    toggleId(list, server.ID),
                                )
                            }
                        />
                    ))}
                    {vault.LinkedDevices.TURNServers.map((server) => (
                        <UnlockedCheckbox
                            key={server.ID}
                            label={`TURN: ${server.Name || server.Host}`}
                            checked={turnServerIDs.includes(server.ID)}
                            onCheckedChange={() =>
                                setTurnServerIDs((list) =>
                                    toggleId(list, server.ID),
                                )
                            }
                        />
                    ))}
                    {!hasCustomSignaling && !hasCustomIce ? (
                        <View className="my-5 border-l-2 border-muted pl-[13px]">
                            <UnlockedText className="text-xs leading-[18px] text-muted-foreground">
                                No custom servers are configured yet.
                            </UnlockedText>
                        </View>
                    ) : null}
                    <UnlockedMenuRow
                        icon={Settings2}
                        title="Manage custom servers"
                        subtitle="Add STUN, TURN, or signaling services"
                        onPress={() =>
                            router.push("/(app)/devices/connectivity")
                        }
                    />
                    {!selectionsValid ? (
                        <InlineNotice
                            tone="warning"
                            message="Select signaling plus at least one STUN or TURN connection path."
                        />
                    ) : null}
                    <UnlockedCheckbox
                        className="mt-5"
                        label="Make linked device root"
                        checked={usesOnlineServices && makeRoot}
                        onCheckedChange={setMakeRoot}
                        disabled={
                            !usesOnlineServices ||
                            !hasSession ||
                            !onlineServicesData?.remoteData?.root ||
                            !onlineServicesData.remoteData.canPromoteDevices
                        }
                    />
                    <UnlockedText className="mt-2 text-xs leading-5 text-muted-foreground">
                        Root devices can manage account devices, recovery, and
                        account deletion.
                    </UnlockedText>
                    <UnlockedButton
                        className="mt-6"
                        disabled={!selectionsValid}
                        onPress={() => setFlow("prepare")}
                    >
                        Use selected connection
                    </UnlockedButton>
                </View>
            </Dialog>

            {flow === "share" && invitation ? (
                <View className="gap-4">
                    <LinkSteps current={1} />
                    <InvitationHeader title="Open on your other device">
                        Use Receive invitation in Cryptex Vault on the device
                        you want to link.
                    </InvitationHeader>
                    {qrFrames[activeFrameIndex] ? (
                        <View className="items-center py-2">
                            <QRCode
                                value={qrFrames[activeFrameIndex]!}
                                size={200}
                            />
                        </View>
                    ) : (
                        <InlineNotice
                            tone="loading"
                            message="Preparing the scannable invitation…"
                        />
                    )}
                    {qrFrames.length > 1 ? (
                        <UnlockedText className="text-center text-xs text-muted-foreground">
                            Part {activeFrameIndex + 1} of {qrFrames.length}
                        </UnlockedText>
                    ) : null}
                    {showTransferPhrase ? (
                        <View className="rounded-md border border-border bg-secondary/40 p-3">
                            <UnlockedText className="mb-2 text-xs text-muted-foreground">
                                Transfer phrase
                            </UnlockedText>
                            <UnlockedText
                                selectable
                                className="font-mono text-sm leading-6 text-foreground"
                            >
                                {invitation.mnemonic}
                            </UnlockedText>
                        </View>
                    ) : null}
                    <UnlockedButton
                        className="w-full"
                        variant="outline"
                        onPress={() => void sharePackageFile()}
                    >{`Share .${LINK_FILE_EXTENSION} file`}</UnlockedButton>
                    <UnlockedButton
                        className="w-full"
                        variant="outline"
                        onPress={() =>
                            void copyTextToClipboard(invitation.packageB64)
                        }
                    >
                        Copy invitation
                    </UnlockedButton>
                    <UnlockedButton
                        className="w-full"
                        variant="outline"
                        onPress={() => setShowTransferPhrase((shown) => !shown)}
                    >
                        {showTransferPhrase
                            ? "Hide transfer phrase"
                            : "Show transfer phrase"}
                    </UnlockedButton>
                    <UnlockedButton
                        className="w-full"
                        onPress={() => setFlow("confirm")}
                    >
                        Start live transfer
                    </UnlockedButton>
                    <View className="border-l-2 border-muted pl-3">
                        <UnlockedText className="text-xs leading-5 text-muted-foreground">
                            Share the invitation and transfer phrase with your
                            receiving device, then start the live transfer here.
                        </UnlockedText>
                    </View>
                    {error ? (
                        <InlineNotice tone="error" message={error} />
                    ) : null}
                </View>
            ) : null}

            {flow === "confirm" && invitation ? (
                <View className="gap-4">
                    <LinkSteps current={2} />
                    <InvitationHeader title="Ready for your other device">
                        Open the invitation and enter the transfer phrase on
                        the receiving device. Keep this screen open during
                        transfer.
                    </InvitationHeader>
                    <View className="min-h-[54px] flex-row items-center justify-between gap-5 border-b border-border py-4">
                        <UnlockedText className="text-[13px] text-muted-foreground">
                            Receiving device
                        </UnlockedText>
                        <UnlockedText className="max-w-[65%] text-right text-[13px] text-foreground">
                            {deviceName}
                        </UnlockedText>
                    </View>
                    <View className="min-h-[54px] flex-row items-center justify-between gap-5 border-b border-border py-4">
                        <UnlockedText className="text-[13px] text-muted-foreground">
                            Status
                        </UnlockedText>
                        <UnlockedText className="max-w-[65%] text-right text-[13px] text-foreground">
                            {transferPhase === "active"
                                ? "Transferring"
                                : transferPhase === "success"
                                  ? "Transfer complete"
                                  : transferPhase === "error"
                                    ? "Needs attention"
                                    : "Waiting for receiver"}
                        </UnlockedText>
                    </View>
                    <View className="border-l-2 border-muted pl-[13px]">
                        <UnlockedText className="text-xs leading-[18px] text-muted-foreground">
                            Your vault is transferred through an encrypted
                            connection. Both devices need to stay online.
                        </UnlockedText>
                    </View>
                    {status && transferPhase !== "idle" ? (
                        <InlineNotice
                            tone={
                                transferPhase === "success"
                                    ? "success"
                                    : transferPhase === "error"
                                      ? "error"
                                      : "loading"
                            }
                            message={status}
                        />
                    ) : null}
                    {error ? (
                        <InlineNotice tone="error" message={error} />
                    ) : null}
                    {transferPhase !== "success" ? (
                        <UnlockedButton
                            loading={transferInProgress}
                            disabled={transferInProgress}
                            onPress={() => void startLiveTransfer()}
                        >
                            Start live transfer
                        </UnlockedButton>
                    ) : (
                        <UnlockedButton
                            onPress={() =>
                                router.dismissTo("/(app)/(tabs)/devices")
                            }
                        >
                            Back to Devices
                        </UnlockedButton>
                    )}
                    {transferInProgress ? (
                        <UnlockedButton
                            variant="destructive"
                            onPress={() => void cancelLiveTransfer()}
                        >
                            Cancel transfer
                        </UnlockedButton>
                    ) : null}
                </View>
            ) : null}
        </Screen>
    );
}
