import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    BackHandler,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    useWindowDimensions,
    ScrollView,
    Text as RNText,
    type TextProps as RNTextProps,
    View,
} from "react-native";
import { router, useGlobalSearchParams } from "expo-router";
import { useFocusEffect } from "expo-router/react-navigation";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import { useAtomValue, useSetAtom } from "jotai";
import {
    ArrowLeft,
    Check,
    Cloud,
    ChevronRight,
    Lock,
    MoreHorizontal,
    Plus,
    RotateCw,
    Smartphone,
    User,
    Vault as VaultIcon,
    type LucideIcon,
} from "lucide-react-native";
import {
    WebRTCStatus,
} from "@cryptex-industries/vault-core/synchronization-utils";
import {
    SafeAreaView,
    useSafeAreaInsets,
} from "react-native-safe-area-context";

import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    linkedDevicesAtom,
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesDataAtom,
    onlineServicesStore,
    vaultStore,
} from "@/utils/atoms";
import {
    lockUnlockedVault,
    lockVaultWithoutSaving,
    vaultLockStateAtom,
} from "@/utils/vault-lock";
import { colors } from "@/theme";
import { VaultLockAnimation } from "./vault-lock-animation";
import { cn } from "@/lib/utils";
import { KeyboardScrollProvider } from "@/components/keyboard-scroll";
import { Input, type InputProps } from "@/components/ui/input";
import { Label, type LabelProps } from "@/components/ui/label";
import {
    Button,
    buttonTextVariants,
    type ButtonProps,
} from "@/components/ui/button";
import {
    Dialog,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import type { TextProps } from "@/components/ui/text";
import { Checkbox, type CheckboxProps } from "@/components/ui/checkbox";
import { useOptionalSyncRuntime, useSyncRuntime } from "@/components/sync-controller-provider";
import {
    getOnlineServicesApiBaseUrl,
    isCloudServicesEnabled,
} from "@/utils/online-services-api-url";

const brandMark = require("../../../assets/brand-mark.png");
const SYSTEM_FONT = Platform.select({ android: "sans-serif", ios: "System" });
export function UnlockedButton({
    children,
    variant,
    size,
    textClassName,
    className,
    style,
    ...props
}: ButtonProps) {
    return (
        <Button
            {...props}
            variant={variant}
            size={size}
            className={cn(
                !size && "h-auto min-h-[54px] px-[18px] py-3",
                variant === "outline" && "border-border bg-[#111520]",
                className,
            )}
            style={(state) => [
                { minHeight: size === "sm" ? 36 : size === "icon" ? 44 : 54 },
                typeof style === "function" ? style(state) : style,
            ]}
            textClassName={textClassName}
        >
            {typeof children === "string" || typeof children === "number" ? (
                <UnlockedText
                    className={cn(
                        buttonTextVariants({ variant, size }),
                        "font-semibold",
                        (!variant || variant === "default") && "text-[#111520]",
                        textClassName,
                    )}
                >
                    {children}
                </UnlockedText>
            ) : (
                children
            )}
        </Button>
    );
}

export function UnlockedDialogTitle({ style, ...props }: TextProps) {
    return (
        <DialogTitle
            {...props}
            style={[
                { fontFamily: SYSTEM_FONT, fontSize: 22, fontWeight: "500" },
                style,
            ]}
        />
    );
}

export function UnlockedInput({ style, ...props }: InputProps) {
    const inputStyle = useMemo(
        () => [
            {
                fontFamily: SYSTEM_FONT,
                minHeight: 54,
                backgroundColor: colors.navigation,
                borderColor: props.invalid ? colors.primary : colors.border,
            },
            style,
        ],
        [props.invalid, style],
    );
    return (
        <Input
            {...props}
            revealButtonHeight={props.revealButtonHeight ?? 54}
            style={inputStyle}
        />
    );
}

export function UnlockedLabel({ style, ...props }: LabelProps) {
    return (
        <Label
            {...props}
            style={[
                {
                    fontFamily: SYSTEM_FONT,
                    fontSize: 12,
                    color: colors.muted,
                    marginBottom: 8,
                },
                style,
            ]}
        />
    );
}

export function UnlockedCheckbox({ labelStyle, ...props }: CheckboxProps) {
    return (
        <Checkbox
            {...props}
            labelStyle={[{ fontFamily: SYSTEM_FONT }, labelStyle]}
        />
    );
}

export function UnlockedMenuRow({
    icon: Icon,
    title,
    subtitle,
    value,
    destructive = false,
    disabled = false,
    onPress,
}: {
    icon: LucideIcon;
    title: string;
    subtitle?: string;
    value?: string;
    destructive?: boolean;
    disabled?: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ""}`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
            style={{
                opacity: disabled ? 0.5 : 1,
                minHeight: 70,
                flexDirection: "row",
                alignItems: "center",
                gap: 13,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <Icon
                size={22}
                color={destructive ? colors.primary : colors.muted}
                strokeWidth={1.7}
            />
            <View style={{ flex: 1, minWidth: 0, paddingVertical: 12 }}>
                <UnlockedText
                    style={{
                        color: destructive ? colors.primary : colors.foreground,
                        fontSize: 14,
                    }}
                >
                    {title}
                </UnlockedText>
                {subtitle ? (
                    <UnlockedText
                        style={{
                            color: colors.muted,
                            fontSize: 12,
                            lineHeight: 18,
                            marginTop: 5,
                        }}
                    >
                        {subtitle}
                    </UnlockedText>
                ) : null}
            </View>
            {value ? <UnlockedText style={{ fontSize: 12, color: colors.muted, maxWidth: "38%", textAlign: "right" }}>{value}</UnlockedText> : null}
            <ChevronRight size={17} color={colors.muted} />
        </Pressable>
    );
}

export function UnlockedText({
    className,
    style,
    ...props
}: RNTextProps & { className?: string }) {
    return (
        <RNText
            className={cn("text-foreground", className)}
            allowFontScaling
            maxFontSizeMultiplier={1.4}
            style={[
                {
                    fontFamily: className?.split(" ").includes("font-mono")
                        ? Platform.select({
                              android: "monospace",
                              ios: "Menlo",
                          })
                        : SYSTEM_FONT,
                },
                style,
            ]}
            {...props}
        />
    );
}

function useLockVault() {
    const metadata = useAtomValue(unlockedVaultMetadataAtom);
    const setVault = useSetAtom(unlockedVaultAtom);
    const setMetadata = useSetAtom(unlockedVaultMetadataAtom);
    const controller = useOptionalSyncRuntime()?.controller;

    return async () => {
        const result = await lockUnlockedVault({
            unlockedVaultMetadata: metadata,
            setUnlockedVault: async (value) => {
                const current = vaultStore.get(unlockedVaultAtom);
                const next =
                    typeof value === "function" ? await value(current) : value;
                setVault(next instanceof Vault ? next : new Vault());
            },
            setUnlockedVaultMetadata: setMetadata,
            syncConnectionController: controller,
        });
        if (result.isOk()) router.replace("/(locked)/unlock");
    };
}

export function VaultLockScreen({
    onContinueEditing,
}: {
    onContinueEditing: () => void;
}) {
    const state = useAtomValue(vaultLockStateAtom);
    const controller = useOptionalSyncRuntime()?.controller;
    const lock = useLockVault();
    const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
    const [forceLockError, setForceLockError] = useState<string | null>(null);
    const confirmLockAnyway = async () => {
        setConfirmDiscardOpen(false);
        setForceLockError(null);
        const result = await lockVaultWithoutSaving(controller);
        if (result.isOk()) router.replace("/(locked)/unlock");
        else setForceLockError("Could not end this vault session. Try again.");
    };
    return (
        <>
            <View
                style={{
                    flex: 1,
                    backgroundColor: colors.background,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 20,
                }}
            >
                {state === "locking" ? (
                    <VaultLockAnimation />
                ) : (
                    <Image
                        source={brandMark}
                        style={{ width: 64, height: 64 }}
                        resizeMode="contain"
                    />
                )}
                <UnlockedText style={{ letterSpacing: 2 }}>
                    CRYPTEX{" "}
                    <RNText style={{ color: colors.primary }}>VAULT</RNText>
                </UnlockedText>
                <UnlockedText
                    accessibilityRole="alert"
                    style={
                        state === "locking"
                            ? { marginTop: 12, color: colors.muted }
                            : undefined
                    }
                >
                    {state === "locking"
                        ? "Locking vault…"
                        : "Saving failed. Your vault is still unlocked in memory."}
                </UnlockedText>
                {forceLockError ? (
                    <UnlockedText accessibilityRole="alert" style={{ color: colors.destructive }}>
                        {forceLockError}
                    </UnlockedText>
                ) : null}
                {state === "failed" ? (
                    <View style={{ width: "100%", maxWidth: 320, gap: 12 }}>
                        <UnlockedText style={{ color: colors.muted, textAlign: "center" }}>
                            You can retry the save, keep editing, or lock without saving. Unsaved changes may be lost if you lock anyway.
                        </UnlockedText>
                        <UnlockedButton onPress={() => void lock()}>
                            Retry saving and lock
                        </UnlockedButton>
                        <UnlockedButton
                            variant="outline"
                            onPress={() => {
                                onContinueEditing();
                                vaultStore.set(vaultLockStateAtom, "idle");
                            }}
                        >
                            Keep editing
                        </UnlockedButton>
                        <UnlockedButton variant="destructive" onPress={() => setConfirmDiscardOpen(true)}>
                            Lock anyway
                        </UnlockedButton>
                    </View>
                ) : null}
            </View>
            <Dialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen} placement="bottom">
                <DialogHeader>
                    <UnlockedDialogTitle>Lock without saving?</UnlockedDialogTitle>
                    <DialogDescription>
                        Any unsaved changes will be lost. Cryptex Vault will end this session without saving again.
                    </DialogDescription>
                </DialogHeader>
                <UnlockedButton variant="secondary" onPress={() => setConfirmDiscardOpen(false)}>
                    Cancel
                </UnlockedButton>
                <UnlockedButton variant="destructive" onPress={() => void confirmLockAnyway()}>
                    Lock anyway
                </UnlockedButton>
            </Dialog>
        </>
    );
}

function UnlockedBrandHeader() {
    const lock = useLockVault();
    const { width } = useWindowDimensions();
    const narrow = width <= 360;
    const vault = useAtomValue(unlockedVaultAtom);
    const devices = useAtomValue(linkedDevicesAtom);
    const authStatus = useAtomValue(onlineServicesAuthConnectionStatusAtom, {
        store: onlineServicesStore,
    });
    const onlineServicesData = useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    });
    const {
        controller,
        connectionStatuses,
        connectedDeviceCount,
        syncQueue,
        runSyncQueue,
        stopSyncQueue,
    } = useSyncRuntime();
    const [accountOpen, setAccountOpen] = useState(false);
    const [devicesOpen, setDevicesOpen] = useState(false);
    const [serviceAvailability, setServiceAvailability] = useState<
        "unknown" | "checking" | "reachable" | "unreachable"
    >("unknown");

    const bound = Vault.isOnlineServicesBound(vault);
    const authenticated =
        bound &&
        !!onlineServicesData?.sessionToken &&
        authStatus.status === "CONNECTED";
    const cloudAvailable = isCloudServicesEnabled();
    const failedDevices = devices.filter(
        (device) => syncQueue.results[device.ID] === "Failed",
    );

    const connectedIds = devices
        .filter(
            (device) =>
                connectionStatuses[device.ID]?.webRTCStatus ===
                WebRTCStatus.Connected,
        )
        .map((device) => device.ID);
    const connectedFailedIds = failedDevices
        .filter((device) => connectedIds.includes(device.ID))
        .map((device) => device.ID);

    useEffect(() => {
        if (!accountOpen) return;
        if (!cloudAvailable) {
            setServiceAvailability("unreachable");
            return;
        }
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 5_000);
        setServiceAvailability("checking");
        void fetch(getOnlineServicesApiBaseUrl(), {
            method: "HEAD",
            signal: abort.signal,
        })
            .then(() => setServiceAvailability("reachable"))
            .catch(() => setServiceAvailability("unreachable"))
            .finally(() => clearTimeout(timeout));
        return () => {
            clearTimeout(timeout);
            abort.abort();
        };
    }, [accountOpen, cloudAvailable]);
    const authLabel = authenticated
        ? "Signed in to Online Services"
        : bound
          ? "Online Services: sign in required"
          : "Local vault: Online Services not signed in";

    return (
        <>
            <View
                style={{
                    height: 64,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: narrow ? 8 : 10,
                    paddingLeft: narrow ? 14 : 20,
                    paddingRight: narrow ? 6 : 14,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                    backgroundColor: colors.background,
                }}
            >
                <Image
                    source={brandMark}
                    resizeMode="contain"
                    style={{ width: 31, height: 31 }}
                    accessibilityIgnoresInvertColors
                />
                <View
                    style={{
                        flex: 1,
                        minWidth: 0,
                        flexDirection: narrow ? "column" : "row",
                        gap: narrow ? 0 : 5,
                    }}
                >
                    <UnlockedText
                        style={{
                            fontSize: 12,
                            fontWeight: "700",
                            letterSpacing: 1.7,
                        }}
                    >
                        CRYPTEX
                    </UnlockedText>
                    <UnlockedText
                        style={{
                            color: colors.primary,
                            fontSize: 12,
                            fontWeight: "700",
                            letterSpacing: 1.7,
                        }}
                    >
                        VAULT
                    </UnlockedText>
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={authLabel}
                    hitSlop={4}
                    onPress={() => setAccountOpen(true)}
                    style={{
                        width: 44,
                        height: 48,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Cloud
                        size={21}
                        color={authenticated ? colors.foreground : colors.muted}
                        strokeWidth={1.7}
                    />
                    <UnlockedText
                        style={{
                            position: "absolute",
                            right: 5,
                            bottom: 7,
                            width: 14,
                            textAlign: "center",
                            color: authenticated
                                ? colors.success
                                : bound
                                  ? colors.primary
                                  : colors.muted,
                            backgroundColor: colors.background,
                            fontSize: 10,
                            fontWeight: "700",
                        }}
                    >
                        {authenticated ? "✓" : bound ? "!" : "−"}
                    </UnlockedText>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${connectedDeviceCount} other devices connected`}
                    hitSlop={4}
                    onPress={() => setDevicesOpen(true)}
                    style={{
                        minWidth: 44,
                        height: 48,
                        flexDirection: "row",
                        gap: 2,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Smartphone
                        size={19}
                        color={colors.foreground}
                        strokeWidth={1.7}
                    />
                    <UnlockedText style={{ fontSize: 12 }}>
                        {connectedDeviceCount}
                    </UnlockedText>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Lock vault"
                    hitSlop={6}
                    onPress={() => void lock()}
                    style={{
                        width: 48,
                        height: 48,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Lock
                        size={21}
                        color={colors.foreground}
                        strokeWidth={1.7}
                    />
                </Pressable>
            </View>
            <Dialog
                open={accountOpen}
                onOpenChange={setAccountOpen}
                placement="bottom"
            >
                <DialogHeader>
                    <UnlockedDialogTitle>Online Services</UnlockedDialogTitle>
                    <UnlockedText
                        style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}
                    >
                        Your local vault remains available independently of
                        Online Services.
                    </UnlockedText>
                </DialogHeader>
                <StatusLine
                    label="Authentication"
                    value={
                        authenticated
                            ? "Signed in"
                            : bound
                              ? "Sign in required"
                              : "Not signed in"
                    }
                    tone={authenticated ? "positive" : bound ? "attention" : "neutral"}
                />
                <StatusLine
                    label="Service availability"
                    value={
                        serviceAvailability === "checking"
                            ? "Checking…"
                            : serviceAvailability === "reachable"
                              ? "Reachable"
                              : serviceAvailability === "unreachable"
                                ? "Unavailable"
                                : "Unknown"
                    }
                    tone={
                        serviceAvailability === "reachable"
                            ? "positive"
                            : serviceAvailability === "unreachable"
                              ? "attention"
                              : "neutral"
                    }
                />
                <UnlockedButton
                    variant="secondary"
                    onPress={() => {
                        setAccountOpen(false);
                        router.navigate("/(app)/(tabs)/account");
                    }}
                >
                    Open Account
                </UnlockedButton>
            </Dialog>
            <Dialog
                open={devicesOpen}
                onOpenChange={setDevicesOpen}
                placement="bottom"
            >
                <DialogHeader>
                    <UnlockedDialogTitle>Connected devices</UnlockedDialogTitle>
                </DialogHeader>
                <ScrollView
                    style={{ maxHeight: 320 }}
                    showsVerticalScrollIndicator={false}
                    nestedScrollEnabled
                >
                <StatusLine
                    label="Connected now"
                    value={`${connectedDeviceCount} of ${devices.length} devices`}
                    tone={connectedDeviceCount ? "positive" : "neutral"}
                />
                {devices.map((device) => {
                    const connected = connectedIds.includes(device.ID);
                    const result = syncQueue.results[device.ID];
                    return (
                        <View
                            key={device.ID}
                            style={{
                                minHeight: 64,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 10,
                                borderBottomWidth: 1,
                                borderBottomColor: colors.border,
                            }}
                        >
                            <View
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    backgroundColor: connected
                                        ? `${colors.success}18`
                                        : `${colors.muted}12`,
                                }}
                            >
                                <Smartphone
                                    size={18}
                                    color={connected ? colors.success : colors.muted}
                                    strokeWidth={1.7}
                                />
                            </View>
                            <View style={{ flex: 1 }}>
                                <UnlockedText style={{ fontSize: 14 }}>
                                    {device.Name || "Untitled device"}
                                </UnlockedText>
                                <UnlockedText
                                    style={{
                                        color:
                                            result === "Failed"
                                                ? colors.primary
                                                : connected
                                                  ? colors.success
                                                  : colors.muted,
                                        fontSize: 12,
                                        marginTop: 5,
                                    }}
                                >
                                    {result ??
                                        (connected
                                            ? device.LastSync
                                                ? `Connected, synced ${new Date(device.LastSync).toLocaleString()}`
                                                : "Connected, never synced"
                                            : "Disconnected")}
                                </UnlockedText>
                            </View>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`${connected ? "Sync" : "Connect"} ${device.Name || "device"}`}
                                disabled={syncQueue.active}
                                onPress={() =>
                                    connected
                                        ? void runSyncQueue([device.ID])
                                        : void controller.connectDevice(device.ID)
                                }
                                style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
                            >
                                {connected ? (
                                    <RotateCw size={19} color={syncQueue.results[device.ID] === "Syncing" ? colors.primary : colors.foreground} />
                                ) : (
                                    <Plus size={20} color={colors.muted} />
                                )}
                            </Pressable>
                        </View>
                    );
                })}
                </ScrollView>
                <UnlockedButton
                    variant="ghost"
                    onPress={() => {
                        setDevicesOpen(false);
                        router.navigate("/(app)/(tabs)/devices");
                    }}
                >
                    Open Devices
                </UnlockedButton>
                <UnlockedText
                    accessibilityRole="alert"
                    style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}
                >
                    {syncQueue.active
                        ? `Syncing ${Math.min(syncQueue.done + 1, syncQueue.total)} of ${syncQueue.total}`
                        : syncQueue.total
                          ? `Finished: ${syncQueue.done} processed${failedDevices.length ? `, ${failedDevices.length} failed` : ""}`
                          : "Sync devices one at a time"}
                </UnlockedText>
                <UnlockedText
                    style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}
                >
                    {devices.length - connectedDeviceCount} disconnected devices
                    excluded from Sync all.
                </UnlockedText>
                {syncQueue.active ? (
                    <UnlockedButton
                        variant="secondary"
                        disabled={syncQueue.stopRequested}
                        onPress={stopSyncQueue}
                    >
                        {syncQueue.stopRequested
                            ? "Stopping after current device…"
                            : "Stop queue"}
                    </UnlockedButton>
                ) : (
                    <UnlockedButton
                        disabled={connectedIds.length === 0}
                        onPress={() => void runSyncQueue(connectedIds)}
                    >
                        {`Sync all (${connectedIds.length})`}
                    </UnlockedButton>
                )}
                {!syncQueue.active && failedDevices.length ? (
                    <>
                        {failedDevices.length > connectedFailedIds.length ? (
                            <UnlockedText
                                style={{
                                    color: colors.muted,
                                    fontSize: 12,
                                    lineHeight: 18,
                                }}
                            >
                                Reconnect failed devices to retry.
                            </UnlockedText>
                        ) : null}
                        <UnlockedButton
                            variant="ghost"
                            disabled={connectedFailedIds.length === 0}
                            onPress={() =>
                                void runSyncQueue(connectedFailedIds)
                            }
                        >
                            {`Retry failed (${connectedFailedIds.length})`}
                        </UnlockedButton>
                    </>
                ) : null}
            </Dialog>
        </>
    );
}

function StatusLine({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone: "positive" | "attention" | "neutral";
}) {
    const tint =
        tone === "positive"
            ? colors.success
            : tone === "attention"
              ? colors.primary
              : colors.muted;
    return (
        <View
            style={{
                minHeight: 54,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <UnlockedText style={{ color: colors.muted, fontSize: 13 }}>
                {label}
            </UnlockedText>
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    paddingHorizontal: 8,
                    paddingVertical: 5,
                    borderRadius: 6,
                    backgroundColor: `${tint}14`,
                }}
            >
                {tone === "positive" ? (
                    <Check size={14} color={tint} />
                ) : null}
                <UnlockedText style={{ color: tint, fontSize: 12 }}>
                    {value}
                </UnlockedText>
            </View>
        </View>
    );
}

type UnlockedScreenProps = {
    children: ReactNode;
    scroll?: boolean;
    padded?: boolean;
    taskTitle?: string;
    onTaskBack?: () => void;
};

export function UnlockedScreen({
    children,
    scroll = false,
    padded = true,
    taskTitle,
    onTaskBack,
}: UnlockedScreenProps) {
    const scrollRef = useRef<ScrollView>(null);
    const content = scroll ? (
        <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{
                flexGrow: 1,
                paddingHorizontal: padded ? 20 : 0,
                paddingTop: padded ? (taskTitle ? 24 : 18) : 0,
                paddingBottom: 28,
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
        >
            <KeyboardScrollProvider scrollRef={scrollRef}>
                {children}
            </KeyboardScrollProvider>
        </ScrollView>
    ) : (
        <View
            style={{
                flex: 1,
                paddingHorizontal: padded ? 20 : 0,
                paddingTop: padded ? (taskTitle ? 24 : 18) : 0,
            }}
        >
            {children}
        </View>
    );

    return (
        <SafeAreaView
            edges={["top", "left", "right"]}
            style={{ flex: 1, backgroundColor: colors.background }}
        >
            {taskTitle ? null : <UnlockedBrandHeader />}
            {taskTitle ? (
                <UnlockedTaskHeader title={taskTitle} onBack={onTaskBack} />
            ) : null}
            <View style={{ flex: 1 }}>{content}</View>
        </SafeAreaView>
    );
}

export function UnlockedPageTitle({
    title,
    eyebrow,
}: {
    title: string;
    eyebrow?: string;
}) {
    return (
        <View
            style={{
                minHeight: 48,
                marginBottom: 14,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
            }}
        >
            <UnlockedText
                accessibilityRole="header"
                style={{ fontSize: 24, fontWeight: "500", letterSpacing: -0.6 }}
            >
                {title}
            </UnlockedText>
            {eyebrow ? (
                <UnlockedText
                    style={{
                        color: colors.muted,
                        fontSize: 10,
                        letterSpacing: 1,
                    }}
                >
                    {eyebrow.toUpperCase()}
                </UnlockedText>
            ) : null}
        </View>
    );
}

type TaskHeaderProps = {
    title: string;
    onBack?: () => void;
    backLabel?: string;
    actions?: ReactNode;
};

export function UnlockedTaskHeader({
    title,
    onBack,
    backLabel = "Back",
    actions,
}: TaskHeaderProps) {
    useFocusEffect(
        useCallback(() => {
            if (!onBack) return;
            const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
                onBack();
                return true;
            });
            return () => subscription.remove();
        }, [onBack]),
    );
    return (
        <View
            style={{
                height: 64,
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 8,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={backLabel}
                onPress={onBack ?? (() => router.back())}
                style={{
                    width: 48,
                    height: 48,
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <ArrowLeft
                    size={22}
                    color={colors.foreground}
                    strokeWidth={1.7}
                />
            </Pressable>
            <UnlockedText style={{ flex: 1, fontSize: 16, fontWeight: "600" }}>
                {title}
            </UnlockedText>
            {actions}
        </View>
    );
}

type TaskScreenProps = TaskHeaderProps & {
    children: ReactNode;
    footer?: ReactNode;
    scroll?: boolean;
};

export function UnlockedTaskScreen({
    children,
    footer,
    scroll = true,
    ...headerProps
}: TaskScreenProps) {
    const scrollRef = useRef<ScrollView>(null);
    const contentRef = useRef<View>(null!);
    const [viewportHeight, setViewportHeight] = useState<number>();
    return (
        <SafeAreaView
            edges={["top", "left", "right", "bottom"]}
            style={{ flex: 1, backgroundColor: colors.background }}
        >
            <UnlockedTaskHeader {...headerProps} />
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === "ios" ? "padding" : "height"}
            >
                {scroll ? <ScrollView
                    ref={scrollRef}
                    innerViewRef={contentRef}
                    onLayout={(event) =>
                        setViewportHeight(event.nativeEvent.layout.height)
                    }
                    style={{ flex: 1 }}
                    contentContainerStyle={{
                        flexGrow: 1,
                        paddingHorizontal: 20,
                        paddingTop: 24,
                        paddingBottom: footer ? 18 : 30,
                    }}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                >
                    <KeyboardScrollProvider
                        scrollRef={scrollRef}
                        contentRef={contentRef}
                        viewportHeight={viewportHeight}
                    >
                        {children}
                    </KeyboardScrollProvider>
                </ScrollView> : children}
                {footer ? (
                    <View
                        style={{
                            paddingHorizontal: 20,
                            paddingVertical: 12,
                            borderTopWidth: 1,
                            borderTopColor: colors.border,
                            backgroundColor: colors.background,
                        }}
                    >
                        {footer}
                    </View>
                ) : null}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const DESTINATIONS: Array<{
    route: "vault" | "account" | "devices" | "settings";
    label: string;
    icon: LucideIcon;
}> = [
    { route: "vault", label: "Vault", icon: VaultIcon },
    { route: "account", label: "Account", icon: User },
    { route: "devices", label: "Devices", icon: Smartphone },
    { route: "settings", label: "More", icon: MoreHorizontal },
];

type UnlockedTabBarProps = {
    state: {
        index: number;
        routes: Array<Parameters<typeof getFocusedRouteNameFromRoute>[0]>;
    };
    navigation: { navigate: (name: string) => void };
};

export function UnlockedTabBar({ state, navigation }: UnlockedTabBarProps) {
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const slotWidth = Math.min(
        80,
        (width - 12 - insets.left - insets.right) / 5,
    );
    const params = useGlobalSearchParams<{ directoryId?: string }>();
    const focusedTab = state.routes[state.index];
    const focusedChild = focusedTab
        ? getFocusedRouteNameFromRoute(focusedTab)
        : undefined;
    const hidden =
        focusedTab?.name === "vault" &&
        focusedChild != null &&
        focusedChild !== "index";
    const activeRoute = focusedTab?.name;
    const destination = (item: (typeof DESTINATIONS)[number]) => {
        const selected = activeRoute === item.route;
        const Icon = item.icon;
        return (
            <Pressable
                key={item.route}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
                onPress={() => navigation.navigate(item.route)}
                style={{
                    width: slotWidth,
                    minHeight: 66,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                }}
            >
                <Icon
                    size={22}
                    color={selected ? colors.primary : colors.muted}
                    strokeWidth={1.7}
                />
                <UnlockedText
                    style={{
                        color: selected ? colors.primary : colors.muted,
                        fontSize: 11,
                    }}
                >
                    {item.label}
                </UnlockedText>
            </Pressable>
        );
    };

    return (
        <View
            // Hiding preserves native icon/text views for the return transition.
            pointerEvents={hidden ? "none" : "auto"}
            importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
            style={{
                display: hidden ? "none" : "flex",
                paddingTop: 6,
                paddingBottom: Math.max(insets.bottom, 6),
                paddingHorizontal: 6,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.navigation,
                borderTopWidth: 1,
                borderTopColor: colors.border,
            }}
        >
            {destination(DESTINATIONS[0]!)}
            {destination(DESTINATIONS[1]!)}
            <View style={{ width: slotWidth, alignItems: "center" }}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add item"
                    onPress={() =>
                        router.push({
                            pathname: "/(app)/(tabs)/vault/new",
                            params: {
                                directoryId:
                                    activeRoute === "vault" &&
                                    !hidden &&
                                    params.directoryId
                                        ? params.directoryId === "root" ||
                                          params.directoryId === "all"
                                            ? ""
                                            : params.directoryId
                                        : "",
                            },
                        })
                    }
                    style={{
                        width: 64,
                        flexShrink: 0,
                        minHeight: 58,
                        borderRadius: 14,
                        backgroundColor: colors.primary,
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 2,
                    }}
                >
                    <Plus
                        size={25}
                        color={colors.navigation}
                        strokeWidth={1.9}
                    />
                    <UnlockedText
                        style={{ color: colors.navigation, fontSize: 11 }}
                    >
                        Add
                    </UnlockedText>
                </Pressable>
            </View>
            {destination(DESTINATIONS[2]!)}
            {destination(DESTINATIONS[3]!)}
        </View>
    );
}
