import { useEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import { useAtomValue } from "jotai";
import { err, type Result } from "neverthrow";

import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import type { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import { isBelowOwaspRecommendedArgon2id } from "@cryptex-industries/vault-core/vault-utils/password-strength";
import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "@/utils/atoms";
import {
    getVaultDEKFromSession,
    getVaultSessionGeneration,
    setVaultDEKInSession,
} from "@/utils/vault-session";
import { queueManagedBackupNow } from "@/app_lib/managed-backup-hooks";
import {
    VaultMetadata,
    type VaultSecurityUpdate,
} from "@/app_lib/vault-utils/storage";
import { vaultWriteCoordinator } from "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator";
import {
    clearSecureDek,
    enrollSecureDek,
    isSecureDekEnrolled,
} from "@/lib/secure-dek";
import { PasswordStrengthMeter } from "@/components/vault/password-strength-meter";
import { PasswordGeneratorDialog } from "@/components/vault/password-generator";
import { InlineNotice } from "@/components/inline-notice";
import {
    UnlockedButton as Button,
    UnlockedCheckbox as Checkbox,
    UnlockedDialogTitle,
    UnlockedInput as Input,
    UnlockedLabel as Label,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import {
    AdditionalKeyProtectionOptions,
    choiceToSource,
    describeKind,
    isProtectionPhraseKind,
    kindToChoice,
    type AdditionalKeyProtectionChoice,
} from "./additional-key-protection-options";
import { KdfBelowRecommendedAck } from "./kdf-below-recommended-ack";
import { SecretReveal } from "./secret-reveal";
import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";

/** Mobile-friendly Argon2 default (lower mem than desktop 256). */
const MOBILE_MEM_LIMIT = 128;
const MOBILE_OPS_LIMIT = 3;

function KeyRotationOptions({
    rotateDataKey,
    onRotateDataKeyChange,
    deleteOlderManagedBackups,
    onDeleteOlderManagedBackupsChange,
    disabled,
}: {
    rotateDataKey: boolean;
    onRotateDataKeyChange: (checked: boolean) => void;
    deleteOlderManagedBackups: boolean;
    onDeleteOlderManagedBackupsChange: (checked: boolean) => void;
    disabled: boolean;
}) {
    return (
        <View className="gap-3 rounded-md border border-border p-3">
            <Checkbox
                checked={rotateDataKey}
                onCheckedChange={onRotateDataKeyChange}
                disabled={disabled}
                label="Rotate this device's vault encryption key"
            />
            <Text className="text-xs leading-5 text-muted-foreground">
                Off by default. Rotation re-encrypts this vault with a fresh
                data key and generates a new recovery code. Linked devices keep
                their own vault keys.
            </Text>
            {rotateDataKey ? (
                <InlineNotice
                    tone="warning"
                    message="Save the new recovery code before leaving this screen."
                />
            ) : null}
            <Text className="text-xs leading-5 text-muted-foreground">
                Downloaded backup files are independent copies and may still
                open with the credentials that protected them when downloaded.
            </Text>
            <Checkbox
                checked={deleteOlderManagedBackups}
                onCheckedChange={onDeleteOlderManagedBackupsChange}
                disabled={disabled}
                label="Delete older managed backups after replacement"
            />
            <Text className="text-xs leading-5 text-muted-foreground">
                If managed backups are enabled, older restore points are deleted
                only after the replacement upload succeeds.
            </Text>
        </View>
    );
}

type Props = {
    mode: "password" | "protection" | "recovery" | "kdf";
    onStageChange?: (
        stage: "main" | "protection-phrase" | "vault-code",
    ) => void;
    onCanLeaveChange?: (canLeave: boolean) => void;
};

export function VaultSecurityDialog({
    mode,
    onStageChange,
    onCanLeaveChange,
}: Props) {
    const confirm = useUnlockedConfirmation();
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const currentKind = vaultMetadata?.Blob?.Envelope?.PrimaryProtectionKind;

    const [currentPassword, setCurrentPassword] = useState("");
    const [currentProtectionPhrase, setCurrentProtectionPhrase] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const initialChoice =
        kindToChoice(currentKind) === "webauthn"
            ? "none"
            : kindToChoice(currentKind);
    const [factorChoice, setFactorChoice] =
        useState<AdditionalKeyProtectionChoice>(initialChoice);
    const [memLimit, setMemLimit] = useState(
        String(
            vaultMetadata?.Blob?.KDFConfigArgon2ID?.memLimit ??
                MOBILE_MEM_LIMIT,
        ),
    );
    const [opsLimit, setOpsLimit] = useState(
        String(
            vaultMetadata?.Blob?.KDFConfigArgon2ID?.opsLimit ??
                MOBILE_OPS_LIMIT,
        ),
    );
    const [isSaving, setIsSaving] = useState(false);
    const [isRotating, setIsRotating] = useState(false);
    const [rotateDataKeyOnProtection, setRotateDataKeyOnProtection] =
        useState(false);
    const [deleteOldBackupsOnProtection, setDeleteOldBackupsOnProtection] =
        useState(false);
    const [rotateDataKeyOnRecovery, setRotateDataKeyOnRecovery] =
        useState(false);
    const [deleteOldBackupsOnRecovery, setDeleteOldBackupsOnRecovery] =
        useState(false);
    const [error, setError] = useState("");
    const [status, setStatus] = useState("");
    const [warning, setWarning] = useState("");
    const [revealProtectionPhrase, setRevealProtectionPhrase] = useState<
        string | null
    >(null);
    const [protectionPhraseAck, setProtectionPhraseAck] = useState(false);
    const [revealRecovery, setRevealRecovery] = useState<string | null>(null);
    const [recoveryAck, setRecoveryAck] = useState(false);
    const [kdfRiskAcknowledged, setKdfRiskAcknowledged] = useState(false);
    const [generatorOpen, setGeneratorOpen] = useState(false);
    const [recoveryAuthOpen, setRecoveryAuthOpen] = useState(false);

    useEffect(() => {
        if (revealProtectionPhrase) onStageChange?.("protection-phrase");
        else if (revealRecovery) onStageChange?.("vault-code");
        else onStageChange?.("main");
    }, [onStageChange, revealProtectionPhrase, revealRecovery]);

    useEffect(() => {
        setKdfRiskAcknowledged(false);
    }, [memLimit, opsLimit]);

    const mem = Number(memLimit);
    const ops = Number(opsLimit);
    const invalidKdf = !Number.isInteger(mem) || !Number.isInteger(ops);
    const belowRecommendedKdf = isBelowOwaspRecommendedArgon2id(mem, ops);
    const submitBlockedByKdf =
        invalidKdf || (belowRecommendedKdf && !kdfRiskAcknowledged);
    const isEnvelope = !!vaultMetadata?.Blob?.Envelope;
    const busy = isSaving || isRotating;
    const webauthnVault =
        currentKind === AdditionalKeyProtectionKind.WEBAUTHN_PRF;

    const refreshBiometricIfEnrolled = async (
        masterPassword: string,
        protectionPhrase?: string,
    ) => {
        const metadata = vaultStore.get(unlockedVaultMetadataAtom);
        if (metadata?.DBIndex == null) return;
        const enrolled = await isSecureDekEnrolled(metadata.DBIndex);
        if (!enrolled) return;
        try {
            const dekRes = await metadata.prepareBiometricUnlock(
                masterPassword,
                protectionPhrase,
            );
            if (dekRes.isErr()) throw new Error(dekRes.error);
            const refreshed = await enrollSecureDek(
                metadata.DBIndex,
                dekRes.value,
            );
            if (!refreshed) throw new Error("BIOMETRIC_REFRESH_FAILED");
        } catch (error) {
            await clearSecureDek(metadata.DBIndex).catch(() => undefined);
            throw error;
        }
    };

    const persistSecurityChange = async (
        change: (
            metadata: VaultMetadata,
            vault: Vault,
            dek: CryptoKey,
        ) => Promise<Result<VaultSecurityUpdate, string>>,
    ): Promise<Result<VaultSecurityUpdate, string>> => {
        const generation = getVaultSessionGeneration();
        return vaultWriteCoordinator.run("vault.configuration", async () => {
            if (generation !== getVaultSessionGeneration())
                return err("VAULT_SESSION_CHANGED");
            const metadata = vaultStore.get(unlockedVaultMetadataAtom);
            const dek = getVaultDEKFromSession();
            if (!metadata) return err("VAULT_METADATA_MISSING");
            if (dek.isErr()) return err(dek.error);
            const result = await change(
                metadata,
                vaultStore.get(unlockedVaultAtom),
                dek.value,
            );
            if (generation !== getVaultSessionGeneration())
                return err("VAULT_SESSION_CHANGED");
            if (result.isErr()) return result;
            if (result.value.sessionDek) {
                setVaultDEKInSession(result.value.sessionDek);
            }
            vaultStore.set(
                unlockedVaultMetadataAtom,
                Object.assign(new VaultMetadata(), metadata),
            );
            return result;
        });
    };

    const queueSecurityBackup = (
        deleteOlderSnapshots: boolean,
        localSuccessMessage: string,
    ) => {
        setStatus(`${localSuccessMessage} Updating managed backup…`);
        void queueManagedBackupNow(deleteOlderSnapshots)
            .then(() => {
                setStatus(`${localSuccessMessage} Managed backup updated.`);
            })
            .catch((backupError: unknown) => {
                const message =
                    backupError instanceof Error
                        ? backupError.message
                        : "Managed backup did not complete.";
                setStatus(`${localSuccessMessage} ${message}`);
            });
    };

    const clearCurrentAuthorization = () => {
        setCurrentPassword("");
        setCurrentProtectionPhrase("");
    };

    const handleSaveSecurity = async () => {
        if (!vaultMetadata) {
            setError("Vault metadata is unavailable.");
            return;
        }
        if (!currentPassword.trim()) {
            setError(
                "Enter your current master password to authorize this change.",
            );
            return;
        }
        if (webauthnVault) {
            setError(
                "This vault uses WebAuthn PRF. Reconfigure security from desktop until mobile WebAuthn is available.",
            );
            return;
        }
        if (factorChoice === "webauthn") {
            setError("WebAuthn PRF is not available on mobile yet.");
            return;
        }

        const changingPassword = newPassword.length > 0;
        if (changingPassword && newPassword !== confirmPassword) {
            setError("New password and confirmation do not match.");
            return;
        }
        if (invalidKdf) {
            setError("Memory and operations limits must be whole numbers.");
            return;
        }
        if (
            mem < KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT ||
            mem > KeyDerivationConfig_Argon2ID.MAX_MEM_LIMIT
        ) {
            setError(
                `Memory limit must be between ${KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT} and ${KeyDerivationConfig_Argon2ID.MAX_MEM_LIMIT} MiB.`,
            );
            return;
        }
        if (
            ops < KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT ||
            ops > KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT
        ) {
            setError(
                `Operations limit must be between ${KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT} and ${KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT}.`,
            );
            return;
        }

        setIsSaving(true);
        setError("");
        setStatus("");
        setWarning("");
        setRevealProtectionPhrase(null);
        setProtectionPhraseAck(false);
        setRevealRecovery(null);
        setRecoveryAck(false);
        try {
            const res = await persistSecurityChange((metadata, vault, dek) =>
                metadata.reconfigureSecurity({
                    currentMasterPassword: currentPassword,
                    currentProtectionPhrase:
                        currentProtectionPhrase.trim() || undefined,
                    newMasterPassword: changingPassword
                        ? newPassword
                        : undefined,
                    additionalKeyProtection: choiceToSource(factorChoice),
                    kdfConfig: new KeyDerivationConfig_Argon2ID(mem, ops),
                    rotateDataKey: rotateDataKeyOnProtection,
                    unlockedVault: vault,
                    unlockedVaultDEK: dek,
                }),
            );
            clearCurrentAuthorization();

            if (res.isErr()) {
                if (
                    res.error === "DEK_UNWRAP_FAILED" ||
                    res.error === "KEK_DERIVATION_FAILED"
                ) {
                    setError(
                        "Incorrect current master password or protection phrase.",
                    );
                } else if (res.error === "WEBAUTHN_PRF_UNSUPPORTED") {
                    setError("WebAuthn PRF is not available on mobile yet.");
                } else {
                    setError(`Failed to update security: ${res.error}`);
                }
                return;
            }

            setNewPassword("");
            setConfirmPassword("");
            const reveal = res.value;
            if (reveal.protectionPhrase) {
                setRevealProtectionPhrase(reveal.protectionPhrase);
            }
            if (reveal.recoveryCode) {
                setRevealRecovery(reveal.recoveryCode);
                setRecoveryAck(false);
            }
            const cacheWarning =
                reveal.deviceKeyProtectionCached === false
                    ? reveal.additionalKeyProtectionKind ===
                      AdditionalKeyProtectionKind.NONE
                        ? " The obsolete device protection cache could not be cleared."
                        : " This device could not cache the new protection key, so the protection phrase will be required on the next unlock."
                    : "";
            queueSecurityBackup(
                deleteOldBackupsOnProtection,
                (reveal.dataKeyRotated
                    ? "Security settings and vault encryption key updated."
                    : "Security settings updated.") + cacheWarning,
            );
            if (reveal.dataKeyRotated) {
                try {
                    await refreshBiometricIfEnrolled(
                        changingPassword ? newPassword : currentPassword,
                        reveal.protectionPhrase,
                    );
                } catch {
                    setWarning(
                        "The vault key was rotated, but biometric unlock could not be refreshed and was disabled. Re-enable it from Security settings.",
                    );
                }
            }
        } catch {
            clearCurrentAuthorization();
            setError("Failed to update security settings.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleResetRecovery = async () => {
        if (!vaultMetadata) {
            setError("Vault metadata is unavailable.");
            return;
        }
        if (!currentPassword.trim()) {
            setError(
                "Enter your current master password to authorize this change.",
            );
            return;
        }
        if (webauthnVault) {
            setError(
                "This vault uses WebAuthn PRF. Reset recovery from desktop until mobile WebAuthn is available.",
            );
            return;
        }

        setIsRotating(true);
        setError("");
        setStatus("");
        setWarning("");
        setRevealRecovery(null);
        setRecoveryAck(false);
        try {
            const res = await persistSecurityChange((metadata, vault, dek) =>
                metadata.resetRecoveryCode({
                    currentMasterPassword: currentPassword,
                    currentProtectionPhrase:
                        currentProtectionPhrase.trim() || undefined,
                    rotateDataKey: rotateDataKeyOnRecovery,
                    unlockedVault: vault,
                    unlockedVaultDEK: dek,
                }),
            );
            clearCurrentAuthorization();

            if (res.isErr()) {
                if (
                    res.error === "DEK_UNWRAP_FAILED" ||
                    res.error === "KEK_DERIVATION_FAILED"
                ) {
                    setError(
                        "Incorrect current master password or protection phrase.",
                    );
                } else {
                    setError(`Failed to reset recovery code: ${res.error}`);
                }
                return;
            }

            setRecoveryAuthOpen(false);
            setRevealRecovery(res.value.recoveryCode);
            queueSecurityBackup(
                deleteOldBackupsOnRecovery,
                res.value.dataKeyRotated
                    ? "Recovery code and vault encryption key replaced."
                    : "New recovery code generated.",
            );
            if (res.value.dataKeyRotated) {
                try {
                    await refreshBiometricIfEnrolled(
                        currentPassword,
                        currentProtectionPhrase.trim() || undefined,
                    );
                } catch {
                    setWarning(
                        "The vault key was rotated, but biometric unlock could not be refreshed and was disabled. Re-enable it from Security settings.",
                    );
                }
            }
        } catch {
            clearCurrentAuthorization();
            setError("Failed to reset recovery code.");
        } finally {
            setIsRotating(false);
        }
    };

    const hasUnacknowledgedSecrets =
        (!!revealRecovery && !recoveryAck) ||
        (!!revealProtectionPhrase && !protectionPhraseAck);
    const canClose = !busy && !hasUnacknowledgedSecrets;

    useEffect(() => {
        onCanLeaveChange?.(canClose);
    }, [canClose, onCanLeaveChange]);

    if (revealProtectionPhrase) {
        return (
            <View className="gap-4">
                <View className="mb-1 border-b border-border pb-[22px]">
                    <Text
                        style={{
                            marginTop: 10,
                            fontSize: 22,
                            fontWeight: "500",
                            letterSpacing: -0.5,
                        }}
                    >
                        Save this phrase separately
                    </Text>
                    <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                        You will need it when restoring on a new device.
                    </Text>
                </View>
                <SecretReveal
                    label="Protection phrase"
                    value={revealProtectionPhrase}
                    requireAck
                    defaultRevealed
                    alwaysShowAcknowledgement
                    flat
                    ackLabel="I saved the protection phrase separately."
                    acknowledged={protectionPhraseAck}
                    onAcknowledgedChange={setProtectionPhraseAck}
                />
                <Button
                    disabled={!protectionPhraseAck}
                    onPress={() => setRevealProtectionPhrase(null)}
                >
                    Finish
                </Button>
            </View>
        );
    }

    if (revealRecovery) {
        return (
            <View className="gap-4">
                <View className="mb-1 border-b border-border pb-[22px]">
                    <Text
                        style={{
                            marginTop: 10,
                            fontSize: 22,
                            fontWeight: "500",
                            letterSpacing: -0.5,
                        }}
                    >
                        Save your new code
                    </Text>
                    <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                        Keep this code somewhere safe, outside this vault.
                    </Text>
                </View>
                <SecretReveal
                    label="Vault recovery code"
                    value={revealRecovery}
                    requireAck
                    defaultRevealed
                    alwaysShowAcknowledgement
                    flat
                    ackLabel="I saved my new vault recovery code."
                    acknowledged={recoveryAck}
                    onAcknowledgedChange={setRecoveryAck}
                />
                <Button
                    disabled={!recoveryAck}
                    onPress={() => setRevealRecovery(null)}
                >
                    Finish
                </Button>
            </View>
        );
    }

    const kdfFields = (
        <View className="gap-3">
            <View className="gap-3">
                <View>
                    <Label>Memory (MiB)</Label>
                    <Input
                        value={memLimit}
                        onChangeText={setMemLimit}
                        keyboardType="number-pad"
                        editable={isEnvelope && !busy && !webauthnVault}
                        accessibilityLabel="Argon2 memory limit in mebibytes"
                    />
                </View>
                <View>
                    <Label>Iterations</Label>
                    <Input
                        value={opsLimit}
                        onChangeText={setOpsLimit}
                        keyboardType="number-pad"
                        editable={isEnvelope && !busy && !webauthnVault}
                        accessibilityLabel="Argon2 operations limit"
                    />
                </View>
            </View>
            {mem > MOBILE_MEM_LIMIT ? (
                <InlineNotice
                    tone="warning"
                    message={`High Argon2 memory (${mem} MiB) may OOM or stall unlock on phones. Prefer ${MOBILE_MEM_LIMIT} MiB / ops ${MOBILE_OPS_LIMIT}.`}
                />
            ) : null}
            <KdfBelowRecommendedAck
                memLimit={mem}
                opsLimit={ops}
                acknowledged={kdfRiskAcknowledged}
                onAcknowledgedChange={setKdfRiskAcknowledged}
            />
        </View>
    );

    const authorizationFields = (
        <>
            <View>
                <Label>Current master password</Label>
                <Input
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    editable={isEnvelope && !busy && !webauthnVault}
                    placeholder="Required to authorize changes"
                    accessibilityLabel="Current master password"
                />
            </View>
            {isProtectionPhraseKind(currentKind) ? (
                <View>
                    <Label>Current protection phrase</Label>
                    <Input
                        value={currentProtectionPhrase}
                        onChangeText={setCurrentProtectionPhrase}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={isEnvelope && !busy}
                        accessibilityLabel="Current protection phrase"
                    />
                </View>
            ) : null}
        </>
    );

    return (
        <>
            {mode === "protection" ? (
                <View className="mb-1 border-b border-border pb-[22px]">
                    <Text
                        style={{
                            marginTop: 10,
                            fontSize: 22,
                            fontWeight: "500",
                            letterSpacing: -0.5,
                        }}
                    >
                        Add a protection phrase
                    </Text>
                    <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                        Your master password is always required. A generated
                        phrase adds a second secret.
                    </Text>
                </View>
            ) : mode === "recovery" ? (
                <View className="mb-1 border-b border-border pb-[22px]">
                    <Text
                        style={{
                            marginTop: 10,
                            fontSize: 22,
                            fontWeight: "500",
                            letterSpacing: -0.5,
                        }}
                    >
                        Recover this vault
                    </Text>
                    <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                        Your recovery code can restore access to the encrypted
                        vault if you forget the password.
                    </Text>
                </View>
            ) : mode === "kdf" ? (
                <View className="mb-1 border-b border-border pb-[22px]">
                    <Text
                        style={{
                            marginTop: 10,
                            fontSize: 22,
                            fontWeight: "500",
                            letterSpacing: -0.5,
                        }}
                    >
                        Key derivation
                    </Text>
                    <Text className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                        Argon2id makes password guessing more expensive. These
                        settings affect unlock time.
                    </Text>
                </View>
            ) : null}
            {!isEnvelope ? (
                <InlineNotice
                    tone="warning"
                    message="This vault uses a legacy format. Unlock it once to upgrade before changing security settings."
                />
            ) : null}

            {webauthnVault ? (
                <InlineNotice
                    tone="warning"
                    message="This vault uses WebAuthn PRF, whose derived output Android does not expose. Reconfigure from desktop or use recovery to re-key it on Android."
                />
            ) : null}

            <View className="gap-3">
                {mode === "password" ? authorizationFields : null}

                {mode === "password" ? (
                    <>
                        <View>
                            <Label>New master password</Label>
                            <Input
                                value={newPassword}
                                onChangeText={setNewPassword}
                                onGenerate={() => {
                                    Keyboard.dismiss();
                                    setError("");
                                    setStatus("");
                                    setGeneratorOpen(true);
                                }}
                                revealButtonHeight={54}
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                                textContentType="newPassword"
                                editable={isEnvelope && !busy && !webauthnVault}
                                accessibilityLabel="New master password"
                            />
                            {newPassword.length > 0 ? (
                                <PasswordStrengthMeter password={newPassword} />
                            ) : null}
                        </View>
                        <View>
                            <Label>Confirm new password</Label>
                            <Input
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                revealButtonHeight={54}
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={isEnvelope && !busy && !webauthnVault}
                                placeholder="Repeat new password"
                                accessibilityLabel="Confirm new master password"
                            />
                        </View>
                        <View className="border-l-2 border-muted pl-3">
                            <Text className="text-xs leading-5 text-muted-foreground">
                                Use a unique password. Keep an up-to-date
                                encrypted backup after changing vault
                                protection.
                            </Text>
                        </View>
                    </>
                ) : null}

                {mode === "protection" ? (
                    <>
                        <AdditionalKeyProtectionOptions
                            unlocked
                            value={factorChoice}
                            disabled={!isEnvelope || busy || webauthnVault}
                            onChange={setFactorChoice}
                        />
                        <Text className="text-xs text-muted-foreground">
                            Current protection: {describeKind(currentKind)}
                        </Text>
                        {authorizationFields}
                    </>
                ) : null}

                {mode === "kdf" ? (
                    <>
                        <View className="min-h-[54px] flex-row items-center justify-between border-b border-border">
                            <Text className="text-[13px] text-muted-foreground">
                                Cipher
                            </Text>
                            <Text className="text-[13px] text-foreground">
                                AES-256
                            </Text>
                        </View>
                        {kdfFields}
                        {authorizationFields}
                        <View className="border-l-2 border-muted pl-[13px]">
                            <Text className="text-xs leading-[18px] text-muted-foreground">
                                Lower settings can weaken password protection.
                                Higher settings need more memory and may unlock
                                more slowly.
                            </Text>
                        </View>
                    </>
                ) : null}

                {mode !== "recovery" ? (
                    <KeyRotationOptions
                        rotateDataKey={rotateDataKeyOnProtection}
                        onRotateDataKeyChange={setRotateDataKeyOnProtection}
                        deleteOlderManagedBackups={deleteOldBackupsOnProtection}
                        onDeleteOlderManagedBackupsChange={
                            setDeleteOldBackupsOnProtection
                        }
                        disabled={
                            !isEnvelope || busy || hasUnacknowledgedSecrets
                        }
                    />
                ) : null}

                {mode !== "recovery" ? (
                    <Button
                        loading={isSaving}
                        disabled={
                            !isEnvelope ||
                            busy ||
                            submitBlockedByKdf ||
                            webauthnVault ||
                            hasUnacknowledgedSecrets
                        }
                        onPress={() => {
                            if (mode !== "kdf") {
                                void handleSaveSecurity();
                                return;
                            }
                            confirm({
                                title: "Review encryption changes",
                                description: `Argon2id memory: ${mem} MiB\nIterations: ${ops}\n\nHigher settings use more time and memory whenever this vault is unlocked.`,
                                cancelLabel: "Keep editing",
                                confirmLabel: "Save changes",
                                destructive: false,
                                onConfirm: () => void handleSaveSecurity(),
                            });
                        }}
                    >
                        {mode === "password"
                            ? "Change password"
                            : mode === "protection"
                              ? "Apply protection"
                              : "Review changes"}
                    </Button>
                ) : null}

                {mode === "recovery" ? (
                    <>
                        <View className="my-5 border-l-2 border-primary pl-[13px]">
                            <Text className="text-xs leading-[18px] text-muted-foreground">
                                Replacing the code invalidates the previous code
                                for the updated vault. Older backups may still
                                need their original code.
                            </Text>
                        </View>

                        <KeyRotationOptions
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
                            loading={isRotating}
                            disabled={
                                !isEnvelope ||
                                busy ||
                                webauthnVault ||
                                hasUnacknowledgedSecrets
                            }
                            onPress={() => {
                                setCurrentPassword("");
                                setCurrentProtectionPhrase("");
                                setError("");
                                setStatus("");
                                setWarning("");
                                setRecoveryAuthOpen(true);
                            }}
                        >
                            Replace recovery code
                        </Button>
                    </>
                ) : null}

                {error && !recoveryAuthOpen ? (
                    <InlineNotice tone="error" message={error} />
                ) : null}
                {warning && !error ? (
                    <InlineNotice tone="warning" message={warning} />
                ) : null}
                {status && !error ? (
                    <InlineNotice tone="success" message={status} />
                ) : null}
            </View>
            <PasswordGeneratorDialog
                open={generatorOpen}
                onOpenChange={setGeneratorOpen}
                placement="bottom"
                onPasswordSelect={(generated) => {
                    setNewPassword(generated);
                    setConfirmPassword(generated);
                    setError("");
                    setStatus("");
                }}
            />
            <Dialog
                open={recoveryAuthOpen}
                onOpenChange={(next) => {
                    if (busy) return;
                    setRecoveryAuthOpen(next);
                    if (!next) setError("");
                }}
                placement="bottom"
            >
                <DialogHeader>
                    <UnlockedDialogTitle>
                        Replace recovery code
                    </UnlockedDialogTitle>
                    <Text className="text-[13px] leading-5 text-muted-foreground">
                        Enter your current master password before replacing the
                        recovery code.
                    </Text>
                </DialogHeader>
                <View className="gap-5">{authorizationFields}</View>
                {error ? <InlineNotice tone="error" message={error} /> : null}
                <DialogFooter>
                    <Button
                        variant="outline"
                        disabled={busy}
                        onPress={() => {
                            setRecoveryAuthOpen(false);
                            setError("");
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        loading={isRotating}
                        disabled={!isEnvelope || busy || webauthnVault}
                        onPress={() => void handleResetRecovery()}
                    >
                        Replace recovery code
                    </Button>
                </DialogFooter>
            </Dialog>
        </>
    );
}
