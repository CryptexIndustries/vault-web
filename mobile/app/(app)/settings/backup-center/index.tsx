import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";
import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { i18n } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import { Archive, Cloud, KeyRound } from "lucide-react-native";
import * as FileSystem from "expo-file-system/legacy";
import { writeSecretTempFile } from "@/utils/secret-temp-files";
import { useSecretRelease } from "@/utils/secret-release";
import { shareSecretFile } from "@/utils/secret-share";

import { trpcReact } from "@/utils/trpc";
import { uint8ToBase64 } from "@cryptex-industries/vault-core/encoding";
import { managedBackupCoordinator } from "@/app_lib/managed-backup-coordinator";
import { downloadBackupBytes } from "@/app_lib/managed-backups";
import {
    UnlockedButton as Button,
    UnlockedMenuRow,
    UnlockedTaskScreen,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { UnlockedDialogTitle } from "@/components/unlocked/unlocked-ui";
import { Switch } from "@/components/ui/switch";
import { InlineNotice } from "@/components/inline-notice";
import { colors } from "@/theme";

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KiB`;
    const size = (bytes / 1024 ** 2).toLocaleString(i18n.locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });
    return `${size} MiB`;
}

export function BackupCenterScreen({
    view = "center",
}: {
    view?: "center" | "history";
}) {
    const { t } = useLingui();
    const confirm = useUnlockedConfirmation();
    const utils = trpcReact.useUtils();
    const status = trpcReact.v1.backup.status.useQuery();
    const history = trpcReact.v1.backup.list.useInfiniteQuery(
        { cursor: undefined },
        {
            enabled:
                status.data?.storageConfigured === true &&
                (status.data.entitled ||
                    (!!status.data.graceExpiresAt &&
                        new Date(status.data.graceExpiresAt) > new Date())),
            getNextPageParam: (page) => page.nextCursor ?? undefined,
        },
    );
    const enable = trpcReact.v1.backup.enable.useMutation();
    const disable = trpcReact.v1.backup.disable.useMutation();
    const remove = trpcReact.v1.backup.delete.useMutation();
    const removeAll = trpcReact.v1.backup.deleteAll.useMutation();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
        null,
    );

    const refresh = () =>
        Promise.all([
            utils.v1.backup.status.invalidate(),
            utils.v1.backup.list.invalidate(),
        ]);

    const enableBackups = async () => {
        setBusy(true);
        setMessage("");
        try {
            await enable.mutateAsync();
            managedBackupCoordinator.setEnabled(true);
            await managedBackupCoordinator.backupNow();
            await refresh();
            setMessage(t`Managed encrypted backups enabled.`);
        } catch (error) {
            setMessage(
                error instanceof Error
                    ? error.message
                    : t`Could not enable backups.`,
            );
        } finally {
            setBusy(false);
        }
    };

    const pauseBackups = async () => {
        setBusy(true);
        setMessage("");
        try {
            await disable.mutateAsync();
            managedBackupCoordinator.setEnabled(false);
            await refresh();
            setMessage(t`Automatic backups paused. Existing history remains.`);
        } catch (error) {
            setMessage(
                error instanceof Error
                    ? error.message
                    : t`Could not pause automatic backups.`,
            );
        } finally {
            setBusy(false);
        }
    };

    const backupNow = async () => {
        setBusy(true);
        setMessage("");
        try {
            await managedBackupCoordinator.backupNow();
            await refresh();
            setMessage(t`Encrypted backup uploaded.`);
        } catch (error) {
            setMessage(
                error instanceof Error ? error.message : t`Backup failed.`,
            );
        } finally {
            setBusy(false);
        }
    };

    // A downloaded backup on its way to the share sheet; a lock or leaving stops it.
    const startDownloadRelease = useSecretRelease();

    const download = async (snapshotId: string) => {
        const release = startDownloadRelease();
        setBusy(true);
        setMessage("");
        try {
            const result = await downloadBackupBytes(snapshotId);
            const shared = await shareSecretFile(
                () =>
                    writeSecretTempFile(
                        "cryx",
                        uint8ToBase64(result.bytes),
                        FileSystem.EncodingType.Base64,
                    ),
                {
                    isCurrent: release.current,
                    mimeType: "application/octet-stream",
                },
            );
            if (shared === "shared") setMessage(t`Encrypted backup ready.`);
            else if (shared === "unavailable")
                setMessage(t`Sharing is unavailable on this device.`);
        } catch (error) {
            setMessage(
                error instanceof Error ? error.message : t`Download failed.`,
            );
        } finally {
            setBusy(false);
        }
    };

    const entitled =
        status.data?.entitled ||
        (!!status.data?.graceExpiresAt &&
            new Date(status.data.graceExpiresAt) > new Date());
    const historyItems =
        history.data?.pages.flatMap((page) => page.items) ?? [];

    const selectedSnapshot = historyItems.find(
        (snapshot) => snapshot.id === selectedSnapshotId,
    );

    const confirmDelete = (snapshotId: string) =>
        confirm({
            title: t`Delete backup`,
            description: t`Permanently delete this encrypted backup?`,
            cancelLabel: t`Cancel`,
            confirmLabel: t`Delete`,
            onConfirm: () => {
                setMessage("");
                void remove
                    .mutateAsync({ snapshotId })
                    .then(refresh)
                    .then(() => setMessage(t`Backup deleted.`))
                    .catch((error: unknown) =>
                        setMessage(
                            error instanceof Error
                                ? error.message
                                : t`Could not delete backup.`,
                        ),
                    );
            },
        });

    const confirmDeleteAll = () =>
        confirm({
            title: t`Delete all backups`,
            description: t`Permanently delete every managed backup for this vault?`,
            cancelLabel: t`Cancel`,
            confirmLabel: t`Delete all`,
            onConfirm: () => {
                setMessage("");
                void removeAll
                    .mutateAsync()
                    .then(refresh)
                    .then(() => setMessage(t`All backups deleted.`))
                    .catch((error: unknown) =>
                        setMessage(
                            error instanceof Error
                                ? error.message
                                : t`Could not delete backups.`,
                        ),
                    );
            },
        });

    if (view === "history") {
        return (
            <UnlockedTaskScreen title={t`Backup history`}>
                {historyItems.length ? (
                    <>
                        <View
                            style={{
                                paddingBottom: 22,
                                marginBottom: 6,
                                borderBottomWidth: 1,
                                borderBottomColor: colors.border,
                            }}
                        >
                            <UnlockedText
                                style={{
                                    fontSize: 22,
                                    fontWeight: "500",
                                    marginTop: 10,
                                    marginBottom: 6,
                                }}
                            >
                                {t`Encrypted snapshots`}
                            </UnlockedText>
                            <UnlockedText
                                style={{
                                    fontSize: 13,
                                    lineHeight: 20,
                                    color: colors.muted,
                                }}
                            >
                                {t`Download a snapshot to restore it, or remove copies you no longer need.`}
                            </UnlockedText>
                        </View>
                        {historyItems.map((snapshot) => (
                            <UnlockedMenuRow
                                key={snapshot.id}
                                icon={Archive}
                                title={new Date(
                                    snapshot.createdAt,
                                ).toLocaleString(i18n.locale, {
                                    month: "long",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                })}
                                subtitle={`${snapshot.sourceLabel} (${formatBytes(snapshot.byteLength)})`}
                                onPress={() => {
                                    setMessage("");
                                    setSelectedSnapshotId(snapshot.id);
                                }}
                            />
                        ))}
                        <View style={{ marginTop: 24, gap: 10 }}>
                            {history.hasNextPage ? (
                                <Button
                                    variant="outline"
                                    loading={history.isFetchingNextPage}
                                    onPress={() => void history.fetchNextPage()}
                                >
                                    {t`Load older backups`}
                                </Button>
                            ) : null}
                            <Button
                                variant="destructive"
                                disabled={busy || removeAll.isPending}
                                onPress={confirmDeleteAll}
                            >
                                {t`Delete all backups`}
                            </Button>
                        </View>
                    </>
                ) : history.isLoading ? (
                    <InlineNotice
                        tone="loading"
                        message={t`Loading saved backups…`}
                    />
                ) : history.isError ? (
                    <InlineNotice
                        tone="error"
                        message={t`Saved backups could not be loaded.`}
                    />
                ) : (
                    <>
                        <View style={{ paddingVertical: 28 }}>
                            <Archive
                                size={32}
                                color={colors.muted}
                                strokeWidth={1.7}
                                style={{ marginBottom: 20 }}
                            />
                            <UnlockedText
                                style={{
                                    fontSize: 22,
                                    fontWeight: "500",
                                    marginBottom: 10,
                                }}
                            >
                                {t`No managed backups`}
                            </UnlockedText>
                            <UnlockedText
                                style={{
                                    fontSize: 13,
                                    lineHeight: 20,
                                    color: colors.muted,
                                }}
                            >
                                {t`Your next managed backup will appear here.`}
                            </UnlockedText>
                        </View>
                        <Button
                            className="mt-6"
                            loading={busy}
                            onPress={() => void backupNow()}
                        >
                            {t`Back up now`}
                        </Button>
                    </>
                )}
                <Dialog
                    open={!!selectedSnapshot}
                    onOpenChange={(open) =>
                        !open && setSelectedSnapshotId(null)
                    }
                    placement="bottom"
                    scroll
                    dismissible={!busy}
                >
                    <DialogHeader>
                        <UnlockedDialogTitle>
                            {t`Encrypted snapshot`}
                        </UnlockedDialogTitle>
                    </DialogHeader>
                    {selectedSnapshot ? (
                        <>
                            <View>
                                {[
                                    [
                                        t({
                                            message: "Created",
                                            comment:
                                                "Backup detail row: creation time",
                                        }),
                                        new Date(
                                            selectedSnapshot.createdAt,
                                        ).toLocaleString(i18n.locale),
                                    ],
                                    [
                                        t({
                                            message: "Source",
                                            comment:
                                                "Backup detail row: device that made the backup",
                                        }),
                                        selectedSnapshot.sourceLabel,
                                    ],
                                    [
                                        t({
                                            message: "Size",
                                            comment:
                                                "Backup detail row: file size",
                                        }),
                                        formatBytes(
                                            selectedSnapshot.byteLength,
                                        ),
                                    ],
                                ].map(([label, value]) => (
                                    <View
                                        key={label}
                                        style={{
                                            flexDirection: "row",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: 20,
                                            paddingVertical: 16,
                                            borderBottomWidth: 1,
                                            borderBottomColor: colors.border,
                                        }}
                                    >
                                        <UnlockedText
                                            style={{
                                                fontSize: 13,
                                                color: colors.muted,
                                            }}
                                        >
                                            {label}
                                        </UnlockedText>
                                        <UnlockedText
                                            style={{
                                                fontSize: 13,
                                                maxWidth: "65%",
                                                textAlign: "right",
                                            }}
                                        >
                                            {value}
                                        </UnlockedText>
                                    </View>
                                ))}
                            </View>
                            <View style={{ marginTop: 24, gap: 10 }}>
                                <Button
                                    variant="outline"
                                    loading={busy}
                                    onPress={() =>
                                        void download(selectedSnapshot.id)
                                    }
                                >
                                    {t`Download backup`}
                                </Button>
                                <Button
                                    variant="destructive"
                                    disabled={busy || remove.isPending}
                                    onPress={() => {
                                        setSelectedSnapshotId(null);
                                        confirmDelete(selectedSnapshot.id);
                                    }}
                                >
                                    {t`Delete backup`}
                                </Button>
                            </View>
                        </>
                    ) : null}
                    {message ? (
                        <InlineNotice tone="info" message={message} />
                    ) : null}
                </Dialog>
                {message ? (
                    <InlineNotice tone="info" message={message} />
                ) : null}
            </UnlockedTaskScreen>
        );
    }

    return (
        <UnlockedTaskScreen title={t`Backup Center`}>
            <View
                style={{
                    paddingBottom: 22,
                    marginBottom: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                }}
            >
                <UnlockedText
                    style={{ fontSize: 22, fontWeight: "500", marginTop: 10 }}
                >
                    {t`Your backups`}
                </UnlockedText>
                <UnlockedText className="mt-[6px] text-[13px] leading-5 text-muted-foreground">
                    {t`Keep a recent encrypted copy and your recovery code available.`}
                </UnlockedText>
            </View>
            <View
                style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    gap: 20,
                    paddingVertical: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                }}
            >
                <UnlockedText style={{ fontSize: 13, color: colors.muted }}>
                    {t`Latest managed backup`}
                </UnlockedText>
                <UnlockedText
                    style={{
                        fontSize: 13,
                        maxWidth: "65%",
                        textAlign: "right",
                    }}
                >
                    {historyItems[0]
                        ? new Date(historyItems[0].createdAt).toLocaleString(
                              i18n.locale,
                          )
                        : status.isLoading || history.isLoading
                          ? t`Checking…`
                          : status.isError || history.isError
                            ? t({
                                  message: "Unavailable",
                                  comment:
                                      "Latest managed backup could not be loaded",
                              })
                            : t`No managed backup yet`}
                </UnlockedText>
            </View>
            <UnlockedMenuRow
                icon={Archive}
                title={t`Create local backup`}
                subtitle={t`Export an encrypted .cryx file`}
                onPress={() =>
                    router.push({
                        pathname: "/(app)/settings/import-export",
                        params: { pane: "encrypted" },
                    })
                }
            />
            <UnlockedMenuRow
                icon={KeyRound}
                title={t`Vault recovery code`}
                subtitle={t`Review recovery and replace your code`}
                onPress={() =>
                    router.push({
                        pathname: "/(app)/settings/security/action",
                        params: { mode: "recovery" },
                    })
                }
            />
            {status.isLoading ? (
                <InlineNotice
                    tone="loading"
                    message={t`Checking managed backup status…`}
                />
            ) : status.isError ? (
                <InlineNotice
                    tone="error"
                    message={t`Managed backup status is unavailable.`}
                />
            ) : !status.data?.storageConfigured ? (
                <InlineNotice
                    tone="info"
                    message={t`Managed backup storage is not configured by this service.`}
                />
            ) : !entitled ? (
                <InlineNotice
                    tone="info"
                    message={t`Managed backups require an eligible subscription. Open Membership in Account to upgrade.`}
                />
            ) : (
                <View className="mb-0">
                    <UnlockedText
                        style={{
                            color: colors.muted,
                            fontSize: 11,
                            letterSpacing: 1,
                            marginTop: 26,
                            marginBottom: 6,
                            textTransform: "uppercase",
                        }}
                    >
                        {t`Managed backups`}
                    </UnlockedText>
                    <View className="min-h-[70px] flex-row items-center justify-between gap-3 border-b border-border">
                        <View className="flex-1">
                            <UnlockedText className="text-sm text-foreground">
                                {t`Automatic backups`}
                            </UnlockedText>
                            <UnlockedText className="mt-1 text-xs text-muted-foreground">
                                {t`Store encrypted snapshots using Online Services.`}
                            </UnlockedText>
                        </View>
                        <Switch
                            value={status.data.enabled}
                            disabled={busy}
                            onValueChange={(enabled) =>
                                void (enabled
                                    ? enableBackups()
                                    : pauseBackups())
                            }
                            accessibilityLabel={t`Automatic managed backups`}
                        />
                    </View>
                </View>
            )}

            {message ? <InlineNotice tone="info" message={message} /> : null}
            {status.data?.storageConfigured && entitled ? (
                <UnlockedMenuRow
                    icon={Cloud}
                    title={t`Backup history`}
                    subtitle={t`Download or remove saved snapshots`}
                    onPress={() => {
                        setMessage("");
                        router.push("/(app)/settings/backup-center/history");
                    }}
                />
            ) : null}
            {status.data?.storageConfigured && entitled ? (
                <Button
                    className="mt-6"
                    variant="outline"
                    loading={busy}
                    onPress={() => void backupNow()}
                >
                    {t`Back up now`}
                </Button>
            ) : null}
        </UnlockedTaskScreen>
    );
}

export default function BackupCenterRoute() {
    return <BackupCenterScreen />;
}
