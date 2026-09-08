import {
    AlertCircle,
    Cloud,
    Download,
    Pause,
    RefreshCw,
    Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
    MANAGED_BACKUP_STATUS_EVENT,
    managedBackupCoordinator,
    type ManagedBackupStatusDetail,
} from "@/app_lib/managed-backup-coordinator";
import { managedBackupErrorMessage } from "@/app_lib/managed-backup-errors";
import {
    downloadBackupBytes,
    downloadBackupFile,
} from "@/app_lib/managed-backups";
import { useOnlineServicesData } from "@/app_lib/use-online-services-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { vaultLog } from "@/utils/logging";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { trpcReact } from "@/utils/trpc";

type ManagedBackupsSettingsCardProps = {
    open: boolean;
    onAccountAction: () => void;
};

export function ManagedBackupsSettingsCard({
    open,
    onAccountAction,
}: ManagedBackupsSettingsCardProps) {
    const onlineServicesData = useOnlineServicesData();
    const [backupUploading, setBackupUploading] = useState(false);
    const [enableConfirmOpen, setEnableConfirmOpen] = useState(false);
    const [backupFailure, setBackupFailure] =
        useState<ManagedBackupStatusDetail["error"]>();
    const cloudServicesEnabled = isCloudServicesEnabled();
    const backupApiEnabled =
        open &&
        cloudServicesEnabled &&
        Boolean(onlineServicesData?.sessionToken);
    const backupUtils = trpcReact.useUtils();
    const backupStatus = trpcReact.v1.backup.status.useQuery(undefined, {
        enabled: backupApiEnabled,
    });
    const backupHistory = trpcReact.v1.backup.list.useInfiniteQuery(
        { cursor: undefined },
        {
            enabled:
                backupApiEnabled &&
                Boolean(
                    backupStatus.data?.entitled ||
                    (backupStatus.data?.graceExpiresAt &&
                        new Date(backupStatus.data.graceExpiresAt) >
                            new Date()),
                ),
            getNextPageParam: (page) => page.nextCursor ?? undefined,
        },
    );
    const backupHistoryItems =
        backupHistory.data?.pages.flatMap((page) => page.items) ?? [];
    const enableBackup = trpcReact.v1.backup.enable.useMutation();
    const disableBackup = trpcReact.v1.backup.disable.useMutation();
    const deleteBackup = trpcReact.v1.backup.delete.useMutation();
    const deleteAllBackups = trpcReact.v1.backup.deleteAll.useMutation();

    const refreshBackups = async () => {
        await Promise.all([
            backupUtils.v1.backup.status.invalidate(),
            backupUtils.v1.backup.list.invalidate(),
        ]);
    };

    const notifyBackupError = (error: unknown, fallback: string) =>
        toast.error(managedBackupErrorMessage(error, fallback));

    useEffect(() => {
        const listener = (event: Event) => {
            const detail = (event as CustomEvent<ManagedBackupStatusDetail>)
                .detail;
            const status = detail?.status;
            if (status) setBackupUploading(status === "uploading");
            if (detail?.error) setBackupFailure(detail.error);
            if (
                status === "scheduled" ||
                status === "uploading" ||
                status === "success"
            ) {
                setBackupFailure(undefined);
            }
            if (status === "success") {
                void refreshBackups();
            }
        };
        window.addEventListener(MANAGED_BACKUP_STATUS_EVENT, listener);
        return () =>
            window.removeEventListener(MANAGED_BACKUP_STATUS_EVENT, listener);
        // refreshBackups only closes over stable backupUtils from useUtils().
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backupUtils]);

    const requestEnable = () => {
        if (!backupStatus.data?.recoveryConfigured) {
            toast.error(
                "Create and save an Online Services recovery phrase in Account Security first.",
            );
            return;
        }
        setEnableConfirmOpen(true);
    };

    const handleEnable = async () => {
        try {
            await enableBackup.mutateAsync();
            managedBackupCoordinator.setEnabled(true);
            await refreshBackups();
        } catch (error) {
            const message = managedBackupErrorMessage(
                error,
                "Could not enable managed backups.",
            );
            vaultLog.error("Failed to enable managed backup", { message });
            toast.error(message);
            return;
        }

        try {
            await managedBackupCoordinator.backupNow();
            toast.success("Managed encrypted backups enabled.");
        } catch (error) {
            toast.error(
                `Managed backups are enabled, but the first upload failed. ${managedBackupErrorMessage(error)}`,
            );
        }
    };

    const handleDisable = async () => {
        try {
            await disableBackup.mutateAsync();
            managedBackupCoordinator.setEnabled(false);
            await refreshBackups();
            toast.success(
                "Automatic backups paused. Existing history remains.",
            );
        } catch (error) {
            notifyBackupError(error, "Could not pause managed backups.");
        }
    };

    const handleBackupNow = async () => {
        try {
            await managedBackupCoordinator.backupNow();
            await refreshBackups();
            toast.success("Encrypted restore point uploaded.");
        } catch (error) {
            notifyBackupError(
                error,
                "Could not upload the encrypted restore point.",
            );
        }
    };

    const handleDownload = async (snapshotId: string) => {
        try {
            const result = await downloadBackupBytes(snapshotId);
            downloadBackupFile(result.bytes, result.snapshot.createdAt);
        } catch (error) {
            notifyBackupError(
                error,
                "Could not download the encrypted restore point.",
            );
        }
    };

    const handleDelete = async (snapshotId: string) => {
        try {
            await deleteBackup.mutateAsync({ snapshotId });
            await refreshBackups();
            toast.success("Restore point deleted.");
        } catch (error) {
            notifyBackupError(error, "Could not delete the restore point.");
        }
    };

    const handleDeleteAll = async () => {
        try {
            await deleteAllBackups.mutateAsync();
            managedBackupCoordinator.setEnabled(false);
            await refreshBackups();
            toast.success("All managed restore points deleted.");
        } catch (error) {
            notifyBackupError(
                error,
                "Could not delete the managed restore points.",
            );
        }
    };

    const storageUsagePercent = backupStatus.data?.maxAccountBytes
        ? Math.max(
              0,
              (backupStatus.data.storageBytes /
                  backupStatus.data.maxAccountBytes) *
                  100,
          )
        : 0;
    const storageUsageLabel =
        storageUsagePercent > 0 && storageUsagePercent < 1
            ? storageUsagePercent.toFixed(1)
            : Math.round(storageUsagePercent).toString();
    const storageUsageBytes = backupStatus.data?.storageBytes ?? 0;
    const storageUsageSize =
        storageUsageBytes >= 1024 * 1024
            ? `${(storageUsageBytes / (1024 * 1024)).toFixed(1)} MiB`
            : `${(storageUsageBytes / 1024).toFixed(1)} KiB`;
    let managedStateLabel = "Paused";
    if (!cloudServicesEnabled) managedStateLabel = "Unavailable";
    else if (!backupApiEnabled) managedStateLabel = "Sign in required";
    else if (backupStatus.isLoading) managedStateLabel = "Checking…";
    else if (backupStatus.isError) managedStateLabel = "Status unavailable";
    else if (!backupStatus.data?.storageConfigured)
        managedStateLabel = "Unavailable";
    else if (
        !backupStatus.data.entitled &&
        (!backupStatus.data.graceExpiresAt ||
            new Date(backupStatus.data.graceExpiresAt) <= new Date())
    )
        managedStateLabel = "Subscription required";
    else if (backupStatus.data.enabled) managedStateLabel = "Active";

    let loadMoreLabel = "Load older backups";
    if (backupHistory.isFetchingNextPage) loadMoreLabel = "Loading…";
    else if (backupHistory.isFetchNextPageError)
        loadMoreLabel = "Retry loading older backups";
    const loadMoreBackups = backupHistory.hasNextPage ? (
        <Button
            size="sm"
            variant="outline"
            onClick={() => void backupHistory.fetchNextPage()}
            disabled={backupHistory.isFetchingNextPage}
        >
            {loadMoreLabel}
        </Button>
    ) : null;

    return (
        <Card className="vault-settings-card min-w-0 shadow-sm">
            <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Cloud className="h-4 w-4" /> Managed Encrypted Backups
                    </CardTitle>
                    <Badge
                        variant={
                            backupStatus.data?.enabled ? "default" : "outline"
                        }
                    >
                        {managedStateLabel}
                    </Badge>
                </div>
                <CardDescription>
                    Versioned, zero-knowledge restore points. Cryptex Vault
                    stores encrypted bytes only and never receives your vault
                    secrets.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {!cloudServicesEnabled ? (
                    <p className="text-sm text-muted-foreground">
                        Managed backups are unavailable in this deployment.
                    </p>
                ) : !backupApiEnabled ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-muted-foreground">
                            Sign in to Online Services to manage cloud backups.
                        </p>
                        <Button size="sm" onClick={onAccountAction}>
                            Sign in
                        </Button>
                    </div>
                ) : backupStatus.isLoading ? (
                    <p className="text-sm text-muted-foreground">
                        Loading backup status…
                    </p>
                ) : backupStatus.isError ? (
                    <div
                        className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
                        role="alert"
                    >
                        <div className="flex gap-2 text-sm text-destructive">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>
                                Could not load managed backup status. Check your
                                connection and try again.
                            </span>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void backupStatus.refetch()}
                            disabled={backupStatus.isFetching}
                        >
                            Retry
                        </Button>
                    </div>
                ) : !backupStatus.data?.storageConfigured ? (
                    <p className="text-sm text-muted-foreground">
                        Managed backup storage is not configured by the service
                        operator.
                    </p>
                ) : !backupStatus.data.entitled &&
                  (!backupStatus.data.graceExpiresAt ||
                      new Date(backupStatus.data.graceExpiresAt) <=
                          new Date()) ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-muted-foreground">
                            Managed encrypted backups are available with Online
                            Services.
                        </p>
                        <Button size="sm" onClick={onAccountAction}>
                            Upgrade
                        </Button>
                    </div>
                ) : !backupStatus.data.enabled ? (
                    <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            Backups run only while this web vault is open and
                            unlocked. Existing paused history remains
                            downloadable.
                        </p>
                        {backupStatus.data.entitled &&
                        onlineServicesData?.remoteData?.root ? (
                            <>
                                <Button
                                    onClick={requestEnable}
                                    disabled={enableBackup.isPending}
                                >
                                    <Cloud className="mr-2 h-4 w-4" /> Enable
                                    Managed Backups
                                </Button>
                                <AlertDialog
                                    open={enableConfirmOpen}
                                    onOpenChange={setEnableConfirmOpen}
                                >
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>
                                                Enable managed backups?
                                            </AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Cryptex Vault stores encrypted
                                                .cryx files and cannot recover
                                                your vault password, recovery
                                                code, or plaintext. Fresh-device
                                                recovery requires both your
                                                Online Services recovery phrase
                                                and your vault secret
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>
                                                Cancel
                                            </AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={() =>
                                                    void handleEnable()
                                                }
                                            >
                                                Enable backups
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </>
                        ) : !backupStatus.data.entitled ? (
                            <p className="text-sm text-amber-700 dark:text-amber-300">
                                Your subscription ended. Downloads remain
                                available until{" "}
                                {new Date(
                                    backupStatus.data.graceExpiresAt!,
                                ).toLocaleDateString()}
                                .
                            </p>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                Only the root device can enable managed backups.
                            </p>
                        )}
                        {backupHistory.isError && !backupHistory.data ? (
                            <p
                                className="text-sm text-destructive"
                                role="alert"
                            >
                                Could not load retained restore points.
                            </p>
                        ) : backupHistoryItems.length ? (
                            <div className="space-y-2 border-t pt-3">
                                <p className="text-sm font-medium">
                                    Retained restore points
                                </p>
                                {backupHistoryItems.map((snapshot) => (
                                    <div
                                        key={snapshot.id}
                                        className="flex items-center justify-between rounded-md border p-2 text-sm"
                                    >
                                        <span>
                                            {new Date(
                                                snapshot.createdAt,
                                            ).toLocaleString()}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            aria-label={`Download restore point from ${new Date(snapshot.createdAt).toLocaleString()}`}
                                            onClick={() =>
                                                handleDownload(snapshot.id)
                                            }
                                        >
                                            <Download className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        {loadMoreBackups}
                    </div>
                ) : (
                    <>
                        <div className="grid gap-2 text-sm sm:grid-cols-4">
                            <div>
                                <span className="text-muted-foreground">
                                    Account recovery
                                </span>
                                <p className="font-medium">
                                    {backupStatus.data
                                        .accountRecoveryProtection ===
                                    "protected"
                                        ? "Protected"
                                        : backupStatus.data
                                                .accountRecoveryProtection ===
                                            "pending"
                                          ? "Pending first root backup"
                                          : backupStatus.data
                                                  .accountRecoveryProtection ===
                                              "degraded"
                                            ? "Degraded"
                                            : "Unavailable"}
                                </p>
                            </div>
                            <div>
                                <span className="text-muted-foreground">
                                    Last backup
                                </span>
                                <p className="font-medium">
                                    {backupStatus.data.latestReadyAt
                                        ? new Date(
                                              backupStatus.data.latestReadyAt,
                                          ).toLocaleString()
                                        : "Not yet"}
                                </p>
                            </div>
                            <div>
                                <span className="text-muted-foreground">
                                    Versions
                                </span>
                                <p className="font-medium">
                                    {backupStatus.data.versionCount}
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">
                                        Encrypted storage
                                    </span>
                                    <span className="font-medium">
                                        {storageUsageLabel}%
                                    </span>
                                </div>
                                <TooltipProvider delayDuration={200}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Progress
                                                className="cursor-help"
                                                value={Math.min(
                                                    storageUsagePercent,
                                                    100,
                                                )}
                                                aria-label="Encrypted backup storage usage"
                                                aria-valuetext={`${storageUsageLabel}% of account backup storage; ${storageUsageSize} used`}
                                                tabIndex={0}
                                            />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {storageUsageSize} used
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                        </div>
                        {backupFailure ? (
                            <div
                                className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                                role="alert"
                            >
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                <div>
                                    <p>{backupFailure.message}</p>
                                    {backupFailure.retryInMs ? (
                                        <p className="mt-1 text-xs">
                                            Automatic retry scheduled in about{" "}
                                            {Math.ceil(
                                                backupFailure.retryInMs / 1000,
                                            )}{" "}
                                            seconds.
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                            <Button
                                onClick={handleBackupNow}
                                disabled={backupUploading}
                            >
                                <RefreshCw className="mr-2 h-4 w-4" /> Backup
                                Now
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handleDisable}
                                disabled={disableBackup.isPending}
                            >
                                <Pause className="mr-2 h-4 w-4" /> Pause
                            </Button>
                            {onlineServicesData?.remoteData?.root ? (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="destructive"
                                            disabled={
                                                deleteAllBackups.isPending
                                            }
                                        >
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Delete All
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>
                                                Delete all restore points?
                                            </AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This permanently deletes every
                                                managed restore point and pauses
                                                managed backups. This cannot be
                                                undone
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>
                                                Cancel
                                            </AlertDialogCancel>
                                            <AlertDialogAction
                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                onClick={() =>
                                                    void handleDeleteAll()
                                                }
                                            >
                                                Delete all
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            ) : null}
                        </div>
                        <div className="space-y-2">
                            <p className="text-sm font-medium">
                                Restore points
                            </p>
                            {backupHistory.isError && !backupHistory.data ? (
                                <p
                                    className="text-sm text-destructive"
                                    role="alert"
                                >
                                    Could not load restore points. Refresh the
                                    backup panel to retry.
                                </p>
                            ) : backupHistoryItems.length ? (
                                backupHistoryItems.map((snapshot) => (
                                    <div
                                        key={snapshot.id}
                                        className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                                    >
                                        <div>
                                            <p className="font-medium">
                                                {new Date(
                                                    snapshot.createdAt,
                                                ).toLocaleString()}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {(
                                                    snapshot.byteLength / 1024
                                                ).toFixed(1)}{" "}
                                                KiB | {snapshot.sourceLabel}
                                            </p>
                                        </div>
                                        <div className="flex gap-1">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                aria-label={`Download restore point from ${new Date(snapshot.createdAt).toLocaleString()}`}
                                                onClick={() =>
                                                    handleDownload(snapshot.id)
                                                }
                                            >
                                                <Download className="h-4 w-4" />
                                            </Button>
                                            {onlineServicesData?.remoteData
                                                ?.root ? (
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            aria-label={`Delete restore point from ${new Date(snapshot.createdAt).toLocaleString()}`}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>
                                                                Delete restore
                                                                point?
                                                            </AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                This permanently
                                                                deletes this
                                                                managed restore
                                                                point and cannot
                                                                be undone
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>
                                                                Cancel
                                                            </AlertDialogCancel>
                                                            <AlertDialogAction
                                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                                onClick={() =>
                                                                    void handleDelete(
                                                                        snapshot.id,
                                                                    )
                                                                }
                                                            >
                                                                Delete
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            ) : null}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    No restore points yet.
                                </p>
                            )}
                            {loadMoreBackups}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
