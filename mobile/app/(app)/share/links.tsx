import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAtomValue } from "jotai";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
    ArrowDownUp,
    Link2,
    ListFilter,
    Lock,
    MoreHorizontal,
    Plus,
    RefreshCw,
    Search,
    Server,
    X,
    type LucideIcon,
} from "lucide-react-native";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    countShareListRows,
    queryShareListRows,
    SHARE_LIST_SORTS,
    SHARE_LIST_STATUSES,
    toShareListRows,
    type ShareListRow,
    type ShareListSort,
    type ShareListStatus,
} from "@cryptex-industries/vault-core/vault-utils/share-list";
import {
    dismissShareLink,
    refreshShareStatuses,
    revokeShareLink,
} from "@cryptex-industries/vault-core/vault-utils/share-service";

import { Snackbar, useSnackbar } from "@/components/snackbar";
import { InlineNotice } from "@/components/inline-notice";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";
import {
    UnlockedButton as Button,
    UnlockedDialogTitle,
    UnlockedTaskScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { mobileShareDeps } from "@/app_lib/share-links";
import {
    shareErrorText,
    shareSortLabel,
    shareStatusLabel,
} from "@/app_lib/share-messages";
import { unlockedVaultAtom } from "@/utils/atoms";
import { colors } from "@/theme";

const searchInputStyle = { fontFamily: "sans-serif" };

const STATUS_COLORS: Record<ShareListStatus, string> = {
    active: colors.primary,
    viewed: "#4ade80",
    expired: colors.muted,
    revoked: colors.muted,
    burned: colors.primary,
};

const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleString(i18n.locale, {
        dateStyle: "medium",
        timeStyle: "short",
    });

function describeTiming(
    record: VaultUtilTypes.ShareLink,
    status: ShareListStatus,
) {
    if (status === "viewed" && record.ViewedAtTimestamp) {
        const date = formatDate(record.ViewedAtTimestamp);
        return t`Opened ${date}`;
    }
    if (status === "active") {
        const date = formatDate(record.ExpiresAtTimestamp);
        return t`Expires ${date}`;
    }
    if (status === "burned") return t`Destroyed after five wrong passphrases`;
    const date = formatDate(record.CreatedAtTimestamp);
    return t`Created ${date}`;
}

function HeaderIcon({
    icon: Icon,
    label,
    onPress,
    disabled,
}: {
    icon: LucideIcon;
    label: string;
    onPress: () => void;
    disabled?: boolean;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
            style={{
                width: 44,
                height: 48,
                alignItems: "center",
                justifyContent: "center",
                opacity: disabled ? 0.5 : 1,
            }}
        >
            <Icon size={20} color={colors.foreground} />
        </Pressable>
    );
}

function ControlIcon({
    icon: Icon,
    label,
    badge,
    onPress,
}: {
    icon: LucideIcon;
    label: string;
    badge?: number;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            style={{
                width: 50,
                height: 50,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: badge ? colors.primary : colors.border,
                borderRadius: 4,
                backgroundColor: colors.secondary,
            }}
        >
            <Icon size={19} color={colors.foreground} strokeWidth={1.7} />
            {badge ? (
                <View
                    style={{
                        position: "absolute",
                        top: -7,
                        right: -7,
                        minWidth: 18,
                        height: 18,
                        paddingHorizontal: 4,
                        borderRadius: 9,
                        backgroundColor: colors.primary,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Text
                        style={{
                            fontSize: 11,
                            fontWeight: "700",
                            color: colors.navigation,
                        }}
                    >
                        {badge}
                    </Text>
                </View>
            ) : null}
        </Pressable>
    );
}

function RadioRow({
    label,
    selected,
    onPress,
}: {
    label: string;
    selected: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={onPress}
            style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                minHeight: 56,
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
                    borderColor: selected ? colors.primary : colors.muted,
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
            <Text style={{ fontSize: 14 }}>{label}</Text>
        </Pressable>
    );
}

export default function SharedLinksScreen() {
    const { t } = useLingui();
    const vault = useAtomValue(unlockedVaultAtom);
    const names = useMemo(
        () =>
            new Map(
                vault.Credentials.filter((item) => !item.Deleted).map(
                    (item) => [item.ID, item.Name],
                ),
            ),
        [vault.Credentials],
    );
    const deletedItem = t({
        message: "Deleted item",
        comment: "Shared link whose vault item was deleted",
    });
    const secret = t({
        message: "Secret",
        comment: "Shared link for text that has no label",
    });
    const rows = useMemo(
        () =>
            toShareListRows(vault.ShareLinks ?? [], names, Date.now(), {
                deletedItem,
                secret,
            }),
        [vault.ShareLinks, names, deletedItem, secret],
    );
    const [query, setQuery] = useState("");
    const [statuses, setStatuses] = useState<ShareListStatus[]>([]);
    const [sort, setSort] = useState<ShareListSort>("newest");
    const [filterOpen, setFilterOpen] = useState(false);
    const [sortOpen, setSortOpen] = useState(false);
    const [actionsFor, setActionsFor] = useState<ShareListRow | null>(null);
    const counts = useMemo(() => countShareListRows(rows), [rows]);
    const visible = useMemo(
        () => queryShareListRows(rows, { query, statuses, sort }),
        [rows, query, statuses, sort],
    );

    const [refreshing, setRefreshing] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const { feedback, show, dismiss } = useSnackbar("shared-links");
    const confirm = useUnlockedConfirmation();

    const refresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await refreshShareStatuses(mobileShareDeps());
        } catch (err) {
            show(shareErrorText(err));
        } finally {
            setRefreshing(false);
        }
    }, [show]);

    useFocusEffect(
        useCallback(() => {
            void refresh();
        }, [refresh]),
    );

    const run = useCallback(
        async (id: string, action: typeof revokeShareLink) => {
            setBusyId(id);
            try {
                await action(mobileShareDeps(), id);
            } catch (err) {
                show(shareErrorText(err));
            } finally {
                setBusyId(null);
            }
        },
        [show],
    );

    const revoke = (row: ShareListRow) =>
        confirm({
            title: t`Revoke this link?`,
            description: t`It stops working right away. The recipient sees that it no longer exists.`,
            confirmLabel: t`Revoke link`,
            cancelLabel: t`Cancel`,
            destructive: true,
            onConfirm: () => void run(row.record.ID, revokeShareLink),
        });

    const remove = (row: ShareListRow) => {
        if (row.status !== "active") {
            void run(row.record.ID, dismissShareLink);
            return;
        }
        confirm({
            title: t`Remove an active link?`,
            description: t`It's still active, so this revokes it first. The recipient can no longer open it.`,
            confirmLabel: t`Revoke and remove`,
            cancelLabel: t`Cancel`,
            destructive: true,
            onConfirm: () => void run(row.record.ID, dismissShareLink),
        });
    };

    const renderItem = useCallback(
        ({ item }: { item: ShareListRow }) => (
            <SharedLinkRow
                row={item}
                busy={busyId === item.record.ID}
                onPress={() => setActionsFor(item)}
            />
        ),
        [busyId],
    );

    const sortLabel = shareSortLabel(sort);
    const selectedCount = statuses.length;

    return (
        <UnlockedTaskScreen
            title={t`Shared links`}
            scroll={false}
            actions={
                <View style={{ flexDirection: "row" }}>
                    <HeaderIcon
                        icon={Server}
                        label={t`Share server settings`}
                        onPress={() => router.push("/(app)/share/server")}
                    />
                    <HeaderIcon
                        icon={RefreshCw}
                        label={t`Refresh status`}
                        disabled={refreshing}
                        onPress={() => void refresh()}
                    />
                    <HeaderIcon
                        icon={Plus}
                        label={t`Share a secret`}
                        onPress={() => router.push("/(app)/share")}
                    />
                </View>
            }
        >
            {/* Controls stay put; only the list below scrolls. */}
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: 20,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                }}
            >
                <View
                    style={{
                        flex: 1,
                        height: 50,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        paddingHorizontal: 14,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 4,
                        backgroundColor: colors.secondary,
                    }}
                >
                    <Search size={19} color={colors.muted} strokeWidth={1.7} />
                    <Input
                        value={query}
                        onChangeText={setQuery}
                        placeholder={t`Search name or server`}
                        accessibilityLabel={t`Search shared links`}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="search"
                        className="min-h-11 flex-1 border-0 bg-transparent px-0"
                        style={searchInputStyle}
                    />
                    {query ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t`Clear search`}
                            onPress={() => setQuery("")}
                            style={{
                                width: 44,
                                height: 44,
                                alignItems: "center",
                                justifyContent: "center",
                                marginRight: -12,
                            }}
                        >
                            <X size={18} color={colors.muted} />
                        </Pressable>
                    ) : null}
                </View>
                <ControlIcon
                    icon={ListFilter}
                    label={
                        selectedCount
                            ? t`Filter by status, ${selectedCount} selected`
                            : t`Filter by status`
                    }
                    badge={statuses.length}
                    onPress={() => setFilterOpen(true)}
                />
                <ControlIcon
                    icon={ArrowDownUp}
                    label={t`Sort: ${sortLabel}`}
                    onPress={() => setSortOpen(true)}
                />
            </View>

            <FlatList
                style={{ flex: 1 }}
                contentContainerStyle={{
                    paddingHorizontal: 20,
                    paddingBottom: 12,
                    flexGrow: 1,
                }}
                data={visible}
                keyExtractor={(row) => row.record.ID}
                renderItem={renderItem}
                initialNumToRender={14}
                windowSize={7}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                ListEmptyComponent={
                    rows.length === 0 ? (
                        <View style={{ gap: 14, paddingTop: 12 }}>
                            <InlineNotice
                                tone="info"
                                message={t`No shared links yet. Use Share once on an item, or share a secret that isn't in your vault.`}
                            />
                            <Button onPress={() => router.push("/(app)/share")}>
                                {t`Share a secret`}
                            </Button>
                        </View>
                    ) : (
                        <View style={{ paddingTop: 12 }}>
                            <InlineNotice
                                tone="info"
                                message={t`No links match.`}
                            />
                        </View>
                    )
                }
            />

            <Snackbar feedback={feedback} onDismiss={dismiss} />

            <Dialog
                open={filterOpen}
                onOpenChange={setFilterOpen}
                placement="bottom"
            >
                <DialogHeader>
                    <UnlockedDialogTitle>
                        {t`Filter by status`}
                    </UnlockedDialogTitle>
                </DialogHeader>
                {SHARE_LIST_STATUSES.map((option) => {
                    const on = statuses.includes(option.value);
                    const statusLabel = shareStatusLabel(option.value);
                    const count = counts[option.value];
                    return (
                        <View
                            key={option.value}
                            style={{
                                minHeight: 56,
                                flexDirection: "row",
                                alignItems: "center",
                                borderBottomWidth: 1,
                                borderBottomColor: colors.border,
                            }}
                        >
                            <Text style={{ flex: 1, fontSize: 14 }}>
                                {statusLabel}
                            </Text>
                            <Text
                                style={{
                                    color: colors.muted,
                                    fontSize: 13,
                                    marginRight: 12,
                                }}
                            >
                                {counts[option.value]}
                            </Text>
                            <Switch
                                value={on}
                                onValueChange={() =>
                                    setStatuses((current) =>
                                        on
                                            ? current.filter(
                                                  (entry) =>
                                                      entry !== option.value,
                                              )
                                            : [...current, option.value],
                                    )
                                }
                                accessibilityLabel={plural(count, {
                                    one: `${statusLabel}, # link`,
                                    other: `${statusLabel}, # links`,
                                })}
                            />
                        </View>
                    );
                })}
                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                    <Button
                        variant="outline"
                        className="flex-1"
                        disabled={statuses.length === 0}
                        onPress={() => setStatuses([])}
                    >
                        {t`Show all`}
                    </Button>
                    <Button
                        className="flex-1"
                        onPress={() => setFilterOpen(false)}
                    >
                        {t`Done`}
                    </Button>
                </View>
            </Dialog>

            <Dialog
                open={sortOpen}
                onOpenChange={setSortOpen}
                placement="bottom"
            >
                <DialogHeader>
                    <UnlockedDialogTitle>{t`Sort by`}</UnlockedDialogTitle>
                </DialogHeader>
                {SHARE_LIST_SORTS.map((option) => (
                    <RadioRow
                        key={option.value}
                        label={shareSortLabel(option.value)}
                        selected={option.value === sort}
                        onPress={() => {
                            setSort(option.value);
                            setSortOpen(false);
                        }}
                    />
                ))}
            </Dialog>

            <Dialog
                open={!!actionsFor}
                onOpenChange={(open) => !open && setActionsFor(null)}
                placement="bottom"
            >
                {actionsFor ? (
                    <>
                        <DialogHeader>
                            <UnlockedDialogTitle>
                                {actionsFor.name}
                            </UnlockedDialogTitle>
                            <Text
                                style={{
                                    color: STATUS_COLORS[actionsFor.status],
                                    fontSize: 13,
                                }}
                            >
                                {shareStatusLabel(actionsFor.status)}
                            </Text>
                            <Text style={{ color: colors.muted, fontSize: 13 }}>
                                {describeTiming(
                                    actionsFor.record,
                                    actionsFor.status,
                                )}
                            </Text>
                        </DialogHeader>
                        {actionsFor.status === "active" ? (
                            <Button
                                variant="destructive"
                                onPress={() => {
                                    const row = actionsFor;
                                    setActionsFor(null);
                                    revoke(row);
                                }}
                            >
                                {t`Revoke link`}
                            </Button>
                        ) : null}
                        {names.has(actionsFor.record.CredentialID) ? (
                            <Button
                                variant="secondary"
                                onPress={() => {
                                    const id = actionsFor.record.CredentialID;
                                    setActionsFor(null);
                                    router.push(`/(app)/(tabs)/vault/${id}`);
                                }}
                            >
                                {t`Open item`}
                            </Button>
                        ) : null}
                        <Button
                            variant="secondary"
                            onPress={() => {
                                const row = actionsFor;
                                setActionsFor(null);
                                remove(row);
                            }}
                        >
                            {t`Remove from list`}
                        </Button>
                    </>
                ) : null}
            </Dialog>
        </UnlockedTaskScreen>
    );
}

function SharedLinkRow({
    row,
    busy,
    onPress,
}: {
    row: ShareListRow;
    busy: boolean;
    onPress: () => void;
}) {
    const { t } = useLingui();
    const { record, status, name, host } = row;
    // Same shape as the vault list: flat rows, a divider, a round icon.
    return (
        <View
            style={{
                minHeight: 72,
                flexDirection: "row",
                alignItems: "center",
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                opacity: busy ? 0.5 : 1,
            }}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${name}, ${shareStatusLabel(status)}`}
                accessibilityHint={t`Shows actions for this link`}
                disabled={busy}
                onPress={onPress}
                android_ripple={{ color: colors.border }}
                style={{
                    minHeight: 72,
                    minWidth: 0,
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                }}
            >
                <View
                    style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: colors.secondary,
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.03)",
                    }}
                >
                    <Link2 size={17} color={STATUS_COLORS[status]} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                        }}
                    >
                        <Text
                            numberOfLines={1}
                            style={{ flexShrink: 1, fontSize: 15 }}
                        >
                            {name}
                        </Text>
                        {record.Passphrase ? (
                            <Lock
                                size={13}
                                color={colors.muted}
                                accessibilityLabel={t`Passphrase protected`}
                            />
                        ) : null}
                        <Text
                            style={{
                                fontSize: 12,
                                color: STATUS_COLORS[status],
                            }}
                        >
                            {shareStatusLabel(status)}
                        </Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 10 }}>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                            {describeTiming(record, status)}
                        </Text>
                        <Text
                            numberOfLines={1}
                            style={{
                                flexShrink: 1,
                                color: colors.muted,
                                fontSize: 12,
                            }}
                        >
                            {host}
                        </Text>
                    </View>
                </View>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t`Actions for ${name}`}
                disabled={busy}
                onPress={onPress}
                style={{
                    width: 44,
                    height: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: -10,
                }}
            >
                <MoreHorizontal size={20} color={colors.foreground} />
            </Pressable>
        </View>
    );
}
