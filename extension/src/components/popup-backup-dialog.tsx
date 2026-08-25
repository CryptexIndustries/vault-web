import {
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
    Cloud,
    Download,
    HardDriveDownload,
    Info,
    Pause,
    RefreshCw,
    ShieldCheck,
    Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
    formatBackupAge,
    getBackupOverview,
    type LocalBackupReceipt,
} from "@/app_lib/backup-status";
import {
    downloadBackupBytes,
    downloadBackupFile,
    uploadEncryptedBackup,
} from "@/app_lib/managed-backups";
import {
    managedBackupErrorMessage,
    normalizeManagedBackupError,
} from "@/app_lib/managed-backup-errors";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

import { trpc } from "../trpc-ext";
import {
    createEncryptedBackupViaSW,
    downloadLocalBackupFile,
    getBackupContextViaSW,
} from "../utils/backup-client";
import {
    accountRecoveryProtectionLabel,
    backupStorageUsage,
    hasBackupHistoryAccess,
} from "../utils/backup-status-labels";
import { vaultLog } from "../utils/ext-logging";
import { isExtensionCloudServicesEnabled } from "../utils/online-services-api-url";

type PopupBackupDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

type BackupStatus = Awaited<ReturnType<typeof trpc.v1.backup.status.query>>;
type BackupListPage = Awaited<ReturnType<typeof trpc.v1.backup.list.query>>;
type BackupSnapshot = BackupListPage["items"][number];

type ManagedBackupView =
    | { kind: "cloud-disabled" }
    | { kind: "signed-out" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | {
          kind: "ready";
          status: BackupStatus;
          isRoot: boolean;
          snapshots: BackupSnapshot[];
          nextCursor: string | null;
      };

type ReadyManagedView = Extract<ManagedBackupView, { kind: "ready" }>;

type BackupBusy =
    | null
    | "local"
    | "upload"
    | "enable"
    | "pause"
    | "delete-all"
    | "load-older"
    | `delete:${string}`;

function parseLocalReceipt(
    completedAt: string,
    isCurrent: boolean,
): LocalBackupReceipt | null {
    const at = new Date(completedAt);
    if (Number.isNaN(at.getTime())) return null;
    return { completedAt: at, isCurrent };
}

async function loadManagedBackupView(
    hasSession: boolean,
): Promise<Exclude<ManagedBackupView, { kind: "loading" }>> {
    if (!isExtensionCloudServicesEnabled()) {
        return { kind: "cloud-disabled" };
    }
    if (!hasSession) {
        return { kind: "signed-out" };
    }

    try {
        const [status, configuration] = await Promise.all([
            trpc.v1.backup.status.query(),
            trpc.v1.user.configuration.query(),
        ]);
        let snapshots: BackupSnapshot[] = [];
        let nextCursor: string | null = null;
        if (hasBackupHistoryAccess(status)) {
            const page = await trpc.v1.backup.list.query({
                cursor: undefined,
            });
            snapshots = page.items;
            nextCursor = page.nextCursor;
        }
        return {
            kind: "ready",
            status,
            isRoot: configuration.root,
            snapshots,
            nextCursor,
        };
    } catch (error) {
        if (
            normalizeManagedBackupError(error).code === "BACKUP_AUTH_REQUIRED"
        ) {
            return { kind: "signed-out" };
        }
        return {
            kind: "error",
            message: managedBackupErrorMessage(
                error,
                "Could not load managed backup status.",
            ),
        };
    }
}

function managedStateLabel(view: ManagedBackupView, compact: boolean): string {
    if (
        view.kind === "cloud-disabled" ||
        (view.kind === "ready" && !view.status.storageConfigured)
    ) {
        return compact ? "Unavailable" : "Managed backups unavailable";
    }
    if (view.kind === "signed-out") {
        return compact ? "Sign in required" : "Sign in for managed backups";
    }
    if (view.kind === "loading") {
        return compact ? "Checking…" : "Checking managed backups";
    }
    if (view.kind === "error") {
        return compact ? "Status unavailable" : "Managed status unavailable";
    }
    if (!hasBackupHistoryAccess(view.status)) return "Premium required";
    if (view.status.enabled) {
        return compact ? "Active" : "Managed backups on";
    }
    return compact ? "Paused" : "Managed backups off";
}

export function PopupBackupDialog({
    open,
    onOpenChange,
}: PopupBackupDialogProps) {
    const [localReceipt, setLocalReceipt] = useState<LocalBackupReceipt | null>(
        null,
    );
    const [managedView, setManagedView] = useState<ManagedBackupView>({
        kind: "loading",
    });
    const [busy, setBusy] = useState<BackupBusy>(null);
    const [enableConfirmOpen, setEnableConfirmOpen] = useState(false);

    const refresh = useCallback(async () => {
        const context = await getBackupContextViaSW();
        if (!context.ok) {
            setLocalReceipt(null);
            setManagedView({
                kind: "error",
                message: "Vault metadata is unavailable.",
            });
            return;
        }
        setLocalReceipt(
            context.localReceipt
                ? parseLocalReceipt(
                      context.localReceipt.completedAt,
                      context.localReceipt.isCurrent,
                  )
                : null,
        );
        setManagedView(
            await loadManagedBackupView(context.hasOnlineServicesSession),
        );
    }, []);

    useEffect(() => {
        if (!open) return;
        setManagedView({ kind: "loading" });
        void refresh();
    }, [open, refresh]);

    const locked = busy !== null;
    const notifyBackupError = (error: unknown, fallback: string) =>
        toast.error(managedBackupErrorMessage(error, fallback));

    const handleManualBackup = async () => {
        setBusy("local");
        try {
            const created = await createEncryptedBackupViaSW(true);
            if (!created.ok) {
                toast.error("Failed to create encrypted backup.");
                return;
            }
            downloadLocalBackupFile(
                created.backup.bytes,
                created.backup.completedAt,
            );
            await refresh();
            toast.success("Encrypted backup downloaded.");
        } catch (error) {
            vaultLog.error("Failed to backup vault", { error });
            toast.error("Failed to create encrypted backup.");
        } finally {
            setBusy(null);
        }
    };

    const handleEnable = async () => {
        if (managedView.kind !== "ready") return;
        if (!managedView.status.recoveryConfigured) {
            toast.error(
                "Create and save an Online Services recovery phrase in the web app Account Security first.",
            );
            return;
        }
        setBusy("enable");
        try {
            await trpc.v1.backup.enable.mutate();
            const created = await createEncryptedBackupViaSW(false);
            if (!created.ok) {
                toast.error(
                    "Managed backups are enabled, but the first upload failed. Could not prepare the encrypted restore point.",
                );
            } else {
                try {
                    await uploadEncryptedBackup(created.backup.bytes);
                    toast.success("Managed encrypted backups enabled.");
                } catch (error) {
                    toast.error(
                        `Managed backups are enabled, but the first upload failed. ${managedBackupErrorMessage(error)}`,
                    );
                }
            }
            await refresh();
        } catch (error) {
            notifyBackupError(error, "Could not enable managed backups.");
        } finally {
            setBusy(null);
            setEnableConfirmOpen(false);
        }
    };

    const handleDisable = async () => {
        setBusy("pause");
        try {
            await trpc.v1.backup.disable.mutate();
            await refresh();
            toast.success(
                "Automatic backups paused. Existing history remains.",
            );
        } catch (error) {
            notifyBackupError(error, "Could not pause managed backups.");
        } finally {
            setBusy(null);
        }
    };

    const handleBackupNow = async () => {
        setBusy("upload");
        try {
            const created = await createEncryptedBackupViaSW(false);
            if (!created.ok) {
                toast.error("Could not prepare the encrypted restore point.");
                return;
            }
            await uploadEncryptedBackup(created.backup.bytes);
            await refresh();
            toast.success("Encrypted restore point uploaded.");
        } catch (error) {
            notifyBackupError(
                error,
                "Could not upload the encrypted restore point.",
            );
        } finally {
            setBusy(null);
        }
    };

    const handleDownloadSnapshot = async (snapshot: BackupSnapshot) => {
        try {
            const result = await downloadBackupBytes(snapshot.id);
            downloadBackupFile(result.bytes, result.snapshot.createdAt);
        } catch (error) {
            notifyBackupError(
                error,
                "Could not download the encrypted restore point.",
            );
        }
    };

    const handleDeleteSnapshot = async (snapshotId: string) => {
        setBusy(`delete:${snapshotId}`);
        try {
            await trpc.v1.backup.delete.mutate({ snapshotId });
            await refresh();
            toast.success("Restore point deleted.");
        } catch (error) {
            notifyBackupError(error, "Could not delete the restore point.");
        } finally {
            setBusy(null);
        }
    };

    const handleDeleteAll = async () => {
        setBusy("delete-all");
        try {
            await trpc.v1.backup.deleteAll.mutate();
            await refresh();
            toast.success("All managed restore points deleted.");
        } catch (error) {
            notifyBackupError(
                error,
                "Could not delete the managed restore points.",
            );
        } finally {
            setBusy(null);
        }
    };

    const handleLoadOlder = async () => {
        if (managedView.kind !== "ready" || !managedView.nextCursor) return;
        setBusy("load-older");
        try {
            const page = await trpc.v1.backup.list.query({
                cursor: managedView.nextCursor,
            });
            setManagedView({
                ...managedView,
                snapshots: [...managedView.snapshots, ...page.items],
                nextCursor: page.nextCursor,
            });
        } catch (error) {
            notifyBackupError(error, "Could not load older restore points.");
        } finally {
            setBusy(null);
        }
    };

    const readyStatus =
        managedView.kind === "ready" ? managedView.status : undefined;
    const overview = getBackupOverview({
        localBackupAt: localReceipt?.completedAt ?? null,
        managedBackupAt: readyStatus?.latestReadyAt
            ? new Date(readyStatus.latestReadyAt)
            : null,
        managedEnabled: readyStatus?.enabled === true,
        managedEntitled: readyStatus?.entitled === true,
    });
    const hasCurrentCoverage =
        readyStatus?.enabled === true ||
        (!overview.isStale &&
            overview.latestSource === "local" &&
            localReceipt?.isCurrent);

    let latestBackupLabel = "No completed backup recorded";
    if (overview.latestBackupAt) {
        const source =
            overview.latestSource === "managed" ? "Managed" : "Local";
        latestBackupLabel = `${source} backup ${formatBackupAge(overview.latestBackupAt)}`;
        if (overview.latestSource === "local" && !localReceipt?.isCurrent) {
            latestBackupLabel += "; changes since backup";
        }
    }

    const stateLabel = managedStateLabel(managedView, false);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[calc(100vh-16px)] max-h-[88vh] w-[calc(100vw-24px)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
                <DialogHeader className="border-b px-4 py-3">
                    <DialogTitle className="flex items-center gap-2 text-base tracking-tight">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        Backup Center
                    </DialogTitle>
                    <DialogDescription>
                        Create a local encrypted backup or manage automatic,
                        zero-knowledge restore points.
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="min-h-0 flex-1">
                    <div className="space-y-3 p-3">
                        <div
                            className={
                                overview.needsReminder
                                    ? "flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
                                    : hasCurrentCoverage
                                      ? "flex gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3"
                                      : "flex gap-3 rounded-lg border bg-muted/30 p-3"
                            }
                            role={overview.needsReminder ? "alert" : undefined}
                        >
                            {overview.needsReminder ? (
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                            ) : hasCurrentCoverage ? (
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-medium">
                                        {overview.needsReminder
                                            ? "Your vault needs a fresh backup"
                                            : hasCurrentCoverage
                                              ? "Your backup coverage is current"
                                              : "Backup status"}
                                    </p>
                                    {readyStatus?.enabled ? (
                                        <Badge className="bg-emerald-600 hover:bg-emerald-600">
                                            {stateLabel}
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline">
                                            {stateLabel}
                                        </Badge>
                                    )}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {latestBackupLabel}.{" "}
                                    {overview.needsReminder
                                        ? "Managed backups are not active, so download an encrypted copy and store it somewhere safe."
                                        : readyStatus?.enabled
                                          ? "Use Backup Now to upload a restore point from this extension. Automatic backups also run while the web vault is open."
                                          : !overview.isStale
                                            ? "Keep the downloaded file in a separate, secure location."
                                            : "Managed backups are not active for this account."}
                                </p>
                            </div>
                        </div>

                        <Card className="shadow-sm">
                            <CardHeader className="p-4 pb-2">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                        <CardTitle className="flex items-center gap-2 text-sm">
                                            <HardDriveDownload className="h-4 w-4" />
                                            Local encrypted backup
                                        </CardTitle>
                                        <CardDescription className="mt-1 text-xs">
                                            Download a portable .cryx file that
                                            only your vault secrets can unlock.
                                        </CardDescription>
                                    </div>
                                    <Badge variant="secondary">
                                        {localReceipt
                                            ? `Last: ${formatBackupAge(localReceipt.completedAt)}`
                                            : "Never on this browser"}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="p-4 pt-2">
                                <Button
                                    size="sm"
                                    onClick={() => void handleManualBackup()}
                                    disabled={locked}
                                >
                                    <Download className="mr-2 h-4 w-4" />
                                    {busy === "local"
                                        ? "Preparing backup…"
                                        : "Download backup"}
                                </Button>
                            </CardContent>
                        </Card>

                        <ManagedBackupsPanel
                            view={managedView}
                            busy={busy}
                            enableConfirmOpen={enableConfirmOpen}
                            onEnableConfirmOpenChange={setEnableConfirmOpen}
                            onRetry={() => void refresh()}
                            onEnable={() => void handleEnable()}
                            onDisable={() => void handleDisable()}
                            onBackupNow={() => void handleBackupNow()}
                            onDownloadSnapshot={(snapshot) =>
                                void handleDownloadSnapshot(snapshot)
                            }
                            onDeleteSnapshot={(snapshotId) =>
                                void handleDeleteSnapshot(snapshotId)
                            }
                            onDeleteAll={() => void handleDeleteAll()}
                            onLoadOlder={() => void handleLoadOlder()}
                        />
                    </div>
                </ScrollArea>

                <DialogFooter className="border-t px-4 py-3">
                    <DialogClose asChild>
                        <Button variant="outline" size="sm">
                            Close
                        </Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

type ManagedBackupsPanelProps = {
    view: ManagedBackupView;
    busy: BackupBusy;
    enableConfirmOpen: boolean;
    onEnableConfirmOpenChange: (open: boolean) => void;
    onRetry: () => void;
    onEnable: () => void;
    onDisable: () => void;
    onBackupNow: () => void;
    onDownloadSnapshot: (snapshot: BackupSnapshot) => void;
    onDeleteSnapshot: (snapshotId: string) => void;
    onDeleteAll: () => void;
    onLoadOlder: () => void;
};

function ManagedBackupsPanel({
    view,
    busy,
    enableConfirmOpen,
    onEnableConfirmOpenChange,
    onRetry,
    onEnable,
    onDisable,
    onBackupNow,
    onDownloadSnapshot,
    onDeleteSnapshot,
    onDeleteAll,
    onLoadOlder,
}: ManagedBackupsPanelProps) {
    const locked = busy !== null;
    const badgeLabel = managedStateLabel(view, true);

    return (
        <Card className="shadow-sm">
            <CardHeader className="p-4 pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                        <Cloud className="h-4 w-4" /> Managed Encrypted Backups
                    </CardTitle>
                    <Badge
                        variant={
                            view.kind === "ready" && view.status.enabled
                                ? "default"
                                : "outline"
                        }
                    >
                        {badgeLabel}
                    </Badge>
                </div>
                <CardDescription className="text-xs">
                    Versioned, zero-knowledge restore points. Cryptex Vault
                    stores encrypted bytes only and never receives your vault
                    secrets.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-2">
                {view.kind === "cloud-disabled" ? (
                    <p className="text-sm text-muted-foreground">
                        Managed backups are unavailable in this deployment.
                    </p>
                ) : view.kind === "signed-out" ? (
                    <p className="text-sm text-muted-foreground">
                        Sign in to Online Services by linking this vault, then
                        reopen Backup Center to manage cloud restore points.
                    </p>
                ) : view.kind === "loading" ? (
                    <p className="text-sm text-muted-foreground">
                        Loading backup status…
                    </p>
                ) : view.kind === "error" ? (
                    <div
                        className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
                        role="alert"
                    >
                        <div className="flex gap-2 text-sm text-destructive">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{view.message}</span>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onRetry}
                            disabled={locked}
                        >
                            Retry
                        </Button>
                    </div>
                ) : !view.status.storageConfigured ? (
                    <p className="text-sm text-muted-foreground">
                        Managed backup storage is not configured by the service
                        operator.
                    </p>
                ) : !hasBackupHistoryAccess(view.status) ? (
                    <p className="text-sm text-muted-foreground">
                        Managed encrypted backups are available with Premium in
                        the web app.
                    </p>
                ) : !view.status.enabled ? (
                    <PausedManagedBackups
                        view={view}
                        locked={locked}
                        loadingOlder={busy === "load-older"}
                        enableConfirmOpen={enableConfirmOpen}
                        onEnableConfirmOpenChange={onEnableConfirmOpenChange}
                        onEnable={onEnable}
                        onDownloadSnapshot={onDownloadSnapshot}
                        onLoadOlder={onLoadOlder}
                    />
                ) : (
                    <ActiveManagedBackups
                        view={view}
                        busy={busy}
                        onDisable={onDisable}
                        onBackupNow={onBackupNow}
                        onDownloadSnapshot={onDownloadSnapshot}
                        onDeleteSnapshot={onDeleteSnapshot}
                        onDeleteAll={onDeleteAll}
                        onLoadOlder={onLoadOlder}
                    />
                )}
            </CardContent>
        </Card>
    );
}

function PausedManagedBackups({
    view,
    locked,
    loadingOlder,
    enableConfirmOpen,
    onEnableConfirmOpenChange,
    onEnable,
    onDownloadSnapshot,
    onLoadOlder,
}: {
    view: ReadyManagedView;
    locked: boolean;
    loadingOlder: boolean;
    enableConfirmOpen: boolean;
    onEnableConfirmOpenChange: (open: boolean) => void;
    onEnable: () => void;
    onDownloadSnapshot: (snapshot: BackupSnapshot) => void;
    onLoadOlder: () => void;
}) {
    return (
        <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
                Automatic backups run while the web vault is open and unlocked.
                Existing paused history remains downloadable here.
            </p>
            {view.status.entitled && view.isRoot ? (
                <>
                    <Button
                        size="sm"
                        onClick={() => onEnableConfirmOpenChange(true)}
                        disabled={locked}
                    >
                        <Cloud className="mr-2 h-4 w-4" /> Enable Managed
                        Backups
                    </Button>
                    <AlertDialog
                        open={enableConfirmOpen}
                        onOpenChange={onEnableConfirmOpenChange}
                    >
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>
                                    Enable managed backups?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                    Cryptex Vault stores encrypted .cryx files
                                    and cannot recover your vault password,
                                    recovery code, or plaintext. Fresh-device
                                    recovery requires both your Online Services
                                    recovery phrase and your vault secret
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={onEnable}>
                                    Enable backups
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </>
            ) : !view.status.entitled && view.status.graceExpiresAt ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                    Premium ended. Downloads remain available until{" "}
                    {new Date(view.status.graceExpiresAt).toLocaleDateString()}.
                </p>
            ) : (
                <p className="text-sm text-muted-foreground">
                    Only the root device can enable managed backups.
                </p>
            )}
            <SnapshotList
                className="border-t pt-3"
                title="Retained restore points"
                snapshots={view.snapshots}
                nextCursor={view.nextCursor}
                onDownload={onDownloadSnapshot}
                onLoadOlder={onLoadOlder}
                loadOlderDisabled={locked}
                loadingOlder={loadingOlder}
                hideWhenEmpty
            />
        </div>
    );
}

function ActiveManagedBackups({
    view,
    busy,
    onDisable,
    onBackupNow,
    onDownloadSnapshot,
    onDeleteSnapshot,
    onDeleteAll,
    onLoadOlder,
}: {
    view: ReadyManagedView;
    busy: BackupBusy;
    onDisable: () => void;
    onBackupNow: () => void;
    onDownloadSnapshot: (snapshot: BackupSnapshot) => void;
    onDeleteSnapshot: (snapshotId: string) => void;
    onDeleteAll: () => void;
    onLoadOlder: () => void;
}) {
    const storage = backupStorageUsage(
        view.status.storageBytes,
        view.status.maxAccountBytes,
    );
    const locked = busy !== null;
    const deletingId =
        busy && busy.startsWith("delete:")
            ? busy.slice("delete:".length)
            : null;

    return (
        <>
            <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                    <span className="text-muted-foreground">
                        Account recovery
                    </span>
                    <p className="font-medium">
                        {accountRecoveryProtectionLabel(
                            view.status.accountRecoveryProtection,
                        )}
                    </p>
                </div>
                <div>
                    <span className="text-muted-foreground">Last backup</span>
                    <p className="font-medium">
                        {view.status.latestReadyAt
                            ? new Date(
                                  view.status.latestReadyAt,
                              ).toLocaleString()
                            : "Not yet"}
                    </p>
                </div>
                <div>
                    <span className="text-muted-foreground">Versions</span>
                    <p className="font-medium">{view.status.versionCount}</p>
                </div>
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                            Encrypted storage
                        </span>
                        <span className="font-medium">
                            {storage.percentLabel}%
                        </span>
                    </div>
                    <Progress
                        value={Math.min(storage.percent, 100)}
                        aria-label="Encrypted backup storage usage"
                        aria-valuetext={`${storage.percentLabel}% of account backup storage; ${storage.sizeLabel} used`}
                    />
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={onBackupNow} disabled={locked}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Backup Now
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={onDisable}
                    disabled={locked}
                >
                    <Pause className="mr-2 h-4 w-4" /> Pause
                </Button>
                {view.isRoot ? (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                size="sm"
                                variant="destructive"
                                disabled={locked}
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
                                    This permanently deletes every managed
                                    restore point and pauses managed backups.
                                    This cannot be undone
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={onDeleteAll}
                                >
                                    Delete all
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                ) : null}
            </div>
            <SnapshotList
                title="Restore points"
                snapshots={view.snapshots}
                nextCursor={view.nextCursor}
                emptyLabel="No restore points yet."
                onDownload={onDownloadSnapshot}
                onDelete={view.isRoot ? onDeleteSnapshot : undefined}
                deletingId={deletingId}
                onLoadOlder={onLoadOlder}
                loadOlderDisabled={locked}
                loadingOlder={busy === "load-older"}
            />
        </>
    );
}

function SnapshotList({
    className,
    title,
    snapshots,
    nextCursor,
    emptyLabel,
    hideWhenEmpty,
    onDownload,
    onDelete,
    deletingId,
    onLoadOlder,
    loadOlderDisabled,
    loadingOlder,
}: {
    className?: string;
    title: string;
    snapshots: BackupSnapshot[];
    nextCursor: string | null;
    emptyLabel?: string;
    hideWhenEmpty?: boolean;
    onDownload: (snapshot: BackupSnapshot) => void;
    onDelete?: (snapshotId: string) => void;
    deletingId?: string | null;
    onLoadOlder: () => void;
    loadOlderDisabled: boolean;
    loadingOlder: boolean;
}) {
    if (hideWhenEmpty && !snapshots.length) return null;
    return (
        <div className={className ? `space-y-2 ${className}` : "space-y-2"}>
            <p className="text-sm font-medium">{title}</p>
            {snapshots.length ? (
                snapshots.map((snapshot) => (
                    <SnapshotRow
                        key={snapshot.id}
                        snapshot={snapshot}
                        deleting={deletingId === snapshot.id}
                        onDownload={() => onDownload(snapshot)}
                        onDelete={
                            onDelete ? () => onDelete(snapshot.id) : undefined
                        }
                    />
                ))
            ) : (
                <p className="text-sm text-muted-foreground">{emptyLabel}</p>
            )}
            {nextCursor ? (
                <Button
                    size="sm"
                    variant="outline"
                    onClick={onLoadOlder}
                    disabled={loadOlderDisabled}
                >
                    {loadingOlder ? "Loading…" : "Load older backups"}
                </Button>
            ) : null}
        </div>
    );
}

function SnapshotRow({
    snapshot,
    deleting,
    onDownload,
    onDelete,
}: {
    snapshot: BackupSnapshot;
    deleting: boolean;
    onDownload: () => void;
    onDelete?: () => void;
}) {
    const createdAt = new Date(snapshot.createdAt);
    const createdLabel = createdAt.toLocaleString();

    return (
        <div className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
            <div className="min-w-0">
                <p className="truncate font-medium">{createdLabel}</p>
                <p className="text-xs text-muted-foreground">
                    {(snapshot.byteLength / 1024).toFixed(1)} KiB |{" "}
                    {snapshot.sourceLabel}
                </p>
            </div>
            <div className="flex shrink-0 gap-1">
                <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Download restore point from ${createdLabel}`}
                    onClick={onDownload}
                >
                    <Download className="h-4 w-4" />
                </Button>
                {onDelete ? (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={deleting}
                                aria-label={`Delete restore point from ${createdLabel}`}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>
                                    Delete restore point?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                    This permanently deletes this managed
                                    restore point and cannot be undone
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={onDelete}
                                >
                                    Delete
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                ) : null}
            </div>
        </div>
    );
}
