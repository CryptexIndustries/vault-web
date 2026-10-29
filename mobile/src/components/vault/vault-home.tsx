import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";
import {
    UnlockedDialogTitle as DialogTitle,
    UnlockedScreen,
    UnlockedText,
    UnlockedButton as Button,
} from "@/components/unlocked/unlocked-ui";
import {
    memo,
    startTransition,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import { Alert, Pressable, ScrollView, SectionList, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAtomValue } from "jotai";
import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
    ArrowDown,
    ArrowUpDown,
    Check,
    ChevronRight,
    Copy,
    Folder,
    FileKey,
    Key,
    Search,
    Settings2,
    ShieldCheck,
} from "lucide-react-native";

import {
    deleteCredential,
    moveCredentialsToDirectory,
    sortDirectories,
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { ItemType } from "@cryptex-industries/vault-core/proto";
import { unlockedVaultAtom, vaultCredentialsAtom } from "@/utils/atoms";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { copySecretToClipboard, copyTextToClipboard } from "@/utils/clipboard";
import { sshPublicKeyLine } from "@cryptex-industries/vault-core/vault-utils/ssh-key-info";
import {
    sortCredentials,
    type CredentialSort,
} from "@/utils/credential-search";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import {
    Dialog,
    DialogDescription,
    DialogHeader,
} from "@/components/ui/dialog";
import { CredentialDetailPanel } from "@/components/vault/credential-detail-panel";
import { AddItemSheet, openNewItem } from "@/components/vault/add-item-sheet";
import { isSSHKeyItem, SSH_KEYS_FILTER, sshKeySummary } from "@/utils/ssh-keys";
import { colors } from "@/theme";

/** A directory ID, or all items, items without a directory, or SSH keys. */
type DirectoryFilter = "all" | "root" | typeof SSH_KEYS_FILTER | string;

const SORT_OPTIONS: Array<{
    value: CredentialSort;
    label: MessageDescriptor;
}> = [
    { value: "modified-desc", label: msg`Recently modified` },
    { value: "modified-asc", label: msg`Oldest first` },
    { value: "name-asc", label: msg`Name A–Z` },
    { value: "name-desc", label: msg`Name Z–A` },
];

function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
    return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
}

function filterDirectoryId(filter: DirectoryFilter): string {
    return filter === "root" ? "" : filter;
}

/** The directory a new item starts in when added from this filter. */
function newItemDirectoryId(filter: DirectoryFilter): string {
    return filter === "all" || filter === SSH_KEYS_FILTER
        ? ""
        : filterDirectoryId(filter);
}

export function VaultHomeScreen({
    selectedId: selectedIdProp,
}: { selectedId?: string | null } = {}) {
    const { t } = useLingui();
    const confirm = useUnlockedConfirmation();
    const params = useLocalSearchParams<{ directoryId?: string }>();
    const vault = useAtomValue(unlockedVaultAtom);
    const credentials = useAtomValue(vaultCredentialsAtom);
    const { isTablet } = useBreakpoint();
    const [filter, setFilter] = useState<DirectoryFilter>("all");
    const [sort, setSort] = useState<CredentialSort>("modified-desc");
    const [filterOpen, setFilterOpen] = useState(false);
    const [sortOpen, setSortOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [moveIDs, setMoveIDs] = useState<string[]>([]);
    const [selectedIDs, setSelectedIDs] = useState<Set<string>>(new Set());
    const [selectedId, setSelectedId] = useState<string | null>(
        selectedIdProp ?? null,
    );

    useEffect(() => {
        if (selectedIdProp !== undefined) setSelectedId(selectedIdProp);
    }, [selectedIdProp]);
    useEffect(() => {
        if (params.directoryId) {
            setFilter(
                params.directoryId === "root" ? "root" : params.directoryId,
            );
        }
    }, [params.directoryId]);
    useEffect(() => setSelectedIDs(new Set()), [filter]);

    const activeCredentials = useMemo(
        () => credentials.filter((item) => !item.Deleted),
        [credentials],
    );
    const directories = useMemo(
        () =>
            sortDirectories(vault.Directories).filter((item) => !item.Deleted),
        [vault.Directories],
    );
    useEffect(() => {
        if (
            filter !== "all" &&
            filter !== "root" &&
            filter !== SSH_KEYS_FILTER &&
            !directories.some((entry) => entry.ID === filter)
        ) {
            setFilter("all");
            router.setParams({ directoryId: "all" });
        }
    }, [directories, filter]);
    const counts = useMemo(
        () =>
            activeCredentials.reduce<Record<string, number>>(
                (result, item) => {
                    result.all = (result.all ?? 0) + 1;
                    const key = item.DirectoryID || "root";
                    result[key] = (result[key] ?? 0) + 1;
                    if (isSSHKeyItem(item)) {
                        result[SSH_KEYS_FILTER] =
                            (result[SSH_KEYS_FILTER] ?? 0) + 1;
                    }
                    return result;
                },
                { all: 0, root: 0, [SSH_KEYS_FILTER]: 0 },
            ),
        [activeCredentials],
    );
    const scoped = useMemo(
        () =>
            filter === "all"
                ? activeCredentials
                : filter === SSH_KEYS_FILTER
                  ? activeCredentials.filter(isSSHKeyItem)
                  : activeCredentials.filter(
                        (item) =>
                            item.DirectoryID === filterDirectoryId(filter),
                    ),
        [activeCredentials, filter],
    );
    const visible = useMemo(
        () => sortCredentials(scoped, sort),
        [scoped, sort],
    );
    const sections = useMemo(() => {
        const grouped = new Map<string, VaultCredential[]>();
        for (const item of visible) {
            const items = grouped.get(item.DirectoryID);
            if (items) items.push(item);
            else grouped.set(item.DirectoryID, [item]);
        }
        return [
            { id: "", name: t`No directory` },
            ...directories.map((entry) => ({ id: entry.ID, name: entry.Name })),
        ]
            .map((entry) => ({
                ...entry,
                key: entry.id,
                data: grouped.get(entry.id) ?? [],
            }))
            .filter((entry) => entry.data.length);
    }, [directories, visible, t]);
    const selectedCredential = useMemo(
        () =>
            selectedId
                ? (activeCredentials.find((item) => item.ID === selectedId) ??
                  null)
                : null,
        [activeCredentials, selectedId],
    );
    const filterLabel =
        filter === "all"
            ? t`All items`
            : filter === "root"
              ? t`No directory`
              : filter === SSH_KEYS_FILTER
                ? t`SSH keys`
                : (directories.find((item) => item.ID === filter)?.Name ??
                  t`Directory`);
    const sshFilter = filter === SSH_KEYS_FILTER;

    const addCredential = () =>
        sshFilter
            ? openNewItem("ssh-key", newItemDirectoryId(filter))
            : setAddOpen(true);

    const toggleSelected = useCallback(
        (id: string) =>
            setSelectedIDs((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            }),
        [],
    );

    const selectionMode = selectedIDs.size > 0;
    const selectedCount = selectedIDs.size;
    // A share link holds one item, and passkeys are never shared.
    const shareableSelection = useMemo(() => {
        if (selectedIDs.size !== 1) return null;
        const [id] = selectedIDs;
        const item = activeCredentials.find((entry) => entry.ID === id);
        return item && item.Type !== ItemType.Passkey ? item : null;
    }, [activeCredentials, selectedIDs]);
    const selectCredential = useCallback(
        (credential: VaultCredential) => {
            if (selectionMode) return toggleSelected(credential.ID);
            if (isTablet) setSelectedId(credential.ID);
            else router.push(`/(app)/(tabs)/vault/${credential.ID}`);
        },
        [selectionMode, isTablet, toggleSelected],
    );

    const deleteItem = (credential: VaultCredential) => {
        const name = credential.Name || t`Untitled`;
        return confirm({
            title: t`Delete this item?`,
            description: t`Remove “${name}” from your vault?`,
            cancelLabel: t`Keep item`,
            confirmLabel: t`Delete item`,
            onConfirm: () =>
                void persistVaultMutation(
                    "credential.delete",
                    async (currentVault) => {
                        const updated = Object.assign(
                            new Vault(),
                            currentVault,
                        );
                        const result = await deleteCredential(
                            [...currentVault.Credentials],
                            credential.ID,
                        );
                        if (result.isErr()) throw new Error(result.error);
                        updated.Credentials = result.value;
                        return { vault: updated, result: undefined };
                    },
                ).then((result) => {
                    if (result.isErr())
                        return Alert.alert(t`Error`, t`Failed to delete item.`);
                    setSelectedId(null);
                    setSelectedIDs((current) => {
                        const next = new Set(current);
                        next.delete(credential.ID);
                        return next;
                    });
                }),
        });
    };

    const moveCount = moveIDs.length;
    const move = async (targetId: string) => {
        if (!moveIDs.length) return;
        const result = await persistVaultMutation(
            "credentials.move",
            async (currentVault) => {
                const updated = Object.assign(new Vault(), currentVault, {
                    Credentials: currentVault.Credentials.map((entry) =>
                        Object.assign(new VaultCredential(), entry),
                    ),
                });
                await moveCredentialsToDirectory(
                    updated.Credentials,
                    moveIDs,
                    targetId,
                    currentVault.Directories,
                );
                return { vault: updated, result: undefined };
            },
        );
        if (result.isErr())
            return Alert.alert(t`Error`, t`Failed to move item.`);
        setMoveIDs([]);
        setSelectedIDs(new Set());
    };

    const longPressCredential = useCallback((id: string) => {
        setSelectedIDs((current) => new Set(current).add(id));
    }, []);
    const renderRow = useCallback(
        ({ item }: { item: VaultCredential }) => (
            <VaultRow
                item={item}
                selected={selectedIDs.has(item.ID)}
                onSelect={selectCredential}
                onLongPress={longPressCredential}
            />
        ),
        [selectedIDs, selectCredential, longPressCredential],
    );

    const toolbar = (
        <View style={{ paddingTop: 12 }}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t`Search your vault`}
                onPress={() =>
                    router.push("/(app)/(tabs)/vault/search" as never)
                }
                style={{
                    height: 54,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 15,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 4,
                    backgroundColor: colors.secondary,
                }}
            >
                <Search size={21} color={colors.muted} strokeWidth={1.7} />
                <UnlockedText style={{ color: colors.muted, fontSize: 14 }}>
                    {t`Search your vault`}
                </UnlockedText>
            </Pressable>
            <View
                style={{
                    minHeight: 52,
                    flexDirection: "row",
                    alignItems: "center",
                }}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t`Filter items, ${filterLabel}`}
                    onPress={() => setFilterOpen(true)}
                    style={{
                        minHeight: 48,
                        minWidth: 0,
                        flex: 1,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                    }}
                >
                    <ArrowDown size={16} color={colors.primary} />
                    <UnlockedText
                        numberOfLines={1}
                        style={{
                            minWidth: 0,
                            flexShrink: 1,
                            color: colors.primary,
                            fontSize: 13,
                        }}
                    >
                        {filterLabel}
                    </UnlockedText>
                    <UnlockedText style={{ color: colors.muted, fontSize: 11 }}>
                        {visible.length}
                    </UnlockedText>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t`Manage directories`}
                    onPress={() => router.push("/(app)/directories" as never)}
                    style={{
                        width: 48,
                        height: 48,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Folder size={20} color={colors.muted} strokeWidth={1.7} />
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t`Sort items`}
                    onPress={() => setSortOpen(true)}
                    style={{
                        width: 48,
                        height: 48,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Settings2
                        size={20}
                        color={colors.muted}
                        strokeWidth={1.7}
                    />
                </Pressable>
            </View>
            {selectedIDs.size ? (
                <View
                    style={{
                        minHeight: 48,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        paddingLeft: 12,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 6,
                        backgroundColor: colors.secondary,
                        marginBottom: 8,
                    }}
                >
                    <UnlockedText style={{ flex: 1, fontSize: 13 }}>
                        {t`${selectedCount} selected`}
                    </UnlockedText>
                    <Button
                        size="sm"
                        variant="ghost"
                        onPress={() =>
                            setSelectedIDs(
                                new Set(visible.map((item) => item.ID)),
                            )
                        }
                    >
                        {t({
                            message: "All",
                            comment: "Button: select all items",
                        })}
                    </Button>
                    {shareableSelection ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            onPress={() => {
                                setSelectedIDs(new Set());
                                router.push({
                                    pathname: "/(app)/share",
                                    params: { id: shareableSelection.ID },
                                });
                            }}
                        >
                            {t({
                                message: "Share",
                                comment: "Button: share the selected item",
                            })}
                        </Button>
                    ) : null}
                    <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => setMoveIDs(Array.from(selectedIDs))}
                    >
                        {t({
                            message: "Move",
                            comment:
                                "Button: move selected items to a directory",
                        })}
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => setSelectedIDs(new Set())}
                    >
                        {t({
                            message: "Clear",
                            comment: "Button: clear the selection",
                        })}
                    </Button>
                </View>
            ) : null}
        </View>
    );

    const empty = (
        <View
            style={{
                flexGrow: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 4,
                paddingVertical: 24,
            }}
        >
            <UnlockedText
                accessibilityRole="header"
                style={{
                    fontSize: 28,
                    fontWeight: "500",
                    letterSpacing: -0.8,
                    textAlign: "center",
                    marginBottom:
                        activeCredentials.length || sshFilter ? 0 : 28,
                }}
            >
                {sshFilter
                    ? t`No SSH keys yet.`
                    : activeCredentials.length
                      ? t`This directory is empty.`
                      : t`Your vault starts here.`}
            </UnlockedText>
            {activeCredentials.length || sshFilter ? (
                <UnlockedText
                    style={{
                        color: colors.muted,
                        fontSize: 14,
                        lineHeight: 23,
                        textAlign: "center",
                        marginTop: 12,
                        marginBottom: 28,
                    }}
                >
                    {sshFilter
                        ? t`Generate a new key or add one you already use.`
                        : t`Add a credential here, or move one from its item menu.`}
                </UnlockedText>
            ) : null}
            <Button
                className="h-[54px] w-full"
                textClassName="text-[#111520]"
                onPress={addCredential}
            >
                {sshFilter
                    ? t`Add SSH key`
                    : activeCredentials.length
                      ? t`Add item here`
                      : t`Add your first item`}
            </Button>
            {!activeCredentials.length && !sshFilter ? (
                <Button
                    variant="ghost"
                    className="mt-2 w-full"
                    onPress={() => router.push("/(app)/settings/import-export")}
                >
                    {t`Import passwords`}
                </Button>
            ) : null}
        </View>
    );

    return (
        <UnlockedScreen padded={false}>
            <View
                style={{ flex: 1, flexDirection: isTablet ? "row" : "column" }}
            >
                <View
                    style={
                        isTablet
                            ? {
                                  width: "42%",
                                  minWidth: 320,
                                  borderRightWidth: 1,
                                  borderRightColor: colors.border,
                              }
                            : { flex: 1 }
                    }
                >
                    <SectionList
                        sections={sections}
                        // Three screens of overscan each way bounds native row mounting.
                        windowSize={7}
                        keyExtractor={(item) => item.ID}
                        renderItem={renderRow}
                        renderSectionHeader={({ section }) => (
                            <View
                                style={{
                                    minHeight: 32,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 8,
                                    borderBottomWidth: 1,
                                    borderBottomColor: colors.border,
                                    backgroundColor: colors.background,
                                }}
                            >
                                <Folder
                                    size={14}
                                    color={colors.primary}
                                    strokeWidth={1.7}
                                />
                                <UnlockedText
                                    style={{
                                        flex: 1,
                                        color: colors.muted,
                                        fontSize: 11,
                                        letterSpacing: 1,
                                        textTransform: "uppercase",
                                    }}
                                >
                                    {section.name}
                                </UnlockedText>
                                <UnlockedText
                                    style={{
                                        color: colors.muted,
                                        fontSize: 11,
                                    }}
                                >
                                    {section.data.length}
                                </UnlockedText>
                            </View>
                        )}
                        ListHeaderComponent={toolbar}
                        ListEmptyComponent={empty}
                        stickySectionHeadersEnabled={false}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{
                            flexGrow: 1,
                            paddingHorizontal: 20,
                            paddingBottom: 24,
                        }}
                        showsVerticalScrollIndicator={false}
                    />
                </View>
                {isTablet ? (
                    <ScrollView
                        style={{ flex: 1 }}
                        contentContainerStyle={{
                            padding: 20,
                            paddingBottom: 32,
                        }}
                        showsVerticalScrollIndicator={false}
                    >
                        <CredentialDetailPanel
                            credential={selectedCredential}
                            directories={directories}
                            embedded
                            onEdit={(item) =>
                                router.push({
                                    pathname: "/(app)/(tabs)/vault/edit",
                                    params: { id: item.ID },
                                })
                            }
                            onDelete={deleteItem}
                        />
                    </ScrollView>
                ) : null}
            </View>

            <DirectoryFilterSheet
                open={filterOpen}
                onOpenChange={setFilterOpen}
                filter={filter}
                setFilter={(next) => {
                    setFilter(next);
                    router.setParams({ directoryId: next });
                }}
                counts={counts}
                directories={directories}
            />
            <AddItemSheet
                open={addOpen}
                onOpenChange={setAddOpen}
                directoryId={newItemDirectoryId(filter)}
            />
            <SortSheet
                open={sortOpen}
                onOpenChange={setSortOpen}
                sort={sort}
                setSort={setSort}
            />

            <Dialog
                open={moveIDs.length > 0}
                onOpenChange={(open) => !open && setMoveIDs([])}
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>{t`Move to directory`}</DialogTitle>
                    <DialogDescription>
                        {plural(moveCount, {
                            one: "Choose a destination for # item.",
                            other: "Choose a destination for # items.",
                        })}
                    </DialogDescription>
                </DialogHeader>
                <DirectoryChoice
                    label={t`No directory`}
                    onPress={() => void move("")}
                />
                {directories.map((directory) => (
                    <DirectoryChoice
                        key={directory.ID}
                        label={directory.Name}
                        onPress={() => void move(directory.ID)}
                    />
                ))}
            </Dialog>
        </UnlockedScreen>
    );
}

function DirectoryChoice({
    label,
    onPress,
}: {
    label: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            style={{
                minHeight: 58,
                justifyContent: "center",
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <UnlockedText style={{ fontSize: 14 }}>{label}</UnlockedText>
        </Pressable>
    );
}

function DirectoryFilterSheet({
    open,
    onOpenChange,
    filter,
    setFilter,
    counts,
    directories,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    filter: DirectoryFilter;
    setFilter: (filter: DirectoryFilter) => void;
    counts: Record<string, number>;
    directories: Array<{ ID: string; Name: string }>;
}) {
    const { t } = useLingui();
    const options = [
        {
            id: "all" as DirectoryFilter,
            name: t`All items`,
            count: counts.all ?? 0,
        },
        {
            id: SSH_KEYS_FILTER as DirectoryFilter,
            name: t`SSH keys`,
            count: counts[SSH_KEYS_FILTER] ?? 0,
        },
        {
            id: "root" as DirectoryFilter,
            name: t`No directory`,
            count: counts.root ?? 0,
        },
        ...directories.map((item) => ({
            id: item.ID,
            name: item.Name,
            count: counts[item.ID] ?? 0,
        })),
    ];
    return (
        <Dialog open={open} onOpenChange={onOpenChange} placement="bottom">
            <DialogHeader>
                <DialogTitle>{t`Filter items`}</DialogTitle>
            </DialogHeader>
            {options.map((item) => (
                <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: filter === item.id }}
                    onPress={() => {
                        setFilter(item.id);
                        onOpenChange(false);
                    }}
                    style={{
                        minHeight: 58,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                    }}
                >
                    {item.id === "all" ? (
                        <ShieldCheck
                            size={20}
                            color={
                                filter === item.id
                                    ? colors.primary
                                    : colors.muted
                            }
                        />
                    ) : item.id === SSH_KEYS_FILTER ? (
                        <FileKey
                            size={20}
                            color={
                                filter === item.id
                                    ? colors.primary
                                    : colors.muted
                            }
                        />
                    ) : (
                        <Folder
                            size={20}
                            color={
                                filter === item.id
                                    ? colors.primary
                                    : colors.muted
                            }
                        />
                    )}
                    <UnlockedText
                        style={{
                            flex: 1,
                            color:
                                filter === item.id
                                    ? colors.primary
                                    : colors.foreground,
                            fontSize: 14,
                        }}
                    >
                        {item.name}
                    </UnlockedText>
                    <UnlockedText style={{ color: colors.muted, fontSize: 12 }}>
                        {item.count}
                    </UnlockedText>
                    {filter === item.id ? (
                        <Check size={18} color={colors.primary} />
                    ) : (
                        <ChevronRight size={17} color={colors.muted} />
                    )}
                </Pressable>
            ))}
            <Button
                variant="ghost"
                className="mt-2"
                onPress={() => {
                    onOpenChange(false);
                    router.push("/(app)/directories" as never);
                }}
            >
                {t`Manage directories`}
            </Button>
        </Dialog>
    );
}

function SortSheet({
    open,
    onOpenChange,
    sort,
    setSort,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sort: CredentialSort;
    setSort: (sort: CredentialSort) => void;
}) {
    const { t } = useLingui();
    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            placement="bottom"
            modal={false}
        >
            <DialogHeader>
                <DialogTitle>{t`Sort items`}</DialogTitle>
            </DialogHeader>
            {SORT_OPTIONS.map((option) => (
                <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: sort === option.value }}
                    onPress={() => {
                        onOpenChange(false);
                        // Start dismissal before the lower-priority list reorder.
                        startTransition(() => setSort(option.value));
                    }}
                    style={{
                        minHeight: 58,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                    }}
                >
                    <ArrowUpDown
                        size={19}
                        color={
                            sort === option.value
                                ? colors.primary
                                : colors.muted
                        }
                    />
                    <UnlockedText
                        style={{
                            flex: 1,
                            color:
                                sort === option.value
                                    ? colors.primary
                                    : colors.foreground,
                            fontSize: 14,
                        }}
                    >
                        {t(option.label)}
                    </UnlockedText>
                    {sort === option.value ? (
                        <Check size={18} color={colors.primary} />
                    ) : null}
                </Pressable>
            ))}
        </Dialog>
    );
}

const VaultRow = memo(function VaultRow({
    item,
    selected,
    onSelect,
    onLongPress,
}: {
    item: VaultCredential;
    selected: boolean;
    onSelect: (item: VaultCredential) => void;
    onLongPress: (id: string) => void;
}) {
    const { t } = useLingui();
    const sshKey = isSSHKeyItem(item);
    const passkeyUser = item.Passkey?.UserDisplayName || item.Passkey?.UserName;
    const secondary = sshKey
        ? sshKeySummary(item)
        : item.Type === ItemType.Passkey && item.Passkey
          ? t`Passkey: ${passkeyUser}`
          : item.Username || (item.Notes ? t`Secure note` : t`No username`);
    const name = item.Name || t`Untitled`;
    return (
        <View
            style={{
                minHeight: 72,
                flexDirection: "row",
                alignItems: "center",
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t`${name}, ${secondary}`}
                accessibilityHint={t`Opens item details. Hold to select.`}
                onPress={() => onSelect(item)}
                onLongPress={() => onLongPress(item.ID)}
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
                        backgroundColor: selected
                            ? colors.primary
                            : colors.secondary,
                        borderWidth: 1,
                        borderColor: selected
                            ? colors.primary
                            : "rgba(255,255,255,0.03)",
                    }}
                >
                    {selected ? (
                        <Check size={17} color={colors.navigation} />
                    ) : sshKey ? (
                        <FileKey
                            size={17}
                            color={colors.primary}
                            strokeWidth={1.8}
                        />
                    ) : (
                        <UnlockedText
                            style={{
                                color:
                                    item.Type === ItemType.Passkey
                                        ? colors.primary
                                        : colors.foreground,
                                fontWeight: "700",
                                fontSize: 13,
                            }}
                        >
                            {initials(item.Name)}
                        </UnlockedText>
                    )}
                </View>
                <View style={{ minWidth: 0, flex: 1 }}>
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 7,
                        }}
                    >
                        <UnlockedText
                            numberOfLines={1}
                            style={{
                                minWidth: 0,
                                flexShrink: 1,
                                fontSize: 15,
                                fontWeight: "600",
                            }}
                        >
                            {name}
                        </UnlockedText>
                        {item.TOTP?.Secret ? (
                            <Key size={12} color={colors.primary} />
                        ) : null}
                    </View>
                    <UnlockedText
                        numberOfLines={1}
                        style={{
                            color: colors.muted,
                            fontSize: 12,
                            marginTop: 5,
                        }}
                    >
                        {secondary}
                    </UnlockedText>
                </View>
            </Pressable>
            {sshKey && item.SSHKey ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        item.Name
                            ? t`Copy ${name} public key`
                            : t`Copy item public key`
                    }
                    onPress={() =>
                        void copyTextToClipboard(sshPublicKeyLine(item.SSHKey!))
                    }
                    android_ripple={{ color: colors.border }}
                    style={{
                        width: 48,
                        height: 48,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Copy size={20} color={colors.muted} strokeWidth={1.7} />
                </Pressable>
            ) : item.Password ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        item.Name
                            ? t`Copy ${name} password`
                            : t`Copy item password`
                    }
                    onPress={() => void copySecretToClipboard(item.Password)}
                    android_ripple={{ color: colors.border }}
                    style={{
                        width: 48,
                        height: 48,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Copy size={20} color={colors.muted} strokeWidth={1.7} />
                </Pressable>
            ) : (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        item.Name ? t`View ${name}` : t`View item`
                    }
                    onPress={() => onSelect(item)}
                    android_ripple={{ color: colors.border }}
                    style={{
                        width: 48,
                        height: 48,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <ChevronRight size={18} color={colors.muted} />
                </Pressable>
            )}
        </View>
    );
});
