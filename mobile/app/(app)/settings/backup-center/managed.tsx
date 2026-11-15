import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useAtomValue } from "jotai";
import { useLingui } from "@lingui/react/macro";
import { Archive, Cloud, CloudAlert, CloudOff } from "lucide-react-native";
import * as FileSystem from "expo-file-system/legacy";
import { uint8ToBase64 } from "@cryptex-industries/vault-core/encoding";

import {
    managedBackupCoordinator,
    managedBackupFailureAtom,
} from "@/app_lib/managed-backup-coordinator";
import { downloadBackupBytes } from "@/app_lib/managed-backups";
import { AgentSectionLabel } from "@/components/agents/agent-rows";
import {
    BackupStatusHeader,
    StorageMeter,
    formatBackupTime,
    formatBytes,
    managedFailureKind,
    managedFailureTitle,
} from "@/components/backup-center/backup-status";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";
import { useUnlockedSnackbar } from "@/components/unlocked/unlocked-snackbar";
import {
    UnlockedButton as Button,
    UnlockedDialogTitle,
    UnlockedMenuRow,
    UnlockedSwitchRow,
    UnlockedTaskScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";
import { vaultStore } from "@/utils/atoms";
import { trpcReact } from "@/utils/trpc";
import { writeSecretTempFile } from "@/utils/secret-temp-files";
import { useSecretRelease } from "@/utils/secret-release";
import { shareSecretFile } from "@/utils/secret-share";

export default function ManagedBackupsRoute() {
    const { t, i18n } = useLingui();
    const confirm = useUnlockedConfirmation();
    const showSnackbar = useUnlockedSnackbar();
    const utils = trpcReact.useUtils();
    const status = trpcReact.v1.backup.status.useQuery();
    const entitled =
        status.data?.entitled ||
        (!!status.data?.graceExpiresAt &&
            new Date(status.data.graceExpiresAt) > new Date());
    const available = status.data?.storageConfigured === true && entitled;
    const history = trpcReact.v1.backup.list.useInfiniteQuery(
        { cursor: undefined },
        {
            enabled: available,
            getNextPageParam: (page) => page.nextCursor ?? undefined,
        },
    );
    const enable = trpcReact.v1.backup.enable.useMutation();
    const disable = trpcReact.v1.backup.disable.useMutation();
    const remove = trpcReact.v1.backup.delete.useMutation();
    const removeAll = trpcReact.v1.backup.deleteAll.useMutation();
    const failure = useAtomValue(managedBackupFailureAtom);
    const [busy, setBusy] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    // A downloaded backup on its way to the share sheet; a lock or leaving stops it.
    const startDownloadRelease = useSecretRelease();

    const refresh = () =>
        Promise.all([
            utils.v1.backup.status.invalidate(),
            utils.v1.backup.list.invalidate(),
        ]);

    // Deleting makes room, so a backup refused for space is retried at once.
    const refreshAfterDelete = async () => {
        if (vaultStore.get(managedBackupFailureAtom))
            await managedBackupCoordinator.backupNow().catch(() => undefined);
        await refresh();
    };

    const run = async (
        work: () => Promise<string | undefined>,
        fallback: string,
    ) => {
        setBusy(true);
        try {
            const done = await work();
            if (done) showSnackbar(done);
        } catch (error) {
            showSnackbar(error instanceof Error ? error.message : fallback);
        } finally {
            setBusy(false);
        }
    };

    const setEnabled = (enabled: boolean) =>
        run(
            async () => {
                if (enabled) {
                    await enable.mutateAsync();
                    managedBackupCoordinator.setEnabled(true);
                    await managedBackupCoordinator.backupNow();
                } else {
                    await disable.mutateAsync();
                    managedBackupCoordinator.setEnabled(false);
                }
                await refresh();
                return enabled
                    ? t`Managed encrypted backups enabled.`
                    : t`Automatic backups paused. Existing history remains.`;
            },
            enabled
                ? t`Could not enable backups.`
                : t`Could not pause automatic backups.`,
        );

    const backupNow = () =>
        run(async () => {
            try {
                await managedBackupCoordinator.backupNow();
            } catch (error) {
                // The status header explains a failed upload.
                if (vaultStore.get(managedBackupFailureAtom))
                    return t`Backup failed.`;
                throw error;
            } finally {
                await refresh();
            }
            return t`Encrypted backup uploaded.`;
        }, t`Backup failed.`);

    const download = (snapshotId: string) => {
        const release = startDownloadRelease();
        return run(async () => {
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
            if (shared === "unavailable")
                return t`Sharing is unavailable on this device.`;
            if (shared !== "shared") return undefined;
            setSelectedId(null);
            return t`Encrypted backup ready.`;
        }, t`Download failed.`);
    };

    const items = history.data?.pages.flatMap((page) => page.items) ?? [];
    const selected = items.find((snapshot) => snapshot.id === selectedId);

    const confirmDelete = (snapshotId: string) =>
        confirm({
            title: t`Delete backup`,
            description: t`Permanently delete this encrypted backup?`,
            cancelLabel: t`Cancel`,
            confirmLabel: t`Delete`,
            onConfirm: () =>
                void run(async () => {
                    await remove.mutateAsync({ snapshotId });
                    await refreshAfterDelete();
                    return t`Backup deleted.`;
                }, t`Could not delete backup.`),
        });

    const confirmDeleteAll = () =>
        confirm({
            title: t`Delete all backups`,
            description: t`Permanently delete every managed backup for this vault?`,
            cancelLabel: t`Cancel`,
            confirmLabel: t`Delete all`,
            onConfirm: () =>
                void run(async () => {
                    await removeAll.mutateAsync();
                    await refreshAfterDelete();
                    return t`All backups deleted.`;
                }, t`Could not delete backups.`),
        });

    if (!available || !status.data) {
        return (
            <UnlockedTaskScreen title={t`Managed backups`}>
                <BackupStatusHeader
                    icon={status.isLoading ? Cloud : CloudOff}
                    tone="neutral"
                    title={
                        status.isLoading
                            ? t`Checking managed backup status…`
                            : status.isError
                              ? t`Managed backup status is unavailable.`
                              : t`Managed backups are not available`
                    }
                    body={
                        status.isLoading || status.isError
                            ? undefined
                            : !status.data?.storageConfigured
                              ? t`Managed backup storage is not configured by this service.`
                              : t`Managed backups require an eligible subscription. Open Membership in Account to upgrade.`
                    }
                >
                    {status.data?.storageConfigured && !entitled ? (
                        <Button
                            className="mt-6"
                            onPress={() =>
                                router.navigate("/(app)/(tabs)/account")
                            }
                        >
                            {t`Open Account`}
                        </Button>
                    ) : null}
                </BackupStatusHeader>
            </UnlockedTaskScreen>
        );
    }

    const kind = managedFailureKind(failure, status.data);
    const when = status.data.latestReadyAt
        ? formatBackupTime(i18n, status.data.latestReadyAt)
        : null;

    return (
        <UnlockedTaskScreen
            title={t`Managed backups`}
            footer={
                <Button
                    loading={busy}
                    disabled={!status.data.enabled}
                    onPress={() => void backupNow()}
                >
                    {t`Back up now`}
                </Button>
            }
        >
            {kind ? (
                <BackupStatusHeader
                    icon={CloudAlert}
                    tone="attention"
                    title={managedFailureTitle(i18n, kind)}
                    body={
                        kind === "full"
                            ? when
                                ? t`Changes since ${when} are not backed up. Delete older backups below to make room.`
                                : t`Delete older backups below to make room.`
                            : kind === "too-large"
                              ? t`One backup can be up to ${formatBytes(status.data.maxSnapshotBytes, i18n.locale)}. Export a backup file or add your own storage instead.`
                              : failure?.message
                    }
                >
                    <StorageMeter
                        i18n={i18n}
                        status={status.data}
                        full={kind === "full"}
                    />
                </BackupStatusHeader>
            ) : (
                <BackupStatusHeader
                    icon={status.data.enabled ? Cloud : CloudOff}
                    tone={status.data.enabled ? "positive" : "neutral"}
                    title={
                        status.data.enabled
                            ? t`Backing up every change`
                            : t`Automatic backups are off`
                    }
                    body={
                        when
                            ? t`Last backup ${when}`
                            : t`No managed backup yet`
                    }
                >
                    <StorageMeter
                        i18n={i18n}
                        status={status.data}
                        full={false}
                    />
                </BackupStatusHeader>
            )}
            <View style={{ paddingVertical: 14 }}>
                <UnlockedSwitchRow
                    testID="managed-backups-switch"
                    label={t`Automatic backups`}
                    hint={t`Store encrypted snapshots using Online Services.`}
                    value={status.data.enabled}
                    disabled={busy}
                    onValueChange={(enabled) => void setEnabled(enabled)}
                />
            </View>
            <AgentSectionLabel
                title={t`Backup history`}
                right={
                    status.data.versionCount
                        ? String(status.data.versionCount)
                        : undefined
                }
                style={{
                    marginTop: 0,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    paddingTop: 14,
                }}
            />
            {items.map((snapshot) => (
                <UnlockedMenuRow
                    key={snapshot.id}
                    icon={Archive}
                    title={new Date(snapshot.createdAt).toLocaleString(
                        i18n.locale,
                        {
                            month: "long",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                        },
                    )}
                    subtitle={`${snapshot.sourceLabel} (${formatBytes(snapshot.byteLength, i18n.locale)})`}
                    onPress={() => setSelectedId(snapshot.id)}
                />
            ))}
            {!items.length ? (
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 13,
                        lineHeight: 20,
                        paddingVertical: 14,
                    }}
                >
                    {history.isLoading
                        ? t`Loading saved backups…`
                        : history.isError
                          ? t`Saved backups could not be loaded.`
                          : t`Your next managed backup will appear here.`}
                </Text>
            ) : (
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
                        disabled={busy}
                        onPress={confirmDeleteAll}
                    >
                        {t`Delete all backups`}
                    </Button>
                </View>
            )}
            <Dialog
                open={!!selected}
                onOpenChange={(open) => !open && setSelectedId(null)}
                placement="bottom"
                scroll
                dismissible={!busy}
            >
                <DialogHeader>
                    <UnlockedDialogTitle>
                        {t`Encrypted snapshot`}
                    </UnlockedDialogTitle>
                </DialogHeader>
                {selected ? (
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
                                        selected.createdAt,
                                    ).toLocaleString(i18n.locale),
                                ],
                                [
                                    t({
                                        message: "Source",
                                        comment:
                                            "Backup detail row: device that made the backup",
                                    }),
                                    selected.sourceLabel,
                                ],
                                [
                                    t({
                                        message: "Size",
                                        comment: "Backup detail row: file size",
                                    }),
                                    formatBytes(
                                        selected.byteLength,
                                        i18n.locale,
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
                                    <Text
                                        style={{
                                            fontSize: 13,
                                            color: colors.muted,
                                        }}
                                    >
                                        {label}
                                    </Text>
                                    <Text
                                        style={{
                                            fontSize: 13,
                                            maxWidth: "65%",
                                            textAlign: "right",
                                        }}
                                    >
                                        {value}
                                    </Text>
                                </View>
                            ))}
                        </View>
                        <View style={{ marginTop: 24, gap: 10 }}>
                            <Button
                                variant="outline"
                                loading={busy}
                                onPress={() => void download(selected.id)}
                            >
                                {t`Download backup`}
                            </Button>
                            <Button
                                variant="destructive"
                                disabled={busy}
                                onPress={() => {
                                    setSelectedId(null);
                                    confirmDelete(selected.id);
                                }}
                            >
                                {t`Delete backup`}
                            </Button>
                        </View>
                    </>
                ) : null}
            </Dialog>
        </UnlockedTaskScreen>
    );
}
