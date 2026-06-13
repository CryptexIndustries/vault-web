import { useEffect, useState } from "react";
import { PasswordStrengthMeter } from "@/components/vault-security/password-strength-meter";
import { KdfBelowRecommendedAck } from "@/components/vault-security/kdf-below-recommended-ack";
import { isBelowOwaspRecommendedArgon2id } from "@/app_lib/vault-utils/password-strength";
import { useAtomValue } from "jotai/react";
import {
    Copy,
    KeyRound,
    LifeBuoy,
    LoaderCircle,
    ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { SecondFactorKind } from "@/app_lib/proto/vault";
import { KeyDerivationConfig_Argon2ID } from "@/app_lib/vault-utils/encryption";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
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
    SecondFactorOptions,
    type SecondFactorChoice,
    choiceToSource,
} from "@/components/vault-manager/second-factor-options";
import { unlockedVaultMetadataAtom } from "@/utils/atoms";
import { copySecretToClipboard } from "@/utils/clipboard";
import { vaultLog } from "@/utils/logging";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

function kindToChoice(kind: SecondFactorKind | undefined): SecondFactorChoice {
    switch (kind) {
        case SecondFactorKind.PASSPHRASE_128:
            return "passphrase128";
        case SecondFactorKind.PASSPHRASE_256:
            return "passphrase256";
        case SecondFactorKind.WEBAUTHN_PRF:
            return "webauthn";
        default:
            return "none";
    }
}

function describeKind(kind: SecondFactorKind | undefined): string {
    switch (kind) {
        case SecondFactorKind.PASSPHRASE_128:
            return "Generated passphrase (128-bit)";
        case SecondFactorKind.PASSPHRASE_256:
            return "Generated passphrase (256-bit)";
        case SecondFactorKind.WEBAUTHN_PRF:
            return "Security key (WebAuthn PRF)";
        default:
            return "None (master password only)";
    }
}

function isPassphraseKind(kind: SecondFactorKind | undefined): boolean {
    return (
        kind === SecondFactorKind.PASSPHRASE_128 ||
        kind === SecondFactorKind.PASSPHRASE_256
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

export function VaultSecurityDialog({ open, onOpenChange }: Props) {
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const currentKind = vaultMetadata?.Blob?.Envelope?.PrimaryFactorKind;

    const [currentPassword, setCurrentPassword] = useState("");
    const [currentSecondFactorPassphrase, setCurrentSecondFactorPassphrase] =
        useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [factorChoice, setFactorChoice] =
        useState<SecondFactorChoice>("none");
    const [factorSource, setFactorSource] = useState(choiceToSource("none"));
    const [memLimit, setMemLimit] = useState(
        KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
    );
    const [opsLimit, setOpsLimit] = useState(
        KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
    );

    const [isSaving, setIsSaving] = useState(false);
    const [isRotating, setIsRotating] = useState(false);
    const [revealPassphrase, setRevealPassphrase] = useState<string | null>(
        null,
    );
    const [revealRecovery, setRevealRecovery] = useState<string | null>(null);
    const [kdfRiskAcknowledged, setKdfRiskAcknowledged] = useState(false);

    // Reset local state to the vault's current configuration whenever the
    // dialog opens, so stale input never leaks across sessions.
    useEffect(() => {
        if (!open) return;
        setCurrentPassword("");
        setCurrentSecondFactorPassphrase("");
        setNewPassword("");
        setConfirmPassword("");
        setFactorChoice(kindToChoice(currentKind));
        setFactorSource(choiceToSource(kindToChoice(currentKind)));
        setMemLimit(
            vaultMetadata?.Blob?.KDFConfigArgon2ID?.memLimit ??
                KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
        );
        setOpsLimit(
            vaultMetadata?.Blob?.KDFConfigArgon2ID?.opsLimit ??
                KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
        );
        setRevealPassphrase(null);
        setRevealRecovery(null);
        setKdfRiskAcknowledged(false);
    }, [open, currentKind, vaultMetadata]);

    useEffect(() => {
        setKdfRiskAcknowledged(false);
    }, [memLimit, opsLimit]);

    const belowRecommendedKdf = isBelowOwaspRecommendedArgon2id(
        Number(memLimit),
        Number(opsLimit),
    );
    const submitBlockedByKdf = belowRecommendedKdf && !kdfRiskAcknowledged;

    const requireCurrentPassword = (): boolean => {
        if (currentPassword.trim().length === 0) {
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
        if (!requireCurrentPassword()) return;

        const changingPassword = newPassword.length > 0;
        if (changingPassword && newPassword !== confirmPassword) {
            toast.error("New password and confirmation do not match.");
            return;
        }

        setIsSaving(true);
        setRevealPassphrase(null);
        try {
            const res = await vaultMetadata.reconfigureSecurity({
                currentMasterPassword: currentPassword,
                currentSecondFactorPassphrase:
                    currentSecondFactorPassphrase.trim() || undefined,
                newMasterPassword: changingPassword ? newPassword : undefined,
                secondFactor: factorSource,
                kdfConfig: new KeyDerivationConfig_Argon2ID(
                    Number(memLimit),
                    Number(opsLimit),
                ),
            });

            if (res.isErr()) {
                if (
                    res.error === "DEK_UNWRAP_FAILED" ||
                    res.error === "KEK_DERIVATION_FAILED"
                ) {
                    toast.error("Incorrect current master password.");
                    return;
                }
                vaultLog.error("reconfigureSecurity failed", {
                    error: res.error,
                });
                toast.error("Failed to update security settings.");
                return;
            }

            toast.success("Security settings updated.");
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");

            const reveal = res.value;
            if (reveal?.secondFactorPassphrase) {
                setRevealPassphrase(reveal.secondFactorPassphrase);
            }
        } catch (error) {
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
        setRevealRecovery(null);
        try {
            const res = await vaultMetadata.resetRecoveryCode({
                currentMasterPassword: currentPassword,
                currentSecondFactorPassphrase:
                    currentSecondFactorPassphrase.trim() || undefined,
            });

            if (res.isErr()) {
                if (
                    res.error === "DEK_UNWRAP_FAILED" ||
                    res.error === "KEK_DERIVATION_FAILED"
                ) {
                    toast.error("Incorrect current master password.");
                    return;
                }
                vaultLog.error("resetRecoveryCode failed", {
                    error: res.error,
                });
                toast.error("Failed to reset recovery code.");
                return;
            }

            setRevealRecovery(res.value.recoveryCode);
            toast.success("New recovery code generated.");
        } catch (error) {
            vaultLog.error("resetRecoveryCode threw", { error });
            toast.error("Failed to reset recovery code.");
        } finally {
            setIsRotating(false);
        }
    };

    const isEnvelope = !!vaultMetadata?.Blob?.Envelope;
    const busy = isSaving || isRotating;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="vault-settings-dialog flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
                <DialogHeader className="border-b px-5 py-4">
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5" />
                        Encryption &amp; Security
                    </DialogTitle>
                    <DialogDescription>
                        Change your master password, second factor, and recovery
                        code. The vault data itself is not re-encrypted.
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
                            placeholder="Required to authorize changes"
                            className="vault-settings-input"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            disabled={!isEnvelope || busy}
                        />
                        <p className="text-xs text-muted-foreground">
                            Proves ownership so the vault key can be re-wrapped.
                        </p>
                    </div>

                    {isPassphraseKind(currentKind) && (
                        <div className="space-y-2">
                            <Label htmlFor="current-second-factor-passphrase">
                                Current second-factor passphrase
                            </Label>
                            <Input
                                id="current-second-factor-passphrase"
                                type="password"
                                placeholder="Optional on this device, required after restore"
                                className="vault-settings-input font-mono text-xs"
                                value={currentSecondFactorPassphrase}
                                onChange={(e) =>
                                    setCurrentSecondFactorPassphrase(
                                        e.target.value,
                                    )
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
                                Master password &amp; second factor
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

                        <SecondFactorOptions
                            value={factorChoice}
                            onChange={(choice, source) => {
                                setFactorChoice(choice);
                                setFactorSource(source);
                            }}
                        />
                        <p className="text-xs text-muted-foreground">
                            Current second factor:{" "}
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

                        {revealPassphrase && (
                            <Alert>
                                <AlertDescription className="space-y-2">
                                    <SecretReveal
                                        label="New second-factor passphrase"
                                        value={revealPassphrase}
                                        helper="Shown once. Write it down: it is required after backup restore or on devices without a local cache."
                                    />
                                </AlertDescription>
                            </Alert>
                        )}
                        {factorChoice === "webauthn" && (
                            <p className="text-xs text-muted-foreground">
                                You will be prompted for your security key when
                                you save.
                            </p>
                        )}

                        <Button
                            className="vault-settings-primary-button w-full"
                            onClick={handleSaveSecurity}
                            disabled={!isEnvelope || busy || submitBlockedByKdf}
                        >
                            {isSaving ? (
                                <span className="flex items-center">
                                    <LoaderCircle className="-ml-1 mr-2 h-4 w-4 animate-spin" />
                                    Updating...
                                </span>
                            ) : (
                                "Save password & 2FA"
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
                            your master password.
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

                        <Button
                            variant="outline"
                            className="vault-settings-action-button w-full"
                            onClick={handleResetRecovery}
                            disabled={!isEnvelope || busy}
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
                    <Button
                        variant="outline"
                        className="vault-settings-action-button"
                        onClick={() => onOpenChange(false)}
                        disabled={busy}
                    >
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
