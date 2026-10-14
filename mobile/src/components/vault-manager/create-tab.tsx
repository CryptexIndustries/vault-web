import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, View, type TextInput } from "react-native";
import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { useSetAtom } from "jotai";
import { Check, ChevronDown } from "lucide-react-native";

import { VaultMetadata } from "@/app_lib/vault-utils/storage";
import {
    EncryptionAlgorithm,
    KeyDerivationFunction,
} from "@cryptex-industries/vault-core/proto";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import {
    Dialog,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { InlineNotice } from "@/components/inline-notice";
import { AdvancedDisclosure } from "@/components/section";
import { PasswordGeneratorDialog } from "@/components/vault/password-generator";
import { PasswordStrengthMeter } from "@/components/vault/password-strength-meter";
import {
    VaultEntryAction,
    VaultEntryAssurance,
    VaultEntryFieldError,
    VaultEntrySteps,
} from "@/components/vault-entry-ui";
import { SecretReveal } from "@/components/vault-security/secret-reveal";
import {
    choiceToSource,
    type AdditionalKeyProtectionChoice,
} from "@/components/vault-security/additional-key-protection-options";
import { unlockedVaultAtom, unlockedVaultMetadataAtom } from "@/utils/atoms";
import { setVaultDEKInSessionForMetadata } from "@/utils/vault-session";
import { vaultLog } from "@/utils/logging";
import { cn } from "@/lib/utils";
import { colors } from "@/theme";
import type { ImportResult } from "@cryptex-industries/vault-core/vault-utils/import-export";
import { ImportWizard } from "@/components/vault-import/import-wizard";
import { useScrollToNode } from "@/components/keyboard-scroll";
import { readPickedImportFile } from "@/utils/mobile-import-picker";
import { ensureSecretTempFilesReady } from "@/utils/secret-temp-files";

/** Mobile-friendly Argon2 defaults (lower mem than desktop 256). */
const MOBILE_MEM_LIMIT = 128;
const MOBILE_OPS_LIMIT = 3;

const CREATE_PROTECTION_OPTIONS: {
    id: AdditionalKeyProtectionChoice;
    label: string;
}[] = [
    { id: "none", label: "No additional key protection" },
    { id: "protectionPhrase128", label: "Generated phrase (128-bit)" },
    { id: "protectionPhrase256", label: "Generated phrase (256-bit)" },
];

export function CreateTab() {
    const setUnlockedVault = useSetAtom(unlockedVaultAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [generatorOpen, setGeneratorOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [fieldErrors, setFieldErrors] = useState({
        name: "",
        password: "",
        confirm: "",
    });
    const [formStage, setFormStage] = useState<0 | 1>(0);
    const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
    const [additionalKeyProtectionChoice, setAdditionalKeyProtectionChoice] =
        useState<AdditionalKeyProtectionChoice>("none");
    const [protectionPickerOpen, setProtectionPickerOpen] = useState(false);
    const [protectionPhrase, setProtectionPhrase] = useState<string | null>(
        null,
    );
    const [recoveryAck, setRecoveryAck] = useState(false);
    const [additionalKeyProtectionAck, setAdditionalKeyProtectionAck] =
        useState(false);
    const [initialImport, setInitialImport] = useState<ImportResult | null>(
        null,
    );
    const pendingUnlock = useRef<Awaited<
        ReturnType<typeof VaultMetadata.createNewVault>
    > | null>(null);
    const finishInFlight = useRef(false);
    const nameRef = useRef<TextInput>(null);
    const passwordRef = useRef<TextInput>(null);
    const confirmRef = useRef<TextInput>(null);
    const errorRef = useRef<View>(null);
    const sheetErrorRef = useRef<View>(null);
    const scrollToNode = useScrollToNode();

    useEffect(() => {
        if (!error) return;
        requestAnimationFrame(() =>
            scrollToNode(
                recoveryCode ? sheetErrorRef.current : errorRef.current,
                48,
            ),
        );
    }, [error, recoveryCode, scrollToNode]);

    const validateProtection = () => {
        const next = {
            name: name.trim() ? "" : "Enter a name for this vault.",
            password: password ? "" : "Enter a master password.",
            confirm: !confirm
                ? "Confirm your master password."
                : password === confirm
                  ? ""
                  : "Enter the same password again.",
        };
        setFieldErrors(next);
        const first = next.name
            ? nameRef
            : next.password
              ? passwordRef
              : next.confirm
                ? confirmRef
                : null;
        if (first) requestAnimationFrame(() => first.current?.focus());
        return first == null;
    };

    const clearFieldError = (field: keyof typeof fieldErrors) => {
        setFieldErrors((current) =>
            current[field] ? { ...current, [field]: "" } : current,
        );
    };

    const handleCreate = async () => {
        setError("");
        if (!validateProtection()) return;

        setLoading(true);
        await new Promise((r) => setTimeout(r, 50));

        try {
            const created = await VaultMetadata.createNewVault(
                { Name: name.trim(), Description: description.trim() },
                {
                    Secret: password,
                    Encryption: EncryptionAlgorithm.XChaCha20Poly1305,
                    EncryptionKeyDerivationFunction:
                        KeyDerivationFunction.Argon2ID,
                    EncryptionConfig: {
                        iterations: 600000,
                        memLimit: MOBILE_MEM_LIMIT,
                        opsLimit: MOBILE_OPS_LIMIT,
                    },
                },
                false,
                0,
                {
                    additionalKeyProtection: choiceToSource(
                        additionalKeyProtectionChoice,
                    ),
                },
                initialImport ?? undefined,
            );

            if (created.revealSecrets.recoveryCode) {
                pendingUnlock.current = created;
                setRecoveryCode(created.revealSecrets.recoveryCode);
                setProtectionPhrase(
                    created.revealSecrets.protectionPhrase ?? null,
                );
                setRecoveryAck(false);
                setAdditionalKeyProtectionAck(false);
            }

            if (!created.revealSecrets.recoveryCode) {
                throw new Error(
                    "Vault creation did not produce a recovery code.",
                );
            }
        } catch (cause) {
            vaultLog.error("Failed to create vault", {
                cause:
                    cause instanceof Error
                        ? {
                              name: cause.name,
                              message: cause.message,
                              stack: __DEV__ ? cause.stack : undefined,
                          }
                        : String(cause),
            });
            setError("Failed to create vault.");
        } finally {
            setLoading(false);
        }
    };

    const continueToPersonalize = () => {
        setError("");
        if (!validateProtection()) return;
        setFormStage(1);
    };

    const finishCreate = async () => {
        const created = pendingUnlock.current;
        if (!created || finishInFlight.current) return;
        finishInFlight.current = true;
        setLoading(true);
        setError("");
        try {
            await created.metadata.save(created.vault, created.dek);
            await created.metadata.persistAdditionalKeyProtectionEnrollment(
                created.enrolledProtection,
            );
            setVaultDEKInSessionForMetadata(created.metadata, created.dek);
            setUnlockedVaultMetadata(created.metadata);
            setUnlockedVault(created.vault);
            pendingUnlock.current = null;
            setRecoveryCode(null);
            setProtectionPhrase(null);
            setRecoveryAck(false);
            setAdditionalKeyProtectionAck(false);
            router.replace("/(app)/(tabs)/vault");
        } catch {
            setError(
                "Could not save the vault. Your recovery details are still available; try again.",
            );
        } finally {
            finishInFlight.current = false;
            setLoading(false);
        }
    };

    return (
        <View>
            <VaultEntrySteps
                labels={["Protect", "Personalize", "Save recovery"]}
                current={formStage}
            />
            {formStage === 0 ? (
                <>
                    <View className="mb-[17px]">
                        <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                            Vault name
                        </Label>
                        <Input
                            ref={nameRef}
                            value={name}
                            onChangeText={(value) => {
                                setName(value);
                                clearFieldError("name");
                            }}
                            invalid={!!fieldErrors.name}
                            placeholder="e.g. Personal"
                            autoCapitalize="words"
                            accessibilityLabel="Vault name"
                            className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                        />
                        <VaultEntryFieldError message={fieldErrors.name} />
                    </View>
                    <View className="mb-[17px]">
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
                            onGenerate={() => {
                                Keyboard.dismiss();
                                setGeneratorOpen(true);
                            }}
                            invalid={!!fieldErrors.password}
                            revealButtonHeight={54}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            textContentType="newPassword"
                            placeholder="Choose a strong password"
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
                            placeholder="Enter it again"
                            accessibilityLabel="Confirm master password"
                            testID="confirm-master-password"
                            className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                        />
                        <VaultEntryFieldError message={fieldErrors.confirm} />
                    </View>
                    <Text className="mb-[25px] mt-3 text-xs leading-[18px] text-muted-foreground">
                        Choose a password you can remember. If you forget it,
                        you&apos;ll need your vault recovery code.
                    </Text>
                </>
            ) : (
                <>
                    <Text className="mb-4 text-sm text-muted-foreground">
                        Add optional protection and details before creating the
                        vault.
                    </Text>
                    <View>
                        <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                            Additional key protection
                        </Label>
                        <Pressable
                            disabled={loading}
                            accessibilityRole="button"
                            accessibilityLabel="Choose additional key protection"
                            accessibilityState={{
                                expanded: protectionPickerOpen,
                                disabled: loading,
                            }}
                            onPress={() => setProtectionPickerOpen(true)}
                            className="h-[54px] min-h-[54px] flex-row items-center rounded-md border border-border bg-transparent px-3.5"
                        >
                            <Text className="flex-1 text-sm text-foreground">
                                {
                                    CREATE_PROTECTION_OPTIONS.find(
                                        (option) =>
                                            option.id ===
                                            additionalKeyProtectionChoice,
                                    )?.label
                                }
                            </Text>
                            <Icon
                                as={ChevronDown}
                                size={18}
                                color={colors.muted}
                            />
                        </Pressable>
                        <Text className="mt-2 text-xs leading-[18px] text-muted-foreground">
                            Your master password is always required. A generated
                            phrase adds another secret to keep for restores on a
                            new device.
                        </Text>
                    </View>
                    <AdvancedDisclosure
                        ruled
                        className="mt-4"
                        title="Description & password import"
                        description={
                            initialImport
                                ? `${initialImport.credentials.length} credentials ready`
                                : "Optional vault details"
                        }
                    >
                        <View>
                            <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                                Description (optional)
                            </Label>
                            <Input
                                value={description}
                                onChangeText={setDescription}
                                placeholder="Optional"
                                accessibilityLabel="Vault description, optional"
                                className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                            />
                        </View>
                        {initialImport ? (
                            <View className="gap-2">
                                <InlineNotice
                                    tone="success"
                                    message={`${initialImport.credentials.length} credentials are staged. They will be added when this vault is created.`}
                                />
                                <Button
                                    variant="outline"
                                    onPress={() => setInitialImport(null)}
                                >
                                    Remove staged import
                                </Button>
                            </View>
                        ) : (
                            <ImportWizard
                                pickAndReadFile={async () => {
                                    await ensureSecretTempFilesReady();
                                    const picked =
                                        await DocumentPicker.getDocumentAsync({
                                            copyToCacheDirectory: true,
                                            type: "*/*",
                                        });
                                    if (picked.canceled || !picked.assets[0]) {
                                        return null;
                                    }
                                    return readPickedImportFile(
                                        picked.assets[0],
                                    );
                                }}
                                onApply={async (result) => {
                                    setInitialImport(result);
                                }}
                            />
                        )}
                    </AdvancedDisclosure>
                </>
            )}

            {error ? (
                <View ref={errorRef} collapsable={false}>
                    <InlineNotice autoScroll tone="error" message={error} />
                </View>
            ) : null}

            <VaultEntryAction
                testID="create-vault"
                className="mt-5"
                loading={loading}
                onPress={() =>
                    formStage === 0
                        ? continueToPersonalize()
                        : void handleCreate()
                }
            >
                {formStage === 0 ? "Continue" : "Create vault"}
            </VaultEntryAction>
            {formStage === 1 ? (
                <Button
                    variant="ghost"
                    disabled={loading}
                    onPress={() => {
                        setError("");
                        setFormStage(0);
                    }}
                >
                    Back to password
                </Button>
            ) : null}
            <VaultEntryAssurance
                className={formStage === 1 ? "mb-2 mt-10" : "mt-10"}
            >
                Encrypted before it&apos;s saved
            </VaultEntryAssurance>

            <PasswordGeneratorDialog
                open={generatorOpen}
                onOpenChange={setGeneratorOpen}
                placement="bottom"
                onPasswordSelect={(generated) => {
                    setPassword(generated);
                    setConfirm(generated);
                    clearFieldError("password");
                    clearFieldError("confirm");
                }}
            />
            <Dialog
                open={protectionPickerOpen}
                onOpenChange={setProtectionPickerOpen}
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>Additional key protection</DialogTitle>
                    <DialogDescription>
                        Choose what is required with your master password.
                    </DialogDescription>
                </DialogHeader>
                <View className="gap-2">
                    {CREATE_PROTECTION_OPTIONS.map((option) => {
                        const selected =
                            option.id === additionalKeyProtectionChoice;
                        return (
                            <Pressable
                                key={option.id}
                                accessibilityRole="radio"
                                accessibilityState={{ selected }}
                                onPress={() => {
                                    setAdditionalKeyProtectionChoice(option.id);
                                    setProtectionPickerOpen(false);
                                }}
                                className={cn(
                                    "min-h-[58px] flex-row items-center rounded-md border border-border px-4 py-3",
                                    selected && "border-primary bg-primary/10",
                                )}
                            >
                                <Text className="flex-1 font-medium text-sm text-foreground">
                                    {option.label}
                                </Text>
                                {selected ? (
                                    <Icon
                                        as={Check}
                                        size={18}
                                        color={colors.primary}
                                    />
                                ) : null}
                            </Pressable>
                        );
                    })}
                </View>
            </Dialog>

            <Dialog
                open={recoveryCode != null}
                onOpenChange={() => {}}
                scroll
                dismissible={false}
                placement="bottom"
                fullHeight
            >
                <DialogHeader>
                    <DialogTitle>Keep your way back in</DialogTitle>
                    <DialogDescription>
                        Store this offline. It can unlock the vault if you
                        forget your master password.
                    </DialogDescription>
                </DialogHeader>
                <VaultEntrySteps
                    labels={["Protect", "Personalize", "Save recovery"]}
                    current={2}
                />
                {recoveryCode ? (
                    <SecretReveal
                        label="Recovery code"
                        value={recoveryCode}
                        helper="Shown once. Write it down before continuing."
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
                        helper="Shown once. It is required with your master password on a new device."
                        requireAck
                        defaultRevealed
                        ackLabel="I have written down the protection phrase"
                        acknowledged={additionalKeyProtectionAck}
                        onAcknowledgedChange={setAdditionalKeyProtectionAck}
                    />
                ) : null}
                {error ? (
                    <View ref={sheetErrorRef} collapsable={false}>
                        <InlineNotice autoScroll tone="error" message={error} />
                    </View>
                ) : null}
                <DialogFooter>
                    <VaultEntryAction
                        loading={loading}
                        disabled={
                            !recoveryAck ||
                            (!!protectionPhrase && !additionalKeyProtectionAck)
                        }
                        onPress={() => void finishCreate()}
                    >
                        Save &amp; open vault
                    </VaultEntryAction>
                </DialogFooter>
            </Dialog>
        </View>
    );
}
