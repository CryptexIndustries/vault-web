import {
    AlertTriangle,
    ArchiveRestore,
    CheckCircle2,
    Download,
    HardDriveDownload,
    Info,
    ShieldCheck,
} from "lucide-react";
import { useAtomValue } from "jotai/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EncryptedBlob } from "@cryptex-industries/vault-core/proto";

import * as Storage from "@/app_lib/vault-utils/storage";
import {
    formatBackupAge,
    getBackupOverview,
    getLocalBackupReceipt,
    LOCAL_BACKUP_STATUS_EVENT,
    recordLocalBackupCompleted,
    type LocalBackupReceipt,
} from "@/app_lib/backup-status";
import { useOnlineServicesData } from "@/app_lib/use-online-services-data";
import {
    MANAGED_BACKUP_STATUS_EVENT,
    type ManagedBackupStatusDetail,
} from "@/app_lib/managed-backup-coordinator";
import { ManagedBackupsSettingsCard } from "@/components/vault-dashboard/managed-backups-settings-card";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { unlockedVaultAtom, unlockedVaultMetadataAtom } from "@/utils/atoms";
import { vaultLog } from "@/utils/logging";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { BACKUP_FILE_EXTENSION } from "@/utils/consts";
import {
    getVaultDEKFromSession,
    MISSING_VAULT_SECRET_ERROR,
} from "@/utils/vault-session";
import { trpcReact } from "@/utils/trpc";

type BackupDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenAccountDialog: () => void;
};

export function BackupSidebarEntry({
    vaultId,
    vaultBlob,
    onOpen,
}: {
    vaultId?: string;
    vaultBlob?: EncryptedBlob;
    onOpen: () => void;
}) {
    const onlineServicesData = useOnlineServicesData();
    const cloudServicesEnabled = isCloudServicesEnabled();
    const hasOnlineServicesSession = Boolean(onlineServicesData?.sessionToken);
    const [localBackup, setLocalBackup] = useState<LocalBackupReceipt | null>(
        null,
    );
    const managedStatus = trpcReact.v1.backup.status.useQuery(undefined, {
        enabled: cloudServicesEnabled && hasOnlineServicesSession,
    });
    const refetchManagedStatus = managedStatus.refetch;

    useEffect(() => {
        if (!cloudServicesEnabled || !hasOnlineServicesSession) return;

        const handleManagedBackup = (event: Event) => {
            const detail = (event as CustomEvent<ManagedBackupStatusDetail>)
                .detail;
            if (detail?.status === "success") void refetchManagedStatus();
        };
        window.addEventListener(
            MANAGED_BACKUP_STATUS_EVENT,
            handleManagedBackup,
        );
        return () =>
            window.removeEventListener(
                MANAGED_BACKUP_STATUS_EVENT,
                handleManagedBackup,
            );
    }, [cloudServicesEnabled, hasOnlineServicesSession, refetchManagedStatus]);

    useEffect(() => {
        let active = true;
        const refresh = async () => {
            const dek = getVaultDEKFromSession();
            if (!vaultId || !vaultBlob || dek.isErr()) {
                if (active) setLocalBackup(null);
                return;
            }
            const receipt = await getLocalBackupReceipt(
                vaultId,
                EncryptedBlob.encode(vaultBlob).finish(),
                dek.value,
            );
            if (active) setLocalBackup(receipt);
        };
        const handleLocalBackup = () => void refresh();
        void refresh();
        window.addEventListener(LOCAL_BACKUP_STATUS_EVENT, handleLocalBackup);
        return () => {
            active = false;
            window.removeEventListener(
                LOCAL_BACKUP_STATUS_EVENT,
                handleLocalBackup,
            );
        };
    }, [vaultBlob, vaultId]);

    const managedBackupAt = managedStatus.data?.latestReadyAt
        ? new Date(managedStatus.data.latestReadyAt)
        : null;
    const overview = getBackupOverview({
        localBackupAt: localBackup?.completedAt ?? null,
        managedBackupAt,
        managedEnabled: managedStatus.data?.enabled === true,
        managedEntitled: managedStatus.data?.entitled === true,
    });
    const backupLabel = overview.latestBackupAt
        ? `${overview.latestSource === "managed" ? "Managed" : "Local"} | ${formatBackupAge(overview.latestBackupAt)}${overview.latestSource === "local" && !localBackup?.isCurrent ? " - changes since" : ""}`
        : "No backup yet";
    const managedStatePrefix = managedStatus.data?.enabled
        ? "On"
        : managedStatus.data?.entitled
          ? "Off"
          : null;
    const statusLabel = `${managedStatePrefix ? `${managedStatePrefix} | ` : ""}${backupLabel}`;
    const managedStateLabel = managedStatus.data?.enabled
        ? "Managed on"
        : managedStatus.data?.entitled
          ? "Managed off"
          : null;
    const statusTitle = overview.needsReminder
        ? `Backup due | ${statusLabel}`
        : statusLabel;

    return (
        <Button
            variant="ghost"
            className="hover:bg-sidebar-accent/70 h-auto min-h-12 w-full justify-start gap-2 rounded-md px-4 py-2 text-left text-xs text-muted-foreground transition-all hover:text-foreground"
            onClick={onOpen}
            title={statusTitle}
        >
            <ArchiveRestore className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                    <span>Backups</span>
                    <span
                        className={cn(
                            "text-[10px] font-normal",
                            overview.needsReminder
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground",
                        )}
                    >
                        {managedStateLabel}
                    </span>
                </span>
                <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">
                    {backupLabel}
                </span>
            </span>
        </Button>
    );
}

export function BackupDialog({
    open,
    onOpenChange,
    onOpenAccountDialog,
}: BackupDialogProps) {
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const onlineServicesData = useOnlineServicesData();
    const vaultId = vaultMetadata?.Blob?.Envelope?.VaultID;
    const [isCreatingLocalBackup, setIsCreatingLocalBackup] = useState(false);
    const [localBackup, setLocalBackup] = useState<LocalBackupReceipt | null>(
        null,
    );
    const backupApiEnabled =
        open &&
        isCloudServicesEnabled() &&
        Boolean(onlineServicesData?.sessionToken);
    const managedStatus = trpcReact.v1.backup.status.useQuery(undefined, {
        enabled: backupApiEnabled,
    });

    useEffect(() => {
        if (!open) return;
        let active = true;
        const refresh = async () => {
            const dek = getVaultDEKFromSession();
            if (!vaultId || !vaultMetadata?.Blob || dek.isErr()) {
                if (active) setLocalBackup(null);
                return;
            }
            const source = EncryptedBlob.encode(vaultMetadata.Blob).finish();
            const receipt = await getLocalBackupReceipt(
                vaultId,
                source,
                dek.value,
            );
            if (active) setLocalBackup(receipt);
        };
        const handleLocalBackup = () => void refresh();
        void refresh();
        window.addEventListener(LOCAL_BACKUP_STATUS_EVENT, handleLocalBackup);
        return () => {
            active = false;
            window.removeEventListener(
                LOCAL_BACKUP_STATUS_EVENT,
                handleLocalBackup,
            );
        };
    }, [open, vaultId, vaultMetadata?.Blob]);

    const managedBackupAt = managedStatus.data?.latestReadyAt
        ? new Date(managedStatus.data.latestReadyAt)
        : null;
    const overview = getBackupOverview({
        localBackupAt: localBackup?.completedAt ?? null,
        managedBackupAt,
        managedEnabled: managedStatus.data?.enabled === true,
        managedEntitled: managedStatus.data?.entitled === true,
    });
    const hasCurrentCoverage =
        !overview.isStale &&
        (overview.latestSource === "managed" ||
            (overview.latestSource === "local" && localBackup?.isCurrent));
    const handleAccountAction = () => {
        onOpenChange(false);
        onOpenAccountDialog();
    };

    const handleManualBackup = async () => {
        if (!vaultMetadata?.Blob || !vaultId) {
            toast.error("Vault metadata is unavailable.");
            return;
        }

        const dekResult = getVaultDEKFromSession();
        if (dekResult.isErr()) {
            toast.error(MISSING_VAULT_SECRET_ERROR);
            return;
        }

        setIsCreatingLocalBackup(true);
        try {
            const serializedData = await Storage.serializeVault(
                unlockedVault,
                vaultMetadata.Blob,
                dekResult.value,
            );
            const blob = new Blob([serializedData], {
                type: "application/octet-stream",
            });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `cryptexvault-bk-${Date.now()}.${BACKUP_FILE_EXTENSION}`;
            anchor.click();
            URL.revokeObjectURL(url);

            const completedAt = new Date();
            try {
                const source = EncryptedBlob.encode(
                    vaultMetadata.Blob,
                ).finish();
                await recordLocalBackupCompleted(
                    vaultId,
                    source,
                    dekResult.value,
                    completedAt,
                );
            } catch (error) {
                vaultLog.error("Failed to save local backup receipt", {
                    error,
                });
            }
            setLocalBackup({ completedAt, isCurrent: true });
            toast.success("Encrypted backup downloaded.");
        } catch (error) {
            vaultLog.error("Failed to backup vault", { error });
            toast.error("Failed to create encrypted backup.");
        } finally {
            setIsCreatingLocalBackup(false);
        }
    };

    let latestBackupLabel = "No completed backup recorded";
    if (overview.latestBackupAt) {
        const source =
            overview.latestSource === "managed" ? "Managed" : "Local";
        latestBackupLabel = `${source} backup ${formatBackupAge(overview.latestBackupAt)}`;
        if (overview.latestSource === "local" && !localBackup?.isCurrent)
            latestBackupLabel += "; changes since backup";
    }

    let managedStateLabel = "Managed backups off";
    if (!isCloudServicesEnabled())
        managedStateLabel = "Managed backups unavailable";
    else if (!onlineServicesData?.sessionToken)
        managedStateLabel = "Sign in for managed backups";
    else if (managedStatus.isLoading)
        managedStateLabel = "Checking managed backups";
    else if (managedStatus.isError)
        managedStateLabel = "Managed status unavailable";
    else if (managedStatus.data?.enabled)
        managedStateLabel = "Managed backups on";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[88vh] w-[96vw] max-w-4xl flex-col gap-0 overflow-hidden p-0 shadow-2xl">
                <DialogHeader className="border-b px-4 py-4 sm:px-6">
                    <DialogTitle className="flex items-center gap-2 text-xl tracking-tight">
                        <ShieldCheck className="h-5 w-5 text-primary" />
                        Backup Center
                    </DialogTitle>
                    <DialogDescription>
                        Create a local encrypted backup or manage automatic,
                        zero-knowledge restore points.
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1">
                    <div className="space-y-4 p-3 sm:p-6">
                        <div
                            className={
                                overview.needsReminder
                                    ? "flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
                                    : hasCurrentCoverage
                                      ? "flex gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4"
                                      : "flex gap-3 rounded-lg border bg-muted/30 p-4"
                            }
                            role={overview.needsReminder ? "alert" : undefined}
                        >
                            {overview.needsReminder ? (
                                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                            ) : hasCurrentCoverage ? (
                                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                                <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium">
                                        {overview.needsReminder
                                            ? "Your vault needs a fresh backup"
                                            : hasCurrentCoverage
                                              ? "Your backup coverage is current"
                                              : !overview.latestBackupAt
                                                ? "No completed backup yet"
                                                : "Backup status"}
                                    </p>
                                    {managedStatus.data?.enabled ? (
                                        <Badge className="bg-emerald-600 hover:bg-emerald-600">
                                            {managedStateLabel}
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline">
                                            {managedStateLabel}
                                        </Badge>
                                    )}
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {latestBackupLabel}.{" "}
                                    {overview.needsReminder
                                        ? "Managed backups are not active, so download an encrypted copy and store it somewhere safe."
                                        : managedStatus.data?.enabled
                                          ? "Automatic backups will keep running while the vault is open and unlocked."
                                          : !overview.isStale
                                            ? "Keep the downloaded file in a separate, secure location."
                                            : "Managed backups are not active for this account."}
                                </p>
                            </div>
                        </div>

                        <Card className="shadow-sm">
                            <CardHeader className="pb-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <CardTitle className="flex items-center gap-2 text-base">
                                            <HardDriveDownload className="h-4 w-4" />
                                            Local encrypted backup
                                        </CardTitle>
                                        <CardDescription className="mt-1">
                                            Download a portable .cryx file that
                                            only your vault secrets can unlock.
                                        </CardDescription>
                                    </div>
                                    <Badge variant="secondary">
                                        {localBackup
                                            ? `Last: ${formatBackupAge(localBackup.completedAt)}`
                                            : "Never on this browser"}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <Button
                                    onClick={() => void handleManualBackup()}
                                    disabled={isCreatingLocalBackup}
                                >
                                    <Download className="mr-2 h-4 w-4" />
                                    {isCreatingLocalBackup
                                        ? "Preparing backup…"
                                        : "Download backup"}
                                </Button>
                            </CardContent>
                        </Card>

                        <ManagedBackupsSettingsCard
                            open={open}
                            onAccountAction={handleAccountAction}
                        />
                    </div>
                </ScrollArea>

                <DialogFooter className="border-t px-4 py-4 sm:px-6">
                    <DialogClose asChild>
                        <Button variant="outline">Close</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
