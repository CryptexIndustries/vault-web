import * as VaultUtilTypes from "@/app_lib/proto/vault";
import * as SynchronizationUtils from "@/app_lib/synchronization-utils";
import { TOTPFormSchemaType } from "@/app_lib/vault-utils/form-schemas";
import * as Vault from "@/app_lib/vault-utils/vault";
import {
    CredentialFormSchemaType,
    VaultCredential,
} from "@/app_lib/vault-utils/vault";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    ArrowRightSquare,
    Clipboard,
    Copy,
    Edit,
    Eye,
    EyeOff,
    Globe,
    Loader2,
    LockKeyhole,
    MoreVertical,
    Plus,
    PlusCircle,
    RefreshCw,
    Search,
    Shield,
    Trash2,
    X,
} from "lucide-react";
import { TOTP } from "otpauth";
import React, { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
    EncryptedEnvelope,
    LiteCredential,
    MessageType,
    PlaintextEnvelope,
} from "./types/sw-messaging";
import {
    createEncryptedEnvelope,
    decryptResponseEnvelope,
    isEncryptedEnvelope,
} from "./utils/session-utils";

import { ManualSynchronizationDialog, ManualSyncShowDialogFnPropType } from "@/components/dialog/synchronization";

// Shadcn UI Components
import { SyncConnectionController, VaultOperations } from "@/app_lib/synchronization";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { err, ok, Result } from "neverthrow";
import { validateEnvelope } from "./utils/security-utils";
import { setOnlineServicesAPIKey } from "@/utils/atoms";
import { WarningDialog, WarningDialogShowFn } from "@/components/dialog/warning";

type VaultViewProps = {
    name: string;
    lockVaultFn: () => void;
    serverPublicKey: {
        keyId: string;
        publicKeyJwk: JsonWebKey;
    } | null;
    onStaleKeyError: () => Promise<Result<void, string>>;
};

type CredentialFormMode = "create" | "edit" | null;

let GlobalSyncConnectionController: SyncConnectionController | null = null;

type ServerPublicKey = NonNullable<VaultViewProps['serverPublicKey']>;

const createVaultOperations = (
    serverPublicKey: ServerPublicKey,
    onCredentialsUpdated?: () => void | Promise<void>,
): VaultOperations => {
    return {
        getItemVersionVectors: async () => {
            return await getItemVersionVectors(serverPublicKey);
        },
        getItemCredentials: async (itemIDs: string[]) => {
            return await getCredentials(serverPublicKey, itemIDs);
        },
        updateCredentials: async (credentials: VaultUtilTypes.Credential[]) => {
            await updateCredentials(serverPublicKey, credentials);
            await onCredentialsUpdated?.();
        },
        getSynchronizationConfig: async () => {
            return await getSynchronizationConfig(serverPublicKey);
        },
    };
};

const getCredentials = async (serverPublicKey: ServerPublicKey, itemIDs: string[]): Promise<VaultUtilTypes.Credential[]> => {
    const envelope = await createEncryptedEnvelope(
        MessageType.SyncGetItemCredentials,
        { itemIDs },
        serverPublicKey.publicKeyJwk,
        serverPublicKey.keyId,
        "popup",
    );

    const res: EncryptedEnvelope | PlaintextEnvelope = await chrome.runtime.sendMessage(envelope);
    if (isEncryptedEnvelope(res)) {
        const decryptedPayload = await decryptResponseEnvelope<{ ok: false; error: string } | { ok: true; credentials: VaultUtilTypes.Credential[] }>(res);
        if (!decryptedPayload.ok) {
            console.error("[SYNCHRONIZATION-POPUP] Failed to decrypt encrypted response (SyncGetItemCredentials):", decryptedPayload.error);
            return [];
        }

        if (!decryptedPayload.payload.ok) {
            console.error("[SYNCHRONIZATION-POPUP] Failed to get credentials (SyncGetItemCredentials):", decryptedPayload.payload.error);
            return [];
        }

        return decryptedPayload.payload.credentials;
    }

    // If we're here, it's an erroneous response from the background script (plaintext envelope)
    console.error("[SYNCHRONIZATION-POPUP] Received a plaintext, but expected an encrypted envelope (SyncGetItemCredentials):", res.payload);
    return [];
};

const getItemVersionVectors = async (serverPublicKey: ServerPublicKey): Promise<VaultUtilTypes.VersionVector[]> => {
    const envelope = await createEncryptedEnvelope(
        MessageType.SyncGetItemVersionVectors,
        null,
        serverPublicKey.publicKeyJwk,
        serverPublicKey.keyId,
        "popup",
    );

    const res: EncryptedEnvelope | PlaintextEnvelope = await chrome.runtime.sendMessage(envelope);
    if (isEncryptedEnvelope(res)) {
        const decryptedPayload = await decryptResponseEnvelope<{ ok: false; error: string } | { ok: true; versionVectors: VaultUtilTypes.VersionVector[] }>(res);
        if (!decryptedPayload.ok) {
            console.error("[SYNCHRONIZATION-POPUP] Failed to decrypt encrypted response (SyncGetItemVersionVectors):", decryptedPayload.error);
            return [];
        }


        if (!decryptedPayload.payload.ok) {
            console.error("[SYNCHRONIZATION-POPUP] Failed to get item version vectors (SyncGetItemVersionVectors):", decryptedPayload.payload.error);
            return [];
        }

        return decryptedPayload.payload.versionVectors;
    }

    // If we're here, it's an erroneous response from the background script (plaintext envelope)
    console.error("[SYNCHRONIZATION-POPUP] Received a plaintext, but expected an encrypted envelope (SyncGetItemVersionVectors):", res.payload);
    return [];
};

const getSynchronizationConfig = async (serverPublicKey: ServerPublicKey): Promise<VaultUtilTypes.LinkedDevices> => {
    const envelope = await createEncryptedEnvelope(
        MessageType.SyncGetConfiguration,
        null,
        serverPublicKey.publicKeyJwk,
        serverPublicKey.keyId,
        "popup",
    );

    const res: EncryptedEnvelope | PlaintextEnvelope = await chrome.runtime.sendMessage(envelope);
    if (isEncryptedEnvelope(res)) {
        const decryptedPayload = await decryptResponseEnvelope<{ ok: false; error: string } | { ok: true; config: VaultUtilTypes.LinkedDevices }>(res);
        if (!decryptedPayload.ok) {
            console.error("[SYNCHRONIZATION-POPUP] Failed to decrypt encrypted response (SyncGetConfiguration):", decryptedPayload.error);
            return null as unknown as VaultUtilTypes.LinkedDevices;
        }

        if (!decryptedPayload.payload.ok) {
            console.error("[SYNCHRONIZATION-POPUP] Failed to get synchronization configuration (SyncGetConfiguration):", decryptedPayload.payload.error);
            return null as unknown as VaultUtilTypes.LinkedDevices;
        }

        return decryptedPayload.payload.config;
    }

    // If we're here, it's an erroneous response from the background script (plaintext envelope)
    console.error("[SYNCHRONIZATION-POPUP] Received a plaintext, but expected an encrypted envelope (SyncGetConfiguration):", res.payload);
    return null as unknown as VaultUtilTypes.LinkedDevices;
};

const updateCredentials = async (serverPublicKey: ServerPublicKey, credentials: VaultUtilTypes.Credential[]) => {
    const envelope = await createEncryptedEnvelope(
        MessageType.SyncUpdateCredentials,
        { credentials },
        serverPublicKey.publicKeyJwk,
        serverPublicKey.keyId,
        "popup",
    );

    const res: EncryptedEnvelope | PlaintextEnvelope = await chrome.runtime.sendMessage(envelope);

    // The expected successful response is an encrypted envelope
    if (isEncryptedEnvelope(res)) {
        const decryptedPayload = await decryptResponseEnvelope<{ ok: boolean }>(res);
        if (!decryptedPayload?.ok) {
            // return err("FAILED_TO_UPDATE_CREDENTIALS_AND_DIFFS");
            console.error("[SYNCHRONIZATION-POPUP] Failed to update credentials and diffs:", decryptedPayload?.error);
            return;
        }
    } else {
        // If we're here, it's an erroneous response from the background script (plaintext envelope)
        console.error("[SYNCHRONIZATION-POPUP] Failed to update credentials and diffs:", res.payload);
    }
};

const VaultView: React.FC<VaultViewProps> = ({
    name,
    lockVaultFn,
    serverPublicKey,
    onStaleKeyError,
}) => {
    const [credentials, setCredentials] = useState<LiteCredential[]>([]);
    const [credentialFormMode, setCredentialFormMode] =
        useState<CredentialFormMode>(null);
    const [editingCredential, setEditingCredential] =
        useState<VaultCredential | null>(null);

    // Modal states
    const credentialModalVisible = useState(false);
    const totpModalVisible = useState(false);

    // Loading states for CRUD operations
    const [isCreating, setIsCreating] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const [searchQuery, setSearchQuery] = useState("");
    const [showFormPassword, setShowFormPassword] = useState(false);
    const [signalingStatus, setSignalingStatus] =
        useState<SynchronizationUtils.SignalingStatus>(
            SynchronizationUtils.SignalingStatus.Disconnected,
        );
    const [webRTCStatus, setWebRTCStatus] =
        useState<SynchronizationUtils.WebRTCStatus>(
            SynchronizationUtils.WebRTCStatus.Disconnected,
        );
    const [lastSync, setLastSync] = useState<Date | null>(null);
    const linkedDevicesRef = useRef<VaultUtilTypes.LinkedDevice[]>([]);

    const showWarningDialogFnRef = useRef<WarningDialogShowFn>(() => {
        // No-op
    });
    const showManualSyncDialog = useRef<ManualSyncShowDialogFnPropType>(() => {
        // No-op
    });
    const refreshCredentialsRef = useRef<(() => Promise<Result<void, string>>) | null>(null);

    // Form management
    const {
        handleSubmit,
        register,
        control,
        formState: { errors, isSubmitting },
        reset,
        setValue,
        getValues,
    } = useForm<CredentialFormSchemaType>({
        resolver: zodResolver(Vault.CredentialFormSchema),
        defaultValues: {
            ID: null,
            Type: VaultUtilTypes.ItemType.Credentials,
            GroupID: "",
            Name: "",
            Username: "",
            Password: "",
            TOTP: null,
            Tags: "",
            URL: "",
            Notes: "",
            CustomFields: [],
        },
    });

    // TOTP Dialog state
    const [showTOTPDialog, setShowTOTPDialog] = useState(false);
    const [totpFormData, setTotpFormData] = useState<TOTPFormSchemaType>({
        Label: "",
        Secret: "",
        Period: 30,
        Digits: 6,
        Algorithm: VaultUtilTypes.TOTPAlgorithm.SHA1,
    });

    const filteredCredentials = credentials.filter(
        (cred) =>
            cred.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            cred.username.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    const copyToClipboard = async (text?: string) => {
        if (!text) {
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error("Failed to copy to clipboard:", err);
        }
    };

    const formatTimeAgo = (date: Date) => {
        const now = new Date();
        const diffInMinutes = Math.floor(
            (now.getTime() - date.getTime()) / (1000 * 60),
        );

        if (diffInMinutes < 1) return "Just now";
        if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
        if (diffInMinutes < 1440)
            return `${Math.floor(diffInMinutes / 60)}h ago`;
        return `${Math.floor(diffInMinutes / 1440)}d ago`;
    };

    // TagBox Component
    const TagBox: React.FC<{
        value: string | undefined;
        onChange: (tags: string) => void;
    }> = ({ value, onChange }) => {
        const tagSeparator = ",";

        const [inputValue, setInputValue] = useState("");
        const [inputFocused, setInputFocused] = useState(false);

        const tagInputRef = useRef<HTMLInputElement>(null);

        const tagArrayValue = value
            ? value.split(tagSeparator).filter((tag) => tag.trim())
            : [];

        const addTag = (tag: string) => {
            if (!tag?.length) return;

            tag = tag.replaceAll(tagSeparator, "").trim();

            const tags = tagArrayValue;

            if (tags.includes(tag)) return;
            else tags.push(tag);

            onChange(tags.join(tagSeparator));
            setInputValue("");
        };

        const removeTag = (tag: string) => {
            const newTags = tagArrayValue.filter((t) => t !== tag);
            onChange(newTags.join(tagSeparator));

            if (inputFocused) {
                const input = tagInputRef.current as HTMLInputElement;
                input.focus();
            }

            if (!inputFocused) {
                const input = tagInputRef.current as HTMLInputElement;
                input.blur();
            }
        };

        const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
                e.preventDefault();
                addTag(inputValue);
            }
            if (e.key === "Backspace" && inputValue.length === 0) {
                const value = tagArrayValue;
                const valueToBeRemoved = value[value.length - 1];
                if (valueToBeRemoved) removeTag(valueToBeRemoved);
            }
        };

        const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            setInputValue(e.target.value);
        };

        const handleInputFocus = () => setInputFocused(true);
        const handleInputBlur = () => setInputFocused(false);

        return (
            <div className="flex flex-row flex-wrap items-center">
                {tagArrayValue.map((tag) => (
                    <div
                        key={tag}
                        className="m-1 flex flex-row items-center rounded-full bg-muted px-2 py-1"
                    >
                        <span className="text-xs text-muted-foreground">
                            {tag}
                        </span>
                        <X
                            className="ml-1 h-3 w-3 cursor-pointer text-muted-foreground hover:text-foreground"
                            aria-hidden="true"
                            onClick={() => removeTag(tag)}
                        />
                    </div>
                ))}
                <div className="m-1 flex flex-row items-center rounded-full bg-muted/50 px-2 py-1">
                    <input
                        ref={tagInputRef}
                        className="bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                        type="text"
                        value={inputValue}
                        onKeyDown={handleKeyDown}
                        onChange={handleInputChange}
                        onFocus={handleInputFocus}
                        onBlur={handleInputBlur}
                        placeholder="Add tag"
                    />
                    <PlusCircle
                        className="ml-1 h-3 w-3 cursor-pointer text-muted-foreground hover:text-foreground"
                        aria-hidden="true"
                        onClick={() => addTag(inputValue)}
                    />
                </div>
            </div>
        );
    };

    // TOTP Control Component
    const TOTPControl: React.FC<{
        value: TOTPFormSchemaType;
        onChange: (event: TOTPFormSchemaType | null) => void;
    }> = ({ value, onChange }) => {
        const codeRef = useRef<string>("");
        const [timeLeft, setTimeLeft] = useState(0);

        const updateCode = () => {
            try {
                const totp = new TOTP({
                    secret: value.Secret.replaceAll(" ", ""),
                    period: value.Period,
                    digits: value.Digits,
                    algorithm: VaultUtilTypes.TOTPAlgorithm[value.Algorithm],
                });
                const code = totp.generate();
                codeRef.current = code;
            } catch (e) {
                console.debug("[TOTP] Update code threw.", e);
                clearTOTP();
            }
        };

        const getTOTPTimeLeft = (period: number): number => {
            const now = new Date();
            const seconds = now.getSeconds();
            const timeLeft = period - (seconds % period);
            return timeLeft;
        };

        const updateTimeLeft = () => {
            const timeLeft = getTOTPTimeLeft(value.Period);
            setTimeLeft(timeLeft);
        };

        const clearTOTP = () => {
            onChange(null);
        };

        useEffect(() => {
            updateCode();
            updateTimeLeft();
        }, [value]);

        useEffect(() => {
            const interval = setInterval(() => {
                updateCode();
                updateTimeLeft();
            }, 1000);
            return () => clearInterval(interval);
        }, []);

        return (
            <div className="flex flex-row items-center">
                <div className="flex w-full flex-row items-center justify-between">
                    <div className="flex flex-col items-center">
                        <span className="text-2xl font-bold">
                            {codeRef.current}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {timeLeft} seconds left
                        </span>
                    </div>
                    <div className="flex flex-row items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 hover:bg-muted/50"
                            onClick={() =>
                                navigator.clipboard.writeText(codeRef.current)
                            }
                        >
                            <Clipboard className="h-3 w-3 text-muted-foreground" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 hover:bg-muted/50"
                            onClick={clearTOTP}
                        >
                            <X className="h-3 w-3 text-muted-foreground" />
                        </Button>
                    </div>
                </div>
            </div>
        );
    };

    type SignalingDisplayStatus =
        | "connected"
        | "connecting"
        | "completed"
        | "disconnected"
        | "failed"
        | "error";
    type WebRTCDisplayStatus =
        | "connected"
        | "connecting"
        | "failed"
        | "idle";
    type ConnectionTone = "green" | "yellow" | "red";

    const getSignalingDisplayStatus = (
        rawStatus: SynchronizationUtils.SignalingStatus,
        webrtc: WebRTCDisplayStatus,
    ): SignalingDisplayStatus => {
        let status: SignalingDisplayStatus = "disconnected";

        if (rawStatus === SynchronizationUtils.SignalingStatus.Connected) {
            status = "connected";
        } else if (
            rawStatus === SynchronizationUtils.SignalingStatus.Connecting
        ) {
            status = "connecting";
        } else if (
            rawStatus === SynchronizationUtils.SignalingStatus.Unavailable
        ) {
            status = "error";
        } else if (rawStatus === SynchronizationUtils.SignalingStatus.Failed) {
            status = "failed";
        } else if (
            rawStatus === SynchronizationUtils.SignalingStatus.Disconnected
        ) {
            status = "disconnected";
        }

        if (
            status === "disconnected" &&
            (webrtc === "connected" || webrtc === "connecting")
        ) {
            return "completed";
        }

        return status;
    };

    const getWebRTCDisplayStatus = (
        rawStatus: SynchronizationUtils.WebRTCStatus,
    ): WebRTCDisplayStatus => {
        if (rawStatus === SynchronizationUtils.WebRTCStatus.Connected) {
            return "connected";
        }
        if (rawStatus === SynchronizationUtils.WebRTCStatus.Connecting) {
            return "connecting";
        }
        if (rawStatus === SynchronizationUtils.WebRTCStatus.Failed) {
            return "failed";
        }
        return "idle";
    };

    const getStatusTone = (status: string): ConnectionTone => {
        if (status === "connected" || status === "completed") {
            return "green";
        }
        if (status === "connecting") {
            return "yellow";
        }
        return "red";
    };

    const getOverallConnectionState = (
        signaling: SignalingDisplayStatus,
        webrtc: WebRTCDisplayStatus,
    ): { label: string; tone: ConnectionTone } => {
        if (signaling === "error") {
            return { label: "Error", tone: "red" };
        }
        if (signaling === "connecting" || webrtc === "connecting") {
            return { label: "Connecting", tone: "yellow" };
        }
        if (webrtc === "failed" || signaling === "failed") {
            return { label: "Connection issue", tone: "red" };
        }
        if (webrtc === "connected") {
            return { label: "Connected", tone: "green" };
        }
        if (
            (signaling === "connected" || signaling === "completed") &&
            webrtc === "idle"
        ) {
            return { label: "Connecting", tone: "yellow" };
        }
        if (signaling === "disconnected" && webrtc === "idle") {
            return { label: "Disconnected", tone: "red" };
        }
        return { label: "Disconnected", tone: "red" };
    };

    const formatStatusLabel = (status: string) =>
        status.charAt(0).toUpperCase() + status.slice(1);

    const ConnectionStatusIndicator: React.FC<{
        signaling: SynchronizationUtils.SignalingStatus;
        webrtc: SynchronizationUtils.WebRTCStatus;
    }> = ({ signaling, webrtc }) => {
        const [detailsOpen, setDetailsOpen] = useState(false);
        const webrtcDisplay = getWebRTCDisplayStatus(webrtc);
        const signalingDisplay = getSignalingDisplayStatus(
            signaling,
            webrtcDisplay,
        );
        const overall = getOverallConnectionState(
            signalingDisplay,
            webrtcDisplay,
        );
        const toneClasses: Record<ConnectionTone, string> = {
            green: "border-green-500/40 bg-green-500/10 text-green-600",
            yellow: "border-yellow-500/40 bg-yellow-500/10 text-yellow-600",
            red: "border-red-500/40 bg-red-500/10 text-red-600",
        };
        const textToneClasses: Record<ConnectionTone, string> = {
            green: "text-green-600",
            yellow: "text-yellow-600",
            red: "text-red-600",
        };
        const dotClasses: Record<ConnectionTone, string> = {
            green: "bg-green-500",
            yellow: "bg-yellow-500",
            red: "bg-red-500",
        };

        return (
            <DropdownMenu open={detailsOpen} onOpenChange={setDetailsOpen}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 py-0 hover:bg-muted/50"
                        onMouseEnter={() => setDetailsOpen(true)}
                    >
                        <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${toneClasses[overall.tone]}`}
                        >
                            <span
                                className={`h-1.5 w-1.5 rounded-full ${dotClasses[overall.tone]}`}
                            />
                            {overall.label}
                        </span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="end"
                    className="w-52 p-3"
                    onMouseEnter={() => setDetailsOpen(true)}
                    onMouseLeave={() => setDetailsOpen(false)}
                >
                    <div className="space-y-2">
                        <div className="text-xs font-semibold text-foreground">
                            Connection details
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                                Signaling
                            </span>
                            <span
                                className={`font-medium ${textToneClasses[getStatusTone(signalingDisplay)]}`}
                            >
                                {formatStatusLabel(signalingDisplay)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">WebRTC</span>
                            <span
                                className={`font-medium ${textToneClasses[getStatusTone(webrtcDisplay)]}`}
                            >
                                {formatStatusLabel(webrtcDisplay)}
                            </span>
                        </div>
                    </div>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    };

    // Credential CRUD operations
    const createCredential = async (formData: CredentialFormSchemaType) => {
        if (!serverPublicKey) {
            console.error(
                "CREDENTIAL_CREATE_FAILED: No server public key available for encrypted messaging",
            );
            return err("NO_PUBLIC_KEY_AVAILABLE");
        }

        const successFn = () => {
            setIsCreating(false);

            // Refresh credentials list
            refreshCredentials();
            credentialModalVisible[1](false);
            setCredentialFormMode(null);

            // Reset TOTP form data to default values
            setTotpFormData({
                Label: "",
                Secret: "",
                Period: 30,
                Digits: 6,
                Algorithm: VaultUtilTypes.TOTPAlgorithm.SHA1,
            });
            reset();
        };

        setIsCreating(true);

        const res = await _createCredential(formData);

        if (res.isOk()) {
            successFn();
            return ok();
        }

        if (res.error === "STALE_KEY") {
            const refreshKeyResult = await onStaleKeyError();
            if (refreshKeyResult.isErr()) {
                console.error(
                    "Failed to create credential, tried to refresh public key but failed: " +
                        refreshKeyResult.error,
                );
                return err("FAILED_TO_CREATE_CREDENTIAL_STALE_KEY");
            }

            const resRetry = await _createCredential(formData);
            if (resRetry.isErr()) {
                console.error(
                    "Failed to create credential after retrying: " +
                        resRetry.error,
                );
            } else {
                successFn();
                return ok();
            }
        } else {
            console.error("Failed to create credential:", res.error);
        }

        setIsCreating(false);

        return err("FAILED_TO_CREATE_CREDENTIAL");
    };

    const _createCredential = async (formData: CredentialFormSchemaType) => {
        if (!serverPublicKey) return err("NO_PUBLIC_KEY_AVAILABLE");

        const envelope = await createEncryptedEnvelope(
            MessageType.CreateCredential,
            { form: formData },
            serverPublicKey.publicKeyJwk,
            serverPublicKey.keyId,
            "popup",
        );

        const res: EncryptedEnvelope | PlaintextEnvelope =
            await chrome.runtime.sendMessage(envelope);
        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<
                | { ok: true; credential: LiteCredential }
                | { ok: false; error: string }
            >(res);
            if (!decryptedPayload?.ok || !decryptedPayload?.payload) {
                if (!decryptedPayload?.ok) {
                    return err(
                        "ENVELOPE_FAILED_DECRYPTION: " +
                            decryptedPayload?.error,
                    );
                }
                return err("ENVELOPE_PAYLOAD_NULL");
            }

            if (!decryptedPayload.payload.ok) {
                return err(
                    "CREDENTIAL_CREATE_FAILED: " +
                        decryptedPayload.payload.error,
                );
            }

            return ok();
        }

        if (!res.payload?.ok && res.payload?.code === "STALE_KEY") {
            return err("STALE_KEY");
        }

        return err("UNKNOWN_NON_ENCRYPTED_ENVELOPE");
    };

    const updateCredential = async (
        id: string,
        formData: CredentialFormSchemaType,
    ) => {
        if (!serverPublicKey) {
            console.error(
                "CREDENTIAL_UPDATE_FAILED: No server public key available for encrypted messaging",
            );
            return err("NO_PUBLIC_KEY_AVAILABLE");
        }

        const successFn = async () => {
            setIsUpdating(false);

            // Refresh credentials list
            await refreshCredentials();

            credentialModalVisible[1](false);
            setCredentialFormMode(null);
            setEditingCredential(null);
            // Reset TOTP form data to default values
            setTotpFormData({
                Label: "",
                Secret: "",
                Period: 30,
                Digits: 6,
                Algorithm: VaultUtilTypes.TOTPAlgorithm.SHA1,
            });
            reset();
        };

        setIsUpdating(true);

        const res = await _updateCredential(id, formData);

        if (res.isOk()) {
            await successFn();
            return ok();
        }

        if (res.error === "STALE_KEY") {
            const refreshKeyResult = await onStaleKeyError();
            if (refreshKeyResult.isErr()) {
                console.error(
                    "Failed to update credential, tried to refresh public key but failed: " +
                        refreshKeyResult.error,
                );
                return err("FAILED_TO_UPDATE_CREDENTIAL_STALE_KEY");
            }

            const resRetry = await _updateCredential(id, formData);
            if (resRetry.isErr()) {
                console.error(
                    "Failed to update credential after retrying: " +
                        resRetry.error,
                );
            } else {
                await successFn();
                return ok();
            }
        } else {
            console.error("Failed to update credential: " + res.error);
        }

        setIsUpdating(false);

        return err("FAILED_TO_UPDATE_CREDENTIAL");
    };

    const _updateCredential = async (
        id: string,
        formData: CredentialFormSchemaType,
    ) => {
        if (!serverPublicKey) return err("NO_PUBLIC_KEY_AVAILABLE");

        const envelope = await createEncryptedEnvelope(
            MessageType.UpdateCredential,
            { id, form: formData },
            serverPublicKey.publicKeyJwk,
            serverPublicKey.keyId,
            "popup",
        );

        const res: EncryptedEnvelope | PlaintextEnvelope =
            await chrome.runtime.sendMessage(envelope);

        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<
                | { ok: true }
                | { ok: false; error: string }
            >(res);
            if (!decryptedPayload?.ok || !decryptedPayload?.payload) {
                if (!decryptedPayload?.ok) {
                    return err(
                        "ENVELOPE_FAILED_DECRYPTION: " +
                            decryptedPayload?.error,
                    );
                }
                return err("ENVELOPE_PAYLOAD_NULL");
            }

            if (!decryptedPayload.payload.ok) {
                return err(
                    "CREDENTIAL_UPDATE_FAILED: " +
                        decryptedPayload.payload.error,
                );
            }

            return ok();
        }

        if (!res.payload?.ok && res.payload?.code === "STALE_KEY") {
            return err("STALE_KEY");
        }

        return err("UNKNOWN_NON_ENCRYPTED_ENVELOPE");
    };

    const deleteCredential = async (id: string) => {
        if (!confirm("Are you sure you want to delete this credential?")) {
            return;
        }

        if (!serverPublicKey) {
            console.error(
                "CREDENTIAL_DELETE_FAILED: No server public key available for encrypted messaging",
            );
            return err("NO_PUBLIC_KEY_AVAILABLE");
        }

        setIsDeleting(true);

        const res = await _deleteCredential(id);

        if (res.isOk()) {
            await refreshCredentials();
            setIsDeleting(false);
            return ok();
        }

        if (res.error === "STALE_KEY") {
            const refreshKeyResult = await onStaleKeyError();
            if (refreshKeyResult.isErr()) {
                console.error(
                    "Failed to delete credential, tried to refresh public key but failed: " +
                        refreshKeyResult.error,
                );
                return err("FAILED_TO_DELETE_CREDENTIAL_STALE_KEY");
            }

            const resRetry = await _deleteCredential(id);
            if (resRetry.isErr()) {
                console.error(
                    "Failed to delete credential after retrying: " +
                        resRetry.error,
                );
            } else {
                await refreshCredentials();
                setIsDeleting(false);
                return ok();
            }
        } else {
            console.error("Failed to delete credential: " + res.error);
        }

        setIsDeleting(false);

        return err("FAILED_TO_DELETE_CREDENTIAL");
    };

    const _deleteCredential = async (id: string) => {
        if (!serverPublicKey) return err("NO_PUBLIC_KEY_AVAILABLE");

        const envelope = await createEncryptedEnvelope(
            MessageType.DeleteCredential,
            { id },
            serverPublicKey.publicKeyJwk,
            serverPublicKey.keyId,
            "popup",
        );

        const res: EncryptedEnvelope | PlaintextEnvelope =
            await chrome.runtime.sendMessage(envelope);
        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<
                { ok: true } | { ok: false; error: string }
            >(res);
            if (!decryptedPayload?.ok || !decryptedPayload?.payload) {
                if (!decryptedPayload?.ok) {
                    return err(
                        "ENVELOPE_FAILED_DECRYPTION: " +
                            decryptedPayload?.error,
                    );
                }
                return err("ENVELOPE_PAYLOAD_NULL");
            }

            if (!decryptedPayload.payload.ok) {
                return err(
                    "CREDENTIAL_DELETE_FAILED: " +
                        decryptedPayload.payload.error,
                );
            }

            return ok();
        }

        if (!res.payload?.ok && res.payload?.code === "STALE_KEY") {
            return err("STALE_KEY");
        }

        return err("UNKNOWN_NON_ENCRYPTED_ENVELOPE");
    };

    const refreshCredentials = async () => {
        if (!serverPublicKey) {
            console.error(
                "REFRESH_CREDENTIALS_FAILED: No server public key available for encrypted messaging",
            );
            return err("NO_PUBLIC_KEY_AVAILABLE");
        }

        setIsRefreshing(true);
        const res = await _refreshCredentials();
        if (res.isOk()) {
            setCredentials(res.value);
            setIsRefreshing(false);
            return ok();
        }

        if (res.error === "STALE_KEY") {
            const refreshKeyResult = await onStaleKeyError();
            if (refreshKeyResult.isErr()) {
                console.error(
                    "Failed to refresh credentials, tried to refresh public key but failed: " +
                        refreshKeyResult.error,
                );
                return err("FAILED_TO_REFRESH_CREDENTIALS_STALE_KEY");
            }

            const resRetry = await _refreshCredentials();
            if (resRetry.isErr()) {
                console.error(
                    "Failed to refresh credentials after retrying: " +
                        resRetry.error,
                );
            } else {
                setCredentials(resRetry.value);
                setIsRefreshing(false);
                return ok();
            }
        } else {
            console.error("Failed to refresh credentials: " + res.error);
        }

        setIsRefreshing(false);

        return err("FAILED_TO_REFRESH_CREDENTIALS");
    };

    useEffect(() => {
        refreshCredentialsRef.current = refreshCredentials;
    }, [refreshCredentials]);

    const _refreshCredentials = async () => {
        if (!serverPublicKey) return err("NO_PUBLIC_KEY_AVAILABLE");

        const envelope = await createEncryptedEnvelope(
            MessageType.GetCredentials,
            null,
            serverPublicKey.publicKeyJwk,
            serverPublicKey.keyId,
            "popup",
        );

        const res: EncryptedEnvelope | PlaintextEnvelope =
            await chrome.runtime.sendMessage(envelope);

        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<{
                ok: true;
                credentials: LiteCredential[];
            } | {
                ok: false;
                error: string;
            }>(res);

            if (!decryptedPayload?.ok) {
                console.error(
                    "Failed to decrypt encrypted response (GetCredentials):",
                    decryptedPayload.error,
                );
                return err("ENVELOPE_FAILED_DECRYPTION");
            }

            if (!decryptedPayload.payload.ok) {
                console.error("Failed to get credentials (GetCredentials):", decryptedPayload.payload.error);
                return err("FAILED_TO_GET_CREDENTIALS");
            }

            return ok(decryptedPayload.payload.credentials);
        }

        if (res.payload?.code === "STALE_KEY") {
            return err("STALE_KEY");
        }

        return err("UNKNOWN_NON_ENCRYPTED_ENVELOPE");
    };

    const _getSyncConfig = async () => {
        if (!serverPublicKey) return err("NO_PUBLIC_KEY_AVAILABLE");

        const envelope = await createEncryptedEnvelope(
            MessageType.SyncGetConfiguration,
            null,
            serverPublicKey.publicKeyJwk,
            serverPublicKey.keyId,
            "popup",
        );

        const res: EncryptedEnvelope | PlaintextEnvelope =
            await chrome.runtime.sendMessage(envelope);

        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<{
                ok: true;
                config: VaultUtilTypes.LinkedDevices;
            } | {
                ok: false;
                error: string;
            }>(res);

            if (!decryptedPayload?.ok) {
                console.error("Failed to decrypt encrypted response (SyncGetConfiguration):", decryptedPayload.error);
                return err("ENVELOPE_FAILED_DECRYPTION");
            }

            if (!decryptedPayload.payload.ok) {
                console.error("Failed to get synchronization configuration (SyncGetConfiguration):", decryptedPayload.payload.error);
                return err("FAILED_TO_GET_SYNCHRONIZATION_CONFIGURATION");
            }

            return ok({ 
                devices: decryptedPayload.payload.config.Devices, 
                apiKey: decryptedPayload.payload.config.APIKey,
            });
        }

        if (res.payload?.code === "STALE_KEY") {
            return err("STALE_KEY");
        }

        return err("UNKNOWN_NON_ENCRYPTED_ENVELOPE");
    };

    const requestCredential = async (id: string) => {
        if (!serverPublicKey) {
            console.error(
                "REQUEST_CREDENTIAL_FAILED: No server public key available for encrypted messaging",
            );
            return err("NO_PUBLIC_KEY_AVAILABLE");
        }
        setIsRefreshing(true);

        const res = await _requestCredential(id);
        if (res.isOk()) {
            setIsRefreshing(false);
            openEditForm(res.value);
            return ok();
        }

        if (res.error === "STALE_KEY") {
            const refreshKeyResult = await onStaleKeyError();
            if (refreshKeyResult.isErr()) {
                console.error(
                    "Failed to request credential, tried to refresh public key but failed: " +
                        refreshKeyResult.error,
                );
                setIsRefreshing(false);
                return err("FAILED_TO_REQUEST_CREDENTIAL_STALE_KEY");
            }

            const resRetry = await _requestCredential(id);
            if (resRetry.isErr()) {
                console.error(
                    "Failed to request credential after retrying: " +
                        resRetry.error,
                );
            } else {
                openEditForm(resRetry.value);
                setIsRefreshing(false);
                return ok();
            }
        } else {
            console.error("Failed to request credential: " + res.error);
        }

        setIsRefreshing(false);

        return err("FAILED_TO_REQUEST_CREDENTIAL");
    };

    const _requestCredential = async (id: string) => {
        if (!serverPublicKey) return err("NO_PUBLIC_KEY_AVAILABLE");

        const envelope: EncryptedEnvelope | PlaintextEnvelope =
            await createEncryptedEnvelope(
                MessageType.GetCredential,
                { id: id },
                serverPublicKey.publicKeyJwk,
                serverPublicKey.keyId,
                "popup",
            );

        const res: EncryptedEnvelope | PlaintextEnvelope =
            await chrome.runtime.sendMessage(envelope);

        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<
                | { ok: true; credential: VaultCredential }
                | { ok: false; error: string }
            >(res);

            if (!decryptedPayload?.ok || !decryptedPayload?.payload) {
                if (!decryptedPayload?.ok) {
                    return err(
                        "ENVELOPE_FAILED_DECRYPTION: " +
                            decryptedPayload?.error,
                    );
                }
                return err("ENVELOPE_PAYLOAD_NULL");
            }

            if (!decryptedPayload.payload.ok) {
                return err(
                    "CREDENTIAL_REQUEST_FAILED: " +
                        decryptedPayload.payload.error,
                );
            }

            return ok(decryptedPayload.payload.credential);
        }

        if (!res.payload?.ok && res.payload?.code === "STALE_KEY") {
            return err("STALE_KEY");
        }

        return err("UNKNOWN_NON_ENCRYPTED_ENVELOPE");
    };

    const openCreateForm = () => {
        setCredentialFormMode("create");
        setEditingCredential(null);
        credentialModalVisible[1](true);
        // Reset TOTP form data to default values
        setTotpFormData({
            Label: "",
            Secret: "",
            Period: 30,
            Digits: 6,
            Algorithm: VaultUtilTypes.TOTPAlgorithm.SHA1,
        });
        reset({
            ID: null,
            Type: VaultUtilTypes.ItemType.Credentials,
            GroupID: "",
            Name: "",
            Username: "",
            Password: "",
            TOTP: null,
            Tags: "",
            URL: "",
            Notes: "",
            CustomFields: [],
        });
    };

    const openEditForm = (credential: VaultCredential) => {
        setCredentialFormMode("edit");
        setEditingCredential(credential);
        credentialModalVisible[1](true);

        // Populate form with existing data
        reset({
            ID: credential.ID,
            Type: credential.Type,
            GroupID: credential.GroupID,
            Name: credential.Name,
            Username: credential.Username,
            Password: credential.Password,
            TOTP: credential.TOTP
                ? {
                      Label: credential.TOTP.Label,
                      Secret: credential.TOTP.Secret,
                      Period: credential.TOTP.Period,
                      Digits: credential.TOTP.Digits,
                      Algorithm: credential.TOTP.Algorithm,
                  }
                : null,
            Tags: credential.Tags || "",
            URL: credential.URL,
            Notes: credential.Notes,
            CustomFields: credential.CustomFields || [],
        });
    };

    const closeCredentialForm = () => {
        setCredentialFormMode(null);
        setEditingCredential(null);
        credentialModalVisible[1](false);
        // Reset TOTP form data to default values
        setTotpFormData({
            Label: "",
            Secret: "",
            Period: 30,
            Digits: 6,
            Algorithm: VaultUtilTypes.TOTPAlgorithm.SHA1,
        });
        reset();
    };

    const handleFormSubmit = async (formData: CredentialFormSchemaType) => {
        if (credentialFormMode === "create") {
            await createCredential(formData);
        } else if (credentialFormMode === "edit" && editingCredential) {
            await updateCredential(editingCredential.ID, formData);
        }
    };

    const handleTOTPSubmit = () => {
        setValue("TOTP", totpFormData);
        totpModalVisible[1](false);
    };

    const handleSyncNow = () => {
        if (GlobalSyncConnectionController && linkedDevicesRef.current.length > 0) {
            GlobalSyncConnectionController.transmitSyncHello(linkedDevicesRef.current[0].ID);
        }
    };

    useEffect(() => {
        refreshCredentials();

        // Clean up and close up the sync connection controller
        return () => {
            if (GlobalSyncConnectionController)
                GlobalSyncConnectionController.teardown();
        };
    }, []);

    useEffect(() => {
        // Clean up and close up the sync connection controller before we refresh it's instance w/ the new server public key
        if (GlobalSyncConnectionController) {
            GlobalSyncConnectionController.teardown();
            GlobalSyncConnectionController = null;
        }

        if (serverPublicKey) {
            GlobalSyncConnectionController = new SyncConnectionController(
                createVaultOperations(serverPublicKey, async () => {
                    await refreshCredentialsRef.current?.();
                }),
            );
            GlobalSyncConnectionController.init();

            // Initiate the connection to the linked devices
            (async () => {
                const syncConfig = await _getSyncConfig();
                if (syncConfig.isErr()) {
                    console.error("Failed to get synchronization configuration:", syncConfig.error);
                    return;
                }

                const { devices, apiKey } = syncConfig.value;

                setOnlineServicesAPIKey(apiKey ?? "");

                linkedDevicesRef.current = devices;
                if (devices.length > 0) {
                    const primaryDevice = devices[0];
                    setSignalingStatus(
                        GlobalSyncConnectionController.getSignalingStatus(
                            primaryDevice.SignalingServerID,
                        ),
                    );
                    setWebRTCStatus(
                        GlobalSyncConnectionController.getWebRTCStatus(
                            primaryDevice.ID,
                        ),
                    );
                }

                for (const device of devices) {
                    GlobalSyncConnectionController.registerSyncSignalingHandler(
                        device.SignalingServerID,
                        (event) => {
                            if (
                                event.data.connectionState ===
                                SynchronizationUtils.SignalingStatus.Connected
                            ) {
                                setSignalingStatus(
                                    SynchronizationUtils.SignalingStatus.Connected,
                                );
                            } else if (
                                event.data.connectionState ===
                                SynchronizationUtils.SignalingStatus.Disconnected
                            ) {
                                setSignalingStatus(
                                    SynchronizationUtils.SignalingStatus.Disconnected,
                                );
                            } else if (
                                event.data.connectionState ===
                                SynchronizationUtils.SignalingStatus.Connecting
                            ) {
                                setSignalingStatus(
                                    SynchronizationUtils.SignalingStatus.Connecting,
                                );
                            } else if (
                                event.data.connectionState ===
                                SynchronizationUtils.SignalingStatus.Unavailable
                            ) {
                                setSignalingStatus(
                                    SynchronizationUtils.SignalingStatus.Unavailable,
                                );
                            } else if (
                                event.data.connectionState ===
                                SynchronizationUtils.SignalingStatus.Failed
                            ) {
                                setSignalingStatus(
                                    SynchronizationUtils.SignalingStatus.Failed,
                                );
                            }
                        },
                    );

                    GlobalSyncConnectionController.registerSyncWebRTCHandler(
                        device.ID,
                        async (event) => {
                            if (event.type === SynchronizationUtils.SyncConnectionControllerEventType.ConnectionStatus) {
                                setWebRTCStatus(event.connectionState);

                                if (
                                    event.connectionState === SynchronizationUtils.WebRTCStatus.Disconnected ||
                                    event.connectionState === SynchronizationUtils.WebRTCStatus.Failed
                                ) {
                                    // Trigger a reconnection attempt
                                    await GlobalSyncConnectionController?.connectDevice(
                                        device.ID,
                                    );
                                }
                            }

                            if (event.type === SynchronizationUtils.SyncConnectionControllerEventType.SynchronizationMessage) {
                                if (event.event === SynchronizationUtils.WebRTCMessageEventType.Synchronized) {
                                    setLastSync(new Date());
                                } else if (event.event === SynchronizationUtils.WebRTCMessageEventType.ManualSyncNecessary) {
                                        // Trigger the manual synchronization dialog
                                        showManualSyncDialog.current(
                                            event.data,
                                            async (
                                                data: SynchronizationUtils.ManualConflictResolutionData,
                                            ) => {
                                                await GlobalSyncConnectionController?.confirmManualConflictResolution(
                                                    device.ID,
                                                    data,
                                                );
                                            },
                                            () => {
                                                // Warn the user that the vaults are still diverged
                                                // toast.warn(
                                                //     "Failed to solve the vault divergence. The vaults are still diverged.",
                                                // );
                                            },
                                        );

                                } else if (event.event === SynchronizationUtils.WebRTCMessageEventType.Error) {
                                    setWebRTCStatus(
                                        SynchronizationUtils.WebRTCStatus.Failed,
                                    );

                                    console.warn(
                                        "NOT IMPLEMENTED: Error",
                                        event,
                                    );
                                }
                            }
                        },
                    );

                    // TODO: figure out what to do with the VaultDataUpdate event... That crap was supposed to be used exclusively for triggering a UI update and not for updating global vault state

                    await GlobalSyncConnectionController.connectDevice(device.ID);
                }
            })();
        }
    }, [serverPublicKey]);

    return (
        <div className="flex flex-col">
            {/* Header with sync status */}
            <div className="flex items-center justify-between border-b border-border bg-background/80 px-3 py-2">
                <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-nowrap text-xs font-semibold text-foreground">
                        {name}
                    </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                    <ConnectionStatusIndicator
                        signaling={signalingStatus}
                        webrtc={webRTCStatus}
                    />
                    {lastSync ? (
                        <span className="text-xs text-muted-foreground">
                            Last sync {formatTimeAgo(lastSync)}
                        </span>
                    ) : null}
                </div>
            </div>

            {/* Search bar */}
            <div className="border-b border-border bg-background/50 px-3 py-2">
                <div className="relative">
                    <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        placeholder="Search credentials..."
                        value={searchQuery}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setSearchQuery(e.target.value)
                        }
                        className="h-6 border-border bg-input pl-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/20"
                    />
                </div>
            </div>

            {/* Credentials list */}
            <div className="flex-1 overflow-y-auto">
                {filteredCredentials.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                        <Shield className="mb-2 h-6 w-6 opacity-50" />
                        <p className="text-xs">No credentials found</p>
                    </div>
                ) : (
                    <div className="space-y-0 p-1">
                        {/* Implement a virtual list to improve performance */}
                        {filteredCredentials.map((credential) => (
                            <div
                                key={credential.id}
                                className="group cursor-pointer border-b border-border transition-all duration-200 last:border-b-0 hover:bg-muted/50 hover:shadow-sm"
                                onClick={async () =>
                                    isRefreshing
                                        ? null
                                        : await requestCredential(credential.id)
                                }
                                onContextMenu={(e: React.MouseEvent) => {
                                    e.preventDefault();

                                    // TODO: Open the dropdown menu
                                }}
                            >
                                <div className="flex items-center justify-between p-2">
                                    <div className="flex min-w-0 flex-1 items-center gap-2">
                                        <Avatar className="h-8 w-8">
                                            <AvatarImage src={credential.url} />
                                            <AvatarFallback>
                                                <Globe className="h-4 w-4" />
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-xs font-medium leading-tight text-foreground">
                                                {credential.name}
                                            </div>
                                            <div className="-mt-0.5 truncate text-xs leading-tight text-muted-foreground">
                                                {credential.username}
                                            </div>
                                        </div>
                                    </div>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger
                                            asChild
                                            onClick={(e: React.MouseEvent) =>
                                                e.stopPropagation()
                                            }
                                        >
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 w-5 p-0 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                                            >
                                                <MoreVertical className="h-3 w-3 text-muted-foreground" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            align="end"
                                            className="w-36"
                                        >
                                            <DropdownMenuItem
                                                onClick={async (
                                                    e: React.MouseEvent,
                                                ) => {
                                                    e.stopPropagation();
                                                    await requestCredential(
                                                        credential.id,
                                                    );
                                                }}
                                                className="text-xs"
                                            >
                                                <Edit className="mr-2 h-3 w-3" />
                                                Edit
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={async (e: React.MouseEvent) => {
                                                    e.stopPropagation();
                                                    await deleteCredential(
                                                        credential.id,
                                                    );
                                                }}
                                                className="text-xs text-destructive"
                                                disabled={isDeleting}
                                            >
                                                {isDeleting ? (
                                                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                                ) : (
                                                    <Trash2 className="mr-2 h-3 w-3" />
                                                )}
                                                {isDeleting
                                                    ? "Deleting..."
                                                    : "Delete"}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={async (e: React.MouseEvent) => {
                                                    e.stopPropagation();
                                                    copyToClipboard(
                                                        credential.username,
                                                    );
                                                }}
                                                className="text-xs"
                                            >
                                                <Copy className="mr-2 h-3 w-3" />
                                                Copy Username
                                            </DropdownMenuItem>
                                            {/* <DropdownMenuItem
                                                onClick={() => copyToClipboard(credential.password)}
                                                className="text-xs"
                                            >
                                                <Copy className="h-3 w-3 mr-2" />
                                                Copy Password
                                            </DropdownMenuItem> */}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Sync controls and add new credential button */}
            <div className="space-y-2 border-t border-border bg-background/50 p-2">
                <Button
                    variant="outline"
                    className="h-7 w-full text-xs"
                    size="sm"
                    onClick={openCreateForm}
                    disabled={
                        isCreating || isUpdating || isDeleting || isRefreshing
                    }
                >
                    <Plus className="mr-1.5 h-3 w-3" />
                    Add Credential
                </Button>

                <div className="flex gap-1">
                    <Button
                        variant="outline"
                        className="h-7 flex-1 text-xs"
                        size="sm"
                        onClick={handleSyncNow}
                        disabled={
                            isCreating ||
                            isUpdating ||
                            isDeleting ||
                            isRefreshing
                        }
                    >
                        <RefreshCw className="mr-1.5 h-3 w-3" />
                        Sync Now
                    </Button>

                    <Button
                        variant="outline"
                        className="h-7 flex-1 text-xs"
                        size="sm"
                        onClick={lockVaultFn}
                        disabled={
                            isCreating ||
                            isUpdating ||
                            isDeleting ||
                            isRefreshing
                        }
                    >
                        <LockKeyhole className="mr-1.5 h-3 w-3" />
                        Lock Vault
                    </Button>
                </div>
            </div>

            {/* Credential Form Dialog */}
            <Dialog
                open={credentialModalVisible[0]}
                onOpenChange={() => closeCredentialForm()}
            >
                <DialogContent
                    className="max-h-[90vh] w-96 max-w-md overflow-y-auto shadow-2xl"
                    aria-describedby={undefined}
                >
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-sm">
                            <Shield className="h-4 w-4" />
                            {credentialFormMode === "create"
                                ? "New Credential"
                                : "Edit Credential"}
                        </DialogTitle>
                    </DialogHeader>
                    <form
                        onSubmit={handleSubmit(handleFormSubmit)}
                        className="space-y-4"
                    >
                        {/* Name Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">
                                Name *
                            </Label>
                            <Input
                                {...register("Name")}
                                className="mt-1 w-full"
                                placeholder="Enter credential name"
                            />
                            {errors.Name && (
                                <p className="mt-1 text-xs text-destructive">
                                    {errors.Name.message}
                                </p>
                            )}
                        </div>

                        {/* Username Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">
                                Username
                            </Label>
                            <div className="mt-1 flex gap-1">
                                <Input
                                    {...register("Username")}
                                    className="mt-1 flex-1"
                                    placeholder="Enter username"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={() =>
                                        copyToClipboard(getValues("Username"))
                                    }
                                >
                                    <Copy className="h-3 w-3" />
                                </Button>
                            </div>
                            {errors.Username && (
                                <p className="mt-1 text-xs text-destructive">
                                    {errors.Username.message}
                                </p>
                            )}
                        </div>

                        {/* Password Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">
                                Password
                            </Label>
                            <div className="mt-1 flex gap-1">
                                <Input
                                    {...register("Password")}
                                    type={
                                        showFormPassword ? "text" : "password"
                                    }
                                    className="mt-1 flex-1"
                                    placeholder="Enter password"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-muted/50"
                                    onClick={() =>
                                        setShowFormPassword(!showFormPassword)
                                    }
                                >
                                    {showFormPassword ? (
                                        <EyeOff className="h-3 w-3 text-muted-foreground" />
                                    ) : (
                                        <Eye className="h-3 w-3 text-muted-foreground" />
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-muted/50"
                                    onClick={() =>
                                        copyToClipboard(getValues("Password"))
                                    }
                                >
                                    <Copy className="h-3 w-3 text-muted-foreground" />
                                </Button>
                            </div>
                            {errors.Password && (
                                <p className="mt-1 text-xs text-destructive">
                                    {errors.Password.message}
                                </p>
                            )}
                        </div>

                        {/* TOTP Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">
                                TOTP
                            </Label>
                            <Controller
                                control={control}
                                name="TOTP"
                                render={({ field: { onChange, value } }) => (
                                    <>
                                        {value != null ? (
                                            <div className="mt-1 rounded-md border border-border bg-muted/50 p-3">
                                                <TOTPControl
                                                    onChange={onChange}
                                                    value={value}
                                                />
                                            </div>
                                        ) : (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="mt-1 h-8 w-full border-border text-xs hover:bg-muted/50"
                                                onClick={() =>
                                                    totpModalVisible[1](true)
                                                }
                                            >
                                                Configure TOTP
                                            </Button>
                                        )}
                                    </>
                                )}
                            />
                            {errors.TOTP && (
                                <p className="mt-1 text-xs text-destructive">
                                    {errors.TOTP.message}
                                </p>
                            )}
                        </div>

                        {/* Tags Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">
                                Tags
                            </Label>
                            <Controller
                                control={control}
                                name="Tags"
                                render={({ field: { onChange, value } }) => (
                                    <div className="mt-1 rounded-md border border-border bg-muted/50 p-2">
                                        <TagBox
                                            onChange={onChange}
                                            value={value}
                                        />
                                    </div>
                                )}
                            />
                            {errors.Tags && (
                                <p className="mt-1 text-xs text-destructive">
                                    {errors.Tags.message}
                                </p>
                            )}
                        </div>

                        {/* URL Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">
                                Website (URL)
                            </Label>
                            <div className="mt-1 flex gap-1">
                                <Input
                                    {...register("URL")}
                                    type="url"
                                    className="mt-1 flex-1"
                                    placeholder="https://example.com"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-muted/50"
                                    onClick={() => {
                                        const url = getValues("URL");
                                        if (url) {
                                            const fullUrl = url.startsWith(
                                                "http",
                                            )
                                                ? url
                                                : `https://${url}`;
                                            window.open(fullUrl, "_blank");
                                        }
                                    }}
                                >
                                    <ArrowRightSquare className="h-3 w-3 text-muted-foreground" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-muted/50"
                                    onClick={() =>
                                        copyToClipboard(getValues("URL"))
                                    }
                                >
                                    <Copy className="h-3 w-3 text-muted-foreground" />
                                </Button>
                            </div>
                            {errors.URL && (
                                <p className="mt-1 text-xs text-destructive">
                                    {errors.URL.message}
                                </p>
                            )}
                        </div>

                        {/* Notes Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">
                                Notes
                            </Label>
                            <textarea
                                {...register("Notes")}
                                className="mt-1 w-full resize-none rounded-md border border-input bg-input p-2 text-xs text-foreground focus:border-ring focus:ring-ring/20"
                                placeholder="Add notes"
                                rows={3}
                            />
                            {errors.Notes && (
                                <p className="mt-1 text-xs text-destructive">
                                    {errors.Notes.message}
                                </p>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-2 border-t border-border pt-4">
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-8 flex-1 text-xs"
                                onClick={closeCredentialForm}
                                disabled={
                                    isCreating || isUpdating || isSubmitting
                                }
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                className="h-8 flex-1 text-xs"
                                disabled={
                                    isSubmitting || isCreating || isUpdating
                                }
                            >
                                {(isSubmitting || isCreating || isUpdating) && (
                                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                )}
                                {isCreating
                                    ? "Creating..."
                                    : isUpdating
                                      ? "Updating..."
                                      : isSubmitting
                                        ? "Saving..."
                                        : credentialFormMode === "create"
                                          ? "Create"
                                          : "Update"}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            {/* TOTP Configuration Dialog */}
            <Dialog
                open={totpModalVisible[0]}
                onOpenChange={() => totpModalVisible[1](false)}
            >
                <DialogContent
                    className="w-80 shadow-2xl"
                    aria-describedby={undefined}
                >
                    <DialogHeader>
                        <DialogTitle className="text-sm text-foreground">
                            Configure TOTP
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label className="text-xs text-muted-foreground">
                                Label
                            </Label>
                            <Input
                                value={totpFormData.Label}
                                onChange={(
                                    e: React.ChangeEvent<HTMLInputElement>,
                                ) =>
                                    setTotpFormData({
                                        ...totpFormData,
                                        Label: e.target.value,
                                    })
                                }
                                className="mt-1 text-xs"
                                placeholder="Account name"
                            />
                        </div>
                        <div>
                            <Label className="text-xs text-muted-foreground">
                                Secret
                            </Label>
                            <Input
                                value={totpFormData.Secret}
                                onChange={(
                                    e: React.ChangeEvent<HTMLInputElement>,
                                ) =>
                                    setTotpFormData({
                                        ...totpFormData,
                                        Secret: e.target.value,
                                    })
                                }
                                className="mt-1 font-mono text-xs"
                                placeholder="Enter TOTP secret"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label className="text-xs text-muted-foreground">
                                    Period
                                </Label>
                                <Input
                                    type="number"
                                    value={totpFormData.Period}
                                    onChange={(
                                        e: React.ChangeEvent<HTMLInputElement>,
                                    ) =>
                                        setTotpFormData({
                                            ...totpFormData,
                                            Period:
                                                parseInt(e.target.value) || 30,
                                        })
                                    }
                                    className="mt-1 text-xs"
                                    min="1"
                                />
                            </div>
                            <div>
                                <Label className="text-xs text-muted-foreground">
                                    Digits
                                </Label>
                                <Input
                                    type="number"
                                    value={totpFormData.Digits}
                                    onChange={(
                                        e: React.ChangeEvent<HTMLInputElement>,
                                    ) =>
                                        setTotpFormData({
                                            ...totpFormData,
                                            Digits:
                                                parseInt(e.target.value) || 6,
                                        })
                                    }
                                    className="mt-1 text-xs"
                                    min="1"
                                    max="10"
                                />
                            </div>
                        </div>
                        <div>
                            <Label className="text-xs text-muted-foreground">
                                Algorithm
                            </Label>
                            <select
                                value={totpFormData.Algorithm}
                                onChange={(e) =>
                                    setTotpFormData({
                                        ...totpFormData,
                                        Algorithm: e.target
                                            .value as unknown as VaultUtilTypes.TOTPAlgorithm,
                                    })
                                }
                                className="mt-1 w-full rounded-md border border-input bg-input p-2 text-xs text-foreground focus:border-ring focus:ring-ring/20"
                            >
                                <option
                                    value={VaultUtilTypes.TOTPAlgorithm.SHA1}
                                >
                                    SHA1
                                </option>
                                <option
                                    value={VaultUtilTypes.TOTPAlgorithm.SHA256}
                                >
                                    SHA256
                                </option>
                                <option
                                    value={VaultUtilTypes.TOTPAlgorithm.SHA512}
                                >
                                    SHA512
                                </option>
                            </select>
                        </div>
                        <div className="flex gap-2 border-t border-border pt-4">
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-8 flex-1 text-xs"
                                onClick={() => totpModalVisible[1](false)}
                                disabled={isSubmitting}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                className="h-8 flex-1 text-xs"
                                onClick={handleTOTPSubmit}
                                disabled={isSubmitting}
                            >
                                {isSubmitting && (
                                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                )}
                                {isSubmitting ? "Adding..." : "Add TOTP"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <ManualSynchronizationDialog
                showDialogFnRef={showManualSyncDialog}
                showWarningDialog={showWarningDialogFnRef.current}
            />
            <WarningDialog
                showFnRef={showWarningDialogFnRef}
            />
        </div>
    );
};

export default VaultView;
