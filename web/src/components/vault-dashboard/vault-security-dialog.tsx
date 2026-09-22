import { useEffect, useRef, useState } from "react";
import { PasswordStrengthMeter } from "@/components/vault-security/password-strength-meter";
import { KdfBelowRecommendedAck } from "@/components/vault-security/kdf-below-recommended-ack";
import { isBelowOwaspRecommendedArgon2id } from "@cryptex-industries/vault-core/vault-utils/password-strength";
import { useAtomValue } from "jotai/react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
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
    type AdditionalKeyProtectionChoice,
    choiceToSource,
} from "@/components/vault-manager/additional-key-protection-options";
import { unlockedVaultMetadataAtom } from "@/utils/atoms";
import { copySecretToClipboard } from "@/utils/clipboard";
import { vaultLog } from "@/utils/logging";
import {
    VAULT_SECURITY_BACKUP_EVENT,
    type VaultSecurityBackupEventDetail,
} from "@/app_lib/managed-backup-hooks";
import {
    reconfigureUnlockedVaultSecurity,
    rotateUnlockedVaultRecoveryCode,
} from "@/utils/vault-security-mutations";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

function kindToChoice(
    kind: AdditionalKeyProtectionKind | undefined,
): AdditionalKeyProtectionChoice {
    switch (kind) {
        case AdditionalKeyProtectionKind.PROTECTION_PHRASE_128:
            return "protectionPhrase128";
        case AdditionalKeyProtectionKind.PROTECTION_PHRASE_256:
            return "protectionPhrase256";
        case AdditionalKeyProtectionKind.WEBAUTHN_PRF:
            return "webauthn";
        default:
            return "none";
    }
}

function describeKind(kind: AdditionalKeyProtectionKind | undefined): string {
    switch (kind) {
        case AdditionalKeyProtectionKind.PROTECTION_PHRASE_128:
            return "Generated protection phrase (128-bit)";
        case AdditionalKeyProtectionKind.PROTECTION_PHRASE_256:
            return "Generated protection phrase (256-bit)";
        case AdditionalKeyProtectionKind.WEBAUTHN_PRF:
            return "Security key (WebAuthn PRF)";
        default:
            return "Password only";
    }
}

function isProtectionPhraseKind(
    kind: AdditionalKeyProtectionKind | undefined,
): boolean {
    return (
        kind === AdditionalKeyProtectionKind.PROTECTION_PHRASE_128 ||
        kind === AdditionalKeyProtectionKind.PROTECTION_PHRASE_256
    );
}

const SecretReveal: React.FC<{
    label: string;
    value: string;
    helper?: string;
}> = ({ label, value, helper }) => {
    const copy = async () => {
        await copySecretToClipboard(value);
    };

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{label}</p>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={copy}
                >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                </Button>
            </div>
            <code className="block break-all rounded bg-muted p-2 text-xs">
                {value}
            </code>
            {helper && (
                <p className="text-xs text-muted-foreground">{helper}</p>
            )}
        </div>
    );
};

const KeyRotationOptions: React.FC<{
    idPrefix: string;
    rotateDataKey: boolean;
    onRotateDataKeyChange: (checked: boolean) => void;
    deleteOlderManagedBackups: boolean;
    onDeleteOlderManagedBackupsChange: (checked: boolean) => void;
    disabled: boolean;
}> = ({
    idPrefix,
    rotateDataKey,
    onRotateDataKeyChange,
    deleteOlderManagedBackups,
    onDeleteOlderManagedBackupsChange,
    disabled,
}) => (
    <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-start gap-2">
            <Checkbox
                id={`${idPrefix}-rotate-data-key`}
                checked={rotateDataKey}
                onCheckedChange={(checked) =>
                    onRotateDataKeyChange(checked === true)
                }
                disabled={disabled}
            />
            <Label
                htmlFor={`${idPrefix}-rotate-data-key`}
                className="space-y-1 font-normal"
            >
                <span className="block font-medium">
                    Rotate this device&apos;s vault encryption key
                </span>
                <span className="block text-xs text-muted-foreground">
                    Off by default. When enabled, the vault is re-encrypted with
                    a fresh data key and a new recovery code is generated.
                </span>
            </Label>
        </div>

        {rotateDataKey && (
            <div className="vault-settings-warning rounded-md border p-3 text-xs">
                This replaces this device&apos;s vault key and recovery code. It
                does not rotate keys on linked devices.
            </div>
        )}

        <p className="text-xs text-muted-foreground">
            Downloaded backup files are independent copies: they cannot be
            revoked and may still open with the credentials that protected them
            when downloaded.
        </p>

        <div className="flex items-start gap-2">
            <Checkbox
                id={`${idPrefix}-delete-old-backups`}
                checked={deleteOlderManagedBackups}
                onCheckedChange={(checked) =>
                    onDeleteOlderManagedBackupsChange(checked === true)
                }
                disabled={disabled}
            />
            <Label
                htmlFor={`${idPrefix}-delete-old-backups`}
                className="space-y-1 font-normal"
            >
                <span className="block font-medium">
                    Delete older managed backups after replacement
                </span>
                <span className="block text-xs text-muted-foreground">
                    If managed backups are enabled, all older restore points for
                    this account—including linked-device snapshots—are deleted
                    only after the new encrypted backup succeeds.
                </span>
            </Label>
        </div>
    </div>
);

export function VaultSecurityDialog({ open, onOpenChange }: Props) {
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const currentKind = vaultMetadata?.Blob?.Envelope?.PrimaryProtectionKind;
    const wasOpenRef = useRef(false);

    const [currentPassword, setCurrentPassword] = useState("");
    const [currentRecoveryCode, setCurrentRecoveryCode] = useState("");
    const [currentProtectionPhrase, setCurrentProtectionPhrase] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [protectionChoice, setProtectionChoice] =
        useState<AdditionalKeyProtectionChoice>("none");
    const [protectionSource, setProtectionSource] = useState(
        choiceToSource("none"),
    );
    const [memLimit, setMemLimit] = useState(
        KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
    );
    const [opsLimit, setOpsLimit] = useState(
        KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
    );

    const [isSaving, setIsSaving] = useState(false);
    const [isRotating, setIsRotating] = useState(false);
    const [revealProtectionPhrase, setRevealProtectionPhrase] = useState<
        string | null
    >(null);
    const [revealRecovery, setRevealRecovery] = useState<string | null>(null);
    const [kdfRiskAcknowledged, setKdfRiskAcknowledged] = useState(false);
    const [rotateDataKeyOnProtection, setRotateDataKeyOnProtection] =
        useState(false);
    const [deleteOldBackupsOnProtection, setDeleteOldBackupsOnProtection] =
        useState(false);
    const [rotateDataKeyOnRecovery, setRotateDataKeyOnRecovery] =
        useState(false);
    const [deleteOldBackupsOnRecovery, setDeleteOldBackupsOnRecovery] =
        useState(false);
    const [secretsAcknowledged, setSecretsAcknowledged] = useState(false);

    // Reset local state to the vault's current configuration whenever the
    // dialog opens, so stale input never leaks across sessions.
    useEffect(() => {
        const isOpening = open && !wasOpenRef.current;
        wasOpenRef.current = open;
        if (!isOpening) return;
        setCurrentPassword("");
        setCurrentRecoveryCode("");
        setCurrentProtectionPhrase("");
        setNewPassword("");
        setConfirmPassword("");
        setProtectionChoice(kindToChoice(currentKind));
        setProtectionSource(choiceToSource(kindToChoice(currentKind)));
        setMemLimit(
            vaultMetadata?.Blob?.KDFConfigArgon2ID?.memLimit ??
                KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
        );
        setOpsLimit(
            vaultMetadata?.Blob?.KDFConfigArgon2ID?.opsLimit ??
                KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
        );
        setRevealProtectionPhrase(null);
        setRevealRecovery(null);
        setKdfRiskAcknowledged(false);
        setRotateDataKeyOnProtection(false);
        setDeleteOldBackupsOnProtection(false);
        setRotateDataKeyOnRecovery(false);
        setDeleteOldBackupsOnRecovery(false);
        setSecretsAcknowledged(false);
    }, [open, currentKind, vaultMetadata]);

    useEffect(() => {
        setKdfRiskAcknowledged(false);
    }, [memLimit, opsLimit]);

    useEffect(() => {
        const listener = (event: Event) => {
            const detail = (
                event as CustomEvent<VaultSecurityBackupEventDetail>
            ).detail;
            if (detail.status === "skipped") {
                toast.info(
                    "Managed backups are not enabled; the local security change is complete.",
                );
                return;
            }
            toast.error(
                `The local security change succeeded, but its managed backup did not complete. ${detail.message}`,
            );
        };
        window.addEventListener(VAULT_SECURITY_BACKUP_EVENT, listener);
        return () =>
            window.removeEventListener(VAULT_SECURITY_BACKUP_EVENT, listener);
    }, []);

    const belowRecommendedKdf = isBelowOwaspRecommendedArgon2id(
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
    const submitBlockedByKdf =
        invalidKdf || (belowRecommendedKdf && !kdfRiskAcknowledged);
    const busy = isSaving || isRotating;
    const hasRevealedSecrets = !!revealProtectionPhrase || !!revealRecovery;
    const hasUnacknowledgedSecrets = hasRevealedSecrets && !secretsAcknowledged;

    const clearCurrentAuthorization = () => {
        setCurrentPassword("");
        setCurrentRecoveryCode("");
        setCurrentProtectionPhrase("");
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen && hasUnacknowledgedSecrets) {
            toast.error("Confirm that you saved the newly generated secrets.");
            return;
        }
        if (!nextOpen && busy) return;
        if (!nextOpen) {
            setCurrentPassword("");
            setCurrentRecoveryCode("");
            setCurrentProtectionPhrase("");
            setNewPassword("");
            setConfirmPassword("");
            setRevealProtectionPhrase(null);
            setRevealRecovery(null);
            setSecretsAcknowledged(false);
        }
        onOpenChange(nextOpen);
    };

    const requireCurrentPassword = (): boolean => {
        if (currentPassword.length === 0) {
            toast.error(
                "Enter your current master password to authorize this change.",
            );
            return false;
        }
        return true;
    };

    const handleSaveSecurity = async () => {
        if (!vaultMetadata) {
            toast.error("Vault metadata is unavailable.");
            return;
        }
        const useRecovery = currentRecoveryCode.trim().length > 0;
        if (!useRecovery && !requireCurrentPassword()) return;
        if (useRecovery && !newPassword) {
            toast.error(
                "Enter a new master password when using a recovery code.",
            );
            return;
        }

        const changingPassword = newPassword.length > 0;
        if (changingPassword && newPassword !== confirmPassword) {
            clearCurrentAuthorization();
            toast.error("New password and confirmation do not match.");
            return;
        }

        setIsSaving(true);
        setRevealProtectionPhrase(null);
        setRevealRecovery(null);
        setSecretsAcknowledged(false);
        try {
            const res = await reconfigureUnlockedVaultSecurity({
                currentMasterPassword: useRecovery ? "" : currentPassword,
                currentRecoveryCode: useRecovery
                    ? currentRecoveryCode.trim()
                    : undefined,
                currentProtectionPhrase:
                    currentProtectionPhrase.trim() || undefined,
                newMasterPassword: changingPassword ? newPassword : undefined,
                additionalKeyProtection: protectionSource,
                kdfConfig: new KeyDerivationConfig_Argon2ID(
                    Number(memLimit),
                    Number(opsLimit),
                ),
                rotateDataKey: rotateDataKeyOnProtection,
                deleteOlderManagedBackups: deleteOldBackupsOnProtection,
            });

            clearCurrentAuthorization();

            if (res.isErr()) {
                if (
                    res.error === "DEK_UNWRAP_FAILED" ||
                    res.error === "KEK_DERIVATION_FAILED" ||
                    (useRecovery && res.error === "RECOVERY_KEK_FAILED")
                ) {
                    toast.error(
                        useRecovery
                            ? "Recovery code is incorrect."
                            : "Current master password or protection phrase is incorrect.",
                    );
                    return;
                }
                vaultLog.error("reconfigureSecurity failed", {
                    error: res.error,
                });
                toast.error("Failed to update security settings.");
                return;
            }

            toast.success(
                res.value.dataKeyRotated
                    ? "Security settings and vault encryption key updated."
                    : "Security settings updated.",
            );
            setNewPassword("");
            setConfirmPassword("");

            const reveal = res.value;
            if (reveal.protectionPhrase) {
                setRevealProtectionPhrase(reveal.protectionPhrase);
            }
            if (reveal.recoveryCode) {
                setRevealRecovery(reveal.recoveryCode);
            }
            setSecretsAcknowledged(
                !reveal.protectionPhrase && !reveal.recoveryCode,
            );
            if (reveal.deviceKeyProtectionCached === false) {
                toast.warning(
                    "Security settings were saved, but this device could not cache the new protection key. Save the protection phrase; it will be required on the next unlock.",
                );
            }
            if (!reveal.protectionPhrase && !reveal.recoveryCode) {
                onOpenChange(false);
            }
        } catch (error) {
            clearCurrentAuthorization();
            vaultLog.error("reconfigureSecurity threw", { error });
            toast.error("Failed to update security settings.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleResetRecovery = async () => {
        if (!vaultMetadata) {
            toast.error("Vault metadata is unavailable.");
            return;
        }
        if (!requireCurrentPassword()) return;

        setIsRotating(true);
        setRevealProtectionPhrase(null);
        setRevealRecovery(null);
        setSecretsAcknowledged(false);
        try {
            const res = await rotateUnlockedVaultRecoveryCode({
                currentMasterPassword: currentPassword,
                currentProtectionPhrase:
                    currentProtectionPhrase.trim() || undefined,
                rotateDataKey: rotateDataKeyOnRecovery,
                deleteOlderManagedBackups: deleteOldBackupsOnRecovery,
            });

            clearCurrentAuthorization();

            if (res.isErr()) {
                if (
                    res.error === "DEK_UNWRAP_FAILED" ||
                    res.error === "KEK_DERIVATION_FAILED"
                ) {
                    toast.error(
                        "Current master password or protection phrase is incorrect.",
                    );
                    return;
                }
                vaultLog.error("resetRecoveryCode failed", {
                    error: res.error,
                });
                toast.error("Failed to reset recovery code.");
                return;
            }

            setRevealRecovery(res.value.recoveryCode);
            setSecretsAcknowledged(false);
            toast.success(
                res.value.dataKeyRotated
                    ? "Vault encryption key and recovery code rotated."
                    : "New recovery code generated.",
            );
        } catch (error) {
            clearCurrentAuthorization();
            vaultLog.error("resetRecoveryCode threw", { error });
            toast.error("Failed to reset recovery code.");
        } finally {
            setIsRotating(false);
        }
    };

    const isEnvelope = !!vaultMetadata?.Blob?.Envelope;
    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="vault-settings-dialog flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
                <DialogHeader className="border-b px-5 py-4">
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5" />
                        Encryption &amp; Security
                    </DialogTitle>
                    <DialogDescription>
                        Change your master password, additional key protection,
                        recovery code, and—optionally—this device&apos;s vault
                        encryption key.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                    {!isEnvelope && (
                        <Alert>
                            <AlertDescription className="text-xs">
                                This vault uses a legacy format. Unlock it once
                                to upgrade it to the envelope format before
                                changing security settings.
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="current-master-password">
                            Current master password
                        </Label>
                        <Input
                            id="current-master-password"
                            type="password"
                            autoComplete="current-password"
                            placeholder="Or use the recovery code below"
                            className="vault-settings-input"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            disabled={!isEnvelope || busy}
                        />
                        <p className="text-xs text-muted-foreground">
                            Proves ownership so the vault key can be re-wrapped.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="current-recovery-code">
                            Recovery code to set a new master password
                        </Label>
                        <Input
                            id="current-recovery-code"
                            type="password"
                            autoComplete="off"
                            className="vault-settings-input font-mono text-xs"
                            value={currentRecoveryCode}
                            onChange={(e) =>
                                setCurrentRecoveryCode(e.target.value)
                            }
                            disabled={!isEnvelope || busy}
                        />
                        <p className="text-xs text-muted-foreground">
                            Use this instead of the current master password.
                            Enter and confirm a new one below.
                        </p>
                    </div>

                    {isProtectionPhraseKind(currentKind) && (
                        <div className="space-y-2">
                            <Label htmlFor="current-protection-phrase">
                                Current protection phrase
                            </Label>
                            <Input
                                id="current-protection-phrase"
                                type="password"
                                placeholder="Optional on this device, required after restore"
                                className="vault-settings-input font-mono text-xs"
                                value={currentProtectionPhrase}
                                onChange={(e) =>
                                    setCurrentProtectionPhrase(e.target.value)
                                }
                                disabled={!isEnvelope || busy}
                            />
                        </div>
                    )}

                    <Separator />

                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <KeyRound className="h-4 w-4" />
                            <p className="text-sm font-medium">
                                Master password &amp; additional key protection
                            </p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="new-master-password">
                                    New master password
                                </Label>
                                <Input
                                    id="new-master-password"
                                    type="password"
                                    autoComplete="new-password"
                                    placeholder="Leave blank to keep current"
                                    className="vault-settings-input"
                                    value={newPassword}
                                    onChange={(e) =>
                                        setNewPassword(e.target.value)
                                    }
                                    disabled={!isEnvelope || busy}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirm-master-password">
                                    Confirm new password
                                </Label>
                                <Input
                                    id="confirm-master-password"
                                    type="password"
                                    autoComplete="new-password"
                                    placeholder="Repeat new password"
                                    className="vault-settings-input"
                                    value={confirmPassword}
                                    onChange={(e) =>
                                        setConfirmPassword(e.target.value)
                                    }
                                    disabled={!isEnvelope || busy}
                                />
                            </div>
                        </div>
                        {newPassword.length > 0 && (
                            <PasswordStrengthMeter password={newPassword} />
                        )}

                        <AdditionalKeyProtectionOptions
                            value={protectionChoice}
                            onChange={(choice, source) => {
                                setProtectionChoice(choice);
                                setProtectionSource(source);
                            }}
                        />
                        <p className="text-xs text-muted-foreground">
                            Current protection:{" "}
                            <span className="font-medium">
                                {describeKind(currentKind)}
                            </span>
                        </p>

                        <Accordion
                            type="single"
                            collapsible
                            className="w-full rounded-md border"
                        >
                            <AccordionItem value="kdf-config">
                                <AccordionTrigger className="px-4 text-sm">
                                    Advanced key derivation (Argon2id)
                                </AccordionTrigger>
                                <AccordionContent className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="security-mem-limit">
                                            Memory limit (MiB)
                                        </Label>
                                        <Input
                                            id="security-mem-limit"
                                            type="number"
                                            min={
                                                KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT
                                            }
                                            max={
                                                KeyDerivationConfig_Argon2ID.MAX_MEM_LIMIT
                                            }
                                            className="vault-settings-input"
                                            value={memLimit}
                                            onChange={(e) =>
                                                setMemLimit(
                                                    Number(e.target.value),
                                                )
                                            }
                                            disabled={!isEnvelope || busy}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="security-ops-limit">
                                            Operations limit
                                        </Label>
                                        <Input
                                            id="security-ops-limit"
                                            type="number"
                                            min={
                                                KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT
                                            }
                                            max={
                                                KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT
                                            }
                                            className="vault-settings-input"
                                            value={opsLimit}
                                            onChange={(e) =>
                                                setOpsLimit(
                                                    Number(e.target.value),
                                                )
                                            }
                                            disabled={!isEnvelope || busy}
                                        />
                                    </div>
                                </AccordionContent>
                                <KdfBelowRecommendedAck
                                    memLimit={Number(memLimit)}
                                    opsLimit={Number(opsLimit)}
                                    acknowledged={kdfRiskAcknowledged}
                                    onAcknowledgedChange={
                                        setKdfRiskAcknowledged
                                    }
                                />
                            </AccordionItem>
                        </Accordion>

                        {revealProtectionPhrase && (
                            <Alert>
                                <AlertDescription className="space-y-2">
                                    <SecretReveal
                                        label="New protection phrase"
                                        value={revealProtectionPhrase}
                                        helper="Shown once. Save it: it is required after a backup restore or on devices without a cached key."
                                    />
                                </AlertDescription>
                            </Alert>
                        )}
                        {protectionChoice === "webauthn" && (
                            <p className="text-xs text-muted-foreground">
                                You will be prompted for your security key when
                                you save.
                            </p>
                        )}

                        <KeyRotationOptions
                            idPrefix="protection"
                            rotateDataKey={rotateDataKeyOnProtection}
                            onRotateDataKeyChange={setRotateDataKeyOnProtection}
                            deleteOlderManagedBackups={
                                deleteOldBackupsOnProtection
                            }
                            onDeleteOlderManagedBackupsChange={
                                setDeleteOldBackupsOnProtection
                            }
                            disabled={
                                !isEnvelope || busy || hasUnacknowledgedSecrets
                            }
                        />

                        <Button
                            className="vault-settings-primary-button w-full"
                            onClick={handleSaveSecurity}
                            disabled={
                                !isEnvelope ||
                                busy ||
                                submitBlockedByKdf ||
                                hasUnacknowledgedSecrets
                            }
                        >
                            {isSaving ? (
                                <span className="flex items-center">
                                    <LoaderCircle className="-ml-1 mr-2 h-4 w-4 animate-spin" />
                                    Updating...
                                </span>
                            ) : (
                                "Save protection settings"
                            )}
                        </Button>
                    </div>

                    <Separator />

                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <LifeBuoy className="h-4 w-4" />
                            <p className="text-sm font-medium">Recovery code</p>
                        </div>
                        <div className="vault-settings-warning rounded-md border p-3 text-xs">
                            Generating a new recovery code immediately
                            invalidates the previous one. Store the new code
                            somewhere safe; it is the only backup if you lose
                            your master password. This action requires the
                            current master password.
                        </div>

                        {revealRecovery && (
                            <Alert>
                                <AlertDescription>
                                    <SecretReveal
                                        label="New recovery code"
                                        value={revealRecovery}
                                        helper="Shown once. Save it before closing this dialog."
                                    />
                                </AlertDescription>
                            </Alert>
                        )}

                        <KeyRotationOptions
                            idPrefix="recovery"
                            rotateDataKey={rotateDataKeyOnRecovery}
                            onRotateDataKeyChange={setRotateDataKeyOnRecovery}
                            deleteOlderManagedBackups={
                                deleteOldBackupsOnRecovery
                            }
                            onDeleteOlderManagedBackupsChange={
                                setDeleteOldBackupsOnRecovery
                            }
                            disabled={
                                !isEnvelope || busy || hasUnacknowledgedSecrets
                            }
                        />

                        <Button
                            variant="outline"
                            className="vault-settings-action-button w-full"
                            onClick={handleResetRecovery}
                            disabled={
                                !isEnvelope || busy || hasUnacknowledgedSecrets
                            }
                        >
                            {isRotating ? (
                                <span className="flex items-center">
                                    <LoaderCircle className="-ml-1 mr-2 h-4 w-4 animate-spin" />
                                    Generating...
                                </span>
                            ) : (
                                "Generate new recovery code"
                            )}
                        </Button>
                    </div>
                </div>

                <DialogFooter className="vault-settings-footer border-t px-5 py-4">
                    {hasRevealedSecrets && (
                        <div className="mr-auto flex items-start gap-2 text-left">
                            <Checkbox
                                id="vault-security-secrets-saved"
                                checked={secretsAcknowledged}
                                onCheckedChange={(checked) =>
                                    setSecretsAcknowledged(checked === true)
                                }
                                disabled={busy}
                            />
                            <Label
                                htmlFor="vault-security-secrets-saved"
                                className="max-w-xs text-xs font-normal"
                            >
                                I saved the newly generated secrets and
                                understand that older downloaded backups may
                                still use their previous credentials.
                            </Label>
                        </div>
                    )}
                    <Button
                        variant="outline"
                        className="vault-settings-action-button"
                        onClick={() => handleOpenChange(false)}
                        disabled={busy || hasUnacknowledgedSecrets}
                    >
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
