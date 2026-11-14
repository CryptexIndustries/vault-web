import { router } from "expo-router";
import { useAtomValue } from "jotai";
import { useLingui } from "@lingui/react/macro";
import {
    Archive,
    Cloud,
    Database,
    KeyRound,
    ShieldAlert,
    ShieldCheck,
    ShieldOff,
} from "lucide-react-native";
import { visibleBackupDestinations } from "@cryptex-industries/vault-core/vault-utils/backup-destinations";

import { useFailingBackupDestination } from "@/app_lib/backup-attention";
import { backupDestinationStatusesAtom } from "@/app_lib/backup-destinations";
import { managedBackupFailureAtom } from "@/app_lib/managed-backup-coordinator";
import {
    BackupStatusHeader,
    StorageMeter,
    formatBackupTime,
    managedFailureKind,
    managedFailureTitle,
} from "@/components/backup-center/backup-status";
import {
    UnlockedButton as Button,
    UnlockedMenuRow,
    UnlockedTaskScreen,
} from "@/components/unlocked/unlocked-ui";
import { unlockedVaultAtom } from "@/utils/atoms";
import { trpcReact } from "@/utils/trpc";

export default function BackupCenterRoute() {
    const { t, i18n } = useLingui();
    const status = trpcReact.v1.backup.status.useQuery();
    const failure = useAtomValue(managedBackupFailureAtom);
    const destinations = visibleBackupDestinations(
        useAtomValue(unlockedVaultAtom).BackupDestinations ?? [],
    );
    const destinationStatuses = useAtomValue(backupDestinationStatusesAtom);
    const failingDestination = useFailingBackupDestination();

    const entitled =
        status.data?.entitled ||
        (!!status.data?.graceExpiresAt &&
            new Date(status.data.graceExpiresAt) > new Date());
    const managed =
        status.data?.storageConfigured && entitled ? status.data : undefined;
    const kind = managedFailureKind(failure, managed);
    const managedOn = !!managed?.enabled;
    const lastBackup = Math.max(
        managed?.latestReadyAt?.getTime() ?? 0,
        ...destinations.map(
            (d) => destinationStatuses[d.ID]?.lastSuccessAt ?? 0,
        ),
    );
    const when = lastBackup ? formatBackupTime(i18n, lastBackup) : null;
    const managedWhen = managed?.latestReadyAt
        ? formatBackupTime(i18n, managed.latestReadyAt)
        : null;

    const header = kind ? (
        <BackupStatusHeader
            icon={ShieldAlert}
            tone="attention"
            title={managedFailureTitle(i18n, kind)}
            body={
                kind === "full"
                    ? managedWhen
                        ? t`Changes since ${managedWhen} are not backed up. Delete older backups to make room.`
                        : t`Delete older backups to make room.`
                    : kind === "too-large"
                      ? t`Export a backup file or add your own storage instead.`
                      : failure?.message
            }
        >
            {managed ? (
                <StorageMeter
                    i18n={i18n}
                    status={managed}
                    full={kind === "full"}
                />
            ) : null}
            {kind === "full" ? (
                <Button
                    className="mt-6"
                    onPress={() =>
                        router.push("/(app)/settings/backup-center/managed")
                    }
                >
                    {t`Free up space`}
                </Button>
            ) : null}
        </BackupStatusHeader>
    ) : failingDestination ? (
        <BackupStatusHeader
            icon={ShieldAlert}
            tone="attention"
            title={t`Backups to ${failingDestination.Name} are failing`}
            body={
                destinationStatuses[failingDestination.ID]?.lastError?.message
            }
        />
    ) : status.isLoading ? (
        <BackupStatusHeader
            icon={ShieldCheck}
            tone="neutral"
            title={t`Checking…`}
        />
    ) : when && (managedOn || destinations.some((d) => !d.Paused)) ? (
        <BackupStatusHeader
            icon={ShieldCheck}
            tone="positive"
            title={t`Your vault is backed up`}
            body={t`Last backup ${when}`}
        >
            {managed ? (
                <StorageMeter i18n={i18n} status={managed} full={false} />
            ) : null}
        </BackupStatusHeader>
    ) : (
        <BackupStatusHeader
            icon={ShieldOff}
            tone="neutral"
            title={t`No automatic backups`}
            body={t`Turn on managed backups or add your own storage, so losing this device does not mean losing your vault.`}
        />
    );

    return (
        <UnlockedTaskScreen title={t`Backup Center`}>
            {header}
            <UnlockedMenuRow
                testID="backup-center-managed"
                icon={Cloud}
                title={t`Managed backups`}
                subtitle={
                    status.isLoading
                        ? t`Checking…`
                        : status.isError
                          ? t({
                                message: "Unavailable",
                                comment:
                                    "Latest managed backup could not be loaded",
                            })
                          : !status.data?.storageConfigured
                            ? t`Not offered by this service`
                            : !entitled
                              ? t`Needs an eligible subscription`
                              : kind === "full"
                                ? t`Storage is full`
                                : kind
                                  ? t`The last backup failed`
                                  : !managedOn
                                    ? t`Off`
                                    : managedWhen
                                      ? t`On, last backup ${managedWhen}`
                                      : t`On`
                }
                attention={!!kind}
                onPress={() =>
                    router.push("/(app)/settings/backup-center/managed")
                }
            />
            <UnlockedMenuRow
                testID="backup-center-storage"
                icon={Database}
                title={t`Your own storage`}
                subtitle={
                    destinations.length
                        ? destinations.map((d) => d.Name).join(", ")
                        : t`S3 buckets you control`
                }
                attention={!!failingDestination}
                onPress={() =>
                    router.push("/(app)/settings/backup-center/storage")
                }
            />
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
        </UnlockedTaskScreen>
    );
}
