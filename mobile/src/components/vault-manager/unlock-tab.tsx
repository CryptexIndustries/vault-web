import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type RefObject,
} from "react";
import { Alert, Platform, Pressable, View, type TextInput } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSetAtom } from "jotai";
import {
    ChevronDown,
    Fingerprint,
    Inbox,
    LockKeyhole,
} from "lucide-react-native";

import {
    listVaults,
    deleteVault,
    VaultMetadata,
} from "@/app_lib/vault-utils/storage";
import {
    EncryptionAlgorithm,
    KeyDerivationFunction,
    AdditionalKeyProtectionKind,
} from "@cryptex-industries/vault-core/proto";
import {
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
} from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    decryptWithDEK,
    isEnvelopeBlob,
} from "@cryptex-industries/vault-core/vault-utils/envelope-encryption";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    Directory,
    LinkedDevices,
    TOTP,
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { ensureSyncKemKeypair } from "@cryptex-industries/vault-core/vault-utils/post-quantum-kem";
import { androidCredentials } from "@/utils/android-credentials";
import { ensureSyncSigningKeypair } from "@cryptex-industries/vault-core/vault-utils/sync-signing";
import type {
    VaultPendingUnlock,
    VaultRevealSecrets,
} from "@cryptex-industries/vault-core/vault-utils/vault-unlock-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { Icon } from "@/components/ui/icon";
import { InlineNotice } from "@/components/inline-notice";
import { EmptyState } from "@/components/empty-state";
import {
    Dialog,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { PasswordStrengthMeter } from "@/components/vault/password-strength-meter";
import {
    AdditionalKeyProtectionOptions,
    choiceToSource,
    isProtectionPhraseKind,
    type AdditionalKeyProtectionChoice,
} from "@/components/vault-security/additional-key-protection-options";
import { SecretReveal } from "@/components/vault-security/secret-reveal";
import { unlockedVaultAtom, unlockedVaultMetadataAtom } from "@/utils/atoms";
import {
    getVaultSessionGeneration,
    setVaultDEKInSessionForMetadata,
} from "@/utils/vault-session";
import {
    clearSecureDek,
    isBiometricAvailable,
    isSecureDekEnrolled,
    unlockWithSecureDek,
} from "@/lib/secure-dek";
import { cn } from "@/lib/utils";
import { clearDeviceAdditionalKeyProtection } from "@/app_lib/vault-utils/vault-key-store";
import { clearPendingSecretFromClipboard } from "@/utils/clipboard";
import {
    VaultEntryAction,
    VaultEntryAssurance,
    VaultEntryFieldError,
    VaultEntryTextButton,
} from "@/components/vault-entry-ui";
import { useScrollToNode } from "@/components/keyboard-scroll";

type UnlockTabProps = {
    onFeedback?: (message: string) => void;
    returnTo?: string;
    restoredGuidance?: boolean;
    onVaultDeleted?: () => void;
};

type PendingRecovery = {
    metadata: VaultMetadata;
    recoveryCode: string;
};

export function UnlockTab({
    onFeedback,
    returnTo,
    restoredGuidance = false,
    onVaultDeleted,
}: UnlockTabProps) {
    const setUnlockedVault = useSetAtom(unlockedVaultAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);

    const [vaults, setVaults] = useState<VaultMetadata[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [passphrase, setPassphrase] = useState("");
    const [additionalKeyProtection, setAdditionalKeyProtection] = useState("");
    const [useRecovery, setUseRecovery] = useState(false);
    const [recoveryCode, setRecoveryCode] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [fieldErrors, setFieldErrors] = useState({
        passphrase: "",
        additionalKeyProtection: "",
        recovery: "",
        managedName: "",
        newPassword: "",
        confirmPassword: "",
    });
    const [biometricOk, setBiometricOk] = useState(false);
    const [secureDekEnrolled, setSecureDekEnrolled] = useState(false);
    const [manageOpen, setManageOpen] = useState(false);
    const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
    const [managedName, setManagedName] = useState("");
    const [managedDescription, setManagedDescription] = useState("");
    const [manageError, setManageError] = useState("");

    const [pendingRecovery, setPendingRecovery] =
        useState<PendingRecovery | null>(null);
    const [pendingUnlockAfterAck, setPendingUnlockAfterAck] =
        useState<VaultPendingUnlock<VaultMetadata> | null>(null);
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [factorChoice, setFactorChoice] =
        useState<AdditionalKeyProtectionChoice>("none");
    const [revealProtectionPhrase, setRevealProtectionPhrase] = useState<
        string | null
    >(null);
    const [revealRecovery, setRevealRecovery] = useState<string | null>(null);
    const [recoveryAck, setRecoveryAck] = useState(false);
    const [protectionPhraseAck, setProtectionPhraseAck] = useState(false);
    const passphraseRef = useRef<TextInput>(null);
    const additionalKeyProtectionRef = useRef<TextInput>(null);
    const recoveryRef = useRef<TextInput>(null);
    const managedNameRef = useRef<TextInput>(null);
    const newPasswordRef = useRef<TextInput>(null);
    const confirmPasswordRef = useRef<TextInput>(null);
    const errorRef = useRef<View>(null);
    const sheetErrorRef = useRef<View>(null);
    const manageErrorRef = useRef<View>(null);
    const biometricAttemptRef = useRef(0);
    const scrollToNode = useScrollToNode();

    useEffect(
        () => () => {
            biometricAttemptRef.current += 1;
        },
        [],
    );

    useEffect(() => {
        if (!error) return;
        requestAnimationFrame(() =>
            scrollToNode(
                pendingRecovery ? sheetErrorRef.current : errorRef.current,
                48,
            ),
        );
    }, [error, pendingRecovery, scrollToNode]);

    useEffect(() => {
        if (!manageError) return;
        requestAnimationFrame(() => scrollToNode(manageErrorRef.current, 48));
    }, [manageError, scrollToNode]);

    const setFieldError = (
        field: keyof typeof fieldErrors,
        message: string,
        ref?: RefObject<TextInput | null>,
    ) => {
        setFieldErrors((current) => ({ ...current, [field]: message }));
        if (ref) requestAnimationFrame(() => ref.current?.focus());
    };

    const clearFieldError = (field: keyof typeof fieldErrors) => {
        setFieldErrors((current) =>
            current[field] ? { ...current, [field]: "" } : current,
        );
    };

    const refresh = useCallback(async () => {
        const list = await listVaults();
        setVaults(list);
        if (list.length > 0 && selectedId == null) {
            setSelectedId(list[0]?.DBIndex ?? null);
        }
    }, [selectedId]);

    useFocusEffect(
        useCallback(() => {
            void refresh();
            void isBiometricAvailable().then(setBiometricOk);
        }, [refresh]),
    );

    useEffect(() => {
        biometricAttemptRef.current += 1;
        let current = true;
        setSecureDekEnrolled(false);
        if (selectedId == null) {
            return;
        }
        void isSecureDekEnrolled(selectedId).then(
            (enrolled) => {
                if (current) setSecureDekEnrolled(enrolled);
            },
            () => {
                if (current) setSecureDekEnrolled(false);
            },
        );
        return () => {
            current = false;
        };
    }, [selectedId]);

    const selected = vaults.find((v) => v.DBIndex === selectedId);
    const selectedMemLimit =
        selected?.Blob?.KDFConfigArgon2ID?.memLimit ??
        KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT;
    const highMemWarning = selectedMemLimit > 128;
    const selectedRequiresPassphrase =
        !useRecovery &&
        isProtectionPhraseKind(selected?.Blob?.Envelope?.PrimaryProtectionKind);
    const webauthnVault =
        selected?.Blob?.Envelope?.PrimaryProtectionKind ===
        AdditionalKeyProtectionKind.WEBAUTHN_PRF;

    const openManager = () => {
        if (!selected) return;
        setManagedName(selected.Name);
        setManagedDescription(selected.Description);
        setManageError("");
        clearFieldError("managedName");
        setManageOpen(true);
    };

    const saveMetadata = async () => {
        if (!selected) return;
        if (!managedName.trim()) {
            setFieldError(
                "managedName",
                "Enter a name for this vault.",
                managedNameRef,
            );
            return;
        }
        setManageError("");
        const previousName = selected.Name;
        const previousDescription = selected.Description;
        try {
            selected.Name = managedName.trim();
            selected.Description = managedDescription.trim();
            await selected.save(null, new Uint8Array(0));
            setManageOpen(false);
            await refresh();
            onFeedback?.("Vault details updated.");
        } catch {
            selected.Name = previousName;
            selected.Description = previousDescription;
            setManageError("Could not save these vault details. Try again.");
        }
    };

    const deleteSelectedVault = () => {
        if (selected?.DBIndex == null) return;
        const id = selected.DBIndex;
        Alert.alert(
            "Delete vault",
            `Permanently delete “${selected.Name}” from this device?`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => {
                        void (async () => {
                            await Promise.all([
                                deleteVault(id),
                                clearDeviceAdditionalKeyProtection(id),
                                clearSecureDek(id),
                                clearPendingSecretFromClipboard(),
                            ]);
                            setSelectedId(null);
                            setManageOpen(false);
                            await refresh();
                            onVaultDeleted?.();
                            onFeedback?.("Vault removed from this device.");
                        })();
                    },
                },
            ],
        );
    };

    const finalizeUnlock = (
        metadata: VaultMetadata,
        vault: Vault,
        dek: CryptoKey,
    ) => {
        setVaultDEKInSessionForMetadata(metadata, dek);
        setUnlockedVaultMetadata(metadata);
        setUnlockedVault(vault);
        // A pending Android autofill/credential-manager request survives the
        // unlock round-trip in the native module; it outranks any returnTo
        // param, which can be lost because the locked manager is usually
        // already mounted without params when the request arrives.
        if (
            Platform.OS === "android" &&
            androidCredentials.available &&
            androidCredentials.getPendingRequest()
        ) {
            router.replace("/credential-request" as never);
            return;
        }
        router.replace((returnTo ?? "/(app)/(tabs)/vault") as never);
    };

    const handleUnlock = async () => {
        setError("");
        if (!selected) {
            setError("Select a vault.");
            return;
        }
        const next = {
            recovery:
                useRecovery && !recoveryCode.trim()
                    ? "Enter your vault recovery code."
                    : "",
            passphrase:
                !useRecovery && !passphrase.trim()
                    ? "Enter your master password."
                    : "",
            additionalKeyProtection:
                selectedRequiresPassphrase && !additionalKeyProtection.trim()
                    ? "Enter the generated protection phrase saved with this vault."
                    : "",
        };
        setFieldErrors((current) => ({ ...current, ...next }));
        const first = next.recovery
            ? recoveryRef
            : next.passphrase
              ? passphraseRef
              : next.additionalKeyProtection
                ? additionalKeyProtectionRef
                : null;
        if (first) {
            requestAnimationFrame(() => first.current?.focus());
            return;
        }
        if (!useRecovery && webauthnVault) {
            setError(
                "This vault uses WebAuthn PRF. Unlock from desktop, or use recovery code to set a new password.",
            );
            return;
        }

        setLoading(true);
        await new Promise((r) => setTimeout(r, 50));

        const result = await selected.decryptVault(
            useRecovery ? "" : passphrase,
            selected.Blob?.Algorithm ?? EncryptionAlgorithm.XChaCha20Poly1305,
            selected.Blob?.KeyDerivationFunc ?? KeyDerivationFunction.Argon2ID,
            {
                iterations:
                    selected.Blob?.KDFConfigPBKDF2?.iterations ??
                    KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
                memLimit:
                    selected.Blob?.KDFConfigArgon2ID?.memLimit ??
                    KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                opsLimit:
                    selected.Blob?.KDFConfigArgon2ID?.opsLimit ??
                    KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
            },
            {
                masterPassword: useRecovery ? "" : passphrase,
                useRecovery,
                recoveryCode: useRecovery ? recoveryCode.trim() : undefined,
                protectionPhrase:
                    !useRecovery && additionalKeyProtection.trim()
                        ? additionalKeyProtection.trim()
                        : undefined,
            },
        );

        setLoading(false);
        if (result.isErr()) {
            if (useRecovery) {
                setFieldError(
                    "recovery",
                    "That recovery code could not unlock this vault. Check it and try again.",
                    recoveryRef,
                );
            } else if (selectedRequiresPassphrase) {
                const message =
                    "The password or protection phrase is incorrect. Check both and try again.";
                setFieldErrors((current) => ({
                    ...current,
                    passphrase: message,
                    additionalKeyProtection: message,
                }));
                requestAnimationFrame(() => passphraseRef.current?.focus());
            } else {
                setFieldError(
                    "passphrase",
                    "That password could not unlock this vault. Check it and try again.",
                    passphraseRef,
                );
            }
            return;
        }

        if (useRecovery) {
            // Forgot-password path: require a new master password and optional protection.
            // before entering the vault session.
            setPendingRecovery({
                metadata: selected,
                recoveryCode: recoveryCode.trim(),
            });
            setNewPassword("");
            setConfirmPassword("");
            setFactorChoice("none");
            setRevealProtectionPhrase(null);
            setProtectionPhraseAck(false);
            return;
        }

        if (result.value.revealSecrets?.recoveryCode) {
            const reveal: VaultRevealSecrets = result.value.revealSecrets;
            setRevealRecovery(reveal.recoveryCode);
            setRevealProtectionPhrase(reveal.protectionPhrase ?? null);
            setRecoveryAck(false);
            setProtectionPhraseAck(false);
            setPendingUnlockAfterAck({
                metadata: selected,
                vault: result.value.vault,
                dek: result.value.dek,
            });
            return;
        }

        finalizeUnlock(selected, result.value.vault, result.value.dek);
    };

    const handleRecoveryRekey = async () => {
        if (!pendingRecovery) return;
        setError("");
        const next = {
            newPassword: newPassword ? "" : "Enter a new master password.",
            confirmPassword: !confirmPassword
                ? "Confirm your new master password."
                : newPassword === confirmPassword
                  ? ""
                  : "Enter the same password again.",
        };
        setFieldErrors((current) => ({ ...current, ...next }));
        const first = next.newPassword
            ? newPasswordRef
            : next.confirmPassword
              ? confirmPasswordRef
              : null;
        if (first) {
            requestAnimationFrame(() => first.current?.focus());
            return;
        }
        if (factorChoice === "webauthn") {
            setError("WebAuthn PRF is not available on mobile yet.");
            return;
        }

        setLoading(true);
        try {
            const { metadata, recoveryCode: code } = pendingRecovery;
            const rekey = await metadata.reconfigureSecurity({
                currentMasterPassword: "",
                currentRecoveryCode: code,
                newMasterPassword: newPassword,
                additionalKeyProtection: choiceToSource(factorChoice),
                kdfConfig: new KeyDerivationConfig_Argon2ID(
                    metadata.Blob?.KDFConfigArgon2ID?.memLimit ?? 128,
                    metadata.Blob?.KDFConfigArgon2ID?.opsLimit ?? 3,
                ),
            });
            if (rekey.isErr()) {
                setError(`Failed to set new password: ${rekey.error}`);
                return;
            }

            if (rekey.value?.protectionPhrase) {
                setRevealProtectionPhrase(rekey.value.protectionPhrase);
                setProtectionPhraseAck(false);
            }

            const unlock = await metadata.decryptVault(
                newPassword,
                metadata.Blob?.Algorithm ??
                    EncryptionAlgorithm.XChaCha20Poly1305,
                metadata.Blob?.KeyDerivationFunc ??
                    KeyDerivationFunction.Argon2ID,
                {
                    iterations:
                        metadata.Blob?.KDFConfigPBKDF2?.iterations ??
                        KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
                    memLimit:
                        metadata.Blob?.KDFConfigArgon2ID?.memLimit ??
                        KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                    opsLimit:
                        metadata.Blob?.KDFConfigArgon2ID?.opsLimit ??
                        KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
                },
                {
                    masterPassword: newPassword,
                    protectionPhrase: rekey.value?.protectionPhrase,
                },
            );
            if (unlock.isErr()) {
                setError("Password set, but unlock failed. Try Unlock tab.");
                setPendingRecovery(null);
                await refresh();
                return;
            }

            if (rekey.value?.protectionPhrase) {
                setRevealProtectionPhrase(rekey.value.protectionPhrase);
                setProtectionPhraseAck(false);
                setPendingUnlockAfterAck({
                    metadata,
                    vault: unlock.value.vault,
                    dek: unlock.value.dek,
                });
                setPendingRecovery(null);
                return;
            }

            setPendingRecovery(null);
            finalizeUnlock(metadata, unlock.value.vault, unlock.value.dek);
        } catch {
            setError("Failed to set new credentials.");
        } finally {
            setLoading(false);
        }
    };

    const continueAfterPassphraseAck = () => {
        if (
            !pendingUnlockAfterAck ||
            (revealRecovery != null && !recoveryAck) ||
            (revealProtectionPhrase != null && !protectionPhraseAck)
        ) {
            return;
        }
        const { metadata, vault, dek } = pendingUnlockAfterAck;
        setPendingUnlockAfterAck(null);
        setRevealRecovery(null);
        setRevealProtectionPhrase(null);
        finalizeUnlock(metadata, vault, dek);
    };

    const handleBiometric = async () => {
        if (!selected?.DBIndex || !selected.Blob) return;
        const generation = getVaultSessionGeneration();
        const attempt = ++biometricAttemptRef.current;
        const isCurrentAttempt = () =>
            biometricAttemptRef.current === attempt &&
            getVaultSessionGeneration() === generation;
        setLoading(true);
        setError("");
        try {
            const dek = await unlockWithSecureDek(selected.DBIndex);
            if (!isCurrentAttempt()) return;
            if (!dek) {
                setError("Biometric unlock cancelled or unavailable.");
                return;
            }
            if (!isEnvelopeBlob(selected.Blob) || !selected.Blob.HeaderIV) {
                setError("Vault format does not support biometric unlock.");
                return;
            }
            const plainRes = await decryptWithDEK(
                dek,
                selected.Blob.Blob,
                selected.Blob.HeaderIV,
            );
            if (!isCurrentAttempt()) return;
            if (plainRes.isErr()) {
                setError("Could not decrypt vault with stored key.");
                return;
            }
            const vaultRaw = VaultUtilTypes.Vault.decode(plainRes.value);
            const vault = Object.assign(new Vault(), vaultRaw);
            vault.LinkedDevices = LinkedDevices.fromGeneric(
                vault.LinkedDevices,
            );
            vault.Credentials = vault.Credentials.map((credential) => {
                if (credential.TOTP) {
                    credential.TOTP = Object.assign(
                        new TOTP(),
                        credential.TOTP,
                    );
                }
                return Object.assign(new VaultCredential(), credential);
            });
            vault.Directories = vault.Directories.map((directory) =>
                Object.assign(new Directory(), directory),
            );
            await vault.upgrade();
            const generatedSyncKeys = await ensureSyncSigningKeypair(
                vault.LinkedDevices,
            );
            const generatedSyncKemKeys = await ensureSyncKemKeypair(
                vault.LinkedDevices,
            );
            if (!isCurrentAttempt()) return;
            if (generatedSyncKeys || generatedSyncKemKeys) {
                try {
                    await selected.save(vault, dek);
                } catch {
                    if (!isCurrentAttempt()) return;
                    setError("Unlocked, but failed to persist sync keys.");
                    return;
                }
            }
            if (!isCurrentAttempt()) return;
            finalizeUnlock(selected, vault, dek);
        } catch {
            if (isCurrentAttempt()) setError("Biometric unlock failed.");
        } finally {
            if (biometricAttemptRef.current === attempt) setLoading(false);
        }
    };

    if (vaults.length === 0) {
        return (
            <EmptyState
                icon={Inbox}
                title="No vaults yet"
                description="Create a vault or restore a backup to get started."
            />
        );
    }

    return (
        <View>
            {restoredGuidance ? (
                <InlineNotice
                    className="mb-4"
                    tone="success"
                    message="Backup restored. Unlock it to continue."
                />
            ) : null}
            <Text className="mb-2.5 font-semibold text-[11px] uppercase tracking-[1.5px] text-muted-foreground">
                On this device
            </Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Selected vault ${selected?.Name ?? ""}. Choose another vault`}
                disabled={loading}
                onPress={() => {
                    if (!loading) setVaultPickerOpen(true);
                }}
                className="mb-5 min-h-[86px] flex-row items-center gap-[13px] rounded-md border border-l-[3px] border-border border-l-primary px-[18px] py-4"
            >
                <View className="h-12 w-12 items-center justify-center rounded-md bg-background">
                    <Icon as={LockKeyhole} size={22} className="text-primary" />
                </View>
                <View className="flex-1">
                    <Text className="font-semibold text-base text-foreground">
                        {selected?.Name}
                    </Text>
                    <Text
                        className="mt-0.5 text-xs text-muted-foreground"
                        numberOfLines={1}
                    >
                        {selected?.Description || "Encrypted on this device"}
                    </Text>
                </View>
                <Icon
                    as={ChevronDown}
                    size={20}
                    className="text-muted-foreground"
                />
            </Pressable>

            <View>
                {highMemWarning ? (
                    <InlineNotice
                        className="mb-4"
                        tone="warning"
                        message={`This vault uses Argon2 memory ${selectedMemLimit} MiB. Unlock may use a lot of RAM. After unlock, rekey from Settings with 128 MiB if needed.`}
                    />
                ) : null}
                {webauthnVault ? (
                    <InlineNotice
                        className="mb-4"
                        tone="warning"
                        message="This vault uses security-key protection that Android cannot use for password unlock. Use the vault recovery code here, link from a device where it opens, or open it on desktop."
                    />
                ) : null}

                {useRecovery ? (
                    <View className="mb-[17px]">
                        <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                            Recovery code
                        </Label>
                        <Input
                            ref={recoveryRef}
                            value={recoveryCode}
                            onChangeText={(value) => {
                                setRecoveryCode(value);
                                clearFieldError("recovery");
                            }}
                            invalid={!!fieldErrors.recovery}
                            revealButtonHeight={54}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            placeholder="Recovery code"
                            accessibilityLabel="Recovery code"
                            className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5 font-mono text-sm"
                        />
                        <VaultEntryFieldError message={fieldErrors.recovery} />
                    </View>
                ) : (
                    <>
                        <View className="mb-[17px]">
                            <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                                Master password
                            </Label>
                            <Input
                                ref={passphraseRef}
                                value={passphrase}
                                onChangeText={(value) => {
                                    setPassphrase(value);
                                    clearFieldError("passphrase");
                                }}
                                invalid={!!fieldErrors.passphrase}
                                revealButtonHeight={54}
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                                textContentType="password"
                                placeholder="Enter master password"
                                onSubmitEditing={() => void handleUnlock()}
                                accessibilityLabel="Master password"
                                className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                            />
                            <VaultEntryFieldError
                                message={fieldErrors.passphrase}
                            />
                        </View>
                        {selectedRequiresPassphrase ? (
                            <View className="mb-[17px]">
                                <Label className="mb-[7px] text-xs font-normal text-muted-foreground">
                                    Generated protection phrase
                                </Label>
                                <Input
                                    ref={additionalKeyProtectionRef}
                                    value={additionalKeyProtection}
                                    onChangeText={(value) => {
                                        setAdditionalKeyProtection(value);
                                        clearFieldError(
                                            "additionalKeyProtection",
                                        );
                                    }}
                                    invalid={
                                        !!fieldErrors.additionalKeyProtection
                                    }
                                    revealButtonHeight={54}
                                    secureTextEntry
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    placeholder={
                                        restoredGuidance
                                            ? "Enter the phrase saved with this vault"
                                            : "Enter the saved protection phrase"
                                    }
                                    accessibilityLabel="Generated protection phrase"
                                    className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                                />
                                <VaultEntryFieldError
                                    message={
                                        fieldErrors.additionalKeyProtection
                                    }
                                />
                            </View>
                        ) : null}
                    </>
                )}

                {error ? (
                    <View ref={errorRef} collapsable={false}>
                        <InlineNotice tone="error" message={error} />
                    </View>
                ) : null}

                <VaultEntryAction
                    className="mt-1"
                    leading={LockKeyhole}
                    loading={loading}
                    onPress={() => void handleUnlock()}
                    testID="unlock-vault"
                >
                    {useRecovery ? "Continue with recovery" : "Unlock vault"}
                </VaultEntryAction>

                {!useRecovery && biometricOk && secureDekEnrolled ? (
                    <VaultEntryAction
                        variant="secondary"
                        className="mt-2.5 border border-border"
                        leading={Fingerprint}
                        showArrow={false}
                        loading={loading}
                        accessibilityLabel="Unlock with biometrics"
                        onPress={() => void handleBiometric()}
                    >
                        Use fingerprint
                    </VaultEntryAction>
                ) : null}

                {!webauthnVault || !useRecovery ? (
                    <VaultEntryTextButton
                        className="mt-1.5"
                        accessibilityLabel={
                            useRecovery
                                ? "Use password instead"
                                : "Use recovery code"
                        }
                        onPress={() => {
                            const next = !useRecovery;
                            setUseRecovery(next);
                            setError("");
                            setRecoveryCode("");
                            setFieldErrors((current) => ({
                                ...current,
                                passphrase: "",
                                additionalKeyProtection: "",
                                recovery: "",
                            }));
                        }}
                    >
                        {useRecovery
                            ? "Use password instead"
                            : "Use recovery code"}
                    </VaultEntryTextButton>
                ) : null}

                {!useRecovery && biometricOk && !secureDekEnrolled ? (
                    <Text className="mt-1 text-center text-xs text-muted-foreground">
                        Biometrics available. Enable in Settings after unlock.
                    </Text>
                ) : null}
                <VaultEntryAssurance>Only you hold the keys</VaultEntryAssurance>
            </View>

            <Dialog
                open={vaultPickerOpen}
                onOpenChange={setVaultPickerOpen}
                placement="bottom"
                scroll
            >
                <DialogHeader>
                    <DialogTitle>Choose a vault</DialogTitle>
                    <DialogDescription>
                        Select a vault stored on this device.
                    </DialogDescription>
                </DialogHeader>
                <View className="gap-2">
                    {vaults.map((item) => (
                        <Pressable
                            key={String(item.DBIndex ?? item.Name)}
                            accessibilityRole="button"
                            accessibilityState={{
                                selected: selectedId === item.DBIndex,
                            }}
                            accessibilityLabel={`Select vault ${item.Name}`}
                            disabled={loading}
                            onPress={() => {
                                if (loading) return;
                                biometricAttemptRef.current += 1;
                                const nextSelectedId = item.DBIndex ?? null;
                                if (nextSelectedId !== selectedId) {
                                    setSecureDekEnrolled(false);
                                }
                                setSelectedId(nextSelectedId);
                                setAdditionalKeyProtection("");
                                setFieldErrors((current) => ({
                                    ...current,
                                    passphrase: "",
                                    additionalKeyProtection: "",
                                    recovery: "",
                                }));
                                setVaultPickerOpen(false);
                            }}
                            className={cn(
                                "min-h-[64px] rounded-md border border-l-[3px] px-4 py-3",
                                selectedId === item.DBIndex
                                    ? "border-border border-l-primary bg-transparent"
                                    : "border-border bg-transparent",
                            )}
                        >
                            <Text className="font-medium text-foreground">
                                {item.Name}
                            </Text>
                            <Text
                                className="text-xs text-muted-foreground"
                                numberOfLines={1}
                            >
                                {item.Description || "Encrypted on this device"}
                            </Text>
                        </Pressable>
                    ))}
                </View>
                <DialogFooter>
                    <Button
                        className="h-[54px] min-h-[54px]"
                        variant="outline"
                        disabled={!selected}
                        onPress={() => {
                            setVaultPickerOpen(false);
                            openManager();
                        }}
                    >
                        Edit selected vault
                    </Button>
                </DialogFooter>
            </Dialog>

            <Dialog
                open={manageOpen}
                onOpenChange={setManageOpen}
                placement="bottom"
                scroll
            >
                <DialogHeader>
                    <DialogTitle>Vault details</DialogTitle>
                    <DialogDescription>
                        Rename this local vault or remove it from this device.
                    </DialogDescription>
                </DialogHeader>
                <View className="gap-3">
                    <View>
                        <Label>Name</Label>
                        <Input
                            ref={managedNameRef}
                            value={managedName}
                            onChangeText={(value) => {
                                setManagedName(value);
                                clearFieldError("managedName");
                                setManageError("");
                            }}
                            invalid={!!fieldErrors.managedName}
                            accessibilityLabel="Edit vault name"
                            className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                        />
                        <VaultEntryFieldError
                            message={fieldErrors.managedName}
                        />
                    </View>
                    <View>
                        <Label>Description</Label>
                        <Input
                            value={managedDescription}
                            onChangeText={(value) => {
                                setManagedDescription(value);
                                setManageError("");
                            }}
                            accessibilityLabel="Edit vault description"
                            className="h-[54px] min-h-[54px] rounded-md border-border bg-transparent px-3.5"
                        />
                    </View>
                </View>
                {manageError ? (
                    <View ref={manageErrorRef} collapsable={false}>
                        <InlineNotice
                            autoScroll
                            tone="error"
                            message={manageError}
                        />
                    </View>
                ) : null}
                <DialogFooter>
                    <VaultEntryAction
                        showArrow={false}
                        onPress={() => void saveMetadata()}
                    >
                        Save
                    </VaultEntryAction>
                    <Button
                        className="h-[54px] min-h-[54px]"
                        variant="destructive"
                        onPress={deleteSelectedVault}
                    >
                        Delete vault
                    </Button>
                </DialogFooter>
            </Dialog>

            <Dialog
                open={pendingRecovery != null || pendingUnlockAfterAck != null}
                onOpenChange={(open) => {
                    if (
                        !open &&
                        ((revealRecovery != null && !recoveryAck) ||
                            (revealProtectionPhrase != null &&
                                !protectionPhraseAck))
                    ) {
                        return;
                    }
                    if (!open) {
                        setPendingRecovery(null);
                        setPendingUnlockAfterAck(null);
                        setRevealRecovery(null);
                        setRevealProtectionPhrase(null);
                    }
                }}
                scroll
                placement="bottom"
                fullHeight
                dismissible={
                    (revealRecovery == null || recoveryAck) &&
                    (revealProtectionPhrase == null || protectionPhraseAck)
                }
            >
                <DialogHeader>
                    <DialogTitle>
                        {revealRecovery
                            ? "Save your recovery material"
                            : "Set new master password"}
                    </DialogTitle>
                    <DialogDescription>
                        {revealRecovery
                            ? "Your vault was upgraded. These secrets are shown once; store them somewhere safe before continuing."
                            : "Set a new master password and choose any additional key protection for this device."}
                    </DialogDescription>
                </DialogHeader>

                {revealRecovery || revealProtectionPhrase ? (
                    <View className="gap-3">
                        {revealRecovery ? (
                            <SecretReveal
                                label="Recovery code"
                                value={revealRecovery}
                                helper="Shown once. Write it down before continuing."
                                requireAck
                                defaultRevealed
                                ackLabel="I have written down the recovery code"
                                acknowledged={recoveryAck}
                                onAcknowledgedChange={setRecoveryAck}
                            />
                        ) : null}
                        {revealProtectionPhrase ? (
                            <SecretReveal
                                label="New generated protection phrase"
                                value={revealProtectionPhrase}
                                helper="Shown once. Write it down before continuing."
                                requireAck
                                defaultRevealed
                                ackLabel="I have written down the protection phrase"
                                acknowledged={protectionPhraseAck}
                                onAcknowledgedChange={setProtectionPhraseAck}
                            />
                        ) : null}
                        <DialogFooter>
                            <VaultEntryAction
                                disabled={
                                    (revealRecovery != null && !recoveryAck) ||
                                    (revealProtectionPhrase != null &&
                                        !protectionPhraseAck)
                                }
                                onPress={continueAfterPassphraseAck}
                            >
                                Continue
                            </VaultEntryAction>
                        </DialogFooter>
                    </View>
                ) : (
                    <View className="gap-3">
                        <View>
                            <Label>New master password</Label>
                            <Input
                                ref={newPasswordRef}
                                value={newPassword}
                                onChangeText={(value) => {
                                    setNewPassword(value);
                                    clearFieldError("newPassword");
                                    clearFieldError("confirmPassword");
                                }}
                                invalid={!!fieldErrors.newPassword}
                                revealButtonHeight={54}
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                                textContentType="newPassword"
                                accessibilityLabel="New master password"
                                className="h-[54px] min-h-[54px]"
                            />
                            <VaultEntryFieldError
                                message={fieldErrors.newPassword}
                            />
                            {newPassword.length > 0 ? (
                                <PasswordStrengthMeter password={newPassword} />
                            ) : null}
                        </View>
                        <View>
                            <Label>Confirm password</Label>
                            <Input
                                ref={confirmPasswordRef}
                                value={confirmPassword}
                                onChangeText={(value) => {
                                    setConfirmPassword(value);
                                    clearFieldError("confirmPassword");
                                }}
                                invalid={!!fieldErrors.confirmPassword}
                                revealButtonHeight={54}
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                                accessibilityLabel="Confirm new master password"
                                className="h-[54px] min-h-[54px]"
                            />
                            <VaultEntryFieldError
                                message={fieldErrors.confirmPassword}
                            />
                        </View>
                        <AdditionalKeyProtectionOptions
                            value={factorChoice}
                            onChange={setFactorChoice}
                        />
                        {error ? (
                            <View ref={sheetErrorRef} collapsable={false}>
                                <InlineNotice
                                    autoScroll
                                    tone="error"
                                    message={error}
                                />
                            </View>
                        ) : null}
                        <DialogFooter>
                            <VaultEntryAction
                                loading={loading}
                                onPress={() => void handleRecoveryRekey()}
                            >
                                Save &amp; unlock
                            </VaultEntryAction>
                            <Button
                                className="h-[54px] min-h-[54px]"
                                variant="ghost"
                                disabled={loading}
                                onPress={() => setPendingRecovery(null)}
                            >
                                Cancel
                            </Button>
                        </DialogFooter>
                    </View>
                )}
            </Dialog>
        </View>
    );
}
