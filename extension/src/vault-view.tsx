import { Globe, X, PlusCircle, ArrowRightSquare, Clipboard, EyeOff, Copy, Edit, Trash2, MoreVertical, Plus, Shield, Wifi, WifiOff, Clock, Search, Loader2, Eye } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TOTP } from "otpauth";
import { LiteCredential, MessageType, EncryptedEnvelope, PlaintextEnvelope } from "./types/sw-messaging";
import { createEncryptedEnvelope, decryptResponseEnvelope, isEncryptedEnvelope } from "./utils/session-utils";
import { VaultCredential, CredentialFormSchemaType } from "@/app_lib/vault-utils/vault";
import { TOTPFormSchemaType } from "@/app_lib/vault-utils/form-schemas";
import * as VaultUtilTypes from "@/app_lib/proto/vault";
import * as Vault from "@/app_lib/vault-utils/vault";

// Shadcn UI Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { validateEnvelope } from "./utils/security-utils";
import { err, ok, Result } from "neverthrow";

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


const VaultView: React.FC<VaultViewProps> = ({
    name,
    lockVaultFn,
    serverPublicKey,
    onStaleKeyError,
}) => {
    const [credentials, setCredentials] = useState<LiteCredential[]>([])
    const [credentialFormMode, setCredentialFormMode] = useState<CredentialFormMode>(null)
    const [editingCredential, setEditingCredential] = useState<VaultCredential | null>(null)

    // Modal states
    const credentialModalVisible = useState(false)
    const totpModalVisible = useState(false)

    // Loading states for CRUD operations
    const [isCreating, setIsCreating] = useState(false)
    const [isUpdating, setIsUpdating] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [refreshing, setRefreshing] = useState(false)

    const [searchQuery, setSearchQuery] = useState("")
    const [showFormPassword, setShowFormPassword] = useState(false)
    const [syncStatus, setSyncStatus] = useState<"connected" | "syncing" | "disconnected">("disconnected")
    const [lastSync, setLastSync] = useState<Date | null>(null)

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
            DateCreated: new Date().toISOString(),
            DateModified: undefined,
            DatePasswordChanged: undefined,
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
    )

    const copyToClipboard = async (text?: string) => {
        if (!text) {
            return;
        }

        try {
            await navigator.clipboard.writeText(text)
        } catch (err) {
            console.error("Failed to copy to clipboard:", err)
        }
    }

    const formatTimeAgo = (date: Date) => {
        const now = new Date()
        const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60))

        if (diffInMinutes < 1) return "Just now"
        if (diffInMinutes < 60) return `${diffInMinutes}m ago`
        if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`
        return `${Math.floor(diffInMinutes / 1440)}d ago`
    }

    // TagBox Component
    const TagBox: React.FC<{
        value: string | undefined;
        onChange: (tags: string) => void;
    }> = ({ value, onChange }) => {
        const tagSeparator = ",";

        const [inputValue, setInputValue] = useState("");
        const [inputFocused, setInputFocused] = useState(false);

        const tagInputRef = useRef<HTMLInputElement>(null);

        const tagArrayValue = value ? value.split(tagSeparator).filter(tag => tag.trim()) : [];

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
                        <span className="text-xs text-muted-foreground">{tag}</span>
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
                        className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
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
                                                                onClick={() => navigator.clipboard.writeText(codeRef.current)}
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

    const getSyncStatusIcon = () => {
        if (refreshing) {
            return <Loader2 className="h-3 w-3 text-primary animate-spin" />
        }
        switch (syncStatus) {
            case "connected":
                return <Wifi className="h-3 w-3 text-green-500" />
            case "syncing":
                return <Clock className="h-3 w-3 text-yellow-500 animate-spin" />
            case "disconnected":
                return <WifiOff className="h-3 w-3 text-red-500" />
        }
    }

    const getSyncStatusText = () => {
        if (refreshing) {
            return "Refreshing..."
        }
        switch (syncStatus) {
            case "connected":
                return "Synced"
            case "syncing":
                return "Syncing..."
            case "disconnected":
                return "Offline"
        }
    }

    // Credential CRUD operations
    const createCredential = async (formData: CredentialFormSchemaType) => {
        if (!serverPublicKey) {
            console.error("CREDENTIAL_CREATE_FAILED: No server public key available for encrypted messaging");
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
                console.error("Failed to create credential, tried to refresh public key but failed: " + refreshKeyResult.error);
                return err("FAILED_TO_CREATE_CREDENTIAL_STALE_KEY");
            }

            const resRetry = await _createCredential(formData);
            if (resRetry.isErr()) {
                console.error("Failed to create credential after retrying: " + resRetry.error);
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
            "popup"
        );

        const res: EncryptedEnvelope | PlaintextEnvelope = await chrome.runtime.sendMessage(envelope);
        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<
                { ok: true; credential: LiteCredential } |
                { ok: false; error: string }
            >(res);
            if (!decryptedPayload?.ok || !decryptedPayload?.payload) {
                if (!decryptedPayload?.ok) {
                    return err("ENVELOPE_FAILED_DECRYPTION: " + decryptedPayload?.error);
                }
                return err("ENVELOPE_PAYLOAD_NULL");
            }

            if (!decryptedPayload.payload.ok) {
                return err("CREDENTIAL_CREATE_FAILED: " + decryptedPayload.payload.error);
            }

            return ok();
        }

        if (!res.payload?.ok && res.payload?.code === "STALE_KEY") {
            return err("STALE_KEY");
        }
        
        return err("UNKNOWN_NON_ENCRYPTED_ENVELOPE");
    };

    const updateCredential = async (id: string, formData: CredentialFormSchemaType) => {
        if (!serverPublicKey) {
            console.error("CREDENTIAL_UPDATE_FAILED: No server public key available for encrypted messaging");
            return err("NO_PUBLIC_KEY_AVAILABLE");
        }

        const successFn = () => {
            setIsUpdating(false);

            // Refresh credentials list
            refreshCredentials();

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
            successFn();
            return ok();
        }

        if (res.error === "STALE_KEY") {
            const refreshKeyResult = await onStaleKeyError();
            if (refreshKeyResult.isErr()) {
                console.error("Failed to update credential, tried to refresh public key but failed: " + refreshKeyResult.error);
                return err("FAILED_TO_UPDATE_CREDENTIAL_STALE_KEY");
            }

            const resRetry = await _updateCredential(id, formData);
            if (resRetry.isErr()) {
                console.error("Failed to update credential after retrying: " + resRetry.error);
            } else {
                successFn();
                return ok();
            }
        } else {
            console.error("Failed to update credential: " + res.error);
        }

        setIsUpdating(false);

        return err("FAILED_TO_UPDATE_CREDENTIAL");
    };

    const _updateCredential = async (id: string, formData: CredentialFormSchemaType) => {
        if (!serverPublicKey) return err("NO_PUBLIC_KEY_AVAILABLE");

        const envelope = await createEncryptedEnvelope(
            MessageType.UpdateCredential,
            { id, form: formData },
            serverPublicKey.publicKeyJwk,
            serverPublicKey.keyId,
            "popup"
        );

        const res: EncryptedEnvelope | PlaintextEnvelope = await chrome.runtime.sendMessage(envelope);

        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<
                { ok: true; credential: LiteCredential } |
                { ok: false; error: string }
            >(res);
            if (!decryptedPayload?.ok || !decryptedPayload?.payload) {
                if (!decryptedPayload?.ok) {
                    return err("ENVELOPE_FAILED_DECRYPTION: " + decryptedPayload?.error);
                }
                return err("ENVELOPE_PAYLOAD_NULL");
            }

            if (!decryptedPayload.payload.ok) {
                return err("CREDENTIAL_UPDATE_FAILED: " + decryptedPayload.payload.error);
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
            console.error("CREDENTIAL_DELETE_FAILED: No server public key available for encrypted messaging");
            return err("NO_PUBLIC_KEY_AVAILABLE");
        }

        setIsDeleting(true);
        
        const res = await _deleteCredential(id);

        if (res.isOk()) {
            refreshCredentials();
            setIsDeleting(false);
            return ok();
        }

        if (res.error === "STALE_KEY") {
            const refreshKeyResult = await onStaleKeyError();
            if (refreshKeyResult.isErr()) {
                console.error("Failed to delete credential, tried to refresh public key but failed: " + refreshKeyResult.error);
                return err("FAILED_TO_DELETE_CREDENTIAL_STALE_KEY");
            }

            const resRetry = await _deleteCredential(id);
            if (resRetry.isErr()) {
                console.error("Failed to delete credential after retrying: " + resRetry.error);
            } else {
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
            "popup"
        );

        const res: EncryptedEnvelope | PlaintextEnvelope = await chrome.runtime.sendMessage(envelope);
        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<{ ok: true } | { ok: false; error: string }>(res);
            if (!decryptedPayload?.ok || !decryptedPayload?.payload) {
                if (!decryptedPayload?.ok) {
                    return err("ENVELOPE_FAILED_DECRYPTION: " + decryptedPayload?.error);
                }
                return err("ENVELOPE_PAYLOAD_NULL");
            }

            if (!decryptedPayload.payload.ok) {
                return err("CREDENTIAL_DELETE_FAILED: " + decryptedPayload.payload.error);
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
            console.error("REFRESH_CREDENTIALS_FAILED: No server public key available for encrypted messaging");
            return err("NO_PUBLIC_KEY_AVAILABLE");
        }

        setRefreshing(true);
        const res = await _refreshCredentials();
        if (res.isOk()) {
            setCredentials(res.value);
            setRefreshing(false);
            return ok();
        }

        if (res.error === "STALE_KEY") {
            const refreshKeyResult = await onStaleKeyError();
            if (refreshKeyResult.isErr()) {
                console.error("Failed to refresh credentials, tried to refresh public key but failed: " + refreshKeyResult.error);
                return err("FAILED_TO_REFRESH_CREDENTIALS_STALE_KEY");
            }

            const resRetry = await _refreshCredentials();
            if (resRetry.isErr()) {
                console.error("Failed to refresh credentials after retrying: " + resRetry.error);
            } else {
                setCredentials(resRetry.value);
                setRefreshing(false);
                return ok();
            }
        } else {
            console.error("Failed to refresh credentials: " + res.error);
        }

        setRefreshing(false);

        return err("FAILED_TO_REFRESH_CREDENTIALS");
    };

    const _refreshCredentials = async () => {
        if (!serverPublicKey) return err("NO_PUBLIC_KEY_AVAILABLE");

        const envelope = await createEncryptedEnvelope(MessageType.GetCredentials, null, serverPublicKey.publicKeyJwk, serverPublicKey.keyId, "popup");

        const res: EncryptedEnvelope | PlaintextEnvelope = await chrome.runtime.sendMessage(envelope);

        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<{ credentials: LiteCredential[] }>(res);

            if (!decryptedPayload?.ok) {
                console.error("Failed to decrypt credentials:", decryptedPayload?.error);
                return err("FAILED_TO_DECRYPT_CREDENTIALS");
            }

            return ok(decryptedPayload.payload?.credentials ?? []);
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
            DateCreated: new Date().toISOString(),
            DateModified: undefined,
            DatePasswordChanged: undefined,
            CustomFields: [],
        });
    };

    const requestCredential = async (id: string) => {
        if (!serverPublicKey) {
            console.error("REQUEST_CREDENTIAL_FAILED: No server public key available for encrypted messaging");
            return err("NO_PUBLIC_KEY_AVAILABLE");
        }

        const res = await _requestCredential(id);
        if (res.isOk()) {
            openEditForm(res.value);
            return ok();
        }

        if (res.error === "STALE_KEY") {
            const refreshKeyResult = await onStaleKeyError();
            if (refreshKeyResult.isErr()) {
                console.error("Failed to request credential, tried to refresh public key but failed: " + refreshKeyResult.error);
                return err("FAILED_TO_REQUEST_CREDENTIAL_STALE_KEY");
            }

            const resRetry = await _requestCredential(id);
            if (resRetry.isErr()) {
                console.error("Failed to request credential after retrying: " + resRetry.error);
            } else {
                openEditForm(resRetry.value);
                return ok();
            }
        } else {
            console.error("Failed to request credential: " + res.error);
        }

        return err("FAILED_TO_REQUEST_CREDENTIAL");
    };

    const _requestCredential = async (id: string) => {
        if (!serverPublicKey) return err("NO_PUBLIC_KEY_AVAILABLE");

        const envelope: EncryptedEnvelope | PlaintextEnvelope = await createEncryptedEnvelope(
            MessageType.GetCredential,
            { id: id },
            serverPublicKey.publicKeyJwk,
            serverPublicKey.keyId,
            "popup"
        );

        const res: EncryptedEnvelope | PlaintextEnvelope = await chrome.runtime.sendMessage(envelope);

        if (isEncryptedEnvelope(res)) {
            const decryptedPayload = await decryptResponseEnvelope<{ ok: true; credential: VaultCredential } | { ok: false; error: string }>(res);

            if (!decryptedPayload?.ok || !decryptedPayload?.payload) {
                if (!decryptedPayload?.ok) {
                    return err("ENVELOPE_FAILED_DECRYPTION: " + decryptedPayload?.error);
                }
                return err("ENVELOPE_PAYLOAD_NULL");
            }

            if (!decryptedPayload.payload.ok) {
                return err("CREDENTIAL_REQUEST_FAILED: " + decryptedPayload.payload.error);
            }

            return ok(decryptedPayload.payload.credential);
        }

        if (!res.payload?.ok && res.payload?.code === "STALE_KEY") {
            return err("STALE_KEY");
        }

        return err("UNKNOWN_NON_ENCRYPTED_ENVELOPE");
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
            TOTP: credential.TOTP ? {
                Label: credential.TOTP.Label,
                Secret: credential.TOTP.Secret,
                Period: credential.TOTP.Period,
                Digits: credential.TOTP.Digits,
                Algorithm: credential.TOTP.Algorithm,
            } : null,
            Tags: credential.Tags || "",
            URL: credential.URL,
            Notes: credential.Notes,
            DateCreated: credential.DateCreated,
            DateModified: credential.DateModified,
            DatePasswordChanged: credential.DatePasswordChanged,
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

    useEffect(() => {
        refreshCredentials();
    }, []);

    return (
        <div className="flex flex-col">
            {/* Header with sync status */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-background/80">
                <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-xs text-foreground text-nowrap overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                    {getSyncStatusIcon()}
                    <span className="text-muted-foreground text-xs">
                        {getSyncStatusText()}{lastSync ? ` • ${formatTimeAgo(lastSync)}` : ""}
                    </span>
                </div>
            </div>

            {/* Search bar */}
            <div className="px-3 py-2 border-b border-border bg-background/50">
                <div className="relative">
                    <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        placeholder="Search credentials..."
                        value={searchQuery}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                        className="pl-7 h-6 text-xs bg-input text-foreground border-border placeholder:text-muted-foreground focus:border-ring focus:ring-ring/20"
                    />
                </div>
            </div>

            {/* Credentials list */}
            <div className="flex-1 overflow-y-auto">
                {filteredCredentials.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Shield className="h-6 w-6 mb-2 opacity-50" />
                        <p className="text-xs">No credentials found</p>
                    </div>
                ) : (
                    <div className="p-1 space-y-0">
                        {filteredCredentials.map((credential) => (
                            <div
                                key={credential.id}
                                className="hover:bg-muted/50 transition-all duration-200 hover:shadow-sm border-b border-border last:border-b-0 group"
                            >
                                <div className="p-2 flex items-center justify-between">
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <Avatar className="h-8 w-8">
                                            <AvatarImage src={credential.url} />
                                            <AvatarFallback>
                                                <Globe className="h-4 w-4" />
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium text-xs truncate text-foreground leading-tight">{credential.name}</div>
                                            <div className="text-xs text-muted-foreground truncate leading-tight -mt-0.5">
                                                {credential.username}
                                            </div>
                                        </div>
                                    </div>
                                    <DropdownMenu>
                                                                                    <DropdownMenuTrigger asChild onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 w-5 p-0 hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <MoreVertical className="h-3 w-3 text-muted-foreground" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-36">
                                            <DropdownMenuItem
                                                onClick={async (e: React.MouseEvent) => {
                                                    e.stopPropagation();
                                                    await requestCredential(credential.id);
                                                }}
                                                className="text-xs"
                                            >
                                                <Edit className="h-3 w-3 mr-2" />
                                                Edit
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={() => deleteCredential(credential.id)}
                                                className="text-xs text-destructive"
                                                disabled={isDeleting}
                                            >
                                                {isDeleting ? (
                                                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                                ) : (
                                                    <Trash2 className="h-3 w-3 mr-2" />
                                                )}
                                                {isDeleting ? "Deleting..." : "Delete"}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={() => copyToClipboard(credential.username)}
                                                className="text-xs"
                                            >
                                                <Copy className="h-3 w-3 mr-2" />
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
            <div className="p-2 border-t border-border bg-background/50 space-y-2">
                {/* Sync controls */}
                <div className="flex gap-1">
                    {syncStatus === "disconnected" && (
                        <Button
                            variant="outline"
                            className="flex-1 h-7 text-xs"
                            size="sm"
                            onClick={() => {}}
                        >
                            <Wifi className="h-3 w-3 mr-1.5" />
                            Connect
                        </Button>
                    )}
                    {syncStatus === "connected" && (
                        <Button
                            variant="outline"
                            className="flex-1 h-7 text-xs"
                            size="sm"
                            // onClick={handleDisconnectDevice}
                        >
                            <WifiOff className="h-3 w-3 mr-1.5" />
                            Disconnect
                        </Button>
                    )}
                    {syncStatus === "connected" && (
                        <Button
                            variant="outline"
                            className="flex-1 h-7 text-xs"
                            size="sm"
                            // onClick={handleManualSync}
                        >
                            <Clock className="h-3 w-3 mr-1.5" />
                            Sync Now
                        </Button>
                    )}
                </div>

                {/* Add new credential button */}
                <Button
                    variant="outline"
                    className="w-full h-7 text-xs"
                    size="sm"
                    onClick={openCreateForm}
                    disabled={isCreating}
                >
                    {isCreating && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                    <Plus className="h-3 w-3 mr-1.5" />
                    {isCreating ? "Creating..." : "Add Credential"}
                </Button>
            </div>



            {/* Credential Form Dialog */}
            <Dialog open={credentialModalVisible[0]} onOpenChange={() => closeCredentialForm()}>
                <DialogContent className="w-96 max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-sm">
                            <Shield className="h-4 w-4" />
                            {credentialFormMode === "create" ? "New Credential" : "Edit Credential"}
                        </DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
                        {/* Name Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">Name *</Label>
                            <Input
                                {...register("Name")}
                                className="mt-1 w-full"
                                placeholder="Enter credential name"
                            />
                            {errors.Name && (
                                <p className="text-destructive text-xs mt-1">{errors.Name.message}</p>
                            )}
                        </div>

                        {/* Username Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">Username</Label>
                            <div className="flex gap-1 mt-1">
                                <Input
                                    {...register("Username")}
                                    className="flex-1 mt-1"
                                    placeholder="Enter username"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={() => copyToClipboard(getValues("Username"))}
                                >
                                    <Copy className="h-3 w-3" />
                                </Button>
                            </div>
                            {errors.Username && (
                                <p className="text-destructive text-xs mt-1">{errors.Username.message}</p>
                            )}
                        </div>

                        {/* Password Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">Password</Label>
                            <div className="flex gap-1 mt-1">
                                <Input
                                    {...register("Password")}
                                    type={showFormPassword ? "text" : "password"}
                                    className="flex-1 mt-1"
                                    placeholder="Enter password"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-muted/50"
                                    onClick={() => setShowFormPassword(!showFormPassword)}
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
                                    onClick={() => copyToClipboard(getValues("Password"))}
                                >
                                    <Copy className="h-3 w-3 text-muted-foreground" />
                                </Button>
                            </div>
                            {errors.Password && (
                                <p className="text-destructive text-xs mt-1">{errors.Password.message}</p>
                            )}
                        </div>

                        {/* TOTP Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">TOTP</Label>
                            <Controller
                                control={control}
                                name="TOTP"
                                render={({ field: { onChange, value } }) => (
                                    <>
                                        {value != null ? (
                                            <div className="mt-1 p-3 bg-muted/50 border border-border rounded-md">
                                                <TOTPControl
                                                    onChange={onChange}
                                                    value={value}
                                                />
                                            </div>
                                        ) : (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="w-full mt-1 h-8 text-xs border-border hover:bg-muted/50"
                                                onClick={() => totpModalVisible[1](true)}
                                            >
                                                Configure TOTP
                                            </Button>
                                        )}
                                    </>
                                )}
                            />
                            {errors.TOTP && (
                                <p className="text-destructive text-xs mt-1">{errors.TOTP.message}</p>
                            )}
                        </div>

                        {/* Tags Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">Tags</Label>
                            <Controller
                                control={control}
                                name="Tags"
                                render={({ field: { onChange, value } }) => (
                                    <div className="mt-1 p-2 bg-muted/50 border border-border rounded-md">
                                        <TagBox
                                            onChange={onChange}
                                            value={value}
                                        />
                                    </div>
                                )}
                            />
                            {errors.Tags && (
                                <p className="text-destructive text-xs mt-1">{errors.Tags.message}</p>
                            )}
                        </div>

                        {/* URL Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">Website (URL)</Label>
                            <div className="flex gap-1 mt-1">
                                <Input
                                    {...register("URL")}
                                    type="url"
                                    className="flex-1 mt-1"
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
                                            const fullUrl = url.startsWith("http") ? url : `https://${url}`;
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
                                    onClick={() => copyToClipboard(getValues("URL"))}
                                >
                                    <Copy className="h-3 w-3 text-muted-foreground" />
                                </Button>
                            </div>
                            {errors.URL && (
                                <p className="text-destructive text-xs mt-1">{errors.URL.message}</p>
                            )}
                        </div>

                        {/* Notes Field */}
                        <div>
                            <Label className="text-xs text-muted-foreground">Notes</Label>
                            <textarea
                                {...register("Notes")}
                                className="w-full mt-1 p-2 bg-input border border-input rounded-md text-foreground text-xs resize-none focus:border-ring focus:ring-ring/20"
                                placeholder="Add notes"
                                rows={3}
                            />
                            {errors.Notes && (
                                <p className="text-destructive text-xs mt-1">{errors.Notes.message}</p>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-2 pt-4 border-t border-border">
                            <Button
                                type="button"
                                variant="ghost"
                                className="flex-1 h-8 text-xs"
                                onClick={closeCredentialForm}
                                disabled={isCreating || isUpdating || isSubmitting}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                className="flex-1 h-8 text-xs"
                                disabled={isSubmitting || isCreating || isUpdating}
                            >
                                {(isSubmitting || isCreating || isUpdating) && (
                                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                )}
                                {isCreating ? "Creating..." : isUpdating ? "Updating..." : isSubmitting ? "Saving..." : (credentialFormMode === "create" ? "Create" : "Update")}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            {/* TOTP Configuration Dialog */}
            <Dialog open={totpModalVisible[0]} onOpenChange={() => totpModalVisible[1](false)}>
                <DialogContent className="w-80 shadow-2xl" aria-describedby={undefined}>
                    <DialogHeader>
                        <DialogTitle className="text-sm text-foreground">
                            Configure TOTP
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label className="text-xs text-muted-foreground">Label</Label>
                            <Input
                                value={totpFormData.Label}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTotpFormData({ ...totpFormData, Label: e.target.value })}
                                className="mt-1 text-xs"
                                placeholder="Account name"
                            />
                        </div>
                        <div>
                            <Label className="text-xs text-muted-foreground">Secret</Label>
                            <Input
                                value={totpFormData.Secret}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTotpFormData({ ...totpFormData, Secret: e.target.value })}
                                className="mt-1 text-xs font-mono"
                                placeholder="Enter TOTP secret"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label className="text-xs text-muted-foreground">Period</Label>
                                <Input
                                    type="number"
                                    value={totpFormData.Period}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTotpFormData({ ...totpFormData, Period: parseInt(e.target.value) || 30 })}
                                    className="mt-1 text-xs"
                                    min="1"
                                />
                            </div>
                            <div>
                                <Label className="text-xs text-muted-foreground">Digits</Label>
                                <Input
                                    type="number"
                                    value={totpFormData.Digits}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTotpFormData({ ...totpFormData, Digits: parseInt(e.target.value) || 6 })}
                                    className="mt-1 text-xs"
                                    min="1"
                                    max="10"
                                />
                            </div>
                        </div>
                        <div>
                            <Label className="text-xs text-muted-foreground">Algorithm</Label>
                            <select
                                value={totpFormData.Algorithm}
                                onChange={(e) => setTotpFormData({ ...totpFormData, Algorithm: e.target.value as unknown as VaultUtilTypes.TOTPAlgorithm })}
                                className="w-full mt-1 p-2 bg-input border border-input rounded-md text-foreground text-xs focus:border-ring focus:ring-ring/20"
                            >
                                <option value={VaultUtilTypes.TOTPAlgorithm.SHA1}>SHA1</option>
                                <option value={VaultUtilTypes.TOTPAlgorithm.SHA256}>SHA256</option>
                                <option value={VaultUtilTypes.TOTPAlgorithm.SHA512}>SHA512</option>
                            </select>
                        </div>
                        <div className="flex gap-2 pt-4 border-t border-border">
                            <Button
                                type="button"
                                variant="ghost"
                                className="flex-1 h-8 text-xs"
                                onClick={() => totpModalVisible[1](false)}
                                disabled={isSubmitting}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                className="flex-1 h-8 text-xs"
                                onClick={handleTOTPSubmit}
                                disabled={isSubmitting}
                            >
                                {isSubmitting && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                                {isSubmitting ? "Adding..." : "Add TOTP"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default VaultView;