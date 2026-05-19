import * as VaultUtilTypes from "@/app_lib/proto/vault";
import * as SynchronizationUtils from "@/app_lib/synchronization-utils";
import * as Vault from "@/app_lib/vault-utils/vault";
import {
    calculateTOTP,
    CredentialFormSchemaType,
    VaultCredential,
} from "@/app_lib/vault-utils/vault";
import { CredentialDetail } from "@/components/vault-dashboard/credential-detail";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    ArrowRightSquare,
    Copy,
    Edit,
    Eye,
    EyeOff,
    FileText,
    Globe,
    GripVertical,
    Key,
    Link as LinkIcon,
    Loader2,
    LockKeyhole,
    MoreVertical,
    Plus,
    PlusCircle,
    RefreshCw,
    Search,
    Shield,
    Trash2,
    User,
    X,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
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
    DialogDescription,
    DialogFooter,
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
import { PasswordGeneratorDialog } from "@/components/ui/password-generator";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { err, ok, Result } from "neverthrow";
import { validateEnvelope } from "./utils/security-utils";
import { WarningDialog, WarningDialogShowFn } from "@/components/dialog/warning";
import { CredentialConstants, TOTPConstants } from "@/utils/consts";

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
    const [selectedCredential, setSelectedCredential] =
        useState<VaultCredential | null>(null);

    // Modal states
    const credentialModalVisible = useState(false);
    const [showPasswordGenerator, setShowPasswordGenerator] = useState(false);

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
        formState: { errors, isSubmitting, isDirty },
        reset,
        setValue,
        getValues,
        watch,
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

    const {
        fields: customFields,
        append: appendCustomField,
        remove: removeCustomField,
    } = useFieldArray({
        control,
        name: "CustomFields",
    });

    const watchedTotp = watch("TOTP");

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
        const tagSeparator = CredentialConstants.TAG_SEPARATOR;

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

            // Reload selected credential to reflect new data in detail pane
            if (selectedCredential?.ID === id) {
                const reloaded = await loadFullCredential(id);
                if (reloaded.isOk()) {
                    setSelectedCredential(reloaded.value);
                }
            }

            credentialModalVisible[1](false);
            setCredentialFormMode(null);
            setEditingCredential(null);
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
            if (selectedCredential?.ID === id) {
                setSelectedCredential(null);
            }
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
                if (selectedCredential?.ID === id) {
                    setSelectedCredential(null);
                }
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
            });
        }

        if (res.payload?.code === "STALE_KEY") {
            return err("STALE_KEY");
        }

        return err("UNKNOWN_NON_ENCRYPTED_ENVELOPE");
    };

    const loadFullCredential = async (
        id: string,
    ): Promise<Result<VaultCredential, string>> => {
        if (!serverPublicKey) {
            console.error(
                "LOAD_CREDENTIAL_FAILED: No server public key available for encrypted messaging",
            );
            return err("NO_PUBLIC_KEY_AVAILABLE");
        }

        const res = await _requestCredential(id);
        if (res.isOk()) {
            return ok(res.value);
        }

        if (res.error === "STALE_KEY") {
            const refreshKeyResult = await onStaleKeyError();
            if (refreshKeyResult.isErr()) {
                console.error(
                    "Failed to request credential, tried to refresh public key but failed: " +
                        refreshKeyResult.error,
                );
                return err("FAILED_TO_REQUEST_CREDENTIAL_STALE_KEY");
            }

            const resRetry = await _requestCredential(id);
            if (resRetry.isErr()) {
                console.error(
                    "Failed to request credential after retrying: " +
                        resRetry.error,
                );
                return err("FAILED_TO_REQUEST_CREDENTIAL");
            }
            return ok(resRetry.value);
        }

        console.error("Failed to request credential: " + res.error);
        return err("FAILED_TO_REQUEST_CREDENTIAL");
    };

    const selectCredential = async (id: string) => {
        setIsRefreshing(true);
        const res = await loadFullCredential(id);
        setIsRefreshing(false);
        if (res.isOk()) {
            setSelectedCredential(res.value);
            return ok();
        }
        return err(res.error);
    };

    const requestEditCredential = async (id: string) => {
        setIsRefreshing(true);
        const res = await loadFullCredential(id);
        setIsRefreshing(false);
        if (res.isOk()) {
            openEditForm(res.value);
            return ok();
        }
        return err(res.error);
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
        setShowFormPassword(false);
        credentialModalVisible[1](true);
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
        setShowFormPassword(false);
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
        setShowFormPassword(false);
        credentialModalVisible[1](false);
        reset();
    };

    const requestCloseCredentialForm = () => {
        if (isSubmitting || isCreating || isUpdating) return;

        if (isDirty) {
            showWarningDialogFnRef.current?.(
                "You have unsaved changes.",
                () => closeCredentialForm(),
                null,
                "Discard changes",
            );
            return;
        }

        closeCredentialForm();
    };

    const handleFormSubmit = async (formData: CredentialFormSchemaType) => {
        const normalized: CredentialFormSchemaType = {
            ...formData,
            Tags: formData.Tags ?? "",
            CustomFields: (formData.CustomFields ?? []).filter(
                (field) => field.Name.trim() && field.Value.trim(),
            ),
        };

        if (credentialFormMode === "create") {
            await createCredential(normalized);
        } else if (credentialFormMode === "edit" && editingCredential) {
            await updateCredential(editingCredential.ID, normalized);
        }
    };

    const handleTotpToggle = (enabled: boolean) => {
        if (!enabled) {
            setValue("TOTP", null, {
                shouldDirty: true,
                shouldValidate: true,
            });
            return;
        }

        setValue(
            "TOTP",
            watchedTotp ?? {
                Label: "",
                Secret: "",
                Period: TOTPConstants.PERIOD_DEFAULT,
                Digits: TOTPConstants.DIGITS_DEFAULT,
                Algorithm: TOTPConstants.ALGORITHM_DEFAULT,
            },
            {
                shouldDirty: true,
                shouldValidate: true,
            },
        );
    };

    const handleAddCustomField = () => {
        appendCustomField({
            ID: `custom-${Date.now()}`,
            Name: "",
            Type: VaultUtilTypes.CustomFieldType.Text,
            Value: "",
        });
    };

    const handleGeneratedPasswordSelect = (newPassword: string) => {
        setValue("Password", newPassword, {
            shouldDirty: true,
            shouldValidate: true,
        });
        setShowFormPassword(true);
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

                const { devices } = syncConfig.value;

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

    const handleCopyUsername = (cred: VaultCredential) => {
        copyToClipboard(cred.Username);
    };

    const handleCopyPassword = (cred: VaultCredential) => {
        copyToClipboard(cred.Password);
    };

    const handleCopyTOTP = (cred: VaultCredential) => {
        if (!cred.TOTP) return;
        try {
            const { code } = calculateTOTP(cred.TOTP);
            copyToClipboard(code);
        } catch (e) {
            console.error("Failed to compute TOTP code:", e);
        }
    };

    const handleOpenUrl = (cred: VaultCredential) => {
        if (!cred.URL) return;
        const fullUrl = cred.URL.startsWith("http")
            ? cred.URL
            : `https://${cred.URL}`;
        window.open(fullUrl, "_blank");
    };

    const handleDeleteSelected = async (cred: VaultCredential) => {
        await deleteCredential(cred.ID);
    };

    return (
        <div className="flex h-full flex-col">
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

            {/* Body: split pane */}
            <div className="flex min-h-0 flex-1">
                {/* Left pane: search + list + add */}
                <aside className="flex w-[280px] flex-shrink-0 flex-col border-r border-border bg-background/40">
                    <div className="border-b border-border bg-background/50 px-3 py-2">
                        <div className="relative">
                            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Search credentials..."
                                value={searchQuery}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setSearchQuery(e.target.value)
                                }
                                className="h-7 border-border bg-input pl-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/20"
                            />
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {filteredCredentials.length === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center px-3 text-center text-muted-foreground">
                                <Shield className="mb-2 h-6 w-6 opacity-50" />
                                <p className="text-xs">No credentials found</p>
                            </div>
                        ) : (
                            <div className="space-y-0 p-1">
                                {filteredCredentials.map((credential) => {
                                    const isSelected =
                                        selectedCredential?.ID === credential.id;
                                    return (
                                        <div
                                            key={credential.id}
                                            role="button"
                                            tabIndex={0}
                                            className={`group cursor-pointer rounded-md border transition-all duration-150 ${
                                                isSelected
                                                    ? "border-primary bg-primary/10"
                                                    : "border-transparent hover:border-border hover:bg-muted/50"
                                            }`}
                                            onClick={async () => {
                                                if (isRefreshing) return;
                                                await selectCredential(
                                                    credential.id,
                                                );
                                            }}
                                            onKeyDown={async (
                                                e: React.KeyboardEvent,
                                            ) => {
                                                if (
                                                    e.key === "Enter" ||
                                                    e.key === " "
                                                ) {
                                                    e.preventDefault();
                                                    if (isRefreshing) return;
                                                    await selectCredential(
                                                        credential.id,
                                                    );
                                                }
                                            }}
                                        >
                                            <div className="flex items-center justify-between p-2">
                                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                                    <Avatar className="h-8 w-8">
                                                        <AvatarImage
                                                            src={credential.url}
                                                        />
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
                                                        onClick={(
                                                            e: React.MouseEvent,
                                                        ) => e.stopPropagation()}
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
                                                                await requestEditCredential(
                                                                    credential.id,
                                                                );
                                                            }}
                                                            className="text-xs"
                                                        >
                                                            <Edit className="mr-2 h-3 w-3" />
                                                            Edit
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={async (
                                                                e: React.MouseEvent,
                                                            ) => {
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
                                                            onClick={async (
                                                                e: React.MouseEvent,
                                                            ) => {
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
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="border-t border-border bg-background/50 p-2">
                        <Button
                            className="h-8 w-full gap-2 text-xs"
                            size="sm"
                            onClick={openCreateForm}
                            disabled={
                                isCreating ||
                                isUpdating ||
                                isDeleting ||
                                isRefreshing
                            }
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Add Credential
                        </Button>
                    </div>
                </aside>

                {/* Right pane: detail */}
                <main className="flex min-w-0 flex-1 flex-col bg-card">
                    {selectedCredential ? (
                        <CredentialDetail
                            credential={selectedCredential}
                            isMobile
                            onEdit={(c) => openEditForm(c)}
                            onClose={() => setSelectedCredential(null)}
                            onCopyUsername={handleCopyUsername}
                            onCopyPassword={handleCopyPassword}
                            onCopyTOTP={handleCopyTOTP}
                            onOpenUrl={handleOpenUrl}
                            onDeleteCredential={handleDeleteSelected}
                        />
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                                <Key className="h-7 w-7 text-muted-foreground" />
                            </div>
                            <p className="text-sm font-medium text-foreground">
                                {credentials.length === 0
                                    ? "No credentials yet"
                                    : "Select a credential"}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                {credentials.length === 0
                                    ? "Add your first credential to get started"
                                    : "Choose an item from the list to view its details"}
                            </p>
                        </div>
                    )}
                </main>
            </div>

            {/* Footer: sync + lock */}
            <div className="border-t border-border bg-background/50 p-2">
                <div className="flex gap-2">
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
                onOpenChange={(open) => {
                    if (!open) requestCloseCredentialForm();
                }}
            >
                <DialogContent
                    className="flex max-h-[90vh] w-[520px] max-w-xl flex-col gap-0 p-0 shadow-2xl"
                    aria-describedby="credential-form-description"
                >
                    <DialogHeader className="border-b border-border px-5 py-4">
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <Shield className="h-4 w-4 text-primary" />
                            {credentialFormMode === "create"
                                ? "Add New Credential"
                                : "Edit Credential"}
                        </DialogTitle>
                        <DialogDescription
                            id="credential-form-description"
                            className="text-xs"
                        >
                            {credentialFormMode === "create"
                                ? "Add a new credential to your secure vault"
                                : "Update the details of this credential"}
                        </DialogDescription>
                    </DialogHeader>

                    <form
                        onSubmit={handleSubmit(handleFormSubmit)}
                        className="flex min-h-0 flex-1 flex-col"
                    >
                        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                            <div className="space-y-5">
                                {/* Basic Info */}
                                <div className="space-y-4">
                                    {/* Name */}
                                    <div className="space-y-1.5">
                                        <Label
                                            htmlFor="cred-name"
                                            className="text-xs font-medium"
                                        >
                                            Name{" "}
                                            <span className="text-destructive">
                                                *
                                            </span>
                                        </Label>
                                        <div className="relative">
                                            <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                            <Input
                                                id="cred-name"
                                                placeholder="e.g., GitHub, AWS Console"
                                                {...register("Name")}
                                                className={cn(
                                                    "h-9 pl-8 text-sm",
                                                    errors.Name &&
                                                        "border-destructive",
                                                )}
                                            />
                                        </div>
                                        {errors.Name && (
                                            <p className="text-xs text-destructive">
                                                {errors.Name.message}
                                            </p>
                                        )}
                                    </div>

                                    {/* Username */}
                                    <div className="space-y-1.5">
                                        <Label
                                            htmlFor="cred-username"
                                            className="text-xs font-medium"
                                        >
                                            Username / Email
                                        </Label>
                                        <div className="relative">
                                            <User className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                            <Input
                                                id="cred-username"
                                                placeholder="username@email.com"
                                                {...register("Username")}
                                                className={cn(
                                                    "h-9 pl-8 pr-9 text-sm",
                                                    errors.Username &&
                                                        "border-destructive",
                                                )}
                                            />
                                            <div className="absolute right-1 top-1/2 -translate-y-1/2">
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                onClick={() =>
                                                                    copyToClipboard(
                                                                        getValues(
                                                                            "Username",
                                                                        ),
                                                                    )
                                                                }
                                                            >
                                                                <Copy className="h-3 w-3 text-muted-foreground" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            Copy
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </div>
                                        </div>
                                        {errors.Username && (
                                            <p className="text-xs text-destructive">
                                                {errors.Username.message}
                                            </p>
                                        )}
                                    </div>

                                    {/* Password */}
                                    <div className="space-y-1.5">
                                        <Label
                                            htmlFor="cred-password"
                                            className="text-xs font-medium"
                                        >
                                            Password
                                        </Label>
                                        <div className="relative">
                                            <Key className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                            <Input
                                                id="cred-password"
                                                type={
                                                    showFormPassword
                                                        ? "text"
                                                        : "password"
                                                }
                                                placeholder="Enter password"
                                                {...register("Password")}
                                                className={cn(
                                                    "h-9 pl-8 pr-[7rem] font-mono text-sm",
                                                    errors.Password &&
                                                        "border-destructive",
                                                )}
                                            />
                                            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                onClick={() =>
                                                                    setShowFormPassword(
                                                                        !showFormPassword,
                                                                    )
                                                                }
                                                            >
                                                                {showFormPassword ? (
                                                                    <EyeOff className="h-3 w-3 text-muted-foreground" />
                                                                ) : (
                                                                    <Eye className="h-3 w-3 text-muted-foreground" />
                                                                )}
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            {showFormPassword
                                                                ? "Hide"
                                                                : "Show"}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                onClick={() =>
                                                                    setShowPasswordGenerator(
                                                                        true,
                                                                    )
                                                                }
                                                            >
                                                                <RefreshCw className="h-3 w-3 text-muted-foreground" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            Generate password
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                onClick={() =>
                                                                    copyToClipboard(
                                                                        getValues(
                                                                            "Password",
                                                                        ),
                                                                    )
                                                                }
                                                            >
                                                                <Copy className="h-3 w-3 text-muted-foreground" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            Copy
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </div>
                                        </div>
                                        {errors.Password && (
                                            <p className="text-xs text-destructive">
                                                {errors.Password.message}
                                            </p>
                                        )}
                                    </div>

                                    {/* URL */}
                                    <div className="space-y-1.5">
                                        <Label
                                            htmlFor="cred-url"
                                            className="text-xs font-medium"
                                        >
                                            Website URL
                                        </Label>
                                        <div className="relative">
                                            <LinkIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                            <Input
                                                id="cred-url"
                                                type="url"
                                                placeholder="https://example.com"
                                                {...register("URL")}
                                                className={cn(
                                                    "h-9 pl-8 pr-[4.5rem] text-sm",
                                                    errors.URL &&
                                                        "border-destructive",
                                                )}
                                            />
                                            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                onClick={() => {
                                                                    const url =
                                                                        getValues(
                                                                            "URL",
                                                                        );
                                                                    if (!url)
                                                                        return;
                                                                    const fullUrl =
                                                                        url.startsWith(
                                                                            "http",
                                                                        )
                                                                            ? url
                                                                            : `https://${url}`;
                                                                    window.open(
                                                                        fullUrl,
                                                                        "_blank",
                                                                    );
                                                                }}
                                                            >
                                                                <ArrowRightSquare className="h-3 w-3 text-muted-foreground" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            Open
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                onClick={() =>
                                                                    copyToClipboard(
                                                                        getValues(
                                                                            "URL",
                                                                        ),
                                                                    )
                                                                }
                                                            >
                                                                <Copy className="h-3 w-3 text-muted-foreground" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            Copy
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </div>
                                        </div>
                                        {errors.URL && (
                                            <p className="text-xs text-destructive">
                                                {errors.URL.message}
                                            </p>
                                        )}
                                    </div>

                                    {/* Tags */}
                                    <div className="space-y-1.5">
                                        <Label className="text-xs font-medium">
                                            Tags
                                        </Label>
                                        <Controller
                                            control={control}
                                            name="Tags"
                                            render={({
                                                field: { onChange, value },
                                            }) => (
                                                <TagBox
                                                    onChange={onChange}
                                                    value={value}
                                                />
                                            )}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Press Enter to add a tag
                                        </p>
                                        {errors.Tags && (
                                            <p className="text-xs text-destructive">
                                                {errors.Tags.message}
                                            </p>
                                        )}
                                    </div>

                                    {/* Notes */}
                                    <div className="space-y-1.5">
                                        <Label
                                            htmlFor="cred-notes"
                                            className="text-xs font-medium"
                                        >
                                            Notes
                                        </Label>
                                        <Textarea
                                            id="cred-notes"
                                            placeholder="Add any additional notes..."
                                            {...register("Notes")}
                                            className="min-h-[72px] resize-none text-sm"
                                        />
                                        {errors.Notes && (
                                            <p className="text-xs text-destructive">
                                                {errors.Notes.message}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* TOTP */}
                                <Separator />
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label className="text-xs font-medium">
                                                Two-Factor Authentication
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                Enable TOTP for this credential
                                            </p>
                                        </div>
                                        <Switch
                                            checked={!!watchedTotp}
                                            onCheckedChange={handleTotpToggle}
                                        />
                                    </div>
                                    {watchedTotp && (
                                        <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                                            <div className="space-y-1.5">
                                                <Label
                                                    htmlFor="totp-label"
                                                    className="text-xs"
                                                >
                                                    TOTP Label
                                                </Label>
                                                <Input
                                                    id="totp-label"
                                                    placeholder="Credential"
                                                    {...register("TOTP.Label")}
                                                    className="h-8 text-sm"
                                                />
                                                {errors.TOTP?.Label && (
                                                    <p className="text-xs text-destructive">
                                                        {
                                                            errors.TOTP.Label
                                                                .message
                                                        }
                                                    </p>
                                                )}
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label
                                                    htmlFor="totp-secret"
                                                    className="text-xs"
                                                >
                                                    TOTP Secret
                                                </Label>
                                                <Input
                                                    id="totp-secret"
                                                    placeholder="Base32 secret"
                                                    {...register("TOTP.Secret")}
                                                    className="h-8 font-mono text-sm"
                                                />
                                                {errors.TOTP?.Secret && (
                                                    <p className="text-xs text-destructive">
                                                        {
                                                            errors.TOTP.Secret
                                                                .message
                                                        }
                                                    </p>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1.5">
                                                    <Label
                                                        htmlFor="totp-period"
                                                        className="text-xs"
                                                    >
                                                        Period (seconds)
                                                    </Label>
                                                    <Input
                                                        id="totp-period"
                                                        type="number"
                                                        min={1}
                                                        {...register(
                                                            "TOTP.Period",
                                                            {
                                                                valueAsNumber:
                                                                    true,
                                                            },
                                                        )}
                                                        className="h-8 text-sm"
                                                    />
                                                    {errors.TOTP?.Period && (
                                                        <p className="text-xs text-destructive">
                                                            {
                                                                errors.TOTP
                                                                    .Period
                                                                    .message
                                                            }
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="space-y-1.5">
                                                    <Label
                                                        htmlFor="totp-digits"
                                                        className="text-xs"
                                                    >
                                                        Digits
                                                    </Label>
                                                    <Input
                                                        id="totp-digits"
                                                        type="number"
                                                        min={1}
                                                        {...register(
                                                            "TOTP.Digits",
                                                            {
                                                                valueAsNumber:
                                                                    true,
                                                            },
                                                        )}
                                                        className="h-8 text-sm"
                                                    />
                                                    {errors.TOTP?.Digits && (
                                                        <p className="text-xs text-destructive">
                                                            {
                                                                errors.TOTP
                                                                    .Digits
                                                                    .message
                                                            }
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs">
                                                    Algorithm
                                                </Label>
                                                <Controller
                                                    name="TOTP.Algorithm"
                                                    control={control}
                                                    render={({ field }) => (
                                                        <Select
                                                            value={String(
                                                                field.value ??
                                                                    TOTPConstants.ALGORITHM_DEFAULT,
                                                            )}
                                                            onValueChange={(
                                                                value,
                                                            ) =>
                                                                field.onChange(
                                                                    Number(
                                                                        value,
                                                                    ),
                                                                )
                                                            }
                                                        >
                                                            <SelectTrigger className="h-8 text-sm">
                                                                <SelectValue placeholder="Select algorithm" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem
                                                                    value={String(
                                                                        VaultUtilTypes
                                                                            .TOTPAlgorithm
                                                                            .SHA1,
                                                                    )}
                                                                >
                                                                    SHA1
                                                                </SelectItem>
                                                                <SelectItem
                                                                    value={String(
                                                                        VaultUtilTypes
                                                                            .TOTPAlgorithm
                                                                            .SHA256,
                                                                    )}
                                                                >
                                                                    SHA256
                                                                </SelectItem>
                                                                <SelectItem
                                                                    value={String(
                                                                        VaultUtilTypes
                                                                            .TOTPAlgorithm
                                                                            .SHA512,
                                                                    )}
                                                                >
                                                                    SHA512
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    )}
                                                />
                                                {errors.TOTP?.Algorithm && (
                                                    <p className="text-xs text-destructive">
                                                        {
                                                            errors.TOTP
                                                                .Algorithm
                                                                .message
                                                        }
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Custom Fields */}
                                <Separator />
                                <div>
                                    <div className="mb-3 flex items-center justify-between">
                                        <div>
                                            <Label className="text-xs font-medium">
                                                Custom Fields
                                            </Label>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                Add additional information
                                            </p>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleAddCustomField}
                                            className="h-7 gap-1.5 text-xs"
                                        >
                                            <Plus className="h-3 w-3" />
                                            Add Field
                                        </Button>
                                    </div>

                                    {customFields.length > 0 ? (
                                        <div className="space-y-2">
                                            {customFields.map(
                                                (field, index) => {
                                                    const fieldType = watch(
                                                        `CustomFields.${index}.Type`,
                                                    );
                                                    return (
                                                        <div
                                                            key={field.id}
                                                            className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5"
                                                        >
                                                            <GripVertical className="mt-2 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                                                            <div className="flex-1 space-y-2">
                                                                <Input
                                                                    placeholder="Field name"
                                                                    {...register(
                                                                        `CustomFields.${index}.Name`,
                                                                    )}
                                                                    className="h-8 text-sm"
                                                                />
                                                                <div className="flex items-center gap-2">
                                                                    <Input
                                                                        placeholder="Value"
                                                                        type={
                                                                            fieldType ===
                                                                            VaultUtilTypes
                                                                                .CustomFieldType
                                                                                .MaskedText
                                                                                ? "password"
                                                                                : "text"
                                                                        }
                                                                        {...register(
                                                                            `CustomFields.${index}.Value`,
                                                                        )}
                                                                        className="h-8 font-mono text-sm"
                                                                    />
                                                                    <Controller
                                                                        control={
                                                                            control
                                                                        }
                                                                        name={`CustomFields.${index}.Type`}
                                                                        render={({
                                                                            field:
                                                                                typeField,
                                                                        }) => (
                                                                            <Select
                                                                                value={String(
                                                                                    typeField.value ??
                                                                                        VaultUtilTypes
                                                                                            .CustomFieldType
                                                                                            .Text,
                                                                                )}
                                                                                onValueChange={(
                                                                                    value,
                                                                                ) =>
                                                                                    typeField.onChange(
                                                                                        Number(
                                                                                            value,
                                                                                        ),
                                                                                    )
                                                                                }
                                                                            >
                                                                                <SelectTrigger className="h-8 w-24 text-xs">
                                                                                    <SelectValue />
                                                                                </SelectTrigger>
                                                                                <SelectContent>
                                                                                    <SelectItem
                                                                                        value={String(
                                                                                            VaultUtilTypes
                                                                                                .CustomFieldType
                                                                                                .Text,
                                                                                        )}
                                                                                    >
                                                                                        Text
                                                                                    </SelectItem>
                                                                                    <SelectItem
                                                                                        value={String(
                                                                                            VaultUtilTypes
                                                                                                .CustomFieldType
                                                                                                .MaskedText,
                                                                                        )}
                                                                                    >
                                                                                        Hidden
                                                                                    </SelectItem>
                                                                                </SelectContent>
                                                                            </Select>
                                                                        )}
                                                                    />
                                                                </div>
                                                            </div>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() =>
                                                                    removeCustomField(
                                                                        index,
                                                                    )
                                                                }
                                                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    );
                                                },
                                            )}
                                        </div>
                                    ) : (
                                        <div className="rounded-md border border-dashed border-border py-5 text-center">
                                            <FileText className="mx-auto mb-1.5 h-6 w-6 text-muted-foreground" />
                                            <p className="text-xs text-muted-foreground">
                                                No custom fields yet
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <DialogFooter className="border-t border-border bg-background/50 px-5 py-3">
                            <div className="flex w-full items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-8 flex-1 text-xs"
                                    onClick={requestCloseCredentialForm}
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
                                    {(isSubmitting ||
                                        isCreating ||
                                        isUpdating) && (
                                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                    )}
                                    {isCreating
                                        ? "Creating..."
                                        : isUpdating
                                          ? "Saving..."
                                          : isSubmitting
                                            ? "Saving..."
                                            : credentialFormMode === "create"
                                              ? "Create Credential"
                                              : "Save Changes"}
                                </Button>
                            </div>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <PasswordGeneratorDialog
                open={showPasswordGenerator}
                onOpenChange={setShowPasswordGenerator}
                onPasswordSelect={handleGeneratedPasswordSelect}
            />

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
