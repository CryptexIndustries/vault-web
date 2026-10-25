import { useEffect, useMemo, useRef, useState } from "react";
import {
    AppState,
    BackHandler,
    Platform,
    Pressable,
    useWindowDimensions,
    View,
} from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { UnlockedDialogTitle } from "@/components/unlocked/unlocked-ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAtomValue } from "jotai";
import * as FileSystem from "expo-file-system/legacy";
import { writeSecretTempFile } from "@/utils/secret-temp-files";
import { useSecretRelease } from "@/utils/secret-release";
import { shareSecretFile } from "@/utils/secret-share";
import QRCode from "react-native-qrcode-svg";
import { ulid } from "ulidx";
import { Maximize2, Settings2, X } from "lucide-react-native";
import * as Brightness from "expo-brightness";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

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
    syncOnlineServicesRemoteConfiguration,
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
    UnlockedInput,
    UnlockedLabel,
    UnlockedMenuRow,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { InlineNotice } from "@/components/inline-notice";
import { InvitationHeader } from "@/components/invitation-header";
import {
    LinkingProgress,
    type LinkActivityEntry,
    type LinkFailure,
    type LinkProgressItem,
} from "@/components/linking-progress";
import { Snackbar, useSnackbar } from "@/components/snackbar";
import { LinkResult } from "@/components/link-result";
import { Switch } from "@/components/ui/switch";
import { DialogDescription } from "@/components/ui/dialog";
import { colors } from "@/theme";

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

const SEND_PROGRESS: Array<{ key: string; title: string; detail: string }> = [
    {
        key: "waiting",
        title: "Wait for the other device",
        detail: "Open the invitation there and enter the verification words.",
    },
    {
        key: "connection",
        title: "Open a private connection",
        detail: "Negotiating the direct WebRTC connection.",
    },
    {
        key: "authentication",
        title: "Authenticate the receiving device",
        detail: "Checking the verification words and exchanging sync keys.",
    },
    {
        key: "transfer",
        title: "Send your vault",
        detail: "Encrypting and sending the vault over the private connection.",
    },
    {
        key: "save",
        title: "Save the device link",
        detail: "Recording the new device in this vault.",
    },
];
const STEP = {
    waiting: 0,
    connection: 1,
    authentication: 2,
    transfer: 3,
    save: 4,
};

const KEEP_AWAKE_TAG = "link-send";
type LinkFlow = "prepare" | "connection" | "transfer";

function LinkSteps({ current }: { current: 0 | 1 }) {
    const labels = ["Prepare", "Transfer"];
    return (
        <View className="mb-6">
            <View className="mb-3 flex-row justify-between">
                <UnlockedText className="text-[10px] uppercase tracking-[1.3px] text-muted-foreground">
                    {labels[current]}
                </UnlockedText>
                <UnlockedText className="text-[10px] tracking-[1.3px] text-muted-foreground">
                    {String(current + 1).padStart(2, "0")} / 02
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

function SectionLabel({ children }: { children: string }) {
    return (
        <UnlockedText className="mb-[2px] mt-[26px] text-[10px] uppercase tracking-[1.1px] text-muted-foreground">
            {children}
        </UnlockedText>
    );
}

function RadioRow({
    title,
    subtitle,
    selected,
    disabled = false,
    onPress,
}: {
    title: string;
    subtitle?: string;
    selected: boolean;
    disabled?: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={title}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={onPress}
            className="min-h-[58px] flex-row items-center gap-3 border-b border-border py-3"
            style={{ opacity: disabled ? 0.5 : 1 }}
        >
            <View
                className={`h-[18px] w-[18px] items-center justify-center rounded-full border ${selected ? "border-primary" : "border-muted"}`}
            >
                {selected ? (
                    <View className="h-2.5 w-2.5 rounded-full bg-primary" />
                ) : null}
            </View>
            <View className="flex-1">
                <UnlockedText className="text-sm text-foreground">
                    {title}
                </UnlockedText>
                {subtitle ? (
                    <UnlockedText className="mt-1 text-xs leading-5 text-muted-foreground">
                        {subtitle}
                    </UnlockedText>
                ) : null}
            </View>
        </Pressable>
    );
}

function SwitchRow({
    title,
    subtitle,
    value,
    disabled = false,
    onValueChange,
}: {
    title: string;
    subtitle?: string;
    value: boolean;
    disabled?: boolean;
    onValueChange: (value: boolean) => void;
}) {
    return (
        <Pressable
            accessibilityRole="switch"
            accessibilityLabel={title}
            accessibilityState={{ checked: value, disabled }}
            disabled={disabled}
            onPress={() => onValueChange(!value)}
            className="min-h-[64px] flex-row items-center justify-between gap-3 border-b border-border py-3"
            style={{ opacity: disabled ? 0.5 : 1 }}
        >
            <View className="flex-1">
                <UnlockedText className="text-sm text-foreground">
                    {title}
                </UnlockedText>
                {subtitle ? (
                    <UnlockedText className="mt-1 text-xs leading-5 text-muted-foreground">
                        {subtitle}
                    </UnlockedText>
                ) : null}
            </View>
            <Switch
                value={value}
                onValueChange={onValueChange}
                disabled={disabled}
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
            />
        </Pressable>
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
    const [deviceName, setDeviceName] = useState("My Device");
    const [makeRoot, setMakeRoot] = useState(false);
    const [busy, setBusy] = useState(false);
    const [transferPhase, setTransferPhase] = useState<TransferPhase>("idle");
    const [flow, setFlow] = useState<LinkFlow>("prepare");
    const [copied, setCopied] = useState(false);
    const [refreshingAccess, setRefreshingAccess] = useState(false);
    const [failure, setFailure] = useState<LinkFailure | null>(null);
    const [sendStep, setSendStep] = useState(0);
    const [activity, setActivity] = useState<LinkActivityEntry[]>([]);
    const activityStartRef = useRef(0);
    const activityIdRef = useRef(0);
    const [stopDialogOpen, setStopDialogOpen] = useState(false);
    const [qrFullscreen, setQrFullscreen] = useState(false);
    const {
        feedback: snackbar,
        show: notify,
        dismiss: dismissSnackbar,
    } = useSnackbar("link-send");
    const insets = useSafeAreaInsets();
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
    // Teardown can report a failure while Stop is already cleaning up; both
    // must share one removal or the second reports a false cleanup failure.
    const pendingRollbacks = useRef(new Map<string, Promise<void>>());

    const vaultTransferSentRef = useRef(false);
    const transferActiveRef = useRef(false);
    const teardownRef = useRef<(() => void) | null>(null);
    // Set when the user shares or copies the invitation, so leaving the app
    // to hand it over does not stop the live transfer. Cleared on return.
    const externalHandoffRef = useRef(false);
    const appActiveForTransfer = () =>
        AppState.currentState === "active" || externalHandoffRef.current;

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
    };

    const selectCustomServers = () => {
        setSignalingServerID(vault.LinkedDevices.SignalingServers[0]?.ID ?? "");
        setStunServerIDs(
            vault.LinkedDevices.STUNServers.map((server) => server.ID),
        );
        setTurnServerIDs(
            vault.LinkedDevices.TURNServers.map((server) => server.ID),
        );
    };

    const rollbackPeerDevice = (deviceId: string | null | undefined) => {
        if (!deviceId || completedInvitations.current.has(deviceId))
            return Promise.resolve();
        const pending = pendingRollbacks.current.get(deviceId);
        if (pending) return pending;
        const rollback = (async () => {
            try {
                await removePendingInvitationDevice(
                    deviceId,
                    promotedInvitations.current.has(deviceId),
                    (input) => setRootMut.mutateAsync(input),
                    (input) => removeDeviceMut.mutateAsync(input),
                );
                promotedInvitations.current.delete(deviceId);
                completedInvitations.current.add(deviceId);
            } catch (rollbackError) {
                notify(
                    "Invitation cleanup failed. Review the pending device in Devices before linking again.",
                );
                onlineServicesLog.error(
                    "Failed to roll back linked device registration",
                    { deviceId, error: rollbackError },
                );
            } finally {
                pendingRollbacks.current.delete(deviceId);
            }
        })();
        pendingRollbacks.current.set(deviceId, rollback);
        return rollback;
    };

    const teardownLiveTransfer = () => {
        // Mark inactive first: closing the channel fires its close handler,
        // which must not treat a deliberate stop as a failure.
        transferActiveRef.current = false;
        teardownRef.current?.();
        teardownRef.current = null;
    };

    const logActivity = (
        message: string,
        type: LinkActivityEntry["type"] = "info",
    ) => {
        const now = Date.now();
        const startedAt = activityStartRef.current || now;
        const id = ++activityIdRef.current;
        setActivity((current) => [
            ...current,
            {
                id,
                elapsedSeconds: Math.max(
                    0,
                    Math.floor((now - startedAt) / 1000),
                ),
                message,
                type,
            },
        ]);
    };

    const resetTransferProgress = () => {
        setFailure(null);
        setSendStep(STEP.waiting);
        setActivity([]);
        activityStartRef.current = Date.now();
    };

    const showTransferFailure = (message: string, technical = message) => {
        setTransferPhase("error");
        setFailure({ message, technical });
        setQrFullscreen(false);
        logActivity(message, "error");
    };

    useEffect(() => {
        return () => {
            teardownLiveTransfer();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only teardown
    }, []);

    useEffect(() => {
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") {
                externalHandoffRef.current = false;
                return;
            }
            if (!transferActiveRef.current || externalHandoffRef.current)
                return;
            teardownLiveTransfer();
            void rollbackPeerDevice(invitation?.peerOnlineServicesDeviceId);
            // An Online Services invitation is revoked by the rollback, so a
            // retry needs a new one.
            if (invitation?.peerOnlineServicesDeviceId) setInvitation(null);
            showTransferFailure(
                "Linking stopped while the app was in the background.",
            );
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
        setBusy(true);
        setTransferPhase("idle");
        resetTransferProgress();
        setStatus("Preparing sync keys…");
        let registeredPeerDeviceId: string | null = null;
        let created: LinkInvitation | null = null;
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

            if (
                !isSameActiveVaultSession(sessionGeneration) ||
                AppState.currentState !== "active"
            ) {
                throw new Error("Vault session expired. Unlock and try again.");
            }

            created = {
                syncId,
                mnemonic: words,
                packageB64: linkingPackage.toBase64(),
                stunServers,
                turnServers,
                signalingServer,
                peerOnlineServicesDeviceId: registeredPeerDeviceId,
            };
            setInvitation(created);
            setFlow("transfer");
        } catch (e) {
            await rollbackPeerDevice(registeredPeerDeviceId);
            const message =
                e instanceof Error
                    ? e.message
                    : "Failed to create link package.";
            // A retry from the transfer screen reports in its step list.
            if (flow === "transfer") showTransferFailure(message);
            else notify(message);
            setInvitation(null);
        } finally {
            setBusy(false);
        }
        // Wait for the receiver right away, so the user only taps once.
        if (created) await startLiveTransfer(created);
    };

    const startLiveTransfer = async (
        current: LinkInvitation | null = invitation,
    ) => {
        const sessionGeneration = getVaultSessionGeneration();
        if (
            !isSameActiveVaultSession(sessionGeneration) ||
            !appActiveForTransfer()
        ) {
            notify("Vault session expired. Unlock and try again.");
            return;
        }
        if (!current) return;
        const cleanDeviceName = deviceName.trim();
        if (!cleanDeviceName) {
            notify("Device name cannot be empty.");
            return;
        }
        if (cleanDeviceName.length > 150) {
            notify("Device name cannot be longer than 150 characters.");
            return;
        }
        if (!vaultMetadata) {
            notify("Vault metadata is unavailable.");
            return;
        }
        if (transferActiveRef.current) return;

        resetTransferProgress();
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
        } = current;

        let signalingSetupTimeout: ReturnType<typeof setTimeout> | undefined;
        let signalingFailureReported = false;
        const signalingChannelReadyRef = { current: false };
        const remoteKeyBundleRef: {
            current: VaultUtilTypes.SyncKeyBundle | null;
        } = { current: null };

        const setProgress = (message: string, step?: number) => {
            setStatus(message);
            logActivity(message);
            if (step !== undefined)
                setSendStep((current) => Math.max(current, step));
        };

        try {
            if (usesOnlineServices) {
                await ensureFreshOnlineServicesSession();
                if (
                    !transferActiveRef.current ||
                    !isSameActiveVaultSession(sessionGeneration) ||
                    !appActiveForTransfer()
                ) {
                    throw new Error(
                        "Vault session expired. Unlock and try again.",
                    );
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
            if (
                !transferActiveRef.current ||
                !isSameActiveVaultSession(sessionGeneration) ||
                !appActiveForTransfer()
            ) {
                webRTConnection.close();
                throw new Error("Vault session expired. Unlock and try again.");
            }
            const webRTCDataChannel =
                webRTConnection.createDataChannel("linking");
            let iceCandidateDiscovery:
                | ReturnType<typeof createIceCandidateDiscovery>
                | undefined;

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
                if (peerOnlineServicesDeviceId) setInvitation(null);
                setStatus(message);
                showTransferFailure(message);
                setBusy(false);
            };

            iceCandidateDiscovery = createIceCandidateDiscovery(() => {
                if (
                    teardownRef.current !== teardownLinkingConnections ||
                    !isSameActiveVaultSession(sessionGeneration) ||
                    !appActiveForTransfer() ||
                    webRTConnection.connectionState === "closed" ||
                    webRTConnection.connectionState === "connected"
                )
                    return;
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
                if (
                    !transferActiveRef.current ||
                    !isSameActiveVaultSession(sessionGeneration) ||
                    !appActiveForTransfer()
                )
                    return;
                iceCandidateDiscovery?.cancel();
                setProgress(
                    "Private channel open. Authenticating the receiving device…",
                    STEP.authentication,
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
                    if (
                        !transferActiveRef.current ||
                        !isSameActiveVaultSession(sessionGeneration) ||
                        !appActiveForTransfer()
                    )
                        return;
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

                    setProgress("Preparing vault package…", STEP.transfer);
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

                    if (
                        !transferActiveRef.current ||
                        !isSameActiveVaultSession(sessionGeneration) ||
                        !appActiveForTransfer()
                    )
                        return;

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
                    setProgress("Encrypted vault transfer sent.", STEP.save);

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
                setProgress(
                    "Other device found. Creating private connection…",
                    STEP.connection,
                );
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
            teardownLiveTransfer();
            await rollbackPeerDevice(peerOnlineServicesDeviceId);
            if (peerOnlineServicesDeviceId) setInvitation(null);
            showTransferFailure(
                e instanceof Error
                    ? e.message
                    : "Failed to start live transfer.",
                e instanceof Error ? `${e.name}: ${e.message}` : String(e),
            );
            setBusy(false);
        }
    };

    // The package file on its way to the share sheet; a lock or leaving stops it.
    const startPackageRelease = useSecretRelease();

    const sharePackageFile = async () => {
        const release = startPackageRelease();
        const isCurrent = () =>
            release.current() && AppState.currentState === "active";
        if (!isCurrent()) {
            notify("Vault session expired. Unlock and try again.");
            return;
        }
        if (!invitation?.packageB64) return;
        const parsed = LinkingPackage.fromBase64(invitation.packageB64);
        if (parsed.isErr()) {
            notify("Invalid package data.");
            return;
        }
        try {
            const shared = await shareSecretFile(
                () =>
                    writeSecretTempFile(
                        LINK_FILE_EXTENSION,
                        uint8ToBase64(parsed.value.toBinary()),
                        FileSystem.EncodingType.Base64,
                    ),
                {
                    isCurrent,
                    // The share sheet takes the app out of the foreground; that
                    // trip must not count as leaving the transfer.
                    beforeShare: () => {
                        externalHandoffRef.current = true;
                    },
                    mimeType: "application/octet-stream",
                    dialogTitle: "Share Cryptex link package",
                },
            );
            if (shared === "unavailable")
                notify("Sharing is not available on this device.");
        } catch {
            notify("Could not share the link package.");
        } finally {
            // Some share sheets never leave the active state; don't keep the
            // exemption around for an unrelated trip to the background.
            if (AppState.currentState === "active")
                externalHandoffRef.current = false;
        }
    };

    const copyInvitation = async () => {
        if (!invitation?.packageB64) return;
        if (!(await copyTextToClipboard(invitation.packageB64))) {
            notify("Could not copy the invitation.");
            return;
        }
        // The user is about to paste it into another app.
        externalHandoffRef.current = true;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const refreshAccountAccess = async () => {
        setRefreshingAccess(true);
        try {
            await ensureFreshOnlineServicesSession();
            await syncOnlineServicesRemoteConfiguration();
        } catch {
            notify(
                "Could not refresh your account. Check your connection and try again.",
            );
        } finally {
            setRefreshingAccess(false);
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
        flow === "transfer" ? "Share invitation" : "Send an invitation";
    const invitationError = invitationAccessError({
        usesOnlineServices,
        hasSession,
        makeRoot,
        permissions: onlineServicesData?.remoteData,
    });

    const leaveTransfer = async (announce = false) => {
        setStopDialogOpen(false);
        setBusy(true);
        try {
            teardownLiveTransfer();
            await rollbackPeerDevice(invitation?.peerOnlineServicesDeviceId);
            setInvitation(null);
            setTransferPhase("idle");
            setStatus("");
            setFailure(null);
            setFlow("prepare");
            if (announce)
                notify(
                    "Linking cancelled. The invitation can no longer be used.",
                );
        } finally {
            setBusy(false);
        }
    };

    const retryTransfer = () => {
        // Online Services invitations are revoked on failure; others can be reused.
        if (invitation) void startLiveTransfer(invitation);
        else void createInvitation();
    };

    const goBack = async () => {
        if (qrFullscreen) {
            setQrFullscreen(false);
            return;
        }
        if (busy && !transferInProgress) return;
        if (transferPhase === "success") {
            router.dismissTo("/(app)/(tabs)/devices");
        } else if (flow === "prepare") router.back();
        else if (flow === "connection") setFlow("prepare");
        else if (transferInProgress) setStopDialogOpen(true);
        else void leaveTransfer();
    };

    useEffect(() => {
        if (flow !== "transfer" || transferPhase !== "active") return;
        void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
        return () => {
            void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
        };
    }, [flow, transferPhase]);

    // The QR is only useful until the receiver connects.
    useEffect(() => {
        if (sendStep > STEP.waiting || transferPhase !== "active")
            setQrFullscreen(false);
    }, [sendStep, transferPhase]);

    useEffect(() => {
        if (!qrFullscreen) return;
        let previous: number | null = null;
        // Window brightness only: no system setting changes, no permission.
        const applied = (async () => {
            try {
                previous = await Brightness.getBrightnessAsync();
                await Brightness.setBrightnessAsync(1);
            } catch {
                // Brightness is a convenience; the QR still works without it.
            }
        })();
        const back = BackHandler.addEventListener("hardwareBackPress", () => {
            setQrFullscreen(false);
            return true;
        });
        return () => {
            back.remove();
            void applied
                .then(() =>
                    Platform.OS === "android"
                        ? Brightness.restoreSystemBrightnessAsync()
                        : previous !== null
                          ? Brightness.setBrightnessAsync(previous)
                          : undefined,
                )
                .catch(() => undefined);
        };
    }, [qrFullscreen]);

    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const fullscreenQrSize = Math.min(windowWidth, windowHeight) - 48;

    const connectionNeedsAttention = !selectionsValid || !!invitationError;
    const connectionRow = (
        <UnlockedMenuRow
            icon={Settings2}
            title="Advanced connection"
            subtitle="Servers and root access for this invitation"
            value={
                signalingServerID === ONLINE_SERVICES_SELECTION_ID
                    ? "Online Services"
                    : vault.LinkedDevices.SignalingServers.find(
                          (server) => server.ID === signalingServerID,
                      )?.Name || "Custom"
            }
            onPress={() => setFlow("connection")}
        />
    );
    const needsAccountVisit =
        usesOnlineServices &&
        (!hasSession ||
            (!!onlineServicesData?.remoteData &&
                onlineServicesData.remoteData.root &&
                !onlineServicesData.remoteData.canLink));

    const progressItems: LinkProgressItem[] = SEND_PROGRESS.map(
        (item, index) => ({
            ...item,
            state:
                transferPhase === "success" || index < sendStep
                    ? "completed"
                    : index > sendStep
                      ? "pending"
                      : failure
                        ? "error"
                        : "active",
        }),
    );
    const showInvitation =
        !!invitation && !failure && sendStep === STEP.waiting;
    const qrValue = qrFrames[activeFrameIndex];

    return (
        <View style={{ flex: 1 }}>
            <Screen
                scroll
                edges={["top", "left", "right", "bottom"]}
                taskTitle={title}
                onTaskBack={goBack}
                contentContainerClassName="px-[20px] pb-[96px] pt-[24px]"
            >
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
                                Keep both devices online. The invitation gives
                                the other device a way to request an encrypted
                                vault transfer.
                            </UnlockedText>
                        </View>
                        {connectionNeedsAttention ? connectionRow : null}
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
                            <View>
                                <InlineNotice
                                    tone="info"
                                    message={invitationError}
                                />
                                <View className="mt-3 flex-row gap-3">
                                    {usesOnlineServices ? (
                                        <UnlockedButton
                                            className="flex-1"
                                            variant="outline"
                                            loading={refreshingAccess}
                                            onPress={() =>
                                                void refreshAccountAccess()
                                            }
                                        >
                                            Refresh
                                        </UnlockedButton>
                                    ) : null}
                                    {needsAccountVisit ? (
                                        <UnlockedButton
                                            className="flex-1"
                                            variant="outline"
                                            onPress={() =>
                                                router.dismissTo(
                                                    "/(app)/(tabs)/account",
                                                )
                                            }
                                        >
                                            Open Account
                                        </UnlockedButton>
                                    ) : null}
                                </View>
                            </View>
                        ) : null}
                        {connectionNeedsAttention ? null : (
                            <View className="mt-8">{connectionRow}</View>
                        )}
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
                        <RadioRow
                            title="Online Services"
                            subtitle={
                                hasSession
                                    ? "Use your signed-in account connection."
                                    : "Reconnect your account before using this option."
                            }
                            selected={connectionMode === "online"}
                            disabled={!cloudEnabled || !boundOs}
                            onPress={selectOnlineServices}
                        />
                        <RadioRow
                            title="Custom servers"
                            subtitle="Requires signaling and an ICE path; STUN or TURN can provide the connection."
                            selected={connectionMode === "custom"}
                            onPress={selectCustomServers}
                        />
                        {vault.LinkedDevices.SignalingServers.length ? (
                            <>
                                <SectionLabel>Signaling server</SectionLabel>
                                {vault.LinkedDevices.SignalingServers.map(
                                    (server) => (
                                        <RadioRow
                                            key={server.ID}
                                            title={server.Name || server.Host}
                                            selected={
                                                signalingServerID === server.ID
                                            }
                                            onPress={() =>
                                                setSignalingServerID(server.ID)
                                            }
                                        />
                                    ),
                                )}
                            </>
                        ) : null}
                        {vault.LinkedDevices.STUNServers.length ||
                        vault.LinkedDevices.TURNServers.length ? (
                            <SectionLabel>Connection paths</SectionLabel>
                        ) : null}
                        {vault.LinkedDevices.STUNServers.map((server) => (
                            <SwitchRow
                                key={server.ID}
                                title={server.Name || server.Host}
                                subtitle="STUN"
                                value={stunServerIDs.includes(server.ID)}
                                onValueChange={() =>
                                    setStunServerIDs((list) =>
                                        toggleId(list, server.ID),
                                    )
                                }
                            />
                        ))}
                        {vault.LinkedDevices.TURNServers.map((server) => (
                            <SwitchRow
                                key={server.ID}
                                title={server.Name || server.Host}
                                subtitle="TURN"
                                value={turnServerIDs.includes(server.ID)}
                                onValueChange={() =>
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
                        <SwitchRow
                            title="Make linked device root"
                            subtitle="Root devices can manage account devices, recovery, and account deletion."
                            value={usesOnlineServices && makeRoot}
                            onValueChange={setMakeRoot}
                            disabled={
                                !usesOnlineServices ||
                                !hasSession ||
                                !onlineServicesData?.remoteData?.root ||
                                !onlineServicesData.remoteData.canPromoteDevices
                            }
                        />
                        <UnlockedButton
                            className="mt-6"
                            disabled={!selectionsValid}
                            onPress={() => setFlow("prepare")}
                        >
                            Use selected connection
                        </UnlockedButton>
                    </View>
                </Dialog>

                {flow === "transfer" ? (
                    <View className="gap-4">
                        <LinkSteps current={1} />
                        {transferPhase === "success" ? (
                            <LinkResult
                                title="Device linked"
                                description={`${deviceName.trim()} received your vault and can now sync with this device.`}
                                rows={[
                                    {
                                        label: "Linked device",
                                        value: deviceName.trim(),
                                    },
                                    {
                                        label: "Connection",
                                        value: usesOnlineServices
                                            ? "Online Services"
                                            : "Custom servers",
                                    },
                                ]}
                                actionLabel="Back to Devices"
                                onAction={() =>
                                    router.dismissTo("/(app)/(tabs)/devices")
                                }
                            />
                        ) : (
                            <>
                                {showInvitation ? (
                                    <>
                                        <InvitationHeader title="Open on your other device">
                                            In Cryptex Vault on the other
                                            device, choose Use invitation, scan
                                            this code, and enter the
                                            verification words.
                                        </InvitationHeader>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="Show QR code full screen"
                                            disabled={!qrValue}
                                            onPress={() =>
                                                setQrFullscreen(true)
                                            }
                                            className="items-center py-2"
                                        >
                                            <View className="h-[224px] w-[224px] items-center justify-center rounded-md bg-white">
                                                {qrValue ? (
                                                    <QRCode
                                                        value={qrValue}
                                                        size={200}
                                                    />
                                                ) : (
                                                    <UnlockedText className="text-xs text-[#5b6274]">
                                                        Preparing QR code…
                                                    </UnlockedText>
                                                )}
                                            </View>
                                            {qrFrames.length > 1 ? (
                                                <UnlockedText className="mt-3 text-xs text-muted-foreground">
                                                    Part {activeFrameIndex + 1}{" "}
                                                    of {qrFrames.length}
                                                </UnlockedText>
                                            ) : null}
                                            <View className="mt-2 flex-row items-center gap-2">
                                                <Maximize2
                                                    size={13}
                                                    color={colors.muted}
                                                />
                                                <UnlockedText className="text-xs text-muted-foreground">
                                                    Tap to enlarge
                                                </UnlockedText>
                                            </View>
                                        </Pressable>
                                        <View className="rounded-md border border-border bg-secondary/40 p-3">
                                            <UnlockedText className="mb-2 text-xs text-muted-foreground">
                                                Verification words
                                            </UnlockedText>
                                            <UnlockedText
                                                selectable
                                                accessibilityLabel="Verification words"
                                                className="font-mono text-sm leading-6 text-foreground"
                                            >
                                                {invitation.mnemonic}
                                            </UnlockedText>
                                        </View>
                                        <View className="flex-row gap-3">
                                            <UnlockedButton
                                                className="flex-1"
                                                variant="outline"
                                                onPress={() =>
                                                    void sharePackageFile()
                                                }
                                            >
                                                Share file
                                            </UnlockedButton>
                                            <UnlockedButton
                                                className="flex-1"
                                                variant="outline"
                                                onPress={() =>
                                                    void copyInvitation()
                                                }
                                            >
                                                {copied
                                                    ? "Copied"
                                                    : "Copy invitation"}
                                            </UnlockedButton>
                                        </View>
                                    </>
                                ) : null}
                                <LinkingProgress
                                    items={progressItems}
                                    status={status || "Preparing invitation…"}
                                    activity={activity}
                                    failure={failure}
                                    failureTitle="Your vault was not sent."
                                    onCancel={() => void leaveTransfer(true)}
                                    onRetry={retryTransfer}
                                />
                            </>
                        )}
                    </View>
                ) : null}

                <Dialog
                    open={stopDialogOpen}
                    onOpenChange={setStopDialogOpen}
                    placement="bottom"
                >
                    <DialogHeader>
                        <UnlockedDialogTitle>Stop linking?</UnlockedDialogTitle>
                        <DialogDescription>
                            The other device will not be able to use this
                            invitation. You can create a new one at any time.
                        </DialogDescription>
                    </DialogHeader>
                    <UnlockedButton
                        variant="secondary"
                        onPress={() => setStopDialogOpen(false)}
                    >
                        Keep linking
                    </UnlockedButton>
                    <UnlockedButton
                        variant="destructive"
                        onPress={() => void leaveTransfer(true)}
                    >
                        Stop linking
                    </UnlockedButton>
                </Dialog>
            </Screen>
            <Snackbar
                feedback={snackbar}
                onDismiss={dismissSnackbar}
                bottomOffset={insets.bottom + 12}
            />
            {qrFullscreen && qrValue ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close full-screen QR code"
                    onPress={() => setQrFullscreen(false)}
                    style={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        bottom: 0,
                        left: 0,
                        zIndex: 10,
                        elevation: 10,
                        backgroundColor: "#ffffff",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 20,
                    }}
                >
                    <QRCode value={qrValue} size={fullscreenQrSize} />
                    <View style={{ alignItems: "center", gap: 6 }}>
                        {qrFrames.length > 1 ? (
                            <UnlockedText
                                style={{ color: "#111520", fontSize: 14 }}
                            >
                                Part {activeFrameIndex + 1} of {qrFrames.length}
                            </UnlockedText>
                        ) : null}
                        <View
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 6,
                            }}
                        >
                            <X size={14} color="#5b6274" />
                            <UnlockedText
                                style={{ color: "#5b6274", fontSize: 13 }}
                            >
                                Tap anywhere to close
                            </UnlockedText>
                        </View>
                    </View>
                </Pressable>
            ) : null}
        </View>
    );
}
