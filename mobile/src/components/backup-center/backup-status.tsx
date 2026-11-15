import type { ReactNode } from "react";
import { View } from "react-native";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { LucideIcon } from "lucide-react-native";

import { UnlockedText as Text } from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

export function formatBytes(bytes: number, locale: string) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KiB`;
    const size = (bytes / 1024 ** 2).toLocaleString(locale, {
        maximumFractionDigits: 1,
    });
    return `${size} MiB`;
}

export function formatBackupTime(i18n: I18n, when: Date | number) {
    const date = new Date(when);
    const time = date.toLocaleTimeString(i18n.locale, {
        hour: "2-digit",
        minute: "2-digit",
    });
    if (date.toDateString() === new Date().toDateString())
        return i18n._(msg`today at ${time}`);
    return date.toLocaleString(i18n.locale, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

type ManagedStatus = {
    storageBytes: number;
    maxSnapshotBytes: number;
    maxAccountBytes: number;
};

/**
 * The server refuses an upload with the same code when the account is full
 * and when one backup is over the size limit.
 */
export function managedFailureKind(
    failure: { code: string | undefined; bytes: number | undefined } | null,
    status: ManagedStatus | undefined,
) {
    if (!failure) return null;
    if (failure.code !== "PAYLOAD_TOO_LARGE") return "failing";
    return status && (failure.bytes ?? 0) > status.maxSnapshotBytes
        ? "too-large"
        : "full";
}

export function managedFailureTitle(
    i18n: I18n,
    kind: NonNullable<ReturnType<typeof managedFailureKind>>,
) {
    if (kind === "full") return i18n._(msg`Managed storage is full`);
    if (kind === "too-large")
        return i18n._(msg`This vault is too large for managed backups`);
    return i18n._(msg`Managed backups are failing`);
}

const TONES = {
    positive: colors.success,
    attention: colors.primary,
    neutral: colors.muted,
};

/** The large state summary at the top of a backup screen. */
export function BackupStatusHeader({
    icon: Icon,
    tone,
    title,
    body,
    children,
}: {
    icon: LucideIcon;
    tone: keyof typeof TONES;
    title: string;
    body?: string;
    children?: ReactNode;
}) {
    const tint = TONES[tone];
    return (
        <View
            testID="backup-status"
            accessibilityRole="summary"
            style={{
                paddingTop: 8,
                paddingBottom: 26,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <View
                style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: `${tint}1f`,
                    marginBottom: 18,
                }}
            >
                <Icon size={28} color={tint} strokeWidth={1.8} />
            </View>
            <Text
                accessibilityLiveRegion="polite"
                style={{ fontSize: 22, fontWeight: "500", lineHeight: 28 }}
            >
                {title}
            </Text>
            {body ? (
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 13,
                        lineHeight: 20,
                        marginTop: 6,
                    }}
                >
                    {body}
                </Text>
            ) : null}
            {children}
        </View>
    );
}

/** Managed storage used out of the account's allowance. */
export function StorageMeter({
    i18n,
    status,
    full,
}: {
    i18n: I18n;
    status: ManagedStatus;
    full: boolean;
}) {
    const share = Math.min(1, status.storageBytes / status.maxAccountBytes);
    const tint = full || share >= 0.9 ? colors.primary : colors.success;
    const used = formatBytes(status.storageBytes, i18n.locale);
    const total = formatBytes(status.maxAccountBytes, i18n.locale);
    return (
        <View
            accessible
            accessibilityLabel={i18n._(
                msg`Managed storage, ${used} of ${total} used`,
            )}
            style={{ marginTop: 22 }}
        >
            <View
                style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 9,
                }}
            >
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {i18n._(msg`Managed storage`)}
                </Text>
                <Text style={{ fontSize: 12 }}>
                    {i18n._(msg`${used} of ${total}`)}
                </Text>
            </View>
            <View
                style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: colors.trackOff,
                    overflow: "hidden",
                }}
            >
                <View
                    style={{
                        width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%`,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: tint,
                    }}
                />
            </View>
        </View>
    );
}
