import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";
import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Archive, Cloud, KeyRound } from "lucide-react-native";
import * as FileSystem from "expo-file-system/legacy";
import { deleteAppOwnedTempFile, writeSecretTempFile } from "@/utils/secret-temp-files";
import * as Sharing from "expo-sharing";

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
    return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

export function BackupCenterScreen({
    view = "center",
}: {
    view?: "center" | "history";
}) {
    const confirm = useUnlockedConfirmation();
    const utils = trpcReact.useUtils();
    const status = trpcReact.v1.backup.status.useQuery();
    const history = trpcReact.v1.backup.list.useInfiniteQuery(
        { cursor: undefined },
        {
            enabled: status.data?.storageConfigured === true && (
                status.data.entitled || !!status.data.graceExpiresAt && new Date(status.data.graceExpiresAt) > new Date()
            ),
            getNextPageParam: (page) => page.nextCursor ?? undefined,
        },
    );
    const enable = trpcReact.v1.backup.enable.useMutation();
    const disable = trpcReact.v1.backup.disable.useMutation();
    const remove = trpcReact.v1.backup.delete.useMutation();
    const removeAll = trpcReact.v1.backup.deleteAll.useMutation();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);

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
            setMessage("Managed encrypted backups enabled.");
        } catch (error) {
            setMessage(
                error instanceof Error
                    ? error.message
                    : "Could not enable backups.",
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
            setMessage("Automatic backups paused. Existing history remains.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not pause automatic backups.");
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
            setMessage("Encrypted backup uploaded.");
        } catch (error) {
            setMessage(
                error instanceof Error ? error.message : "Backup failed.",
            );
        } finally {
            setBusy(false);
        }
    };

    const download = async (snapshotId: string) => {
        setBusy(true);
        setMessage("");
        let path: string | undefined;
        try {
            const result = await downloadBackupBytes(snapshotId);
            path = await writeSecretTempFile(
                "cryx",
                uint8ToBase64(result.bytes),
                FileSystem.EncodingType.Base64,
            );
            await Sharing.shareAsync(path, {
                mimeType: "application/octet-stream",
            });
            setMessage("Encrypted backup ready.");
        } catch (error) {
            setMessage(
                error instanceof Error ? error.message : "Download failed.",
            );
        } finally {
            if (path) await deleteAppOwnedTempFile(path).catch(() => undefined);
            setBusy(false);
        }
    };

    const entitled =
        status.data?.entitled ||
        (!!status.data?.graceExpiresAt &&
            new Date(status.data.graceExpiresAt) > new Date());
    const historyItems =
        history.data?.pages.flatMap((page) => page.items) ?? [];

    const selectedSnapshot = historyItems.find((snapshot) => snapshot.id === selectedSnapshotId);

    const confirmDelete = (snapshotId: string) =>
        confirm({
            title: "Delete backup",
            description: "Permanently delete this encrypted backup?",
            cancelLabel: "Cancel",
            confirmLabel: "Delete",
            onConfirm: () => {
                setMessage("");
                void remove
                    .mutateAsync({ snapshotId })
                    .then(refresh)
                    .then(() => setMessage("Backup deleted."))
                    .catch((error: unknown) =>
                        setMessage(
                            error instanceof Error
                                ? error.message
                                : "Could not delete backup.",
                        ),
                    );
            },
        });

    const confirmDeleteAll = () =>
        confirm({
            title: "Delete all backups",
            description:
                "Permanently delete every managed backup for this vault?",
            cancelLabel: "Cancel",
            confirmLabel: "Delete all",
            onConfirm: () => {
                setMessage("");
                void removeAll
                    .mutateAsync()
                    .then(refresh)
                    .then(() => setMessage("All backups deleted."))
                    .catch((error: unknown) =>
                        setMessage(
                            error instanceof Error
                                ? error.message
                                : "Could not delete backups.",
                        ),
                    );
            },
        });

    if (view === "history") {
        return (
            <UnlockedTaskScreen title="Backup history">
                {historyItems.length ? <>
                    <View style={{ paddingBottom: 22, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <UnlockedText style={{ fontSize: 22, fontWeight: "500", marginTop: 10, marginBottom: 6 }}>
                            Encrypted snapshots
                        </UnlockedText>
                        <UnlockedText style={{ fontSize: 13, lineHeight: 20, color: colors.muted }}>
                            Download a snapshot to restore it, or remove copies you no longer need.
                        </UnlockedText>
                    </View>
                    {historyItems.map((snapshot) => (
                        <UnlockedMenuRow
                            key={snapshot.id}
                            icon={Archive}
                            title={new Date(snapshot.createdAt).toLocaleString(undefined, { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            subtitle={`${snapshot.sourceLabel} (${formatBytes(snapshot.byteLength)})`}
                            onPress={() => { setMessage(""); setSelectedSnapshotId(snapshot.id); }}
                        />
                    ))}
                    <View style={{ marginTop: 24, gap: 10 }}>
                        {history.hasNextPage ? (
                            <Button variant="outline" loading={history.isFetchingNextPage} onPress={() => void history.fetchNextPage()}>
                                Load older backups
                            </Button>
                        ) : null}
                        <Button variant="destructive" disabled={busy || removeAll.isPending} onPress={confirmDeleteAll}>
                            Delete all backups
                        </Button>
                    </View>
                </> : history.isLoading ? (
                    <InlineNotice tone="loading" message="Loading saved backups…" />
                ) : history.isError ? (
                    <InlineNotice tone="error" message="Saved backups could not be loaded." />
                ) : <>
                    <View style={{ paddingVertical: 28 }}>
                        <Archive size={32} color={colors.muted} strokeWidth={1.7} style={{ marginBottom: 20 }} />
                        <UnlockedText style={{ fontSize: 22, fontWeight: "500", marginBottom: 10 }}>No managed backups</UnlockedText>
                        <UnlockedText style={{ fontSize: 13, lineHeight: 20, color: colors.muted }}>Your next managed backup will appear here.</UnlockedText>
                    </View>
                    <Button className="mt-6" loading={busy} onPress={() => void backupNow()}>Back up now</Button>
                </>}
                <Dialog open={!!selectedSnapshot} onOpenChange={(open) => !open && setSelectedSnapshotId(null)} placement="bottom" scroll dismissible={!busy}>
                    <DialogHeader><UnlockedDialogTitle>Encrypted snapshot</UnlockedDialogTitle></DialogHeader>
                    {selectedSnapshot ? <>
                        <View>
                        {[
                            ["Created", new Date(selectedSnapshot.createdAt).toLocaleString()],
                            ["Source", selectedSnapshot.sourceLabel],
                            ["Size", formatBytes(selectedSnapshot.byteLength)],
                        ].map(([label, value]) => (
                            <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                                <UnlockedText style={{ fontSize: 13, color: colors.muted }}>{label}</UnlockedText>
                                <UnlockedText style={{ fontSize: 13, maxWidth: "65%", textAlign: "right" }}>{value}</UnlockedText>
                            </View>
                        ))}
                        </View>
                        <View style={{ marginTop: 24, gap: 10 }}>
                            <Button variant="outline" loading={busy} onPress={() => void download(selectedSnapshot.id)}>Download backup</Button>
                            <Button variant="destructive" disabled={busy || remove.isPending} onPress={() => {
                                setSelectedSnapshotId(null);
                                confirmDelete(selectedSnapshot.id);
                            }}>Delete backup</Button>
                        </View>
                    </> : null}
                    {message ? <InlineNotice tone="info" message={message} /> : null}
                </Dialog>
                {message ? <InlineNotice tone="info" message={message} /> : null}
            </UnlockedTaskScreen>
        );
    }

    return (
        <UnlockedTaskScreen title="Backup Center">
            <View style={{ paddingBottom: 22, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <UnlockedText style={{ fontSize: 22, fontWeight: "500", marginTop: 10 }}>
                Your backups
            </UnlockedText>
            <UnlockedText className="mt-[6px] text-[13px] leading-5 text-muted-foreground">
                Keep a recent encrypted copy and your recovery code available.
            </UnlockedText>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <UnlockedText style={{ fontSize: 13, color: colors.muted }}>Latest managed backup</UnlockedText>
                <UnlockedText style={{ fontSize: 13, maxWidth: "65%", textAlign: "right" }}>{historyItems[0] ? new Date(historyItems[0].createdAt).toLocaleString() : status.isLoading || history.isLoading ? "Checking…" : status.isError || history.isError ? "Unavailable" : "No managed backup yet"}</UnlockedText>
            </View>
            <UnlockedMenuRow
                icon={Archive}
                title="Create local backup"
                subtitle="Export an encrypted .cryx file"
                onPress={() => router.push({ pathname: "/(app)/settings/import-export", params: { pane: "encrypted" } })}
            />
            <UnlockedMenuRow
                icon={KeyRound}
                title="Vault recovery code"
                subtitle="Review recovery and replace your code"
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
                    message="Checking managed backup status…"
                />
            ) : status.isError ? (
                <InlineNotice
                    tone="error"
                    message="Managed backup status is unavailable."
                />
            ) : !status.data?.storageConfigured ? (
                <InlineNotice
                    tone="info"
                    message="Managed backup storage is not configured by this service."
                />
            ) : !entitled ? (
                <InlineNotice
                    tone="info"
                    message="Managed backups require an eligible subscription. Open Membership in Account to upgrade using Stripe Checkout."
                />
            ) : (
                <View className="mb-0">
                        <UnlockedText style={{ color: colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 26, marginBottom: 6, textTransform: "uppercase" }}>
                            Managed backups
                        </UnlockedText>
                        <View className="min-h-[70px] flex-row items-center justify-between gap-3 border-b border-border">
                            <View className="flex-1">
                                <UnlockedText className="text-sm text-foreground">Automatic backups</UnlockedText>
                                <UnlockedText className="mt-1 text-xs text-muted-foreground">Store encrypted snapshots using Online Services.</UnlockedText>
                            </View>
                            <Switch
                                value={status.data.enabled}
                                disabled={busy}
                                onValueChange={(enabled) => void (enabled ? enableBackups() : pauseBackups())}
                                accessibilityLabel="Automatic managed backups"
                            />
                        </View>

                </View>
            )}

            {message ? <InlineNotice tone="info" message={message} /> : null}
            {status.data?.storageConfigured && entitled ? (
                <UnlockedMenuRow
                    icon={Cloud}
                    title="Backup history"
                    subtitle="Download or remove saved snapshots"
                    onPress={() => {
                        setMessage("");
                        router.push("/(app)/settings/backup-center/history");
                    }}
                />
            ) : null}
            {status.data?.storageConfigured && entitled ? <Button className="mt-6" variant="outline" loading={busy} onPress={() => void backupNow()}>Back up now</Button> : null}
        </UnlockedTaskScreen>
    );
}

export default function BackupCenterRoute() {
    return <BackupCenterScreen />;
}
