import { vars } from "nativewind";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type RefObject,
} from "react";
import { AppState, Pressable, View, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";

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
import { deleteOnlineServicesAccount } from "@/app_lib/online-services-account";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { LINK_FILE_EXTENSION } from "@cryptex-industries/vault-core/consts";
import { base64ToUint8 } from "@cryptex-industries/vault-core/encoding";
import { readPickedImportFile } from "@/utils/mobile-import-picker";
import { ensureSecretTempFilesReady } from "@/utils/secret-temp-files";
import {
    clearOnlineServicesSession,
    isVaultUnlockedAtom,
    onlineServicesDataAtom,
    onlineServicesStore,
    setOnlineServicesData,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
} from "@/utils/atoms";
import { setVaultDEKInSessionForMetadata } from "@/utils/vault-session";
import { persistVaultMutation } from "@/utils/vault-mutations";
import {
    createLinkedVaultEnvelope,
    type LinkedVaultEnvelopeResult,
} from "@/utils/linked-vault-envelope";
import {
    ensureActiveVaultSyncKeyMaterial,
    mergeReceivedVaultIntoActive,
    receiverSyncKeyMaterial,
} from "@/utils/link-merge";
import { decodeReceivedVault } from "@/utils/received-vault";
import { linkingLogText } from "@/utils/linking-messages";
import { onlineServicesLog } from "@/utils/logging";
import { Screen } from "@/components/screen";
import {
    UnlockedButton,
    UnlockedInput,
    UnlockedLabel,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { InlineNotice } from "@/components/inline-notice";
import { InvitationHeader } from "@/components/invitation-header";
import { LinkResult } from "@/components/link-result";
import { Snackbar, useSnackbar } from "@/components/snackbar";
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

type ConfirmRequest = {
    title: string;
    description: string;
    cancelLabel: string;
    confirmLabel?: string;
    onConfirm?: () => void;
};

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

type OsOverwriteChoice = "cancel" | "keep" | "delete";

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
    title: MessageDescriptor;
    detail: MessageDescriptor;
}> = [
    {
        key: "invitation",
        title: msg`Open the invitation`,
        detail: msg`Decrypting and validating the invitation.`,
    },
    {
        key: "keys",
        title: msg`Prepare this device`,
        detail: msg`Preparing local signing and post-quantum keys.`,
    },
    {
        key: "signaling",
        title: msg`Find the sending device`,
        detail: msg`Keep the linking screen open on your sending device until the transfer finishes.`,
    },
    {
        key: "connection",
        title: msg`Open a private connection`,
        detail: msg`Negotiating the direct WebRTC connection.`,
    },
    {
        key: "authentication",
        title: msg`Authenticate key exchange`,
        detail: msg`Verifying the sender and exchanging sync keys.`,
    },
    {
        key: "transfer",
        title: msg`Receive and verify your vault`,
        detail: msg`Receiving, authenticating, and decrypting the transfer.`,
    },
    {
        key: "cleanup",
        title: msg`Finish the connection`,
        detail: msg`Closing the private connection before local setup.`,
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

function LinkReceiveContent({ embedded = false }: { embedded?: boolean }) {
    const { t } = useLingui();
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
    const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
        null,
    );
    const {
        feedback: snackbar,
        show: notify,
        dismiss: dismissSnackbar,
    } = useSnackbar("link-receive", unlocked);
    const insets = useSafeAreaInsets();
    // Inside the unlocked app, problems are reported in a snackbar instead of
    // an inline notice; the locked flow keeps its inline messages.
    useEffect(() => {
        if (!unlocked || !error) return;
        notify(error);
        setError("");
    }, [unlocked, error, notify]);
    const [fieldErrors, setFieldErrors] = useState({
        paste: "",
        mnemonic: "",
        vaultName: "",
        password: "",
        confirm: "",
    });
    const [cameraError, setCameraError] = useState("");
    const [vaultName, setVaultName] = useState(() => t`Linked vault`);
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
    const [osOverwriteCanDelete, setOsOverwriteCanDelete] = useState(false);
    const [linkProgress, setLinkProgress] = useState(INITIAL_PROGRESS);
    const [linkActivity, setLinkActivity] = useState<LinkActivityEntry[]>([]);
    const [linkDeadline, setLinkDeadline] = useState<number | null>(null);
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
    const osOverwriteResolverRef = useRef<
        ((choice: OsOverwriteChoice) => void) | null
    >(null);
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
                setConfirmRequest({
                    title: t`Finish saving your vault`,
                    description: t`Save the recovery details before leaving this screen.`,
                    cancelLabel: t`Continue setup`,
                });
                return;
            }
            setConfirmRequest({
                title: t`Discard received vault?`,
                description: t`This received copy has not been saved. Leaving means you will need to repeat the live transfer. The sending vault is not changed.`,
                cancelLabel: t`Keep setting up`,
                confirmLabel: t`Discard`,
                onConfirm: () => {
                    receivedVaultRef.current = null;
                    pendingLinkedSaveRef.current = null;
                    setHasUnsavedReceivedVault(false);
                    requestAnimationFrame(() =>
                        navigation.dispatch(data.action),
                    );
                },
            });
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
                osOverwriteResolverRef.current("cancel");
                osOverwriteResolverRef.current = null;
            }
        };
    }, [mergeMode]);

    useEffect(() => {
        const subscription = AppState.addEventListener("change", (state) => {
            if (
                !shouldCancelReceiveLinkOnBackground(
                    state,
                    validatingInvitation,
                    controllerRef.current !== null,
                )
            )
                return;
            linkAttemptRef.current += 1;
            controllerRef.current?.abortWaitingForDevice();
            controllerRef.current = null;
            receivedVaultRef.current = null;
            setHasUnsavedReceivedVault(false);
            finishCurrentSessionTransition();
            failedRef.current = true;
            setValidatingInvitation(false);
            setStage("failed");
            setError(
                t`Live transfer stopped while the app was in the background. Start again.`,
            );
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
            onInvalid(t`This is not a valid Cryptex Vault link invitation.`);
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
            if (result.canceled || !result.assets?.[0]) {
                setMethod(null);
                return;
            }
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
            } else {
                setMethod(null);
            }
        } catch {
            setError(t`Could not read this link file.`);
            setMethod(null);
        }
    };

    const startScan = async (clearErrors = true) => {
        cancelScan();
        setScanEpoch((epoch) => epoch + 1);
        scanSessionRef.current = createQrScanSession(
            setQrChunkProgress,
            (base64) => {
                if (!navigation.isFocused()) return;
                if (
                    !acceptInvitation(
                        { source: "scan", base64, label: t`Scanned QR code` },
                        setCameraError,
                    )
                )
                    return;
                setCameraError("");
                setStatusMessage("");
                setMethod(null);
            },
        );
        if (clearErrors) {
            setError("");
            setCameraError("");
        }
        setMethod("scan");
        if (!permission?.granted && permission?.canAskAgain !== false) {
            await requestPermission();
        }
    };

    // An unlocked vault opens straight into the scanner; file and paste are
    // the fallbacks. Coming back from either one restarts the camera.
    useEffect(() => {
        if (!unlocked || stage !== "input" || invitation || method !== null)
            return;
        if (!isFocused) return;
        void startScan(false);
        // startScan is recreated every render; the guards above decide when to run.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unlocked, stage, invitation, method, isFocused]);

    const usePastedInvitation = () => {
        const base64 = pasteDraft.trim();
        if (!base64) {
            setFieldError(
                "paste",
                t`Paste the invitation data from the sending device.`,
                pasteRef,
            );
            return;
        }
        if (
            !acceptInvitation(
                {
                    source: "paste",
                    base64,
                    label: t`Pasted link data`,
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
            throw new Error(t`Choose a link invitation.`);
        }
        if (invitation.source === "file") {
            return LinkingPackage.fromBinary(invitation.bytes);
        }
        const parsed = LinkingPackage.fromBase64(invitation.base64);
        if (parsed.isErr()) {
            throw new Error(t`Invalid link package data.`);
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
        const log = status.LogMessage;
        const details = log?.details;
        if (details?.type === "connection_state") {
            const message = log ? linkingLogText(log) : t`Connection error`;
            const state = details.state;
            return t`${message}\nConnection state: ${state}`;
        }
        if (details?.type === "vault" || details?.type === "webrtc") {
            return `${log ? linkingLogText(log) : t`Linking error`}\n${details.error.name}: ${details.error.message}`;
        }
        return log
            ? linkingLogText(log)
            : t`The linking process reported an error.`;
    };

    const confirmOsOverwrite = (incoming: OnlineServices, canDelete: boolean) =>
        new Promise<OsOverwriteChoice>((resolve) => {
            osOverwriteResolverRef.current = resolve;
            setPendingOsOverwrite(incoming);
            setOsOverwriteCanDelete(canDelete);
            setOsOverwriteOpen(true);
        });

    const chooseOsOverwrite = (choice: OsOverwriteChoice) => {
        osOverwriteResolverRef.current?.(choice);
        osOverwriteResolverRef.current = null;
        setOsOverwriteOpen(false);
    };

    const osOverwriteSameAccount =
        pendingOsOverwrite != null &&
        Vault.isOnlineServicesBound(unlockedVault) &&
        pendingOsOverwrite.UserID === unlockedVault.OnlineServices.UserID;

    const sealLinkedVault = async () => {
        if (sealInFlightRef.current) return;
        setError("");
        const rawVaultBinary = receivedVaultRef.current;
        if (!rawVaultBinary) {
            setError(t`No vault data to save.`);
            return;
        }
        const next = {
            vaultName: vaultName.trim()
                ? ""
                : t`Enter a name for this linked vault.`,
            password: password
                ? ""
                : t`Enter a master password for this device.`,
            confirm: !confirm
                ? t`Confirm your master password.`
                : password === confirm
                  ? ""
                  : t`Enter the same password again.`,
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
            const vault = decodeReceivedVault(rawVaultBinary);

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
                throw new Error(t`Could not verify the new local vault.`);
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
                e instanceof Error
                    ? e.message
                    : t`Failed to save linked vault.`,
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
                    t`The vault is encrypted and saved, but this device could not cache its protection phrase. Keep the phrase available and tap Save and open vault to try again.`,
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
                    : t`Failed to save linked vault.`,
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
            setError(t`No vault data received.`);
            setLinkProgress((current) => ({ ...current, transfer: "error" }));
            setLinkFailure({
                message: t`No vault data received.`,
                technical: t`Vault transfer completed without usable vault data or sender key material.`,
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
            const { credentialsAdded, devicesAdded, credentialsSkipped } =
                summary;
            setStatusMessage(
                t`Merged ${plural(credentialsAdded, { one: "# credential", other: "# credentials" })} and ${plural(devicesAdded, { one: "# device", other: "# devices" })}. Skipped ${credentialsSkipped} existing.`,
            );
        } catch (e) {
            finishSessionTransition(attempt);
            setStage("failed");
            const message =
                e instanceof Error
                    ? e.message
                    : t`Failed to merge linked vault.`;
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
                t`Enter all twelve verification words from the sending device.`,
                mnemonicRef,
            );
            return;
        }
        if (!invitation) {
            setError(
                t`Scan a QR code, paste link data, or choose a link file.`,
            );
            return;
        }

        setValidatingInvitation(true);
        let invitationOpened = false;
        let wrongWords = false;
        setStatusMessage(t`Checking verification words…`);
        linkStartedAtRef.current = Date.now();
        setLinkDeadline(null);
        linkActivityIdRef.current = 0;
        setLinkActivity([]);
        setLinkFailure(null);
        setLinkProgress({
            ...INITIAL_PROGRESS,
            invitation: "active",
        });
        appendLinkActivity(t`Opening and validating the encrypted invitation.`);
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
                wrongWords = true;
                throw new Error(
                    t`Wrong verification words or corrupt invitation.`,
                );
            }
            invitationOpened = true;
            setValidatingInvitation(false);
            setStage("linking");
            setProgressState("invitation", "completed");
            setProgressState("keys", "active");
            appendLinkActivity(
                t`Invitation opened. Preparing this device's keys.`,
            );
            const linkingBlob = decrypted.value;
            if (
                !linkingBlob.SenderKeyBundle?.SyncSigningPublicKey ||
                !linkingBlob.SenderKeyBundle.SyncKemPublicKey
            ) {
                throw new Error(t`Link package missing sync key material.`);
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
                    const otherAccount =
                        unlockedVault.OnlineServices.UserID !==
                        incomingOs.UserID;
                    const choice = await confirmOsOverwrite(
                        incomingOs,
                        otherAccount &&
                            (onlineServicesStore.get(onlineServicesDataAtom)
                                ?.remoteData?.root ??
                                unlockedVault.OnlineServices.IsRootDevice),
                    );
                    if (attempt !== linkAttemptRef.current) return;
                    if (choice === "cancel") {
                        finishSessionTransition(attempt);
                        setStage("input");
                        setStatusMessage("");
                        setError(t`Linking cancelled.`);
                        return;
                    }
                    if (choice === "delete") {
                        setStatusMessage(t`Deleting this device's account…`);
                        // Refresh is paused during the link, and the session may
                        // have expired while the prompt was open.
                        await establishOnlineServicesSession({
                            deviceId: unlockedVault.OnlineServices.DeviceId,
                            privateKeyJWK:
                                unlockedVault.OnlineServices.PrivateKeyJWK,
                        });
                        if (attempt !== linkAttemptRef.current) return;
                        await deleteOnlineServicesAccount(
                            unlockedVault.OnlineServices.PrivateKeyJWK,
                        );
                        if (attempt !== linkAttemptRef.current) return;
                        const unbound = await persistVaultMutation(
                            "vault.account",
                            (currentVault) => {
                                const next = Object.assign(
                                    new Vault(),
                                    currentVault,
                                );
                                Vault.unbindOnlineServices(next);
                                return { vault: next, result: undefined };
                            },
                        );
                        if (unbound.isErr()) {
                            throw new Error(
                                t`The account was deleted, but this vault could not be updated. Try linking again.`,
                            );
                        }
                        appendLinkActivity(t`Deleted this device's account.`);
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
                setStatusMessage(t`Online Services authenticated. Connecting…`);
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
                t`Local signing and post-quantum keys are ready.`,
            );

            const onStatusChange = async (status: LinkingProcessStatus) => {
                if (attempt !== linkAttemptRef.current || failedRef.current)
                    return;
                if (status.Deadline !== undefined)
                    setLinkDeadline(status.Deadline);
                if (status.LogMessage?.message) {
                    const message = linkingLogText(status.LogMessage);
                    setStatusMessage(message);
                    appendLinkActivity(
                        message,
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
                    const message = t`The live transfer stopped. Keep the linking screen open on your sending device and try again.`;
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
                            ? t`Vault received. Preparing merge…`
                            : t`Vault received. Set up its local password and protection.`,
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
                        setError(t`No vault data received.`);
                        setProgressState("transfer", "error");
                        setLinkFailure({
                            message: t`No vault data received.`,
                            technical: t`The private connection closed without a verified vault payload.`,
                        });
                        appendLinkActivity(t`No vault data received.`, "error");
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
                t`Keep the linking screen open on your sending device until the transfer finishes.`,
            );
        } catch (e) {
            if (attempt !== linkAttemptRef.current) return;
            finishSessionTransition(attempt);
            setValidatingInvitation(false);
            setStatusMessage("");
            const message =
                e instanceof Error ? e.message : t`Link receive failed.`;
            if (wrongWords) {
                // The user fixes this in the field, so report it there.
                setStage("input");
                setFieldError("mnemonic", message, mnemonicRef);
                return;
            }
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
            setConfirmRequest({
                title: t`Restart live transfer?`,
                description: t`The received copy has not been saved. Restarting means this copy will be discarded.`,
                cancelLabel: t`Keep received copy`,
                confirmLabel: t`Discard and restart`,
                onConfirm: () => {
                    finishCurrentSessionTransition();
                    receivedVaultRef.current = null;
                    pendingLinkedSaveRef.current = null;
                    setHasUnsavedReceivedVault(false);
                    if (mergeMode) setStage("confirm-merge");
                    else void runLinking();
                },
            });
            return;
        }
        void runLinking();
    };

    const abortWaiting = () => {
        if (hasUnsavedReceivedVault) {
            setConfirmRequest({
                title: t`Discard received vault?`,
                description: t`This received copy has not been saved. Discarding means you will need to repeat the live transfer.`,
                cancelLabel: t`Keep setting up`,
                confirmLabel: t`Discard`,
                onConfirm: () => {
                    linkAttemptRef.current += 1;
                    receivedVaultRef.current = null;
                    setHasUnsavedReceivedVault(false);
                    controllerRef.current?.abortWaitingForDevice();
                    controllerRef.current = null;
                    setStage("input");
                    setStatusMessage("");
                    setError(
                        t`Received copy discarded. No vault was saved on this device.`,
                    );
                },
            });
            return;
        }
        linkAttemptRef.current += 1;
        finishCurrentSessionTransition();
        controllerRef.current?.abortWaitingForDevice();
        controllerRef.current = null;
        setStage("input");
        setStatusMessage("");
        setError(
            t`Live transfer cancelled. No vault was saved on this device.`,
        );
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
    const qrReceived = qrChunkProgress?.received ?? 0;
    const qrTotal = qrChunkProgress?.total ?? 0;
    const invitationLabel = invitation?.label ?? "";
    const credentialsAdded = mergeSummary?.credentialsAdded ?? 0;
    const credentialsSkipped = mergeSummary?.credentialsSkipped ?? 0;
    const devicesAdded = mergeSummary?.devicesAdded ?? 0;
    const linkSteps = [
        t({ message: "Invitation", comment: "Link receive step" }),
        t({ message: "Authorize", comment: "Link receive step" }),
        t({ message: "Protect", comment: "Link receive step" }),
    ];

    const headerCopy =
        stage === "linking"
            ? {
                  title: t`Link in progress.`,
                  subtitle: t`Keep Cryptex Vault open on both devices.`,
              }
            : stage === "failed"
              ? {
                    title: t`Let's try that again.`,
                    subtitle: t`The received vault has not been saved.`,
                }
              : stage === "passphrase"
                ? {
                      title: t`Protect this copy.`,
                      subtitle: t`Choose how this vault opens on this device.`,
                  }
                : stage === "recovery"
                  ? {
                        title: t`Keep your way back in.`,
                        subtitle: t`Save these details before opening the vault.`,
                    }
                  : stage === "done"
                    ? {
                          title: t`Vault linked.`,
                          subtitle: t`The secure connection has finished.`,
                      }
                    : {
                          title: t`Make the connection.`,
                          subtitle: t`Securely transfer a vault from a device you already use.`,
                      };

    const progressItems: LinkProgressItem[] = RECEIVE_PROGRESS.map((item) => ({
        key: item.key,
        title: t(item.title),
        detail: t(item.detail),
        state: linkProgress[item.key],
    }));

    const confirmDialog = (
        <Dialog
            placement="bottom"
            open={confirmRequest != null}
            onOpenChange={(open) => {
                if (!open) setConfirmRequest(null);
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{confirmRequest?.title}</DialogTitle>
                    <DialogDescription>
                        {confirmRequest?.description}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        className="h-[54px] min-h-[54px]"
                        variant={
                            confirmRequest?.confirmLabel ? "ghost" : "secondary"
                        }
                        onPress={() => setConfirmRequest(null)}
                    >
                        {confirmRequest?.cancelLabel}
                    </Button>
                    {confirmRequest?.confirmLabel ? (
                        <Button
                            className="h-[54px] min-h-[54px]"
                            variant="destructive"
                            onPress={() => {
                                const request = confirmRequest;
                                setConfirmRequest(null);
                                request.onConfirm?.();
                            }}
                        >
                            {confirmRequest.confirmLabel}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );

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
            ? t`Review invitation`
            : t`Receive invitation`;
        return (
            <View style={{ flex: 1 }}>
                <Screen
                    scroll
                    taskTitle={inputTitle}
                    onTaskBack={() => {
                        if (invitation) resetInput();
                        else router.back();
                    }}
                    maxWidth="content"
                    contentContainerClassName="px-[20px] pb-[28px] pt-0"
                    style={{ paddingTop: 24 }}
                >
                    {!invitation ? (
                        <View className="gap-4">
                            <InvitationHeader title={t`Scan the invitation`}>
                                {t`On your other device, choose Create invitation and point this camera at its QR code. Items received are merged with this vault; existing items are kept.`}
                            </InvitationHeader>
                            <View className="aspect-square w-full overflow-hidden rounded-md border border-border bg-[#111520]">
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
                                                t`Could not start the camera. Open an invitation file or paste the invitation instead.`,
                                            )
                                        }
                                    />
                                ) : (
                                    <View className="flex-1 items-center justify-center">
                                        <QrCode size={56} color="#ff526b" />
                                    </View>
                                )}
                            </View>
                            {method === "scan" && !permission?.granted ? (
                                <InlineNotice
                                    tone={permission ? "warning" : "loading"}
                                    message={
                                        permission
                                            ? t`Camera access is off. Open an invitation file or paste the invitation instead.`
                                            : t`Opening camera…`
                                    }
                                />
                            ) : null}
                            {cameraError ? (
                                <InlineNotice
                                    tone="error"
                                    message={cameraError}
                                />
                            ) : null}
                            {qrChunkProgress ? (
                                <InlineNotice
                                    tone="loading"
                                    message={t`Collected ${qrReceived} of ${qrTotal} QR parts.`}
                                />
                            ) : null}
                            <View className="flex-row gap-3">
                                <UnlockedButton
                                    className="flex-1"
                                    variant="outline"
                                    onPress={() => void pickLinkFile()}
                                >
                                    {t`Open file`}
                                </UnlockedButton>
                                <UnlockedButton
                                    className="flex-1"
                                    variant="outline"
                                    onPress={() => setMethod("paste")}
                                >
                                    {t({
                                        message: "Paste",
                                        comment:
                                            "Button: paste the invitation text",
                                    })}
                                </UnlockedButton>
                            </View>
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
                            <DialogTitle>{t`Paste invitation`}</DialogTitle>
                        </DialogHeader>
                        {method === "paste" && !invitation ? (
                            <View className="gap-4">
                                <UnlockedLabel>{t`Invitation`}</UnlockedLabel>
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
                                    placeholder={t`Paste invitation text`}
                                    multiline
                                    numberOfLines={6}
                                    textAlignVertical="top"
                                    accessibilityLabel={t`Pasted invitation`}
                                    style={{ height: 140, paddingVertical: 12 }}
                                />
                                <VaultEntryFieldError
                                    message={fieldErrors.paste}
                                />
                                <UnlockedButton onPress={usePastedInvitation}>
                                    {t`Review invitation`}
                                </UnlockedButton>
                            </View>
                        ) : null}
                    </Dialog>

                    {invitation ? (
                        <View className="gap-4">
                            <InvitationHeader
                                title={t`Connect to ${invitationLabel}`}
                            >
                                {t`You will receive an encrypted vault and merge it with this one.`}
                            </InvitationHeader>
                            <View className="min-h-[52px] flex-row items-center justify-between border-b border-border">
                                <UnlockedText className="text-sm text-muted-foreground">
                                    {t({
                                        message: "Connection",
                                        comment:
                                            "Row label; the value is the connection type",
                                    })}
                                </UnlockedText>
                                <UnlockedText className="text-sm text-foreground">
                                    {t`Encrypted invitation`}
                                </UnlockedText>
                            </View>
                            <View className="border-l-2 border-muted pl-3">
                                <UnlockedText className="text-xs leading-5 text-muted-foreground">
                                    {t`Existing items stay in this vault. New items from the other vault will be added.`}
                                </UnlockedText>
                            </View>
                            <UnlockedLabel>{t`Verification words`}</UnlockedLabel>
                            <UnlockedInput
                                value={mnemonic}
                                onChangeText={(value) => {
                                    setMnemonic(value.toLowerCase());
                                    clearFieldError("mnemonic");
                                }}
                                invalid={!!fieldErrors.mnemonic}
                                autoCapitalize="none"
                                autoCorrect={false}
                                placeholder={t`Enter the words shown on the sending device`}
                                multiline
                                numberOfLines={4}
                                textAlignVertical="top"
                                accessibilityLabel={t`Verification words`}
                                style={{ height: 112, paddingVertical: 12 }}
                            />
                            <VaultEntryFieldError
                                message={fieldErrors.mnemonic}
                            />
                            <UnlockedButton
                                loading={validatingInvitation}
                                onPress={beginReceive}
                            >
                                {t`Connect & merge`}
                            </UnlockedButton>
                            <UnlockedButton
                                variant="secondary"
                                onPress={resetInput}
                            >
                                {t`Cancel`}
                            </UnlockedButton>
                        </View>
                    ) : null}
                </Screen>
                {confirmDialog}
                <Snackbar
                    feedback={snackbar}
                    onDismiss={dismissSnackbar}
                    bottomOffset={insets.bottom + 12}
                />
            </View>
        );
    }

    return (
        <View style={{ flex: 1 }}>
            <Screen
                scroll
                taskTitle={
                    unlocked
                        ? method === "paste" && !invitation && stage === "input"
                            ? t`Paste invitation`
                            : stage !== "done" &&
                                (invitation || stage === "confirm-merge")
                              ? t`Review invitation`
                              : t`Receive invitation`
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
                    unlocked
                        ? "px-[20px] pb-[28px] pt-[24px]"
                        : "px-5 pb-8 pt-0"
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
                            labels={linkSteps}
                            current={invitation ? 1 : 0}
                        />
                        {mergeMode ? (
                            <InlineNotice
                                className="mb-4"
                                tone="info"
                                message={t`Vault is unlocked. Received data will merge into the active vault. Existing credentials keep their current values; missing IDs are added.`}
                            />
                        ) : (
                            <Text className="mb-[18px] text-xs leading-[18px] text-muted-foreground">
                                {t`On your other device, open Cryptex Vault and start linking. Then scan its invitation here.`}
                            </Text>
                        )}

                        {!invitation ? (
                            <View className="gap-2">
                                <View
                                    style={{
                                        width: "100%",
                                        maxWidth: cameraActive
                                            ? undefined
                                            : 240,
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
                                                onBarcodeScanned={
                                                    onBarcodeScanned
                                                }
                                                onMountError={() =>
                                                    setCameraError(
                                                        t`Could not start the camera. Try again or choose another linking method.`,
                                                    )
                                                }
                                            />
                                        ) : (
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel={t`Scan QR code`}
                                                onPress={() => void startScan()}
                                                className="h-full w-full items-center justify-center gap-4 active:bg-secondary"
                                            >
                                                <Icon
                                                    as={QrCode}
                                                    size={56}
                                                    className="text-primary"
                                                />
                                                <Text className="font-medium text-sm text-foreground">
                                                    {t`Tap to scan`}
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
                                                message={t`Opening camera…`}
                                            />
                                        ) : !permission.granted ? (
                                            <InlineNotice
                                                tone="warning"
                                                message={
                                                    permission.canAskAgain
                                                        ? t`Camera access was not granted. Tap the scanner to try again, or use a link file or pasted data.`
                                                        : t`Camera access is blocked. Enable it in Android settings, or use a link file or pasted data.`
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
                                                message={t`Collected ${qrReceived} of ${qrTotal} QR parts. Keep the camera pointed at the sender's code.`}
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
                                                {t`Choose link file`}
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
                                                {t`Paste link data`}
                                            </Text>
                                        </View>
                                    </Button>
                                </View>

                                <VaultEntryNotice className="mb-3 mt-5">
                                    {t`Keep the linking screen open on your sending device until the transfer finishes.`}
                                </VaultEntryNotice>
                                <VaultEntryAssurance className="mt-2">
                                    {t`Encrypted from sender to receiver`}
                                </VaultEntryAssurance>
                            </View>
                        ) : null}

                        {invitation ? (
                            <View className="gap-3">
                                <InlineNotice
                                    tone="success"
                                    message={t`Invitation ready: ${invitationLabel}`}
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
                                    {t`Replace invitation`}
                                </Button>
                                <View>
                                    <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                                        {t`Verification words`}
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
                                        placeholder={t`Twelve words from the sender`}
                                        accessibilityLabel={t`Verification words`}
                                        className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                                    />
                                    <VaultEntryFieldError
                                        message={fieldErrors.mnemonic}
                                    />
                                    <Text className="mt-1 text-xs text-muted-foreground">
                                        {t`This phrase authorizes the live transfer. It is separate from vault recovery details.`}
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
                                        ? t`Continue to merge`
                                        : t`Connect to sending device`}
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
                                    {t`Cancel`}
                                </Button>
                            </>
                        ) : null}
                    </View>
                ) : null}

                {stage === "confirm-merge" ? (
                    <View className="gap-3">
                        <InlineNotice
                            tone="warning"
                            message={t`Merge into the unlocked vault? This adds missing credentials, directories, connectivity servers, and linked devices. Existing records with the same ID are kept (not overwritten).`}
                        />
                        <VaultEntryAction onPress={() => void runLinking()}>
                            {t`Confirm merge and start`}
                        </VaultEntryAction>
                        <Button
                            variant="ghost"
                            className="min-h-[44px]"
                            onPress={() => setStage("input")}
                        >
                            {t`Back`}
                        </Button>
                    </View>
                ) : null}

                {stage === "linking" || stage === "failed" ? (
                    <LinkingProgress
                        items={progressItems}
                        status={statusMessage || t`Linking in progress…`}
                        deadline={stage === "linking" ? linkDeadline : null}
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
                        <VaultEntrySteps labels={linkSteps} current={2} />
                        <LinkActivityLog activity={linkActivity} />
                        <Text className="text-sm text-muted-foreground">
                            {t`Create a master password for this local copy. It can differ from the password on the sending device.`}
                        </Text>
                        <View>
                            <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                                {t`Vault name`}
                            </Label>
                            <Input
                                ref={vaultNameRef}
                                value={vaultName}
                                onChangeText={(value) => {
                                    setVaultName(value);
                                    clearFieldError("vaultName");
                                }}
                                invalid={!!fieldErrors.vaultName}
                                placeholder={t`Linked vault`}
                                autoCapitalize="words"
                                accessibilityLabel={t`Linked vault name`}
                                className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                            />
                            <VaultEntryFieldError
                                message={fieldErrors.vaultName}
                            />
                        </View>
                        <View>
                            <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                                {t`Master password`}
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
                                placeholder={t`Master password`}
                                accessibilityLabel={t`Master password`}
                                className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                            />
                            <VaultEntryFieldError
                                message={fieldErrors.password}
                            />
                            <PasswordStrengthMeter
                                password={password}
                                compact
                            />
                        </View>
                        <View>
                            <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                                {t`Confirm password`}
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
                                placeholder={t`Confirm password`}
                                accessibilityLabel={t`Confirm master password`}
                                className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                            />
                            <VaultEntryFieldError
                                message={fieldErrors.confirm}
                            />
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
                            {t`Continue`}
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
                        <DialogTitle>{t`Paste link data`}</DialogTitle>
                        <DialogDescription>
                            {t`Paste the invitation from your sending device.`}
                        </DialogDescription>
                    </DialogHeader>
                    <Label>{t`Link data`}</Label>
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
                        placeholder={t`Paste link data`}
                        multiline
                        numberOfLines={4}
                        scrollEnabled
                        textAlignVertical="top"
                        accessibilityLabel={t`Pasted link data`}
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
                            {t`Use pasted data`}
                        </VaultEntryAction>
                        <Button
                            variant="ghost"
                            onPress={() => {
                                setMethod(null);
                                clearFieldError("paste");
                            }}
                        >
                            {t`Cancel`}
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
                            <DialogTitle>{t`Keep your way back in`}</DialogTitle>
                            <DialogDescription>
                                {t`Store these offline before opening the linked vault.`}
                            </DialogDescription>
                        </DialogHeader>
                        <VaultEntrySteps
                            labels={[
                                t({
                                    message: "Invitation",
                                    comment: "Link receive step",
                                }),
                                t({
                                    message: "Protect",
                                    comment: "Link receive step",
                                }),
                                t({
                                    message: "Save recovery",
                                    comment: "Link receive step",
                                }),
                            ]}
                            current={2}
                        />
                        <InlineNotice
                            tone="warning"
                            message={t`This is the recovery material for the new local vault. Recovery details from the sending device do not transfer.`}
                        />
                        {recoveryCode ? (
                            <SecretReveal
                                label={t`Recovery code`}
                                value={recoveryCode}
                                helper={t`Store this offline. It can recover this local vault if you forget its master password.`}
                                requireAck
                                defaultRevealed
                                ackLabel={t`I have written down the recovery code`}
                                acknowledged={recoveryAck}
                                onAcknowledgedChange={setRecoveryAck}
                            />
                        ) : null}
                        {protectionPhrase ? (
                            <SecretReveal
                                label={t`Generated protection phrase`}
                                value={protectionPhrase}
                                helper={t`Store this separately. You will need it with the master password after restoring on a new device.`}
                                requireAck
                                defaultRevealed
                                ackLabel={t`I have written down the protection phrase`}
                                acknowledged={additionalKeyProtectionAck}
                                onAcknowledgedChange={
                                    setAdditionalKeyProtectionAck
                                }
                            />
                        ) : null}
                        {saveWarning ? (
                            <InlineNotice
                                tone="warning"
                                message={saveWarning}
                            />
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
                                {t`Save and open vault`}
                            </VaultEntryAction>
                        </DialogFooter>
                    </Dialog>
                ) : null}

                {stage === "done" && mergeMode ? (
                    <LinkResult
                        title={t`Vault merged`}
                        description={t`Items from the other device were added to this vault. Nothing here was overwritten.`}
                        rows={[
                            {
                                label: t`Credentials added`,
                                value: String(
                                    mergeSummary?.credentialsAdded ?? 0,
                                ),
                            },
                            {
                                label: t`Already in this vault`,
                                value: String(
                                    mergeSummary?.credentialsSkipped ?? 0,
                                ),
                            },
                            {
                                label: t`Linked devices added`,
                                value: String(mergeSummary?.devicesAdded ?? 0),
                            },
                        ]}
                        actionLabel={t`Back to Devices`}
                        onAction={() =>
                            router.dismissTo("/(app)/(tabs)/devices")
                        }
                    />
                ) : null}

                {stage === "done" && !mergeMode ? (
                    <View className="gap-3">
                        <InlineNotice
                            tone="success"
                            message={statusMessage || t`Done.`}
                        />
                        {mergeSummary ? (
                            <Text className="text-sm text-muted-foreground">
                                {t`Added ${plural(credentialsAdded, { one: "# credential", other: "# credentials" })}, skipped ${credentialsSkipped}, linked ${plural(devicesAdded, { one: "# device", other: "# devices" })}.`}
                            </Text>
                        ) : null}
                        <VaultEntryAction
                            onPress={() =>
                                mergeMode
                                    ? router.dismissTo("/(app)/(tabs)/devices")
                                    : router.replace("/(app)/(tabs)/vault")
                            }
                        >
                            {mergeMode ? t`Back to Devices` : t`Open vault`}
                        </VaultEntryAction>
                    </View>
                ) : null}

                <Dialog
                    placement="bottom"
                    open={osOverwriteOpen}
                    onOpenChange={(open) => {
                        if (!open) chooseOsOverwrite("cancel");
                    }}
                >
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>
                                {osOverwriteSameAccount
                                    ? t`Overwrite Online Services?`
                                    : t`This device has its own account`}
                            </DialogTitle>
                            <DialogDescription>
                                {osOverwriteSameAccount
                                    ? t`This invitation uses a different Online Services device identity for the same account. Continuing replaces the identity saved in this vault; existing Online Services device links may need to be linked again.`
                                    : osOverwriteCanDelete
                                      ? t`The invitation comes from a different Online Services account. Linking moves this vault to that account.\n\nThis device's current account stays active, including any subscription on it. Delete it now to cancel a subscription bought on the web. Cancel a Google Play subscription in the Play Store. Deleting cannot be undone.`
                                      : t`The invitation comes from a different Online Services account. Linking moves this vault to that account.\n\nThis device's current account stays active, including any subscription on it. Only that account's root device can delete it.`}
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button
                                className="h-[54px] min-h-[54px]"
                                variant="ghost"
                                onPress={() => chooseOsOverwrite("cancel")}
                            >
                                {t`Cancel`}
                            </Button>
                            {osOverwriteCanDelete ? (
                                <>
                                    <Button
                                        className="h-[54px] min-h-[54px]"
                                        variant="outline"
                                        onPress={() =>
                                            chooseOsOverwrite("keep")
                                        }
                                    >
                                        {t`Keep it and link`}
                                    </Button>
                                    <Button
                                        className="h-[54px] min-h-[54px]"
                                        variant="destructive"
                                        onPress={() =>
                                            chooseOsOverwrite("delete")
                                        }
                                    >
                                        {t`Delete it and link`}
                                    </Button>
                                </>
                            ) : (
                                <Button
                                    className="h-[54px] min-h-[54px]"
                                    variant="destructive"
                                    onPress={() => chooseOsOverwrite("keep")}
                                >
                                    {osOverwriteSameAccount
                                        ? t`Overwrite`
                                        : t`Link anyway`}
                                </Button>
                            )}
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </Screen>
            {confirmDialog}
            <Snackbar
                feedback={snackbar}
                onDismiss={dismissSnackbar}
                bottomOffset={insets.bottom + 12}
            />
        </View>
    );
}

export function LinkReceiveScreen({
    embedded = false,
}: {
    embedded?: boolean;
}) {
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
