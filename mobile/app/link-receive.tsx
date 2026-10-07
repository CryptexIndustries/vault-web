import { vars } from "nativewind";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type RefObject,
} from "react";
import { Alert, AppState, Pressable, View, type TextInput } from "react-native";
import { router, useNavigation } from "expo-router";
import { useIsFocused, usePreventRemove } from "expo-router/react-navigation";
import { useAtomValue, useSetAtom } from "jotai";
import { FileText, Link2, QrCode } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import {
    CameraView,
    useCameraPermissions,
    type BarcodeScanningResult,
} from "expo-camera";
import { ulid } from "ulidx";

import { type ChunkedQRCodeProgress } from "@ui/lib/chunked-qr";
import { createQrScanSession } from "@/utils/qr-scan-session";

import {
    LinkingPackage,
    LinkingProcessController,
    LinkingProcessState,
    LinkingProcessStep,
    type LinkingProcessStatus,
} from "@cryptex-industries/vault-core/vault-utils/linking";
import { ensureSyncKemKeypair } from "@cryptex-industries/vault-core/vault-utils/post-quantum-kem";
import { ensureSyncSigningKeypair } from "@cryptex-industries/vault-core/vault-utils/sync-signing";
import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import { openEnvelopeBlob } from "@cryptex-industries/vault-core/vault-utils/vault-envelope-ops";
import { saveVault, VaultMetadata } from "@/app_lib/vault-utils/storage";
import {
    LinkedDevices,
    OnlineServices,
    Vault,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    establishOnlineServicesSession,
    setOnlineServicesSessionIdentityTransition,
    syncOnlineServicesRemoteConfiguration,
} from "@/app_lib/auth-session";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { LINK_FILE_EXTENSION } from "@cryptex-industries/vault-core/consts";
import { base64ToUint8 } from "@cryptex-industries/vault-core/encoding";
import { readPickedImportFile } from "@/utils/mobile-import-picker";
import { ensureSecretTempFilesReady } from "@/utils/secret-temp-files";
import {
    clearOnlineServicesSession,
    isVaultUnlockedAtom,
    setOnlineServicesData,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
} from "@/utils/atoms";
import { setVaultDEKInSessionForMetadata } from "@/utils/vault-session";
import {
    createLinkedVaultEnvelope,
    type LinkedVaultEnvelopeResult,
} from "@/utils/linked-vault-envelope";
import {
    ensureActiveVaultSyncKeyMaterial,
    mergeReceivedVaultIntoActive,
    receiverSyncKeyMaterial,
} from "@/utils/link-merge";
import { onlineServicesLog } from "@/utils/logging";
import { Screen } from "@/components/screen";
import {
    UnlockedButton,
    UnlockedInput,
    UnlockedLabel,
    UnlockedMenuRow,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { InlineNotice } from "@/components/inline-notice";
import { InvitationHeader } from "@/components/invitation-header";
import {
    VaultEntryAction,
    VaultEntryAssurance,
    VaultEntryFieldError,
    VaultEntryHeader,
    VaultEntryNotice,
    VaultEntrySteps,
} from "@/components/vault-entry-ui";
import {
    LinkActivityLog,
    LinkingProgress,
    type LinkActivityEntry,
    type LinkFailure,
    type LinkProgressItem,
} from "@/components/linking-progress";
import { Icon } from "@/components/ui/icon";
import { PasswordStrengthMeter } from "@/components/vault/password-strength-meter";
import { SecretReveal } from "@/components/vault-security/secret-reveal";
import {
    choiceToSource,
    AdditionalKeyProtectionOptions,
    type AdditionalKeyProtectionChoice,
} from "@/components/vault-security/additional-key-protection-options";
import { useVaultScreenPrivacy } from "@/hooks/use-vault-screen-privacy";
import { useAutoLock } from "@/hooks/use-auto-lock";
import { vaultLockStateAtom } from "@/utils/vault-lock";
import { VaultLockScreen } from "@/components/unlocked/unlocked-ui";
import { shouldCancelReceiveLinkOnBackground } from "@/utils/link-receive-background";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useScrollToNode } from "@/components/keyboard-scroll";

type Stage =
    | "input"
    | "confirm-merge"
    | "linking"
    | "passphrase"
    | "recovery"
    | "done"
    | "failed";

type InputMethod = "scan" | "paste" | "file";

type Invitation =
    | { source: "scan"; base64: string; label: string }
    | { source: "paste"; base64: string; label: string }
    | { source: "file"; bytes: Uint8Array; label: string };

type PendingSyncKeys = {
    signingPublicKey: string;
    signingPrivateKey: string;
    kemPublicKey: string;
    kemPrivateKey: string;
};

type MergeSummary = {
    credentialsAdded: number;
    credentialsSkipped: number;
    devicesAdded: number;
};

type PendingLinkedSave = {
    metadata: VaultMetadata;
    vault: Vault;
    envelope: LinkedVaultEnvelopeResult;
    dek: CryptoKey;
};

type ReceiveProgressKey =
    | "invitation"
    | "keys"
    | "signaling"
    | "connection"
    | "authentication"
    | "transfer"
    | "cleanup";

const RECEIVE_PROGRESS: Array<{
    key: ReceiveProgressKey;
    title: string;
    detail: string;
}> = [
    {
        key: "invitation",
        title: "Open the invitation",
        detail: "Decrypting and validating the invitation.",
    },
    {
        key: "keys",
        title: "Prepare this device",
        detail: "Preparing local signing and post-quantum keys.",
    },
    {
        key: "signaling",
        title: "Find the sending device",
        detail: "Keep the linking screen open on your sending device until the transfer finishes.",
    },
    {
        key: "connection",
        title: "Open a private connection",
        detail: "Negotiating the direct WebRTC connection.",
    },
    {
        key: "authentication",
        title: "Authenticate key exchange",
        detail: "Verifying the sender and exchanging sync keys.",
    },
    {
        key: "transfer",
        title: "Receive and verify your vault",
        detail: "Receiving, authenticating, and decrypting the transfer.",
    },
    {
        key: "cleanup",
        title: "Finish the connection",
        detail: "Closing the private connection before local setup.",
    },
];

const INITIAL_PROGRESS = Object.fromEntries(
    RECEIVE_PROGRESS.map(({ key }) => [key, "pending"]),
) as Record<ReceiveProgressKey, LinkProgressItem["state"]>;

function progressKeyForStep(
    step: LinkingProcessStep,
): ReceiveProgressKey | null {
    switch (step) {
        case LinkingProcessStep.Signaling:
        case LinkingProcessStep.SignalingWaitingOtherDevice:
            return "signaling";
        case LinkingProcessStep.DirectConnection:
            return "connection";
        case LinkingProcessStep.SyncKeyExchange:
            return "authentication";
        case LinkingProcessStep.VaultTransfer:
        case LinkingProcessStep.VaultSave:
            return "transfer";
        case LinkingProcessStep.DirectConnectionCleanup:
            return "cleanup";
        case LinkingProcessStep.SignalingCleanup:
            return null;
    }
}

const DEFAULT_MEM_LIMIT = 128;
const DEFAULT_OPS_LIMIT = 3;

function LinkReceiveContent({
    embedded = false,
}: {
    embedded?: boolean;
}) {
    const navigation = useNavigation();
    const unlocked = useAtomValue(isVaultUnlockedAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);

    // Merge into the unlocked vault instead of creating a second local vault.
    const mergeMode = unlocked;

    const [permission, requestPermission] = useCameraPermissions();
    const isFocused = useIsFocused();
    const cameraRef = useRef<CameraView>(null);
    const [method, setInputMethod] = useState<InputMethod | null>(null);
    const [qrChunkProgress, setQrChunkProgress] =
        useState<ChunkedQRCodeProgress | null>(null);
    const scanSessionRef = useRef<ReturnType<
        typeof createQrScanSession
    > | null>(null);
    const [scanEpoch, setScanEpoch] = useState(0);
    const cancelScan = useCallback(() => {
        scanSessionRef.current?.cancel();
        scanSessionRef.current = null;
        setQrChunkProgress(null);
    }, []);
    const setMethod = (next: InputMethod | null) => {
        if (next !== "scan") cancelScan();
        setInputMethod(next);
    };

    useEffect(() => {
        const stopScanning = () => {
            cancelScan();
            void cameraRef.current?.pausePreview().catch(() => {
                // The native view may already have been removed by navigation.
            });
            setInputMethod((current) => (current === "scan" ? null : current));
        };
        const unsubscribe = navigation.addListener("blur", stopScanning);
        return () => {
            unsubscribe();
            stopScanning();
        };
    }, [navigation, cancelScan]);
    const [mnemonic, setMnemonic] = useState("");
    const [pasteDraft, setPasteDraft] = useState("");
    const [invitation, setInvitation] = useState<Invitation | null>(null);
    const [stage, setStage] = useState<Stage>("input");
    const [validatingInvitation, setValidatingInvitation] = useState(false);
    const [statusMessage, setStatusMessage] = useState("");
    const [error, setError] = useState("");
    const [fieldErrors, setFieldErrors] = useState({
        paste: "",
        mnemonic: "",
        vaultName: "",
        password: "",
        confirm: "",
    });
    const [cameraError, setCameraError] = useState("");
    const [vaultName, setVaultName] = useState("Linked vault");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [additionalKeyProtectionChoice, setAdditionalKeyProtectionChoice] =
        useState<AdditionalKeyProtectionChoice>("none");
    const [saving, setSaving] = useState(false);
    const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
    const [protectionPhrase, setProtectionPhrase] = useState<string | null>(
        null,
    );
    const [recoveryAck, setRecoveryAck] = useState(false);
    const [additionalKeyProtectionAck, setAdditionalKeyProtectionAck] =
        useState(false);
    const [saveWarning, setSaveWarning] = useState("");
    const [hasUnsavedReceivedVault, setHasUnsavedReceivedVault] =
        useState(false);
    const [allowNavigation, setAllowNavigation] = useState(false);
    const [mergeSummary, setMergeSummary] = useState<MergeSummary | null>(null);
    const [osOverwriteOpen, setOsOverwriteOpen] = useState(false);
    const [pendingOsOverwrite, setPendingOsOverwrite] =
        useState<OnlineServices | null>(null);
    const [linkProgress, setLinkProgress] = useState(INITIAL_PROGRESS);
    const [linkActivity, setLinkActivity] = useState<LinkActivityEntry[]>([]);
    const [linkFailure, setLinkFailure] = useState<LinkFailure | null>(null);

    const controllerRef = useRef<LinkingProcessController | null>(null);
    const receivedVaultRef = useRef<Uint8Array | null>(null);
    const pendingSyncKeysRef = useRef<PendingSyncKeys | null>(null);
    const senderKeyBundleRef = useRef<VaultUtilTypes.SyncKeyBundle | null>(
        null,
    );
    const onlineServicesRef = useRef<OnlineServices | null>(null);
    const completedRef = useRef(false);
    const failedRef = useRef(false);
    const osOverwriteResolverRef = useRef<((ok: boolean) => void) | null>(null);
    const pendingLinkedSaveRef = useRef<PendingLinkedSave | null>(null);
    const sealInFlightRef = useRef(false);
    const saveInFlightRef = useRef(false);
    const linkAttemptRef = useRef(0);
    const sessionTransitionAttemptRef = useRef<number | null>(null);
    const linkStartedAtRef = useRef(0);
    const linkActivityIdRef = useRef(0);
    const pasteRef = useRef<TextInput>(null);
    const mnemonicRef = useRef<TextInput>(null);
    const vaultNameRef = useRef<TextInput>(null);
    const passwordRef = useRef<TextInput>(null);
    const confirmRef = useRef<TextInput>(null);
    const generalErrorRef = useRef<View>(null);
    const scrollToNode = useScrollToNode();

    const beginSessionTransition = (attempt: number) => {
        if (!mergeMode) return;
        sessionTransitionAttemptRef.current = attempt;
        setOnlineServicesSessionIdentityTransition(true);
    };

    const finishSessionTransition = (attempt: number) => {
        if (!mergeMode || sessionTransitionAttemptRef.current !== attempt)
            return;
        sessionTransitionAttemptRef.current = null;
        setOnlineServicesSessionIdentityTransition(false);
    };

    const finishCurrentSessionTransition = () => {
        const attempt = sessionTransitionAttemptRef.current;
        if (attempt != null) finishSessionTransition(attempt);
    };

    useEffect(() => {
        if (!error) return;
        requestAnimationFrame(() => scrollToNode(generalErrorRef.current, 48));
    }, [error, scrollToNode]);

    const setFieldError = (
        field: keyof typeof fieldErrors,
        message: string,
        ref: RefObject<TextInput | null>,
    ) => {
        setFieldErrors((current) => ({ ...current, [field]: message }));
        requestAnimationFrame(() => ref.current?.focus());
    };

    const clearFieldError = (field: keyof typeof fieldErrors) => {
        setFieldErrors((current) =>
            current[field] ? { ...current, [field]: "" } : current,
        );
    };

    usePreventRemove(
        !allowNavigation && (recoveryCode != null || hasUnsavedReceivedVault),
        ({ data }) => {
            if (recoveryCode != null) {
                Alert.alert(
                    "Finish saving your vault",
                    "Save the recovery details before leaving this screen.",
                    [{ text: "Continue setup" }],
                );
                return;
            }
            Alert.alert(
                "Discard received vault?",
                "This received copy has not been saved. Leaving means you will need to repeat the live transfer. The sending vault is not changed.",
                [
                    { text: "Keep setting up", style: "cancel" },
                    {
                        text: "Discard",
                        style: "destructive",
                        onPress: () => {
                            receivedVaultRef.current = null;
                            pendingLinkedSaveRef.current = null;
                            setHasUnsavedReceivedVault(false);
                            requestAnimationFrame(() =>
                                navigation.dispatch(data.action),
                            );
                        },
                    },
                ],
            );
        },
    );

    useEffect(() => {
        return () => {
            if (mergeMode) setOnlineServicesSessionIdentityTransition(false);
            sessionTransitionAttemptRef.current = null;
            linkAttemptRef.current += 1;
            controllerRef.current?.abortWaitingForDevice();
            controllerRef.current = null;
            receivedVaultRef.current = null;
            pendingLinkedSaveRef.current = null;
            if (osOverwriteResolverRef.current) {
                osOverwriteResolverRef.current(false);
                osOverwriteResolverRef.current = null;
            }
        };
    }, [mergeMode]);

    useEffect(() => {
        const subscription = AppState.addEventListener("change", (state) => {
            if (!shouldCancelReceiveLinkOnBackground(
                state,
                validatingInvitation,
                controllerRef.current !== null,
            )) return;
            linkAttemptRef.current += 1;
            controllerRef.current?.abortWaitingForDevice();
            controllerRef.current = null;
            receivedVaultRef.current = null;
            setHasUnsavedReceivedVault(false);
            finishCurrentSessionTransition();
            failedRef.current = true;
            setValidatingInvitation(false);
            setStage("failed");
            setError("Live transfer stopped while the app was in the background. Start again.");
        });
        return () => subscription.remove();
        // The controller ref contains the current transfer; state only tracks validation.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [validatingInvitation]);

    const acceptInvitation = (
        candidate: Invitation,
        onInvalid: (message: string) => void = setError,
    ) => {
        try {
            let parsed: LinkingPackage;
            if (candidate.source === "file") {
                parsed = LinkingPackage.fromBinary(candidate.bytes);
            } else {
                const result = LinkingPackage.fromBase64(candidate.base64);
                if (result.isErr()) throw new Error(result.error);
                parsed = result.value;
            }
            if (
                parsed.Blob.length === 0 ||
                base64ToUint8(parsed.Salt).length !== 16 ||
                base64ToUint8(parsed.HeaderIV).length !== 24
            ) {
                throw new Error("LINK_INVITATION_FIELDS_INVALID");
            }
            setInvitation(candidate);
            setMethod(null);
            setError("");
            return true;
        } catch {
            onInvalid("This is not a valid Cryptex Vault link invitation.");
            return false;
        }
    };

    const pickLinkFile = async () => {
        setError("");
        setMethod("file");
        try {
            await ensureSecretTempFilesReady();
            const result = await DocumentPicker.getDocumentAsync({
                copyToCacheDirectory: true,
                type: "*/*",
            });
            if (result.canceled || !result.assets?.[0]) return;
            const asset = result.assets[0];
            const picked = await readPickedImportFile(asset);
            const name = asset.name ?? `link.${LINK_FILE_EXTENSION}`;
            if (
                acceptInvitation({
                    source: "file",
                    bytes: picked.bytes,
                    label: name,
                })
            ) {
                setPasteDraft("");
            }
        } catch {
            setError("Could not read this link file.");
        }
    };

    const startScan = async () => {
        cancelScan();
        setScanEpoch((epoch) => epoch + 1);
        scanSessionRef.current = createQrScanSession(
            setQrChunkProgress,
            (base64) => {
                if (!navigation.isFocused()) return;
                if (
                    !acceptInvitation(
                        { source: "scan", base64, label: "Scanned QR code" },
                        setCameraError,
                    )
                )
                    return;
                setCameraError("");
                setStatusMessage("");
                setMethod(null);
            },
        );
        setError("");
        setCameraError("");
        setMethod("scan");
        if (!permission?.granted && permission?.canAskAgain !== false) {
            await requestPermission();
        }
    };

    const usePastedInvitation = () => {
        const base64 = pasteDraft.trim();
        if (!base64) {
            setFieldError(
                "paste",
                "Paste the invitation data from the sending device.",
                pasteRef,
            );
            return;
        }
        if (
            !acceptInvitation(
                {
                    source: "paste",
                    base64,
                    label: "Pasted link data",
                },
                (message) => setFieldError("paste", message, pasteRef),
            )
        )
            return;
        setPasteDraft("");
    };

    // Capture this render's session, not the ref: a late event from an old
    // camera must not feed a newly opened collector.
    const scanSession = scanSessionRef.current;
    const onBarcodeScanned = (result: BarcodeScanningResult) => {
        if (method !== "scan" || cameraError || !navigation.isFocused()) return;
        scanSession?.scan(result.data);
    };

    const getLinkingPackage = (): LinkingPackage => {
        if (!invitation) {
            throw new Error("Choose a link invitation.");
        }
        if (invitation.source === "file") {
            return LinkingPackage.fromBinary(invitation.bytes);
        }
        const parsed = LinkingPackage.fromBase64(invitation.base64);
        if (parsed.isErr()) {
            throw new Error("Invalid link package data.");
        }
        return parsed.value;
    };

    const appendLinkActivity = (
        message: string,
        type: LinkActivityEntry["type"] = "info",
        timestamp = Date.now(),
    ) => {
        const startedAt = linkStartedAtRef.current || timestamp;
        const id = ++linkActivityIdRef.current;
        setLinkActivity((current) => [
            ...current,
            {
                id,
                elapsedSeconds: Math.max(
                    0,
                    Math.floor((timestamp - startedAt) / 1000),
                ),
                message,
                type,
            },
        ]);
    };

    const setProgressState = (
        key: ReceiveProgressKey,
        state: LinkProgressItem["state"],
    ) => {
        setLinkProgress((current) => {
            // Connection-state callbacks may arrive after the protocol milestone.
            if (current[key] === "completed" && state === "active")
                return current;
            return { ...current, [key]: state };
        });
    };

    const technicalErrorForStatus = (status: LinkingProcessStatus) => {
        const details = status.LogMessage?.details;
        if (details?.type === "connection_state") {
            return `${status.LogMessage?.message ?? "Connection error"}\nConnection state: ${details.state}`;
        }
        if (details?.type === "vault" || details?.type === "webrtc") {
            return `${status.LogMessage?.message ?? "Linking error"}\n${details.error.name}: ${details.error.message}`;
        }
        return (
            status.LogMessage?.message ??
            "The linking process reported an error."
        );
    };

    const confirmOsOverwrite = (incoming: OnlineServices) =>
        new Promise<boolean>((resolve) => {
            osOverwriteResolverRef.current = resolve;
            setPendingOsOverwrite(incoming);
            setOsOverwriteOpen(true);
        });

    const sealLinkedVault = async () => {
        if (sealInFlightRef.current) return;
        setError("");
        const rawVaultBinary = receivedVaultRef.current;
        if (!rawVaultBinary) {
            setError("No vault data to save.");
            return;
        }
        const next = {
            vaultName: vaultName.trim()
                ? ""
                : "Enter a name for this linked vault.",
            password: password
                ? ""
                : "Enter a master password for this device.",
            confirm: !confirm
                ? "Confirm your master password."
                : password === confirm
                  ? ""
                  : "Enter the same password again.",
        };
        setFieldErrors((current) => ({ ...current, ...next }));
        const first = next.vaultName
            ? vaultNameRef
            : next.password
              ? passwordRef
              : next.confirm
                ? confirmRef
                : null;
        if (first) {
            requestAnimationFrame(() => first.current?.focus());
            return;
        }

        sealInFlightRef.current = true;
        setSaving(true);
        try {
            const raw = VaultUtilTypes.Vault.decode(rawVaultBinary);
            const vault = Object.assign(new Vault(), raw);
            vault.LinkedDevices = LinkedDevices.fromGeneric(
                vault.LinkedDevices,
            );

            if (pendingSyncKeysRef.current) {
                vault.LinkedDevices.SyncSigningPublicKey =
                    pendingSyncKeysRef.current.signingPublicKey;
                vault.LinkedDevices.SyncSigningPrivateKey =
                    pendingSyncKeysRef.current.signingPrivateKey;
                vault.LinkedDevices.SyncKemPublicKey =
                    pendingSyncKeysRef.current.kemPublicKey;
                vault.LinkedDevices.SyncKemPrivateKey =
                    pendingSyncKeysRef.current.kemPrivateKey;
            } else {
                await ensureSyncSigningKeypair(vault.LinkedDevices);
                await ensureSyncKemKeypair(vault.LinkedDevices);
            }

            if (senderKeyBundleRef.current) {
                for (const device of vault.LinkedDevices.Devices) {
                    device.RemoteSyncPublicKey =
                        senderKeyBundleRef.current.SyncSigningPublicKey;
                    device.RemoteSyncKemPublicKey =
                        senderKeyBundleRef.current.SyncKemPublicKey;
                }
            }
            if (onlineServicesRef.current) {
                vault.OnlineServices = onlineServicesRef.current;
            }
            await vault.upgrade();

            const metadata = new VaultMetadata();
            metadata.Name = vaultName.trim();
            metadata.CreatedAt = new Date().toISOString();

            const vaultBytes = VaultUtilTypes.Vault.encode(vault).finish();
            const vaultId = ulid();
            const kdfConfig = new KeyDerivationConfig_Argon2ID(
                DEFAULT_MEM_LIMIT,
                DEFAULT_OPS_LIMIT,
            );
            const envelope = await createLinkedVaultEnvelope(vaultBytes, {
                vaultId,
                masterPassword: password,
                kdfConfig,
                additionalKeyProtection: choiceToSource(
                    additionalKeyProtectionChoice,
                ),
            });
            metadata.Blob = envelope.blob;

            const dekRes = await openEnvelopeBlob(metadata.Blob, vaultId, {
                masterPassword: password,
                additionalKeyProtectionHkdfBase:
                    envelope.enrolledProtection.hkdfBaseKey,
            });
            if (dekRes.isErr()) {
                throw new Error("Could not verify the new local vault.");
            }

            pendingLinkedSaveRef.current = {
                metadata,
                vault,
                envelope,
                dek: dekRes.value.dek,
            };
            setRecoveryCode(envelope.recoveryCode);
            setProtectionPhrase(envelope.protectionPhrase ?? null);
            setRecoveryAck(false);
            setAdditionalKeyProtectionAck(false);
            setSaveWarning("");
            setStage("recovery");
        } catch (e) {
            setError(
                e instanceof Error ? e.message : "Failed to save linked vault.",
            );
        } finally {
            sealInFlightRef.current = false;
            setSaving(false);
        }
    };

    const finishLinkedVault = async () => {
        const pending = pendingLinkedSaveRef.current;
        if (
            !pending ||
            !recoveryAck ||
            (protectionPhrase != null && !additionalKeyProtectionAck) ||
            saveInFlightRef.current
        ) {
            return;
        }
        saveInFlightRef.current = true;
        setSaving(true);
        setError("");
        try {
            const dbIndex = await saveVault(
                pending.metadata.DBIndex,
                VaultUtilTypes.VaultMetadata.encode(pending.metadata).finish(),
            );
            pending.metadata.DBIndex = dbIndex;
            try {
                await pending.metadata.persistAdditionalKeyProtectionEnrollment(
                    pending.envelope.enrolledProtection,
                );
            } catch (enrollmentError) {
                onlineServicesLog.warn(
                    "Failed to cache linked vault protection phrase",
                    { error: enrollmentError },
                );
                setSaveWarning(
                    "The vault is encrypted and saved, but this device could not cache its protection phrase. Keep the phrase available and tap Save and open vault to try again.",
                );
                return;
            }

            receivedVaultRef.current = null;
            pendingLinkedSaveRef.current = null;
            setHasUnsavedReceivedVault(false);
            setRecoveryCode(null);
            setProtectionPhrase(null);
            setAllowNavigation(true);
            requestAnimationFrame(() => {
                setVaultDEKInSessionForMetadata(pending.metadata, pending.dek);
                setUnlockedVaultMetadata(pending.metadata);
                setUnlockedVault(pending.vault);
                const onlineServices = pending.vault.OnlineServices;
                if (
                    onlineServicesRef.current &&
                    onlineServices &&
                    Vault.isOnlineServicesBound(pending.vault)
                ) {
                    void (async () => {
                        try {
                            setOnlineServicesData({
                                deviceId: onlineServices.DeviceId,
                                sessionToken: null,
                                sessionExpiresAt: null,
                                remoteData: null,
                            });
                            await establishOnlineServicesSession({
                                deviceId: onlineServices.DeviceId,
                                privateKeyJWK: onlineServices.PrivateKeyJWK,
                            });
                            await syncOnlineServicesRemoteConfiguration();
                        } catch (sessionError) {
                            onlineServicesLog.error(
                                "Post-link Online Services session failed",
                                { error: sessionError },
                            );
                        }
                    })();
                }
                router.replace("/(app)/(tabs)/vault");
            });
        } catch (saveError) {
            setError(
                saveError instanceof Error
                    ? saveError.message
                    : "Failed to save linked vault.",
            );
        } finally {
            saveInFlightRef.current = false;
            setSaving(false);
        }
    };

    const finishWithMerge = async (attempt = linkAttemptRef.current) => {
        const rawVaultBinary = receivedVaultRef.current;
        const senderBundle = senderKeyBundleRef.current;
        if (!rawVaultBinary || !senderBundle) {
            finishSessionTransition(attempt);
            setStage("failed");
            setError("No vault data received.");
            setLinkProgress((current) => ({ ...current, transfer: "error" }));
            setLinkFailure({
                message: "No vault data received.",
                technical:
                    "Vault transfer completed without usable vault data or sender key material.",
            });
            return;
        }
        try {
            const summary = await mergeReceivedVaultIntoActive({
                receivedVaultData: rawVaultBinary,
                onlineServicesOverwrite: onlineServicesRef.current,
                senderKeyBundle: senderBundle,
            });
            finishSessionTransition(attempt);
            if (onlineServicesRef.current) {
                // Authentication happened before the incoming binding existed in
                // the active vault. Refresh the live signaling configuration now
                // so this unlocked session can connect without a lock/unlock cycle.
                await syncOnlineServicesRemoteConfiguration();
            }
            receivedVaultRef.current = null;
            setHasUnsavedReceivedVault(false);
            setMergeSummary(summary);
            setStage("done");
            setStatusMessage(
                `Merged ${summary.credentialsAdded} credential(s) and ${summary.devicesAdded} device(s). Skipped ${summary.credentialsSkipped} existing.`,
            );
        } catch (e) {
            finishSessionTransition(attempt);
            setStage("failed");
            const message =
                e instanceof Error
                    ? e.message
                    : "Failed to merge linked vault.";
            setError(message);
            setLinkProgress((current) => ({ ...current, transfer: "error" }));
            setLinkFailure({
                message,
                technical:
                    e instanceof Error ? `${e.name}: ${e.message}` : String(e),
            });
            appendLinkActivity(message, "error");
        }
    };

    const runLinking = async () => {
        const attempt = ++linkAttemptRef.current;
        setError("");
        setCameraError("");
        setMergeSummary(null);
        if (mnemonic.trim().split(/\s+/).length < 12) {
            setFieldError(
                "mnemonic",
                "Enter the full twelve-word linking phrase from the sending device.",
                mnemonicRef,
            );
            return;
        }
        if (!invitation) {
            setError("Scan a QR code, paste link data, or choose a link file.");
            return;
        }

        setValidatingInvitation(true);
        let invitationOpened = false;
        setStatusMessage("Checking linking phrase…");
        linkStartedAtRef.current = Date.now();
        linkActivityIdRef.current = 0;
        setLinkActivity([]);
        setLinkFailure(null);
        setLinkProgress({
            ...INITIAL_PROGRESS,
            invitation: "active",
        });
        appendLinkActivity("Opening and validating the encrypted invitation.");
        completedRef.current = false;
        failedRef.current = false;
        receivedVaultRef.current = null;
        controllerRef.current = null;
        beginSessionTransition(attempt);

        try {
            const linkingPackage = getLinkingPackage();
            const decrypted = await linkingPackage.decryptPackage(
                mnemonic.trim(),
            );
            if (attempt !== linkAttemptRef.current) return;
            if (decrypted.isErr()) {
                throw new Error("Wrong linking phrase or corrupt invitation.");
            }
            invitationOpened = true;
            setValidatingInvitation(false);
            setStage("linking");
            setProgressState("invitation", "completed");
            setProgressState("keys", "active");
            appendLinkActivity(
                "Invitation opened. Preparing this device's keys.",
            );
            const linkingBlob = decrypted.value;
            if (
                !linkingBlob.SenderKeyBundle?.SyncSigningPublicKey ||
                !linkingBlob.SenderKeyBundle.SyncKemPublicKey
            ) {
                throw new Error("Link package missing sync key material.");
            }
            const senderKeyBundle = linkingBlob.SenderKeyBundle;

            const usesOnlineServices =
                linkingBlob.OnlineServices != null ||
                linkingBlob.SignalingServer == null;

            if (linkingBlob.OnlineServices) {
                const incomingOs = new OnlineServices(
                    linkingBlob.OnlineServices.DeviceId,
                    linkingBlob.OnlineServices.UserID,
                    linkingBlob.OnlineServices.PublicKeyJWK,
                    linkingBlob.OnlineServices.PrivateKeyJWK,
                );

                if (
                    mergeMode &&
                    Vault.isOnlineServicesBound(unlockedVault) &&
                    (unlockedVault.OnlineServices.UserID !==
                        incomingOs.UserID ||
                        unlockedVault.OnlineServices.DeviceId !==
                            incomingOs.DeviceId)
                ) {
                    const ok = await confirmOsOverwrite(incomingOs);
                    if (attempt !== linkAttemptRef.current) return;
                    if (!ok) {
                        finishSessionTransition(attempt);
                        setStage("input");
                        setStatusMessage("");
                        setError("Linking cancelled.");
                        return;
                    }
                }

                if (attempt !== linkAttemptRef.current) return;
                setOnlineServicesData({
                    deviceId: linkingBlob.OnlineServices.DeviceId,
                    sessionToken: null,
                    sessionExpiresAt: null,
                    remoteData: null,
                });
                await establishOnlineServicesSession({
                    deviceId: linkingBlob.OnlineServices.DeviceId,
                    privateKeyJWK: linkingBlob.OnlineServices.PrivateKeyJWK,
                });
                if (attempt !== linkAttemptRef.current) return;
                onlineServicesRef.current = incomingOs;
                setStatusMessage("Online Services authenticated. Connecting…");
            } else {
                if (attempt !== linkAttemptRef.current) return;
                onlineServicesRef.current = null;
                if (!mergeMode) {
                    clearOnlineServicesSession();
                }
            }

            let receiverSyncKeys;
            if (mergeMode) {
                receiverSyncKeys = await ensureActiveVaultSyncKeyMaterial();
            } else {
                // A sealed new vault has no existing identity to preserve.
                const pendingLinkedDevices = new LinkedDevices();
                await ensureSyncSigningKeypair(pendingLinkedDevices);
                await ensureSyncKemKeypair(pendingLinkedDevices);
                receiverSyncKeys =
                    receiverSyncKeyMaterial(pendingLinkedDevices);
            }
            if (attempt !== linkAttemptRef.current) return;
            senderKeyBundleRef.current = senderKeyBundle;
            pendingSyncKeysRef.current = receiverSyncKeys;
            setProgressState("keys", "completed");
            appendLinkActivity(
                "Local signing and post-quantum keys are ready.",
            );

            const onStatusChange = async (status: LinkingProcessStatus) => {
                if (attempt !== linkAttemptRef.current || failedRef.current)
                    return;
                if (status.LogMessage?.message) {
                    setStatusMessage(status.LogMessage.message);
                    appendLinkActivity(
                        status.LogMessage.message,
                        status.LogMessage.type,
                        status.LogMessage.timestamp,
                    );
                }
                const progressKey = progressKeyForStep(status.Step);
                if (progressKey) {
                    if (
                        status.State === LinkingProcessState.Active &&
                        !(progressKey === "transfer" && !status.LogMessage)
                    ) {
                        setProgressState(progressKey, "active");
                    } else if (
                        status.State === LinkingProcessState.Completed &&
                        status.Step !== LinkingProcessStep.Signaling
                    ) {
                        setProgressState(progressKey, "completed");
                    } else if (status.State === LinkingProcessState.Error) {
                        setProgressState(progressKey, "error");
                    }
                }
                if (
                    status.State === LinkingProcessState.Error &&
                    !failedRef.current
                ) {
                    finishSessionTransition(attempt);
                    failedRef.current = true;
                    controllerRef.current?.abortWaitingForDevice();
                    controllerRef.current = null;
                    setStage("failed");
                    const message =
                        "The live transfer stopped. Keep the linking screen open on your sending device and try again.";
                    setError(message);
                    setLinkFailure({
                        message,
                        technical: technicalErrorForStatus(status),
                    });
                }
                if (
                    status.Step === LinkingProcessStep.VaultTransfer &&
                    status.State === LinkingProcessState.Completed &&
                    status.VaultBinaryData
                ) {
                    receivedVaultRef.current = status.VaultBinaryData;
                    setHasUnsavedReceivedVault(true);
                    setStatusMessage(
                        mergeMode
                            ? "Vault received. Preparing merge…"
                            : "Vault received. Set up its local password and protection.",
                    );
                }
                if (
                    status.Step ===
                        LinkingProcessStep.DirectConnectionCleanup &&
                    status.State === LinkingProcessState.Completed &&
                    !completedRef.current
                ) {
                    if (failedRef.current) return;
                    completedRef.current = true;
                    controllerRef.current = null;
                    if (!receivedVaultRef.current) {
                        finishSessionTransition(attempt);
                        failedRef.current = true;
                        setStage("failed");
                        setError("No vault data received.");
                        setProgressState("transfer", "error");
                        setLinkFailure({
                            message: "No vault data received.",
                            technical:
                                "The private connection closed without a verified vault payload.",
                        });
                        appendLinkActivity("No vault data received.", "error");
                        return;
                    }
                    if (mergeMode) {
                        await finishWithMerge(attempt);
                    } else {
                        setStage("passphrase");
                    }
                }
            };

            const controllerResult = await LinkingProcessController.create(
                linkingBlob,
                usesOnlineServices,
                receiverSyncKeys,
                mnemonic.trim(),
                onStatusChange,
            );
            if (controllerResult.isErr()) {
                throw controllerResult.error;
            }
            if (attempt !== linkAttemptRef.current) {
                controllerResult.value.abortWaitingForDevice();
                finishSessionTransition(attempt);
                return;
            }
            controllerRef.current = controllerResult.value;
            setStatusMessage(
                "Keep the linking screen open on your sending device until the transfer finishes.",
            );
        } catch (e) {
            if (attempt !== linkAttemptRef.current) return;
            finishSessionTransition(attempt);
            setValidatingInvitation(false);
            setStatusMessage("");
            const message =
                e instanceof Error ? e.message : "Link receive failed.";
            setError(message);
            if (!invitationOpened) {
                setStage("input");
                return;
            }
            setStage("failed");
            setLinkProgress((current) => {
                const active = RECEIVE_PROGRESS.find(
                    ({ key }) => current[key] === "active",
                )?.key;
                return active ? { ...current, [active]: "error" } : current;
            });
            setLinkFailure({
                message,
                technical:
                    e instanceof Error ? `${e.name}: ${e.message}` : String(e),
            });
            appendLinkActivity(message, "error");
        }
    };

    const beginReceive = () => {
        setError("");
        if (hasUnsavedReceivedVault) {
            Alert.alert(
                "Restart live transfer?",
                "The received copy has not been saved. Restarting means this copy will be discarded.",
                [
                    { text: "Keep received copy", style: "cancel" },
                    {
                        text: "Discard and restart",
                        style: "destructive",
                        onPress: () => {
                            finishCurrentSessionTransition();
                            receivedVaultRef.current = null;
                            pendingLinkedSaveRef.current = null;
                            setHasUnsavedReceivedVault(false);
                            if (mergeMode) setStage("confirm-merge");
                            else void runLinking();
                        },
                    },
                ],
            );
            return;
        }
        void runLinking();
    };

    const abortWaiting = () => {
        if (hasUnsavedReceivedVault) {
            Alert.alert(
                "Discard received vault?",
                "This received copy has not been saved. Discarding means you will need to repeat the live transfer.",
                [
                    { text: "Keep setting up", style: "cancel" },
                    {
                        text: "Discard",
                        style: "destructive",
                        onPress: () => {
                            linkAttemptRef.current += 1;
                            receivedVaultRef.current = null;
                            setHasUnsavedReceivedVault(false);
                            controllerRef.current?.abortWaitingForDevice();
                            controllerRef.current = null;
                            setStage("input");
                            setStatusMessage("");
                            setError(
                                "Received copy discarded. No vault was saved on this device.",
                            );
                        },
                    },
                ],
            );
            return;
        }
        linkAttemptRef.current += 1;
        finishCurrentSessionTransition();
        controllerRef.current?.abortWaitingForDevice();
        controllerRef.current = null;
        setStage("input");
        setStatusMessage("");
        setError("Live transfer canceled. No vault was saved on this device.");
    };

    const useNewInvitation = () => {
        linkAttemptRef.current += 1;
        finishCurrentSessionTransition();
        controllerRef.current?.abortWaitingForDevice();
        controllerRef.current = null;
        receivedVaultRef.current = null;
        pendingLinkedSaveRef.current = null;
        setHasUnsavedReceivedVault(false);
        setInvitation(null);
        setMnemonic("");
        setMethod(null);
        setStage("input");
        setStatusMessage("");
        setError("");
        setLinkFailure(null);
        setLinkActivity([]);
        setLinkProgress({ ...INITIAL_PROGRESS });
    };

    const cameraActive =
        method === "scan" && permission?.granted && !cameraError && isFocused;

    const headerCopy =
        stage === "linking"
            ? {
                  title: "Link in progress.",
                  subtitle: "Keep Cryptex Vault open on both devices.",
              }
            : stage === "failed"
              ? {
                    title: "Let's try that again.",
                    subtitle: "The received vault has not been saved.",
                }
              : stage === "passphrase"
                ? {
                      title: "Protect this copy.",
                      subtitle: "Choose how this vault opens on this device.",
                  }
                : stage === "recovery"
                  ? {
                        title: "Keep your way back in.",
                        subtitle:
                            "Save these details before opening the vault.",
                    }
                  : stage === "done"
                    ? {
                          title: "Vault linked.",
                          subtitle: "The secure connection has finished.",
                      }
                    : {
                          title: "Make the connection.",
                          subtitle:
                              "Securely transfer a vault from a device you already use.",
                      };

    const progressItems: LinkProgressItem[] = RECEIVE_PROGRESS.map((item) => ({
        ...item,
        state: linkProgress[item.key],
    }));

    if (unlocked && stage === "input") {
        const resetInput = () => {
            setInvitation(null);
            setMethod(null);
            setPasteDraft("");
            setMnemonic("");
            setStatusMessage("");
            setError("");
        };
        const inputTitle = invitation
            ? "Review invitation"
            : "Receive invitation";
        return (
            <Screen
                scroll
                taskTitle={inputTitle}
                onTaskBack={() => {
                    if (method || invitation) resetInput();
                    else router.back();
                }}
                maxWidth="content"
                contentContainerClassName="px-[20px] pb-[28px] pt-0"
                style={{ paddingTop: 24 }}
            >
                {(!method || method === "paste") && !invitation ? (
                    <View>
                        <InvitationHeader title="Connect this vault">
                            Use an invitation from the device you want to link.
                        </InvitationHeader>
                        <UnlockedMenuRow
                            icon={QrCode}
                            title="Scan QR code"
                            subtitle="Use your camera"
                            onPress={() => void startScan()}
                        />
                        <UnlockedMenuRow
                            icon={FileText}
                            title="Open invitation file"
                            subtitle="Choose a Cryptex invitation"
                            onPress={() => void pickLinkFile()}
                        />
                        <UnlockedMenuRow
                            icon={Link2}
                            title="Paste invitation"
                            subtitle="Enter invitation text"
                            onPress={() => setMethod("paste")}
                        />
                        <View className="mt-5 border-l-2 border-muted pl-3">
                            <UnlockedText className="text-xs leading-5 text-muted-foreground">
                                Items received from another vault are merged
                                with this vault. Existing items are kept.
                            </UnlockedText>
                        </View>
                    </View>
                ) : null}

                {method === "scan" && !invitation ? (
                    <View className="gap-4">
                        <UnlockedText className="font-medium text-xl text-foreground">
                            Scan invitation
                        </UnlockedText>
                        <View className="aspect-square w-full overflow-hidden rounded-md border border-border bg-[#111520]">
                            {cameraActive ? (
                                <CameraView
                                    key={scanEpoch}
                                    ref={cameraRef}
                                    style={{ width: "100%", height: "100%" }}
                                    facing="back"
                                    barcodeScannerSettings={{
                                        barcodeTypes: ["qr"],
                                    }}
                                    onBarcodeScanned={onBarcodeScanned}
                                    onMountError={() =>
                                        setCameraError(
                                            "Could not start the camera. Choose a link file or pasted invitation instead.",
                                        )
                                    }
                                />
                            ) : (
                                <View className="flex-1 items-center justify-center">
                                    <QrCode size={56} color="#ff526b" />
                                </View>
                            )}
                        </View>
                        {!permission?.granted ? (
                            <InlineNotice
                                tone={permission ? "warning" : "loading"}
                                message={
                                    permission
                                        ? "Camera access is required to scan an invitation."
                                        : "Opening camera…"
                                }
                            />
                        ) : null}
                        {cameraError ? (
                            <InlineNotice tone="error" message={cameraError} />
                        ) : null}
                        {qrChunkProgress ? (
                            <InlineNotice
                                tone="loading"
                                message={`Collected ${qrChunkProgress.received} of ${qrChunkProgress.total} QR parts.`}
                            />
                        ) : null}
                        <UnlockedButton
                            variant="secondary"
                            onPress={resetInput}
                        >
                            Cancel
                        </UnlockedButton>
                    </View>
                ) : null}

                <Dialog
                    open={method === "paste" && !invitation && isFocused}
                    onOpenChange={(open) => {
                        if (!open) {
                            setMethod(null);
                            clearFieldError("paste");
                        }
                    }}
                    placement="bottom"
                    scroll
                >
                    <DialogHeader>
                        <DialogTitle>Paste invitation</DialogTitle>
                    </DialogHeader>
                    {method === "paste" && !invitation ? (
                        <View className="gap-4">
                            <UnlockedLabel>Invitation</UnlockedLabel>
                            <UnlockedInput
                                autoFocus
                                value={pasteDraft}
                                onChangeText={(value) => {
                                    setPasteDraft(value);
                                    clearFieldError("paste");
                                }}
                                invalid={!!fieldErrors.paste}
                                autoCapitalize="none"
                                autoCorrect={false}
                                placeholder="Paste invitation text"
                                multiline
                                numberOfLines={6}
                                textAlignVertical="top"
                                accessibilityLabel="Pasted invitation"
                                style={{ height: 140, paddingVertical: 12 }}
                            />
                            <VaultEntryFieldError message={fieldErrors.paste} />
                            <UnlockedButton onPress={usePastedInvitation}>
                                Review invitation
                            </UnlockedButton>
                        </View>
                    ) : null}
                </Dialog>

                {invitation ? (
                    <View className="gap-4">
                        <InvitationHeader
                            title={`Connect to ${invitation.label}`}
                        >
                            You will receive an encrypted vault and merge it
                            with this one.
                        </InvitationHeader>
                        <View className="min-h-[52px] flex-row items-center justify-between border-b border-border">
                            <UnlockedText className="text-sm text-muted-foreground">
                                Connection
                            </UnlockedText>
                            <UnlockedText className="text-sm text-foreground">
                                Encrypted invitation
                            </UnlockedText>
                        </View>
                        <View className="border-l-2 border-muted pl-3">
                            <UnlockedText className="text-xs leading-5 text-muted-foreground">
                                Existing items stay in this vault. New items
                                from the other vault will be added.
                            </UnlockedText>
                        </View>
                        <UnlockedLabel>Transfer phrase</UnlockedLabel>
                        <UnlockedInput
                            value={mnemonic}
                            onChangeText={(value) => {
                                setMnemonic(value.toLowerCase());
                                clearFieldError("mnemonic");
                            }}
                            invalid={!!fieldErrors.mnemonic}
                            autoCapitalize="none"
                            autoCorrect={false}
                            placeholder="Enter the phrase shown on the sending device"
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                            accessibilityLabel="Transfer phrase"
                            style={{ height: 112, paddingVertical: 12 }}
                        />
                        <VaultEntryFieldError message={fieldErrors.mnemonic} />
                        {error ? (
                            <InlineNotice tone="error" message={error} />
                        ) : null}
                        <UnlockedButton
                            loading={validatingInvitation}
                            onPress={beginReceive}
                        >
                            Connect &amp; merge
                        </UnlockedButton>
                        <UnlockedButton
                            variant="secondary"
                            onPress={resetInput}
                        >
                            Cancel
                        </UnlockedButton>
                    </View>
                ) : null}
            </Screen>
        );
    }

    return (
        <Screen
            scroll
            taskTitle={
                unlocked
                    ? method === "paste" && !invitation && stage === "input"
                        ? "Paste invitation"
                        : invitation || stage === "confirm-merge"
                          ? "Review invitation"
                          : "Receive invitation"
                    : undefined
            }
            onTaskBack={
                unlocked
                    ? () => {
                          if (stage === "confirm-merge") setStage("input");
                          else if (method === "paste") setMethod(null);
                          else router.back();
                      }
                    : undefined
            }
            maxWidth="content"
            contentContainerClassName={
                unlocked ? "px-[20px] pb-[28px] pt-[24px]" : "px-5 pb-8 pt-0"
            }
            edges={embedded ? ["top", "left", "right"] : undefined}
            style={vars({ "--primary-foreground": "224.21 28.36% 13.14%" })}
        >
            {!unlocked ? (
                <VaultEntryHeader
                    {...headerCopy}
                    showBack
                    onBack={() =>
                        embedded
                            ? router.replace("/(locked)/unlock" as never)
                            : router.back()
                    }
                />
            ) : null}
            {stage === "input" ? (
                <View>
                    <VaultEntrySteps
                        labels={["Invitation", "Authorize", "Protect"]}
                        current={invitation ? 1 : 0}
                    />
                    {mergeMode ? (
                        <InlineNotice
                            className="mb-4"
                            tone="info"
                            message="Vault is unlocked. Received data will merge into the active vault. Existing credentials keep their current values; missing IDs are added."
                        />
                    ) : (
                        <Text className="mb-[18px] text-xs leading-[18px] text-muted-foreground">
                            On your other device, open Cryptex Vault and start
                            linking. Then scan its invitation here.
                        </Text>
                    )}

                    {!invitation ? (
                        <View className="gap-2">
                            <View
                                style={{
                                    width: "100%",
                                    maxWidth: cameraActive ? undefined : 240,
                                    alignSelf: "center",
                                }}
                            >
                                <View
                                    className="bg-navigation relative w-full items-center justify-center overflow-hidden rounded-md border border-border"
                                    style={{ aspectRatio: 1 }}
                                >
                                    {cameraActive ? (
                                        <CameraView
                                            key={scanEpoch}
                                            ref={cameraRef}
                                            style={{
                                                width: "100%",
                                                height: "100%",
                                            }}
                                            facing="back"
                                            barcodeScannerSettings={{
                                                barcodeTypes: ["qr"],
                                            }}
                                            onBarcodeScanned={onBarcodeScanned}
                                            onMountError={() =>
                                                setCameraError(
                                                    "Could not start the camera. Try again or choose another linking method.",
                                                )
                                            }
                                        />
                                    ) : (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="Scan QR code"
                                            onPress={() => void startScan()}
                                            className="h-full w-full items-center justify-center gap-4 active:bg-secondary"
                                        >
                                            <Icon
                                                as={QrCode}
                                                size={56}
                                                className="text-primary"
                                            />
                                            <Text className="font-medium text-sm text-foreground">
                                                Tap to scan
                                            </Text>
                                        </Pressable>
                                    )}
                                </View>
                            </View>
                            {method === "scan" ? (
                                <>
                                    {!permission ? (
                                        <InlineNotice
                                            tone="loading"
                                            message="Opening camera…"
                                        />
                                    ) : !permission.granted ? (
                                        <InlineNotice
                                            tone="warning"
                                            message={
                                                permission.canAskAgain
                                                    ? "Camera access was not granted. Tap the scanner to try again, or use a link file or pasted data."
                                                    : "Camera access is blocked. Enable it in Android settings, or use a link file or pasted data."
                                            }
                                        />
                                    ) : null}
                                    {cameraError ? (
                                        <InlineNotice
                                            autoScroll
                                            tone="error"
                                            message={cameraError}
                                        />
                                    ) : null}
                                    {qrChunkProgress ? (
                                        <InlineNotice
                                            tone="loading"
                                            message={`Collected ${qrChunkProgress.received} of ${qrChunkProgress.total} QR parts. Keep the camera pointed at the sender's code.`}
                                        />
                                    ) : null}
                                </>
                            ) : null}
                            <View className="flex-row gap-2">
                                <Button
                                    variant="secondary"
                                    className="h-[52px] min-h-[52px] flex-1 rounded-md border border-border"
                                    textClassName="text-xs"
                                    onPress={() => void pickLinkFile()}
                                >
                                    <View className="flex-row items-center gap-2">
                                        <Icon
                                            as={FileText}
                                            size={18}
                                            className="text-foreground"
                                        />
                                        <Text className="font-semibold text-xs text-foreground">
                                            Choose link file
                                        </Text>
                                    </View>
                                </Button>
                                <Button
                                    variant="secondary"
                                    className="h-[52px] min-h-[52px] flex-1 rounded-md border border-border"
                                    textClassName="text-xs"
                                    onPress={() => setMethod("paste")}
                                >
                                    <View className="flex-row items-center gap-2">
                                        <Icon
                                            as={Link2}
                                            size={18}
                                            className="text-foreground"
                                        />
                                        <Text className="font-semibold text-xs text-foreground">
                                            Paste link data
                                        </Text>
                                    </View>
                                </Button>
                            </View>

                            <VaultEntryNotice className="mb-3 mt-5">
                                Keep the linking screen open on your sending
                                device until the transfer finishes.
                            </VaultEntryNotice>
                            <VaultEntryAssurance className="mt-2">
                                Encrypted from sender to receiver
                            </VaultEntryAssurance>
                        </View>
                    ) : null}

                    {invitation ? (
                        <View className="gap-3">
                            <InlineNotice
                                tone="success"
                                message={`Invitation ready: ${invitation.label}`}
                            />
                            <Button
                                variant="outline"
                                onPress={() => {
                                    setInvitation(null);
                                    setMethod(null);
                                    setStatusMessage("");
                                    setError("");
                                }}
                            >
                                Replace invitation
                            </Button>
                            <View>
                                <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                                    Linking phrase
                                </Label>
                                <Input
                                    ref={mnemonicRef}
                                    value={mnemonic}
                                    onChangeText={(value) => {
                                        setMnemonic(value);
                                        clearFieldError("mnemonic");
                                    }}
                                    invalid={!!fieldErrors.mnemonic}
                                    revealButtonHeight={54}
                                    secureTextEntry
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    placeholder="Twelve words from the sender"
                                    accessibilityLabel="Linking phrase"
                                    className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                                />
                                <VaultEntryFieldError
                                    message={fieldErrors.mnemonic}
                                />
                                <Text className="mt-1 text-xs text-muted-foreground">
                                    This phrase authorizes the live transfer. It
                                    is separate from vault recovery details.
                                </Text>
                            </View>
                        </View>
                    ) : null}

                    {statusMessage ? (
                        <InlineNotice tone="info" message={statusMessage} />
                    ) : null}
                    {error ? (
                        <View ref={generalErrorRef} collapsable={false}>
                            <InlineNotice
                                autoScroll
                                tone="error"
                                message={error}
                            />
                        </View>
                    ) : null}

                    {invitation ? (
                        <>
                            <VaultEntryAction
                                className="mt-3"
                                onPress={beginReceive}
                                loading={validatingInvitation}
                            >
                                {mergeMode
                                    ? "Continue to merge"
                                    : "Connect to sending device"}
                            </VaultEntryAction>
                            <Button
                                variant="ghost"
                                className="min-h-[44px]"
                                onPress={() =>
                                    embedded
                                        ? router.replace(
                                              "/(locked)/unlock" as never,
                                          )
                                        : router.back()
                                }
                            >
                                Cancel
                            </Button>
                        </>
                    ) : null}
                </View>
            ) : null}

            {stage === "confirm-merge" ? (
                <View className="gap-3">
                    <InlineNotice
                        tone="warning"
                        message="Merge into the unlocked vault? This adds missing credentials, directories, connectivity servers, and linked devices. Existing records with the same ID are kept (not overwritten)."
                    />
                    <VaultEntryAction onPress={() => void runLinking()}>
                        Confirm merge and start
                    </VaultEntryAction>
                    <Button
                        variant="ghost"
                        className="min-h-[44px]"
                        onPress={() => setStage("input")}
                    >
                        Back
                    </Button>
                </View>
            ) : null}

            {stage === "linking" || stage === "failed" ? (
                <LinkingProgress
                    items={progressItems}
                    status={statusMessage || "Linking in progress…"}
                    activity={linkActivity}
                    failure={linkFailure}
                    onCancel={abortWaiting}
                    onRetry={() => {
                        if (mergeMode && receivedVaultRef.current) {
                            const attempt = linkAttemptRef.current;
                            beginSessionTransition(attempt);
                            void finishWithMerge(attempt);
                        } else {
                            void runLinking();
                        }
                    }}
                    onUseNewInvitation={useNewInvitation}
                />
            ) : null}

            {stage === "passphrase" ? (
                <View className="gap-3">
                    <VaultEntrySteps
                        labels={["Invitation", "Authorize", "Protect"]}
                        current={2}
                    />
                    <LinkActivityLog activity={linkActivity} />
                    <Text className="text-sm text-muted-foreground">
                        Create a master password for this local copy. It can
                        differ from the password on the sending device.
                    </Text>
                    <View>
                        <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                            Vault name
                        </Label>
                        <Input
                            ref={vaultNameRef}
                            value={vaultName}
                            onChangeText={(value) => {
                                setVaultName(value);
                                clearFieldError("vaultName");
                            }}
                            invalid={!!fieldErrors.vaultName}
                            placeholder="Linked vault"
                            autoCapitalize="words"
                            accessibilityLabel="Linked vault name"
                            className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                        />
                        <VaultEntryFieldError message={fieldErrors.vaultName} />
                    </View>
                    <View>
                        <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                            Master password
                        </Label>
                        <Input
                            ref={passwordRef}
                            value={password}
                            onChangeText={(value) => {
                                setPassword(value);
                                clearFieldError("password");
                                clearFieldError("confirm");
                            }}
                            invalid={!!fieldErrors.password}
                            revealButtonHeight={54}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            textContentType="newPassword"
                            placeholder="Master password"
                            accessibilityLabel="Master password"
                            className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                        />
                        <VaultEntryFieldError message={fieldErrors.password} />
                        <PasswordStrengthMeter password={password} compact />
                    </View>
                    <View>
                        <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                            Confirm password
                        </Label>
                        <Input
                            ref={confirmRef}
                            value={confirm}
                            onChangeText={(value) => {
                                setConfirm(value);
                                clearFieldError("confirm");
                            }}
                            invalid={!!fieldErrors.confirm}
                            revealButtonHeight={54}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            placeholder="Confirm password"
                            accessibilityLabel="Confirm master password"
                            className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                        />
                        <VaultEntryFieldError message={fieldErrors.confirm} />
                    </View>
                    <AdditionalKeyProtectionOptions
                        value={additionalKeyProtectionChoice}
                        disabled={saving}
                        onChange={(choice) =>
                            setAdditionalKeyProtectionChoice(choice)
                        }
                    />
                    {error ? (
                        <View ref={generalErrorRef} collapsable={false}>
                            <InlineNotice
                                autoScroll
                                tone="error"
                                message={error}
                            />
                        </View>
                    ) : null}
                    <VaultEntryAction
                        loading={saving}
                        onPress={() => void sealLinkedVault()}
                    >
                        Continue
                    </VaultEntryAction>
                </View>
            ) : null}

            <Dialog
                open={
                    method === "paste" &&
                    stage === "input" &&
                    !invitation &&
                    isFocused
                }
                onOpenChange={(open) => {
                    if (!open) {
                        setMethod(null);
                        clearFieldError("paste");
                    }
                }}
                placement="bottom"
                scroll
            >
                <DialogHeader>
                    <DialogTitle>Paste link data</DialogTitle>
                    <DialogDescription>
                        Paste the invitation from your sending device.
                    </DialogDescription>
                </DialogHeader>
                <Label>Link data</Label>
                <Input
                    ref={pasteRef}
                    value={pasteDraft}
                    onChangeText={(value) => {
                        setPasteDraft(value);
                        clearFieldError("paste");
                    }}
                    invalid={!!fieldErrors.paste}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Paste link data"
                    multiline
                    numberOfLines={4}
                    scrollEnabled
                    textAlignVertical="top"
                    accessibilityLabel="Pasted link data"
                    style={{
                        height: 112,
                        maxHeight: 112,
                        lineHeight: 22,
                        paddingVertical: 12,
                    }}
                    className="rounded-md border-border bg-transparent px-3.5"
                />
                <VaultEntryFieldError message={fieldErrors.paste} />
                <DialogFooter>
                    <VaultEntryAction
                        showArrow={false}
                        onPress={usePastedInvitation}
                    >
                        Use pasted data
                    </VaultEntryAction>
                    <Button
                        variant="ghost"
                        onPress={() => {
                            setMethod(null);
                            clearFieldError("paste");
                        }}
                    >
                        Cancel
                    </Button>
                </DialogFooter>
            </Dialog>
            {stage === "recovery" ? (
                <Dialog
                    open
                    onOpenChange={() => {}}
                    placement="bottom"
                    dismissible={false}
                    scroll
                    fullHeight
                >
                    <DialogHeader>
                        <DialogTitle>Keep your way back in</DialogTitle>
                        <DialogDescription>
                            Store these offline before opening the linked vault.
                        </DialogDescription>
                    </DialogHeader>
                    <VaultEntrySteps
                        labels={["Invitation", "Protect", "Save recovery"]}
                        current={2}
                    />
                    <InlineNotice
                        tone="warning"
                        message="This is the recovery material for the new local vault. Recovery details from the sending device do not transfer."
                    />
                    {recoveryCode ? (
                        <SecretReveal
                            label="Recovery code"
                            value={recoveryCode}
                            helper="Store this offline. It can recover this local vault if you forget its master password."
                            requireAck
                            defaultRevealed
                            ackLabel="I have written down the recovery code"
                            acknowledged={recoveryAck}
                            onAcknowledgedChange={setRecoveryAck}
                        />
                    ) : null}
                    {protectionPhrase ? (
                        <SecretReveal
                            label="Generated protection phrase"
                            value={protectionPhrase}
                            helper="Store this separately. You will need it with the master password after restoring on a new device."
                            requireAck
                            defaultRevealed
                            ackLabel="I have written down the protection phrase"
                            acknowledged={additionalKeyProtectionAck}
                            onAcknowledgedChange={setAdditionalKeyProtectionAck}
                        />
                    ) : null}
                    {saveWarning ? (
                        <InlineNotice tone="warning" message={saveWarning} />
                    ) : null}
                    {error ? (
                        <View ref={generalErrorRef} collapsable={false}>
                            <InlineNotice
                                autoScroll
                                tone="error"
                                message={error}
                            />
                        </View>
                    ) : null}
                    <DialogFooter>
                        <VaultEntryAction
                            loading={saving}
                            disabled={
                                !recoveryAck ||
                                (protectionPhrase != null &&
                                    !additionalKeyProtectionAck)
                            }
                            onPress={() => void finishLinkedVault()}
                        >
                            Save and open vault
                        </VaultEntryAction>
                    </DialogFooter>
                </Dialog>
            ) : null}

            {stage === "done" ? (
                <View className="gap-3">
                    <InlineNotice
                        tone="success"
                        message={statusMessage || "Done."}
                    />
                    {mergeSummary ? (
                        <Text className="text-sm text-muted-foreground">
                            Added {mergeSummary.credentialsAdded} credentials,
                            skipped {mergeSummary.credentialsSkipped}, linked{" "}
                            {mergeSummary.devicesAdded} devices.
                        </Text>
                    ) : null}
                    <VaultEntryAction
                        onPress={() =>
                            mergeMode
                                ? router.dismissTo("/(app)/(tabs)/devices")
                                : router.replace("/(app)/(tabs)/vault")
                        }
                    >
                        {mergeMode ? "Back to Devices" : "Open vault"}
                    </VaultEntryAction>
                </View>
            ) : null}

            <Dialog
                placement="bottom"
                open={osOverwriteOpen}
                onOpenChange={(open) => {
                    if (!open && osOverwriteResolverRef.current) {
                        osOverwriteResolverRef.current(false);
                        osOverwriteResolverRef.current = null;
                    }
                    setOsOverwriteOpen(open);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Overwrite Online Services?</DialogTitle>
                        <DialogDescription>
                            {pendingOsOverwrite &&
                            Vault.isOnlineServicesBound(unlockedVault) &&
                            pendingOsOverwrite.UserID ===
                                unlockedVault.OnlineServices.UserID
                                ? "This invitation uses a different Online Services device identity for the same account. Continuing replaces the identity saved in this vault; existing Online Services device links may need to be linked again."
                                : `This link contains Online Services credentials for a different user${pendingOsOverwrite ? ` (${pendingOsOverwrite.UserID})` : ""}. Continuing replaces the Online Services identity saved in this vault, and existing Online Services device links may need to be linked again.`}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            className="h-[54px] min-h-[54px]"
                            variant="ghost"
                            onPress={() => {
                                osOverwriteResolverRef.current?.(false);
                                osOverwriteResolverRef.current = null;
                                setOsOverwriteOpen(false);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            className="h-[54px] min-h-[54px]"
                            variant="destructive"
                            onPress={() => {
                                osOverwriteResolverRef.current?.(true);
                                osOverwriteResolverRef.current = null;
                                setOsOverwriteOpen(false);
                            }}
                        >
                            Overwrite
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Screen>
    );
}

export function LinkReceiveScreen({ embedded = false }: { embedded?: boolean }) {
    const isFocused = useIsFocused();
    useVaultScreenPrivacy(true, "cryptex-link-receive");
    const unlocked = useAtomValue(isVaultUnlockedAtom);
    const lockState = useAtomValue(vaultLockStateAtom);
    const { onInteraction, resumeAfterFailedLock } = useAutoLock(isFocused);
    return (
        <View
            style={{ flex: 1 }}
            onStartShouldSetResponderCapture={() => {
                onInteraction();
                return false;
            }}
        >
            {unlocked && lockState !== "idle" ? (
                <VaultLockScreen onContinueEditing={resumeAfterFailedLock} />
            ) : (
                <LinkReceiveContent embedded={embedded} />
            )}
        </View>
    );
}

export default LinkReceiveScreen;
