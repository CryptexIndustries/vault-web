import {
    UnlockedDialogTitle as DialogTitle,
    UnlockedMenuRow as MoreRow,
    UnlockedTaskScreen,
    UnlockedText as Text,
    UnlockedButton as Button,
    UnlockedInput as Input,
    UnlockedLabel as Label,
} from "@/components/unlocked/unlocked-ui";
import { useEffect, useState } from "react";
import { Alert, Keyboard, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useAtomValue } from "jotai";
import { unlockedVaultMetadataAtom } from "@/utils/atoms";
import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import {
    clearSecureDek,
    enableBiometricUnlock,
    isBiometricAvailable,
    isSecureDekEnrolled,
} from "@/lib/secure-dek";
import {
    Dialog,
    DialogHeader,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    AUTO_LOCK_MINUTE_OPTIONS,
    DEFAULT_AUTO_LOCK_MINUTES,
    saveAutoLockMinutes,
} from "@/hooks/use-auto-lock";
import {
    getCachedAutoLockMinutes,
    loadAutoLockMinutes,
} from "@/utils/auto-lock-settings";
import { Switch } from "@/components/ui/switch";
import { InlineNotice } from "@/components/inline-notice";
import {
    Archive,
    Clock,
    Fingerprint,
    KeyRound,
    Settings2,
    Shield,
} from "lucide-react-native";
import { colors } from "@/theme";

function SectionLabel({ children }: { children: string }) {
    return (
        <Text
            style={{
                color: colors.muted,
                fontSize: 11,
                letterSpacing: 1,
                marginTop: 26,
                marginBottom: 6,
                textTransform: "uppercase",
            }}
        >
            {children}
        </Text>
    );
}

export default function SecuritySettingsScreen() {
    const metadata = useAtomValue(unlockedVaultMetadataAtom);

    const [autoLockMinutes, setAutoLockMinutes] = useState(
        String(getCachedAutoLockMinutes()),
    );
    const [biometricAvailable, setBiometricAvailable] = useState(false);
    const [biometricChecking, setBiometricChecking] = useState(true);
    const [biometricEnabled, setBiometricEnabled] = useState(false);
    const [biometricBusy, setBiometricBusy] = useState(false);
    const [enrollmentOpen, setEnrollmentOpen] = useState(false);
    const [enrollmentPassword, setEnrollmentPassword] = useState("");
    const [enrollmentPhrase, setEnrollmentPhrase] = useState("");
    const [enrollmentError, setEnrollmentError] = useState("");

    const closeEnrollment = () => {
        setEnrollmentOpen(false);
        setEnrollmentPassword("");
        setEnrollmentPhrase("");
        setEnrollmentError("");
    };
    const [autoLockOpen, setAutoLockOpen] = useState(false);
    const [autoLockSaving, setAutoLockSaving] = useState(false);
    const [autoLockError, setAutoLockError] = useState("");

    useEffect(() => {
        void loadAutoLockMinutes().then((minutes) => {
            setAutoLockMinutes(String(minutes));
        });
        void (async () => {
            setBiometricChecking(true);
            try {
                setBiometricAvailable(await isBiometricAvailable());
            } finally {
                setBiometricChecking(false);
            }
        })();
    }, []);

    useEffect(() => {
        if (metadata?.DBIndex == null) return;
        void isSecureDekEnrolled(metadata.DBIndex).then(setBiometricEnabled);
    }, [metadata?.DBIndex]);

    const toggleBiometric = async (enabled: boolean) => {
        if (metadata?.DBIndex == null) return;
        if (enabled && !enrollmentOpen) {
            setEnrollmentError("");
            setEnrollmentOpen(true);
            return;
        }
        if (enabled && !enrollmentPassword) {
            setEnrollmentError("Enter your master password.");
            return;
        }
        setBiometricBusy(true);
        Keyboard.dismiss();
        try {
            if (enabled) {
                if (!biometricAvailable) {
                    Alert.alert(
                        "Biometrics unavailable",
                        "This device has no enrolled biometrics, or hardware is unavailable.",
                    );
                    return;
                }
                const dekRes = await metadata.prepareBiometricUnlock(
                    enrollmentPassword,
                    enrollmentPhrase.trim() || undefined,
                );
                setEnrollmentPassword("");
                setEnrollmentPhrase("");
                if (dekRes.isErr()) {
                    setEnrollmentError(
                        "Could not verify your vault credentials. Check the master password and any required protection phrase.",
                    );
                    return;
                }
                const result = await enableBiometricUnlock(
                    dekRes.value,
                    metadata.DBIndex,
                );
                setBiometricEnabled(result.isOk());
                if (result.isOk()) closeEnrollment();
                if (result.isErr()) {
                    const messages: Partial<
                        Record<typeof result.error, string>
                    > = {
                        BIOMETRIC_UNAVAILABLE:
                            "Could not access this device's biometrics.",
                        BIOMETRIC_NOT_ENROLLED:
                            "Enroll a fingerprint in Android Settings first.",
                        BIOMETRIC_CANCELLED:
                            "Fingerprint authentication was cancelled. Try again when ready.",
                        AUTH_KEY_FAILED:
                            "Could not access or save the fingerprint-protected unlock key.",
                        BIOMETRIC_KEY_INVALIDATED:
                            "Android invalidated the biometric unlock key after a security change.",
                        VAULT_KEY_EXPORT_FAILED:
                            "Could not prepare this vault's encryption key for biometric unlock. Lock the vault, unlock with your password, and try again.",
                        WRAP_FAILED:
                            "Could not encrypt the vault key for biometric unlock.",
                        ENROLLMENT_SAVE_FAILED:
                            "Could not save biometric unlock data in device storage.",
                    };
                    setEnrollmentError(
                        `${messages[result.error] ?? "Could not enable biometric unlock."}\n\nError: ${result.error}`,
                    );
                }
            } else {
                await clearSecureDek(metadata.DBIndex);
                setBiometricEnabled(false);
            }
        } catch {
            setEnrollmentPassword("");
            setEnrollmentPhrase("");
            if (enabled)
                setEnrollmentError(
                    "Could not enable biometric unlock. Try again.",
                );
            else
                Alert.alert(
                    "Biometrics",
                    "Could not disable biometric unlock. Try again.",
                );
        } finally {
            setBiometricBusy(false);
        }
    };

    const saveAutoLock = async (minutes: string) => {
        setAutoLockSaving(true);
        setAutoLockError("");
        try {
            await saveAutoLockMinutes(Number(minutes));
            setAutoLockMinutes(minutes);
            setAutoLockOpen(false);
        } catch {
            setAutoLockError("Could not save auto-lock. Try again.");
        } finally {
            setAutoLockSaving(false);
        }
    };

    const biometricHint = biometricChecking
        ? "Checking device support…"
        : !biometricAvailable
          ? "Unavailable on this device"
          : biometricEnabled
            ? "DEK stored behind device biometrics"
            : "Enable to unlock without typing your password";
    const currentFactorValue =
        metadata?.Blob?.Envelope?.PrimaryProtectionKind ===
        AdditionalKeyProtectionKind.PROTECTION_PHRASE_128
            ? "Generated phrase (128-bit)"
            : metadata?.Blob?.Envelope?.PrimaryProtectionKind ===
                AdditionalKeyProtectionKind.PROTECTION_PHRASE_256
              ? "Generated phrase (256-bit)"
              : metadata?.Blob?.Envelope?.PrimaryProtectionKind ===
                  AdditionalKeyProtectionKind.WEBAUTHN_PRF
                ? "Security key"
                : "No additional key protection";

    return (
        <UnlockedTaskScreen title="Security">
            <Dialog
                open={autoLockOpen}
                onOpenChange={setAutoLockOpen}
                placement="bottom"
                scroll
                dismissible={!autoLockSaving}
            >
                <DialogHeader>
                    <DialogTitle>Auto-lock</DialogTitle>
                </DialogHeader>
                <Text className="mb-5 text-sm leading-5 text-muted-foreground">
                    Lock after no interaction while the app is open, or
                    immediately on return when background time exceeds this
                    setting.
                </Text>
                <View>
                    {AUTO_LOCK_MINUTE_OPTIONS.map((minutes) => {
                        const value = String(minutes);
                        const selected = autoLockMinutes === value;
                        const label =
                            minutes === 0
                                ? "Off"
                                : minutes < 60
                                  ? `${minutes} minute${minutes === 1 ? "" : "s"}`
                                  : `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
                        return (
                            <Pressable
                                key={value}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: selected }}
                                disabled={autoLockSaving}
                                onPress={() => void saveAutoLock(value)}
                                style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 13,
                                    paddingVertical: 18,
                                    borderBottomWidth: 1,
                                    borderBottomColor: colors.border,
                                }}
                            >
                                <View
                                    style={{
                                        width: 18,
                                        height: 18,
                                        borderRadius: 9,
                                        borderWidth: 1,
                                        borderColor: selected
                                            ? colors.primary
                                            : colors.muted,
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    {selected ? (
                                        <View
                                            style={{
                                                width: 10,
                                                height: 10,
                                                borderRadius: 5,
                                                backgroundColor: colors.primary,
                                            }}
                                        />
                                    ) : null}
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 14 }}>
                                        {label}
                                    </Text>
                                    {minutes === 0 ||
                                    minutes === DEFAULT_AUTO_LOCK_MINUTES ? (
                                        <Text
                                            style={{
                                                fontSize: 12,
                                                lineHeight: 18,
                                                marginTop: 5,
                                                color: colors.muted,
                                            }}
                                        >
                                            {minutes === 0
                                                ? "Manual locking remains available."
                                                : "Default"}
                                        </Text>
                                    ) : null}
                                </View>
                            </Pressable>
                        );
                    })}
                </View>
                {autoLockError ? (
                    <InlineNotice tone="error" message={autoLockError} />
                ) : null}
            </Dialog>
            <SectionLabel>Unlock &amp; privacy</SectionLabel>
            <View>
                <MoreRow
                    icon={Clock}
                    title="Auto-lock"
                    subtitle="Lock after inactivity"
                    value={
                        autoLockMinutes === "0"
                            ? "Off"
                            : `${autoLockMinutes} minutes`
                    }
                    onPress={() => {
                        setAutoLockError("");
                        setAutoLockOpen(true);
                    }}
                />
                <View className="min-h-[70px] flex-row items-center gap-3 border-b border-border">
                    <Fingerprint
                        size={22}
                        color={colors.muted}
                        strokeWidth={1.7}
                    />
                    <View className="flex-1 py-3 pr-3">
                        <Text className="text-sm text-foreground">
                            Biometric unlock
                        </Text>
                        <Text className="mt-1 text-xs text-muted-foreground">
                            {biometricHint}
                        </Text>
                    </View>
                    <Switch
                        value={biometricEnabled}
                        disabled={
                            !biometricAvailable ||
                            biometricChecking ||
                            biometricBusy
                        }
                        onValueChange={(v) => void toggleBiometric(v)}
                        accessibilityLabel="Biometric unlock"
                        thumbColor={
                            biometricAvailable
                                ? colors.foreground
                                : colors.muted
                        }
                        style={{
                            opacity: biometricAvailable ? 1 : 0.4,
                        }}
                    />
                </View>
                <SectionLabel>Vault protection</SectionLabel>
                <MoreRow
                    icon={KeyRound}
                    title="Master password"
                    subtitle="Change the password used to unlock"
                    onPress={() =>
                        router.push({
                            pathname: "/(app)/settings/security/action",
                            params: { mode: "password" },
                        })
                    }
                />
                <MoreRow
                    icon={Shield}
                    title="Additional protection"
                    subtitle="Add a generated protection phrase"
                    value={currentFactorValue}
                    onPress={() =>
                        router.push({
                            pathname: "/(app)/settings/security/action",
                            params: { mode: "protection" },
                        })
                    }
                />
                <MoreRow
                    icon={Archive}
                    title="Vault recovery code"
                    subtitle="Replace the code used to recover this vault"
                    onPress={() =>
                        router.push({
                            pathname: "/(app)/settings/security/action",
                            params: { mode: "recovery" },
                        })
                    }
                />
                <MoreRow
                    icon={Settings2}
                    title="Encryption settings"
                    subtitle="Advanced Argon2id parameters"
                    onPress={() =>
                        router.push({
                            pathname: "/(app)/settings/security/action",
                            params: { mode: "kdf" },
                        })
                    }
                />
                {biometricBusy ? (
                    <InlineNotice
                        tone="loading"
                        message="Updating biometric enrollment…"
                    />
                ) : null}
                <View className="mt-5 border-l-2 border-muted pl-3">
                    <Text className="text-xs leading-5 text-muted-foreground">
                        Password and protection changes apply to this vault.
                        Account recovery is managed separately in Account.
                    </Text>
                </View>
            </View>

            <Dialog
                open={enrollmentOpen}
                onOpenChange={(open) => {
                    if (!open) closeEnrollment();
                }}
                placement="bottom"
                scroll
                dismissible={!biometricBusy}
            >
                <DialogHeader>
                    <DialogTitle>Enable biometric unlock</DialogTitle>
                    <DialogDescription>
                        Confirm your vault password, then authenticate with your
                        fingerprint.
                    </DialogDescription>
                </DialogHeader>
                <Label>Master password</Label>
                <Input
                    value={enrollmentPassword}
                    onChangeText={(value) => {
                        setEnrollmentPassword(value);
                        setEnrollmentError("");
                    }}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!biometricBusy}
                    accessibilityLabel="Confirm vault password for biometric unlock"
                    revealButtonHeight={54}
                    className="h-[54px]"
                />
                {metadata?.Blob?.Envelope?.PrimaryProtectionKind ===
                    AdditionalKeyProtectionKind.PROTECTION_PHRASE_128 ||
                metadata?.Blob?.Envelope?.PrimaryProtectionKind ===
                    AdditionalKeyProtectionKind.PROTECTION_PHRASE_256 ? (
                    <>
                        <Label>Protection phrase (if required)</Label>
                        <Input
                            value={enrollmentPhrase}
                            onChangeText={(value) => {
                                setEnrollmentPhrase(value);
                                setEnrollmentError("");
                            }}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!biometricBusy}
                            accessibilityLabel="Vault protection phrase for biometric unlock"
                            revealButtonHeight={54}
                            className="h-[54px]"
                        />
                        <Text className="text-xs text-muted-foreground">
                            Leave blank if the protection phrase is already
                            saved on this device.
                        </Text>
                    </>
                ) : null}
                {enrollmentError ? (
                    <InlineNotice
                        autoScroll
                        tone="error"
                        message={enrollmentError}
                    />
                ) : null}
                <DialogFooter>
                    <Button
                        loading={biometricBusy}
                        onPress={() => void toggleBiometric(true)}
                    >
                        Enable biometric unlock
                    </Button>
                    <Button
                        variant="ghost"
                        disabled={biometricBusy}
                        onPress={closeEnrollment}
                    >
                        Cancel
                    </Button>
                </DialogFooter>
            </Dialog>
        </UnlockedTaskScreen>
    );
}
