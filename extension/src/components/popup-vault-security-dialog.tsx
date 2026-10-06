import { useCallback, useEffect, useState } from "react";
import {
    Copy,
    KeyRound,
    LifeBuoy,
    LoaderCircle,
    ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import { isBelowOwaspRecommendedArgon2id } from "@cryptex-industries/vault-core/vault-utils/password-strength";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
    AdditionalKeyProtectionOptions,
    choiceToSource,
    type AdditionalKeyProtectionChoice,
} from "@/components/vault-manager/additional-key-protection-options";
import { KdfBelowRecommendedAck } from "@/components/vault-security/kdf-below-recommended-ack";
import { PasswordStrengthMeter } from "@/components/vault-security/password-strength-meter";
import { copySecretToClipboard } from "@/utils/clipboard";

import {
    MessageType,
    type GetSecurityBackupJobResponse,
    type ReconfigureVaultSecurityRequest,
    type RotateVaultRecoveryCodeRequest,
    type SecurityBackupJob,
    type VaultSecurityMutationResponse,
    type VaultSecurityStateResponse,
} from "../types/sw-messaging";
import { sendEncryptedEnvelopeToSW } from "../utils/sw-envelope-client";
import { vaultLog } from "../utils/ext-logging";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSessionInvalidated: () => void;
};

const isProtectionPhraseKind = (
    kind: AdditionalKeyProtectionKind | undefined,
): boolean =>
    kind === AdditionalKeyProtectionKind.PROTECTION_PHRASE_128 ||
    kind === AdditionalKeyProtectionKind.PROTECTION_PHRASE_256;

function kindToChoice(
    kind: AdditionalKeyProtectionKind | undefined,
): AdditionalKeyProtectionChoice {
    if (kind === AdditionalKeyProtectionKind.PROTECTION_PHRASE_128)
        return "protectionPhrase128";
    if (kind === AdditionalKeyProtectionKind.PROTECTION_PHRASE_256)
        return "protectionPhrase256";
    return "none";
}

function describeKind(kind: AdditionalKeyProtectionKind | undefined): string {
    if (kind === AdditionalKeyProtectionKind.PROTECTION_PHRASE_128) {
        return "Generated protection phrase (128-bit)";
    }
    if (kind === AdditionalKeyProtectionKind.PROTECTION_PHRASE_256) {
        return "Generated protection phrase (256-bit)";
    }
    if (kind === AdditionalKeyProtectionKind.WEBAUTHN_PRF) {
        return "Security key (managed in the web app)";
    }
    return "Password only";
}

const SecretReveal = ({ label, value }: { label: string; value: string }) => (
    <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">{label}</p>
            <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => void copySecretToClipboard(value)}
            >
                <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
        </div>
        <code className="block break-all rounded bg-muted p-2 text-[11px]">
            {value}
        </code>
        <p className="text-[11px] text-muted-foreground">
            Shown once. Save it before closing this dialog.
        </p>
    </div>
);

type RotationOptionsProps = {
    prefix: string;
    rotate: boolean;
    setRotate: (value: boolean) => void;
    deleteOlder: boolean;
    setDeleteOlder: (value: boolean) => void;
    disabled: boolean;
};

const RotationOptions = ({
    prefix,
    rotate,
    setRotate,
    deleteOlder,
    setDeleteOlder,
    disabled,
}: RotationOptionsProps) => (
    <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-start gap-2">
            <Checkbox
                id={`${prefix}-rotate-dek`}
                checked={rotate}
                onCheckedChange={(checked) => setRotate(checked === true)}
                disabled={disabled}
            />
            <Label
                htmlFor={`${prefix}-rotate-dek`}
                className="space-y-1 text-xs font-normal"
            >
                <span className="block font-medium">
                    Rotate this device&apos;s vault encryption key
                </span>
                <span className="block text-[11px] text-muted-foreground">
                    Off by default. Re-encrypts this vault and generates a new
                    recovery code; linked-device keys are unchanged.
                </span>
            </Label>
        </div>
        {rotate ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
                This replaces this device&apos;s vault key and recovery code.
                Linked-device keys are unchanged.
            </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
            Downloaded backup files cannot be revoked and may still open with
            the credentials that protected them when downloaded.
        </p>
        <div className="flex items-start gap-2">
            <Checkbox
                id={`${prefix}-delete-managed-history`}
                checked={deleteOlder}
                onCheckedChange={(checked) => setDeleteOlder(checked === true)}
                disabled={disabled}
            />
            <Label
                htmlFor={`${prefix}-delete-managed-history`}
                className="space-y-1 text-xs font-normal"
            >
                <span className="block font-medium">
                    Delete older managed backups after replacement
                </span>
                <span className="block text-[11px] text-muted-foreground">
                    All older account restore points, including linked-device
                    snapshots, are deleted only after the replacement upload
                    succeeds.
                </span>
            </Label>
        </div>
    </div>
);

function backupErrorMessage(job: SecurityBackupJob): string {
    if (job.error === "BACKUP_QUEUE_FAILED") {
        return "The local security change succeeded, but its managed backup could not be queued.";
    }
    if (job.error === "BACKUP_HISTORY_DELETE_FAILED") {
        return "The replacement backup uploaded, but older managed backups could not be deleted.";
    }
    return "The local security change succeeded, but the managed backup upload failed.";
}

export function PopupVaultSecurityDialog({
    open,
    onOpenChange,
    onSessionInvalidated,
}: Props) {
    const [security, setSecurity] = useState<VaultSecurityStateResponse | null>(
        null,
    );
    const [currentPassword, setCurrentPassword] = useState("");
    const [currentProtectionPhrase, setCurrentProtectionPhrase] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [protectionChoice, setProtectionChoice] =
        useState<AdditionalKeyProtectionChoice>("none");
    const [memLimit, setMemLimit] = useState(
        KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
    );
    const [opsLimit, setOpsLimit] = useState(
        KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
    );
    const [kdfRiskAcknowledged, setKdfRiskAcknowledged] = useState(false);
    const [rotateProtectionDek, setRotateProtectionDek] = useState(false);
    const [deleteProtectionHistory, setDeleteProtectionHistory] =
        useState(false);
    const [rotateRecoveryDek, setRotateRecoveryDek] = useState(false);
    const [deleteRecoveryHistory, setDeleteRecoveryHistory] = useState(false);
    const [busy, setBusy] = useState<"protection" | "recovery" | null>(null);
    const [revealProtectionPhrase, setRevealProtectionPhrase] = useState<
        string | null
    >(null);
    const [revealRecovery, setRevealRecovery] = useState<string | null>(null);
    const [secretsAcknowledged, setSecretsAcknowledged] = useState(false);
    const [sessionInvalidated, setSessionInvalidated] = useState(false);
    const [backupJob, setBackupJob] = useState<SecurityBackupJob | null>(null);

    const loadSecurity = useCallback(async () => {
        const response =
            await sendEncryptedEnvelopeToSW<VaultSecurityStateResponse>(
                MessageType.GetVaultSecurity,
                null,
            );
        if (!response.ok) {
            setSecurity({ ok: false, error: response.error });
            return;
        }
        setSecurity(response.payload);
        if (response.payload.ok) {
            setProtectionChoice(
                kindToChoice(response.payload.additionalKeyProtectionKind),
            );
            setMemLimit(response.payload.kdf.memLimit);
            setOpsLimit(response.payload.kdf.opsLimit);
        }
    }, []);

    useEffect(() => {
        if (!open) return;
        setCurrentPassword("");
        setCurrentProtectionPhrase("");
        setNewPassword("");
        setConfirmPassword("");
        setRotateProtectionDek(false);
        setDeleteProtectionHistory(false);
        setRotateRecoveryDek(false);
        setDeleteRecoveryHistory(false);
        setRevealProtectionPhrase(null);
        setRevealRecovery(null);
        setSecretsAcknowledged(false);
        setSessionInvalidated(false);
        setBackupJob(null);
        setKdfRiskAcknowledged(false);
        setSecurity(null);
        void loadSecurity();
    }, [open, loadSecurity]);

    useEffect(() => {
        setKdfRiskAcknowledged(false);
    }, [memLimit, opsLimit]);

    const monitorBackup = useCallback(async (jobId: string) => {
        for (let attempt = 0; attempt < 120; attempt += 1) {
            const response =
                await sendEncryptedEnvelopeToSW<GetSecurityBackupJobResponse>(
                    MessageType.GetSecurityBackupJob,
                    { id: jobId },
                );
            if (!response.ok || !response.payload.ok) return;
            const job = response.payload.job;
            if (job) setBackupJob(job);
            if (!job) return;
            if (job.status === "success") {
                toast.success(
                    job.deleteOlderSnapshots
                        ? "Replacement backup uploaded and older managed history deleted."
                        : "Replacement managed backup uploaded.",
                );
                return;
            }
            if (job.status === "skipped") {
                toast.info(
                    "Managed backups are not enabled; the local security change is complete.",
                );
                return;
            }
            if (job.status === "error") {
                toast.error(backupErrorMessage(job));
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }, []);

    const latestBackupJobId = security?.ok
        ? security.latestBackupJobId
        : undefined;
    useEffect(() => {
        if (!open || !latestBackupJobId) return;
        void monitorBackup(latestBackupJobId);
    }, [latestBackupJobId, monitorBackup, open]);

    const clearCurrentAuthorization = () => {
        setCurrentPassword("");
        setCurrentProtectionPhrase("");
    };

    const applySuccess = (response: VaultSecurityMutationResponse) => {
        if (!response.ok) return;
        setRevealProtectionPhrase(response.protectionPhrase ?? null);
        setRevealRecovery(response.recoveryCode ?? null);
        setSecretsAcknowledged(
            !response.protectionPhrase && !response.recoveryCode,
        );
        setSessionInvalidated(!response.sessionContinued);
        setSecurity((current) =>
            current?.ok
                ? {
                      ...current,
                      additionalKeyProtectionKind:
                          response.additionalKeyProtectionKind,
                      webAuthnUnsupported: false,
                  }
                : current,
        );
        if (response.backupError) {
            toast.error(
                "The local security change succeeded, but its managed backup could not be queued.",
            );
        } else if (response.backupJobId) {
            void monitorBackup(response.backupJobId);
        }
        if (response.deviceKeyProtectionCached === false) {
            toast.warning(
                "Settings were saved, but this profile could not cache the new protection key. Save the protection phrase; it will be required on the next unlock.",
            );
        }
        if (!response.sessionContinued) {
            toast.error(
                "Security settings were saved, but the unlocked session could not be continued. Save the displayed secrets, then unlock again.",
            );
        }
    };

    const handleProtectionSave = async () => {
        if (!security?.ok) return;
        if (!currentPassword) {
            toast.error("Enter your current master password.");
            return;
        }
        if (newPassword && newPassword !== confirmPassword) {
            clearCurrentAuthorization();
            toast.error("New password and confirmation do not match.");
            return;
        }

        setBusy("protection");
        setRevealProtectionPhrase(null);
        setRevealRecovery(null);
        setSecretsAcknowledged(false);
        const request: ReconfigureVaultSecurityRequest = {
            currentMasterPassword: currentPassword,
            ...(currentProtectionPhrase.trim()
                ? {
                      currentProtectionPhrase: currentProtectionPhrase.trim(),
                  }
                : {}),
            ...(newPassword ? { newMasterPassword: newPassword } : {}),
            additionalKeyProtectionKind: choiceToSource(protectionChoice)
                .kind as
                | AdditionalKeyProtectionKind.NONE
                | AdditionalKeyProtectionKind.PROTECTION_PHRASE_128
                | AdditionalKeyProtectionKind.PROTECTION_PHRASE_256,
            kdf: { memLimit: Number(memLimit), opsLimit: Number(opsLimit) },
            rotateDataKey: rotateProtectionDek,
            deleteOlderManagedBackups: deleteProtectionHistory,
        };

        try {
            const result =
                await sendEncryptedEnvelopeToSW<VaultSecurityMutationResponse>(
                    MessageType.ReconfigureVaultSecurity,
                    request,
                );
            clearCurrentAuthorization();
            if (!result.ok) {
                vaultLog.warn("Extension vault security update failed", {
                    error: result.error,
                });
                toast.error("Failed to update vault security settings.");
                return;
            }
            if (!result.payload.ok) {
                const error = result.payload.error;
                vaultLog.warn("Extension vault security update failed", {
                    error,
                });
                toast.error(
                    error === "DEK_UNWRAP_FAILED" ||
                        error === "KEK_DERIVATION_FAILED"
                        ? "Current master password or protection phrase is incorrect."
                        : "Failed to update vault security settings.",
                );
                return;
            }
            applySuccess(result.payload);
            setNewPassword("");
            setConfirmPassword("");
            toast.success(
                result.payload.dataKeyRotated
                    ? "Security settings and vault encryption key updated."
                    : "Security settings updated.",
            );
        } catch (error) {
            clearCurrentAuthorization();
            vaultLog.error("Extension vault security update threw", { error });
            toast.error("Failed to update vault security settings.");
        } finally {
            setBusy(null);
        }
    };

    const handleRecoveryRotation = async () => {
        if (!security?.ok) return;
        if (!currentPassword) {
            toast.error("Enter your current master password.");
            return;
        }
        const request: RotateVaultRecoveryCodeRequest = {
            currentMasterPassword: currentPassword,
            ...(currentProtectionPhrase.trim()
                ? {
                      currentProtectionPhrase: currentProtectionPhrase.trim(),
                  }
                : {}),
            rotateDataKey: rotateRecoveryDek,
            deleteOlderManagedBackups: deleteRecoveryHistory,
        };

        setBusy("recovery");
        setRevealProtectionPhrase(null);
        setRevealRecovery(null);
        setSecretsAcknowledged(false);
        try {
            const result =
                await sendEncryptedEnvelopeToSW<VaultSecurityMutationResponse>(
                    MessageType.RotateVaultRecoveryCode,
                    request,
                );
            clearCurrentAuthorization();
            if (!result.ok) {
                vaultLog.warn("Extension recovery-code rotation failed", {
                    error: result.error,
                });
                toast.error("Failed to generate a new recovery code.");
                return;
            }
            if (!result.payload.ok) {
                const error = result.payload.error;
                vaultLog.warn("Extension recovery-code rotation failed", {
                    error,
                });
                toast.error(
                    error === "DEK_UNWRAP_FAILED" ||
                        error === "KEK_DERIVATION_FAILED"
                        ? "Current master password or protection phrase is incorrect."
                        : "Failed to generate a new recovery code.",
                );
                return;
            }
            applySuccess(result.payload);
            toast.success(
                result.payload.dataKeyRotated
                    ? "Vault encryption key and recovery code rotated."
                    : "New recovery code generated.",
            );
        } catch (error) {
            clearCurrentAuthorization();
            vaultLog.error("Extension recovery-code rotation threw", {
                error,
            });
            toast.error("Failed to generate a new recovery code.");
        } finally {
            setBusy(null);
        }
    };

    const hasSecrets = !!revealProtectionPhrase || !!revealRecovery;
    const mustAcknowledge = hasSecrets && !secretsAcknowledged;
    const unsupported = security?.ok && security.webAuthnUnsupported;
    const belowRecommended = isBelowOwaspRecommendedArgon2id(
        Number(memLimit),
        Number(opsLimit),
    );
    const invalidKdf =
        !Number.isInteger(Number(memLimit)) ||
        !Number.isInteger(Number(opsLimit)) ||
        Number(memLimit) < KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT ||
        Number(memLimit) > KeyDerivationConfig_Argon2ID.MAX_MEM_LIMIT ||
        Number(opsLimit) < KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT ||
        Number(opsLimit) > KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT;
    const kdfBlocked = invalidKdf || (belowRecommended && !kdfRiskAcknowledged);

    const handleOpenChange = (next: boolean) => {
        if (!next && mustAcknowledge) {
            toast.error("Confirm that you saved the newly generated secrets.");
            return;
        }
        if (!next && busy) return;
        if (!next) {
            setCurrentPassword("");
            setCurrentProtectionPhrase("");
            setNewPassword("");
            setConfirmPassword("");
            setRevealProtectionPhrase(null);
            setRevealRecovery(null);
            setSecretsAcknowledged(false);
        }
        onOpenChange(next);
        if (!next && sessionInvalidated) onSessionInvalidated();
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="flex max-h-[92vh] max-w-xl flex-col gap-0 overflow-hidden p-0">
                <DialogHeader className="border-b px-5 py-4">
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5" /> Encryption &amp;
                        Security
                    </DialogTitle>
                    <DialogDescription>
                        Change this vault&apos;s password, protection phrase,
                        recovery code, and optional local data key.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    {!security ? (
                        <div className="flex justify-center py-10">
                            <LoaderCircle className="h-5 w-5 animate-spin" />
                        </div>
                    ) : !security.ok ? (
                        <Alert variant="destructive">
                            <AlertDescription>
                                Vault security settings are unavailable.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <>
                            {unsupported ? (
                                <Alert variant="destructive">
                                    <AlertDescription>
                                        This vault uses WebAuthn PRF. Manage its
                                        protection settings in the web app;
                                        WebAuthn support is intentionally not
                                        included in this extension change.
                                    </AlertDescription>
                                </Alert>
                            ) : null}

                            {sessionInvalidated ? (
                                <Alert variant="destructive">
                                    <AlertDescription>
                                        The security change is saved, but this
                                        unlocked session ended. Save the
                                        displayed secrets, close this dialog,
                                        and unlock again.
                                    </AlertDescription>
                                </Alert>
                            ) : null}

                            <div className="space-y-2">
                                <Label htmlFor="extension-current-password">
                                    Current master password
                                </Label>
                                <Input
                                    id="extension-current-password"
                                    type="password"
                                    autoComplete="current-password"
                                    value={currentPassword}
                                    onChange={(event) =>
                                        setCurrentPassword(event.target.value)
                                    }
                                    disabled={
                                        !!busy ||
                                        unsupported ||
                                        sessionInvalidated
                                    }
                                />
                            </div>

                            {isProtectionPhraseKind(
                                security.additionalKeyProtectionKind,
                            ) ? (
                                <div className="space-y-2">
                                    <Label htmlFor="extension-current-protection">
                                        Current protection phrase
                                    </Label>
                                    <Input
                                        id="extension-current-protection"
                                        type="password"
                                        className="font-mono text-xs"
                                        placeholder="Optional when cached on this profile"
                                        value={currentProtectionPhrase}
                                        onChange={(event) =>
                                            setCurrentProtectionPhrase(
                                                event.target.value,
                                            )
                                        }
                                        disabled={
                                            !!busy ||
                                            unsupported ||
                                            sessionInvalidated
                                        }
                                    />
                                </div>
                            ) : null}

                            <Separator />

                            <section className="space-y-3">
                                <h3 className="flex items-center gap-2 text-sm font-medium">
                                    <KeyRound className="h-4 w-4" /> Password
                                    &amp; protection phrase
                                </h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="extension-new-password">
                                            New password
                                        </Label>
                                        <Input
                                            id="extension-new-password"
                                            type="password"
                                            autoComplete="new-password"
                                            placeholder="Leave blank to keep"
                                            value={newPassword}
                                            onChange={(event) =>
                                                setNewPassword(
                                                    event.target.value,
                                                )
                                            }
                                            disabled={
                                                !!busy ||
                                                unsupported ||
                                                sessionInvalidated
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="extension-confirm-password">
                                            Confirm password
                                        </Label>
                                        <Input
                                            id="extension-confirm-password"
                                            type="password"
                                            autoComplete="new-password"
                                            value={confirmPassword}
                                            onChange={(event) =>
                                                setConfirmPassword(
                                                    event.target.value,
                                                )
                                            }
                                            disabled={
                                                !!busy ||
                                                unsupported ||
                                                sessionInvalidated
                                            }
                                        />
                                    </div>
                                </div>
                                {newPassword ? (
                                    <PasswordStrengthMeter
                                        password={newPassword}
                                    />
                                ) : null}
                                <AdditionalKeyProtectionOptions
                                    value={protectionChoice}
                                    onChange={(choice) =>
                                        setProtectionChoice(choice)
                                    }
                                    allowWebAuthn={false}
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Current protection:{" "}
                                    <span className="font-medium">
                                        {describeKind(
                                            security.additionalKeyProtectionKind,
                                        )}
                                    </span>
                                </p>
                                <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="extension-memory-limit">
                                            Argon2 memory (MiB)
                                        </Label>
                                        <Input
                                            id="extension-memory-limit"
                                            type="number"
                                            min={
                                                KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT
                                            }
                                            max={
                                                KeyDerivationConfig_Argon2ID.MAX_MEM_LIMIT
                                            }
                                            value={memLimit}
                                            onChange={(event) =>
                                                setMemLimit(
                                                    Number(event.target.value),
                                                )
                                            }
                                            disabled={
                                                !!busy ||
                                                unsupported ||
                                                sessionInvalidated
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="extension-ops-limit">
                                            Argon2 passes
                                        </Label>
                                        <Input
                                            id="extension-ops-limit"
                                            type="number"
                                            min={
                                                KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT
                                            }
                                            max={
                                                KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT
                                            }
                                            value={opsLimit}
                                            onChange={(event) =>
                                                setOpsLimit(
                                                    Number(event.target.value),
                                                )
                                            }
                                            disabled={
                                                !!busy ||
                                                unsupported ||
                                                sessionInvalidated
                                            }
                                        />
                                    </div>
                                </div>
                                <KdfBelowRecommendedAck
                                    memLimit={Number(memLimit)}
                                    opsLimit={Number(opsLimit)}
                                    acknowledged={kdfRiskAcknowledged}
                                    onAcknowledgedChange={
                                        setKdfRiskAcknowledged
                                    }
                                    compact
                                />
                                <RotationOptions
                                    prefix="extension-protection"
                                    rotate={rotateProtectionDek}
                                    setRotate={setRotateProtectionDek}
                                    deleteOlder={deleteProtectionHistory}
                                    setDeleteOlder={setDeleteProtectionHistory}
                                    disabled={
                                        !!busy ||
                                        unsupported ||
                                        sessionInvalidated ||
                                        mustAcknowledge
                                    }
                                />
                                <Button
                                    className="w-full"
                                    onClick={() => void handleProtectionSave()}
                                    disabled={
                                        !!busy ||
                                        unsupported ||
                                        sessionInvalidated ||
                                        kdfBlocked ||
                                        mustAcknowledge
                                    }
                                >
                                    {busy === "protection" ? (
                                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    Save protection settings
                                </Button>
                            </section>

                            <Separator />

                            <section className="space-y-3">
                                <h3 className="flex items-center gap-2 text-sm font-medium">
                                    <LifeBuoy className="h-4 w-4" /> Recovery
                                    code
                                </h3>
                                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                                    The previous recovery code stops opening the
                                    current vault as soon as the new one is
                                    saved.
                                </div>
                                <RotationOptions
                                    prefix="extension-recovery"
                                    rotate={rotateRecoveryDek}
                                    setRotate={setRotateRecoveryDek}
                                    deleteOlder={deleteRecoveryHistory}
                                    setDeleteOlder={setDeleteRecoveryHistory}
                                    disabled={
                                        !!busy ||
                                        unsupported ||
                                        sessionInvalidated ||
                                        mustAcknowledge
                                    }
                                />
                                <Button
                                    variant="outline"
                                    className="w-full"
                                    onClick={() =>
                                        void handleRecoveryRotation()
                                    }
                                    disabled={
                                        !!busy ||
                                        unsupported ||
                                        sessionInvalidated ||
                                        mustAcknowledge
                                    }
                                >
                                    {busy === "recovery" ? (
                                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    Generate new recovery code
                                </Button>
                            </section>

                            {revealProtectionPhrase || revealRecovery ? (
                                <Alert>
                                    <AlertDescription className="space-y-3">
                                        {revealProtectionPhrase ? (
                                            <SecretReveal
                                                label="New protection phrase"
                                                value={revealProtectionPhrase}
                                            />
                                        ) : null}
                                        {revealRecovery ? (
                                            <SecretReveal
                                                label="New recovery code"
                                                value={revealRecovery}
                                            />
                                        ) : null}
                                    </AlertDescription>
                                </Alert>
                            ) : null}

                            {backupJob &&
                            !["success", "skipped", "error"].includes(
                                backupJob.status,
                            ) ? (
                                <p className="text-[11px] text-muted-foreground">
                                    Managed backup update: {backupJob.status}…
                                </p>
                            ) : null}
                        </>
                    )}
                </div>

                <DialogFooter className="border-t px-5 py-3">
                    {hasSecrets ? (
                        <div className="mr-auto flex max-w-sm items-start gap-2 text-left">
                            <Checkbox
                                id="extension-security-secrets-saved"
                                checked={secretsAcknowledged}
                                onCheckedChange={(checked) =>
                                    setSecretsAcknowledged(checked === true)
                                }
                                disabled={!!busy}
                            />
                            <Label
                                htmlFor="extension-security-secrets-saved"
                                className="text-[11px] font-normal"
                            >
                                I saved the new secrets and understand that
                                downloaded backups may still use older
                                credentials.
                            </Label>
                        </div>
                    ) : null}
                    <Button
                        variant="outline"
                        onClick={() => handleOpenChange(false)}
                        disabled={!!busy || mustAcknowledge}
                    >
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
