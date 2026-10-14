import React from "react";
import {
    BackHandler,
    FlatList,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    useWindowDimensions,
    View,
} from "react-native";
import {
    ArrowLeft,
    ArrowUpRight,
    Globe2,
    Plus,
    Search,
    ShieldAlert,
    Smartphone,
} from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";
import type {
    AutofillCredentialRow,
    AutofillTarget,
} from "@/utils/android-autofill";
import { BrandIcon } from "@/components/brand";
import {
    UnlockedButton,
    UnlockedCheckbox,
    UnlockedDialogTitle,
    UnlockedInput,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import {
    Dialog,
    DialogDescription,
    DialogFooter,
    DialogHeader,
} from "@/components/ui/dialog";
import { colors } from "@/theme";

export function AutofillRequestShell({
    title,
    onBack,
    backLabel = "Back",
    footer,
    scroll = true,
    compact = false,
    children,
}: {
    title: string;
    onBack: () => void;
    backLabel?: string;
    footer?: React.ReactNode;
    scroll?: boolean;
    compact?: boolean;
    children: React.ReactNode;
}) {
    React.useEffect(() => {
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                onBack();
                return true;
            },
        );
        return () => subscription.remove();
    }, [onBack]);
    const content = (
        <>
            {compact ? null : (
                <UnlockedText
                    accessibilityRole="header"
                    style={{
                        paddingHorizontal: 20,
                        paddingTop: 17,
                        paddingBottom: 12,
                        fontFamily: "Oxanium_600SemiBold",
                        fontSize: 27,
                        lineHeight: 34,
                        letterSpacing: -0.6,
                    }}
                >
                    {title}
                </UnlockedText>
            )}
            {children}
        </>
    );
    return (
        <SafeAreaView
            edges={["top", "left", "right", "bottom"]}
            style={{ flex: 1, backgroundColor: colors.background }}
        >
            <View
                style={{
                    height: compact ? 52 : 72,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                }}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={backLabel}
                    onPress={onBack}
                    style={{ width: 44, height: compact ? 44 : 48, alignItems: "center", justifyContent: "center" }}
                >
                    <ArrowLeft size={18} color={colors.foreground} />
                </Pressable>
                <BrandIcon size={compact ? 24 : 30} />
                <View style={{ flex: 1, flexDirection: "row", gap: 7 }}>
                    <UnlockedText style={{ fontSize: 12, fontWeight: "700", letterSpacing: 1.7 }}>
                        CRYPTEX
                    </UnlockedText>
                    <UnlockedText style={{ color: colors.primary, fontSize: 12, fontWeight: "700", letterSpacing: 1.7 }}>
                        VAULT
                    </UnlockedText>
                </View>
            </View>
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === "ios" ? "padding" : "height"}
            >
                {scroll ? (
                    <ScrollView
                        style={{ flex: 1 }}
                        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode="on-drag"
                        showsVerticalScrollIndicator={false}
                    >
                        {content}
                    </ScrollView>
                ) : (
                    <View style={{ flex: 1 }}>{content}</View>
                )}
                {footer ? (
                    <View style={{ paddingHorizontal: 20, paddingVertical: compact ? 7 : 11, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.navigation }}>
                        {footer}
                    </View>
                ) : null}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

export function RequestDestination({
    label,
    kind,
    warning,
    detail,
    compact = false,
}: {
    label: string;
    kind: "website" | "app" | "passkey";
    warning?: string | null;
    detail?: string;
    compact?: boolean;
}) {
    const Icon = kind === "website" ? Globe2 : Smartphone;
    return (
        <View style={{ gap: compact ? 0 : 10 }}>
            <View
                style={{
                    minHeight: compact ? 42 : 48,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    borderLeftWidth: 2,
                    borderLeftColor: colors.primary,
                    paddingLeft: 12,
                    paddingVertical: compact ? 2 : 4,
                }}
            >
                {kind === "passkey" ? (
                    <BrandIcon size={24} />
                ) : (
                    <Icon size={17} color={colors.primary} strokeWidth={1.7} />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                    <UnlockedText
                        numberOfLines={compact ? 1 : 2}
                        style={{ fontSize: 14, lineHeight: 19, fontWeight: "600" }}
                    >
                        {label}
                    </UnlockedText>
                    {compact ? null : (
                        <UnlockedText style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
                            {detail ?? (kind === "website"
                                ? "Website reported by Android"
                                : kind === "app"
                                  ? "App reported by Android"
                                  : "Relying party")}
                        </UnlockedText>
                    )}
                </View>
            </View>
            {warning && !compact ? (
                <View
                    accessibilityRole="alert"
                    style={{
                        flexDirection: "row",
                        gap: 10,
                        borderLeftWidth: 2,
                        borderLeftColor: colors.primary,
                        paddingLeft: 12,
                        paddingVertical: 4,
                    }}
                >
                    <ShieldAlert size={18} color={colors.primary} />
                    <UnlockedText
                        style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 19 }}
                    >
                        {warning}
                    </UnlockedText>
                </View>
            ) : null}
        </View>
    );
}

function CredentialRow({
    row,
    disabled,
    onPress,
}: {
    row: AutofillCredentialRow;
    disabled: boolean;
    onPress: (credential: VaultCredential) => void;
}) {
    const { credential, isMatch } = row;
    const [pressed, setPressed] = React.useState(false);
    const rawTarget = credential.URL || credential.AdditionalURLs?.[0]?.URL || "Saved login";
    const target = (() => {
        try {
            const parsed = new URL(rawTarget);
            return parsed.protocol === "androidapp:"
                ? parsed.host || rawTarget.replace(/^androidapp:\/\//u, "")
                : parsed.hostname || rawTarget;
        } catch {
            return rawTarget.replace(/^androidapp:\/\//u, "");
        }
    })();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${credential.Name}, ${credential.Username || "Password only"}${isMatch ? ", matches destination" : ""}`}
            disabled={disabled}
            onPress={() => onPress(credential)}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            style={{
                minHeight: 76,
                flexDirection: "row",
                alignItems: "center",
                gap: 11,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderLeftWidth: isMatch ? 2 : 0,
                borderLeftColor: colors.primary,
                borderRadius: 6,
                backgroundColor: pressed
                    ? "#2a3348"
                    : isMatch
                      ? colors.secondary
                      : "transparent",
                opacity: disabled ? 0.55 : 1,
            }}
        >
            <View
                style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.navigation,
                    borderWidth: 1,
                    borderColor: colors.border,
                }}
            >
                <UnlockedText style={{ color: colors.primary, fontSize: 14, fontWeight: "700" }}>
                    {(credential.Name.trim()[0] ?? "?").toUpperCase()}
                </UnlockedText>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                    <UnlockedText numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, fontWeight: "600" }}>
                        {credential.Name}
                    </UnlockedText>
                    {isMatch ? (
                        <UnlockedText style={{ color: colors.primary, fontSize: 10 }}>
                            Match
                        </UnlockedText>
                    ) : null}
                </View>
                <UnlockedText
                    numberOfLines={1}
                    style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}
                >
                    {credential.Username || "Password only"}
                </UnlockedText>
                <UnlockedText
                    numberOfLines={1}
                    style={{ color: colors.muted, fontSize: 11, lineHeight: 15 }}
                >
                    {target}
                </UnlockedText>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <UnlockedText style={{ color: colors.primary, fontSize: 12 }}>Fill</UnlockedText>
                <ArrowUpRight size={12} color={colors.primary} />
            </View>
        </Pressable>
    );
}

function useCompactPickerLayout() {
    const { height } = useWindowDimensions();
    const [keyboardVisible, setKeyboardVisible] = React.useState(() => Keyboard.isVisible());
    React.useEffect(() => {
        const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
        const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);
    return keyboardVisible || height < 620;
}

export function AutofillPicker({
    target,
    warning,
    rows,
    matchCount,
    eligibleCount,
    query,
    expanded,
    busy,
    error,
    onQueryChange,
    onToggleExpanded,
    onChoose,
    onAdd,
    onCancel,
}: {
    target: AutofillTarget;
    warning?: string | null;
    rows: AutofillCredentialRow[];
    matchCount: number;
    eligibleCount: number;
    query: string;
    expanded: boolean;
    busy: boolean;
    error?: string;
    onQueryChange: (query: string) => void;
    onToggleExpanded: () => void;
    onChoose: (credential: VaultCredential) => void;
    onAdd: () => void;
    onCancel: () => void;
}) {
    const showingGlobalResults = expanded || query.trim().length > 0;
    const visibleMatchCount = rows.filter((row) => row.isMatch).length;
    const compact = useCompactPickerLayout();
    return (
        <AutofillRequestShell
            title="Choose a login"
            backLabel="Cancel autofill"
            onBack={onCancel}
            scroll={false}
            compact={compact}
            footer={
                <View
                    style={{ flexDirection: "row", gap: 10 }}
                >
                    <View style={{ flex: 1 }}>
                        <UnlockedButton
                            variant="ghost"
                            disabled={busy}
                            onPress={onCancel}
                        >
                            Cancel autofill
                        </UnlockedButton>
                    </View>
                    <View style={{ flex: 1 }}>
                        <UnlockedButton
                            variant="secondary"
                            disabled={busy}
                            onPress={onAdd}
                        >
                            <Plus size={16} color={colors.primary} />
                            <UnlockedText style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>
                                Add login
                            </UnlockedText>
                        </UnlockedButton>
                    </View>
                </View>
            }
        >
            <View style={{ flex: 1, paddingHorizontal: 20 }}>
                <RequestDestination
                    label={target.displayName}
                    kind={target.pageUrl ? "website" : "app"}
                    warning={warning}
                    detail={target.warningType === "unverified-web-scheme"
                        ? `Browser address: ${target.displayName} (scheme unavailable)`
                        : `Reported destination: ${target.pageUrl ?? target.appUri ?? "Reported target"}`}
                    compact={compact}
                />
                <View style={{ marginTop: compact ? 7 : 14, position: "relative" }}>
                    <Search
                        size={18}
                        color={colors.muted}
                        style={{ position: "absolute", zIndex: 1, left: 14, top: 18 }}
                    />
                    <UnlockedInput
                        value={query}
                        onChangeText={onQueryChange}
                        placeholder="Search all logins"
                        accessibilityLabel="Search all autofill logins"
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={{ paddingLeft: 42 }}
                    />
                </View>
                <View
                    style={{
                        minHeight: compact ? 40 : 48,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                    }}
                >
                    <UnlockedText style={{ color: colors.muted, fontSize: 12 }}>
                        {rows.length} {rows.length === 1 ? "login" : "logins"}{" ("}
                        {visibleMatchCount} {visibleMatchCount === 1 ? "match" : "matches"})
                    </UnlockedText>
                    {eligibleCount > matchCount && !query.trim() ? (
                        <Pressable
                            accessibilityRole="button"
                            onPress={onToggleExpanded}
                            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
                        >
                            <UnlockedText style={{ color: colors.primary, fontSize: 13 }}>
                                {expanded ? "Show less" : `Show all (${eligibleCount})`}
                            </UnlockedText>
                        </Pressable>
                    ) : null}
                </View>
                {error ? (
                    <UnlockedText
                        accessibilityRole="alert"
                        style={{ color: colors.primary, fontSize: 13, marginBottom: 8 }}
                    >
                        {error}
                    </UnlockedText>
                ) : null}
                <FlatList
                    data={rows}
                    keyExtractor={(row) => row.credential.ID}
                    renderItem={({ item }) => (
                        <CredentialRow row={item} disabled={busy} onPress={onChoose} />
                    )}
                    ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
                    initialNumToRender={10}
                    maxToRenderPerBatch={10}
                    windowSize={7}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 14, flexGrow: 1 }}
                    ListEmptyComponent={
                        <View style={{ paddingVertical: 24, gap: 6 }}>
                            <UnlockedText style={{ fontSize: 15 }}>
                                {query.trim()
                                    ? "No logins match your search."
                                    : `No login saved for ${target.displayName}`}
                            </UnlockedText>
                            <UnlockedText style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
                                {showingGlobalResults
                                    ? "Try another search or add a login."
                                    : "Show all logins or add one for this destination."}
                            </UnlockedText>
                        </View>
                    }
                />
            </View>
        </AutofillRequestShell>
    );
}

export function FillDecisionScreen({
    credential,
    target,
    warning,
    canAssociate,
    busy,
    onClose,
    onFillOnce,
    onAssociate,
}: {
    credential: VaultCredential | null;
    target: AutofillTarget;
    warning?: string | null;
    canAssociate: boolean;
    busy: boolean;
    onClose: () => void;
    onFillOnce: () => void;
    onAssociate: () => void;
}) {
    if (!credential) return null;
    const kind = target.pageUrl ? "website" : "app";
    return (
        <AutofillRequestShell
            title="Review destination"
            onBack={onClose}
            backLabel="Back to logins"
            footer={
                <View style={{ gap: 10 }}>
                    <UnlockedButton loading={busy} onPress={onFillOnce}>
                        Fill once
                    </UnlockedButton>
                    {canAssociate ? (
                        <UnlockedButton variant="secondary" disabled={busy} onPress={onAssociate}>
                            {`Fill and associate ${kind}`}
                        </UnlockedButton>
                    ) : null}
                    <UnlockedButton variant="ghost" disabled={busy} onPress={onClose}>
                        Cancel
                    </UnlockedButton>
                </View>
            }
        >
            <View style={{ gap: 20 }}>
                <RequestDestination
                    label={target.displayName}
                    kind={target.pageUrl ? "website" : "app"}
                    warning={warning}
                />
                <View style={{ gap: 6 }}>
                    <UnlockedText style={{ color: colors.muted, fontSize: 10, letterSpacing: 1 }}>
                        SAVED LOGIN
                    </UnlockedText>
                    <UnlockedText style={{ fontSize: 17, fontWeight: "600" }}>
                        {credential.Name}
                    </UnlockedText>
                    <UnlockedText style={{ color: colors.muted, fontSize: 13 }}>
                        {credential.Username || "Password only"}
                    </UnlockedText>
                </View>
                <UnlockedText style={{ fontSize: 13, lineHeight: 20 }}>
                    Fill once leaves the login's saved targets unchanged.
                </UnlockedText>
            </View>
        </AutofillRequestShell>
    );
}

export function AssociationConsentScreen({
    credential,
    target,
    busy,
    error,
    onBack,
    onConfirm,
}: {
    credential: VaultCredential;
    target: AutofillTarget;
    busy: boolean;
    error?: string;
    onBack: () => void;
    onConfirm: () => void;
}) {
    const [consented, setConsented] = React.useState(false);
    const association = target.pageUrl ?? target.appUri ?? "";
    const kind = target.pageUrl ? "website" : "app";
    return (
        <AutofillRequestShell
            title={`Associate ${kind}`}
            onBack={onBack}
            backLabel="Back to destination review"
            footer={
                <View style={{ gap: 10 }}>
                    <UnlockedButton
                        loading={busy}
                        disabled={!consented}
                        onPress={onConfirm}
                    >
                        Save association and fill
                    </UnlockedButton>
                    <UnlockedButton variant="ghost" disabled={busy} onPress={onBack}>
                        Cancel
                    </UnlockedButton>
                </View>
            }
        >
            <View style={{ gap: 18 }}>
                <RequestDestination
                    label={target.displayName}
                    kind={target.pageUrl ? "website" : "app"}
                />
                <UnlockedText style={{ fontSize: 14, lineHeight: 21 }}>
                    Add this exact {kind === "website" ? "hostname" : "package"} to {credential.Name}. Existing targets stay in place.
                </UnlockedText>
                <UnlockedText selectable style={{ color: colors.muted, fontSize: 12 }}>
                    {association}
                </UnlockedText>
                <UnlockedText style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
                    Association changes where Cryptex Vault can offer this login. It does not verify the app or website.
                </UnlockedText>
                <UnlockedCheckbox
                    checked={consented}
                    onCheckedChange={(value) => setConsented(value === true)}
                    label={`Add this exact ${kind === "website" ? "hostname" : "app package"}`}
                />
                {error ? (
                    <UnlockedText accessibilityRole="alert" style={{ color: colors.primary, fontSize: 13 }}>
                        {error}
                    </UnlockedText>
                ) : null}
            </View>
        </AutofillRequestShell>
    );
}

export function SaveFailureSheet({
    open,
    code,
    onClose,
    onRetry,
}: {
    open: boolean;
    code: string;
    onClose: () => void;
    onRetry: () => void;
}) {
    const [details, setDetails] = React.useState(false);
    React.useEffect(() => {
        if (!open) setDetails(false);
    }, [open]);
    return (
        <Dialog open={open} onOpenChange={(next) => !next && onClose()} placement="bottom">
            <DialogHeader>
                <UnlockedDialogTitle>Could not save item</UnlockedDialogTitle>
                <DialogDescription>
                    The vault update could not be saved. Your changes are still in the editor.
                </DialogDescription>
            </DialogHeader>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: details }}
                onPress={() => setDetails((value) => !value)}
                style={{ minHeight: 44, justifyContent: "center" }}
            >
                <UnlockedText style={{ color: colors.primary, fontSize: 13 }}>
                    {details ? "Hide failure details" : "Failure details"}
                </UnlockedText>
            </Pressable>
            {details ? (
                <View style={{ gap: 8 }}>
                    <UnlockedText style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
                        The local encrypted save did not finish. No changes were confirmed as saved, and no login was filled.
                    </UnlockedText>
                    <UnlockedText selectable style={{ color: colors.muted, fontFamily: "monospace", fontSize: 11 }}>
                        Failure code: {code}
                    </UnlockedText>
                </View>
            ) : null}
            <DialogFooter>
                <UnlockedButton onPress={onRetry}>Try again</UnlockedButton>
                <UnlockedButton variant="secondary" onPress={onClose}>
                    Back to editing
                </UnlockedButton>
            </DialogFooter>
        </Dialog>
    );
}
