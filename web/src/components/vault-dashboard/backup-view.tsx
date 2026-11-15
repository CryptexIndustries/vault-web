import {
    AlertTriangle,
    ArchiveRestore,
    CheckCircle2,
    Download,
    HardDriveDownload,
    Info,
} from "lucide-react";
import { useAtomValue } from "jotai/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EncryptedBlob } from "@cryptex-industries/vault-core/proto";

import * as Storage from "@/app_lib/vault-utils/storage";
import {
    backupDestinationStatusesAtom,
    useBackupDestinationsController,
} from "@/app_lib/backup-destinations";
import {
    BACKUP_SOURCE_LABELS,
    formatBackupAge,
    getBackupOverview,
    getLocalBackupReceipt,
    latestDestinationBackupAt,
    LOCAL_BACKUP_STATUS_EVENT,
    recordLocalBackupCompleted,
    type LocalBackupReceipt,
} from "@/app_lib/backup-status";
import { useOnlineServicesData } from "@/app_lib/use-online-services-data";
import { useManagedBackupFailure } from "@/app_lib/use-managed-backup-failure";
import {
    MANAGED_BACKUP_STATUS_EVENT,
    type ManagedBackupStatusDetail,
} from "@/app_lib/managed-backup-coordinator";
import { BackupDestinationsCard } from "@/components/vault-dashboard/backup-destinations-card";
import { ManagedBackupsSettingsCard } from "@/components/vault-dashboard/managed-backups-settings-card";
import { DashboardScreen } from "@/components/vault-dashboard/dashboard-screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
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

type BackupViewProps = {
    onBack: () => void;
    onOpenAccountDialog: () => void;
};

export function BackupSidebarEntry({
    vaultId,
    vaultBlob,
    active,
    onOpen,
}: {
    vaultId?: string;
    vaultBlob?: EncryptedBlob;
    active: boolean;
    onOpen: () => void;
}) {
    const onlineServicesData = useOnlineServicesData();
    const cloudServicesEnabled = isCloudServicesEnabled();
    const hasOnlineServicesSession = Boolean(onlineServicesData?.sessionToken);
    const [localBackup, setLocalBackup] = useState<LocalBackupReceipt | null>(
        null,
    );
    const destinationBackupAt = latestDestinationBackupAt(
        useAtomValue(unlockedVaultAtom).BackupDestinations ?? [],
        useAtomValue(backupDestinationStatusesAtom),
    );
    const managedStatus = trpcReact.v1.backup.status.useQuery(undefined, {
        enabled: cloudServicesEnabled && hasOnlineServicesSession,
    });
    const refetchManagedStatus = managedStatus.refetch;
    const managedFailure = useManagedBackupFailure();

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
        destinationBackupAt,
        managedEnabled: managedStatus.data?.enabled === true,
        managedEntitled: managedStatus.data?.entitled === true,
    });
    const backupLabel = overview.latestBackupAt
        ? `${BACKUP_SOURCE_LABELS[overview.latestSource ?? "local"]} | ${formatBackupAge(overview.latestBackupAt)}${overview.latestSource === "local" && !localBackup?.isCurrent ? " - changes since" : ""}`
        : "No backup yet";
    const managedStatePrefix = managedStatus.data?.enabled
        ? "On"
        : managedStatus.data?.entitled
          ? "Off"
          : null;
    const statusLabel = `${managedStatePrefix ? `${managedStatePrefix} | ` : ""}${backupLabel}`;
    const managedStateLabel = managedFailure
        ? "Backup failed"
        : managedStatus.data?.enabled
          ? "Managed on"
          : managedStatus.data?.entitled
            ? "Managed off"
            : null;
    const statusTitle = managedFailure
        ? `${managedFailure.message} | ${statusLabel}`
        : overview.needsReminder
          ? `Backup due | ${statusLabel}`
          : statusLabel;

    return (
        <Button
            variant="ghost"
            className={cn(
                "hover:bg-sidebar-accent/70 h-auto min-h-12 w-full justify-start gap-2 rounded-md px-4 py-2 text-left text-xs text-muted-foreground transition-all hover:text-foreground",
                active && "bg-sidebar-accent text-foreground",
            )}
            onClick={onOpen}
            aria-current={active ? "page" : undefined}
            title={statusTitle}
        >
            <ArchiveRestore className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                    <span>Backups</span>
                    <span
                        className={cn(
                            "text-[10px] font-normal",
                            overview.needsReminder || managedFailure
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

export function BackupView({ onBack, onOpenAccountDialog }: BackupViewProps) {
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const onlineServicesData = useOnlineServicesData();
    const backupDestinationsController = useBackupDestinationsController();
    const destinationBackupAt = latestDestinationBackupAt(
        backupDestinationsController.destinations,
        backupDestinationsController.statuses,
    );
    const vaultId = vaultMetadata?.Blob?.Envelope?.VaultID;
    const [isCreatingLocalBackup, setIsCreatingLocalBackup] = useState(false);
    const [localBackup, setLocalBackup] = useState<LocalBackupReceipt | null>(
        null,
    );
    const backupApiEnabled =
        isCloudServicesEnabled() && Boolean(onlineServicesData?.sessionToken);
    const managedStatus = trpcReact.v1.backup.status.useQuery(undefined, {
        enabled: backupApiEnabled,
    });
    const managedFailure = useManagedBackupFailure();

    useEffect(() => {
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
    }, [vaultId, vaultMetadata?.Blob]);

    const managedBackupAt = managedStatus.data?.latestReadyAt
        ? new Date(managedStatus.data.latestReadyAt)
        : null;
    const overview = getBackupOverview({
        localBackupAt: localBackup?.completedAt ?? null,
        managedBackupAt,
        destinationBackupAt,
        managedEnabled: managedStatus.data?.enabled === true,
        managedEntitled: managedStatus.data?.entitled === true,
    });
    const needsAttention = overview.needsReminder || Boolean(managedFailure);
    const hasCurrentCoverage =
        !needsAttention &&
        !overview.isStale &&
        (overview.latestSource === "managed" ||
            overview.latestSource === "destination" ||
            (overview.latestSource === "local" && localBackup?.isCurrent));
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
        const source = BACKUP_SOURCE_LABELS[overview.latestSource ?? "local"];
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
        <DashboardScreen
            icon={ArchiveRestore}
            title="Backup Center"
            description="Create a local encrypted backup or manage automatic, zero-knowledge restore points."
            onBack={onBack}
        >
            <div className="space-y-4">
                <div
                    className={
                        needsAttention
                            ? "flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
                            : hasCurrentCoverage
                              ? "flex gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4"
                              : "flex gap-3 rounded-lg border bg-muted/30 p-4"
                    }
                    role={needsAttention ? "alert" : undefined}
                >
                    {needsAttention ? (
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                    ) : hasCurrentCoverage ? (
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                        <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">
                                {managedFailure
                                    ? "Managed backups are failing"
                                    : overview.needsReminder
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
                            {managedFailure
                                ? managedFailure.message
                                : overview.needsReminder
                                  ? "Managed backups are not active, so download an encrypted copy and store it somewhere safe."
                                  : managedStatus.data?.enabled ||
                                      overview.latestSource === "destination"
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
                                    Download a portable .cryx file that only
                                    your vault secrets can unlock.
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

                <BackupDestinationsCard
                    controller={backupDestinationsController}
                />

                <ManagedBackupsSettingsCard
                    onAccountAction={onOpenAccountDialog}
                />
            </div>
        </DashboardScreen>
    );
}
