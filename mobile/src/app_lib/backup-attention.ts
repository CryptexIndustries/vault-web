import { useAtomValue } from "jotai";
import { visibleBackupDestinations } from "@cryptex-industries/vault-core/vault-utils/backup-destinations";

import { backupDestinationStatusesAtom } from "@/app_lib/backup-destinations";
import { managedBackupFailureAtom } from "@/app_lib/managed-backup-coordinator";
import { unlockedVaultAtom } from "@/utils/atoms";

/** The first backup destination whose last upload failed. */
export function useFailingBackupDestination() {
    const destinations =
        useAtomValue(unlockedVaultAtom).BackupDestinations ?? [];
    const statuses = useAtomValue(backupDestinationStatusesAtom);
    return visibleBackupDestinations(destinations).find(
        (destination) => statuses[destination.ID]?.phase === "error",
    );
}

/** True while a managed backup or a backup destination is failing. */
export function useBackupNeedsAttention() {
    const managedFailure = useAtomValue(managedBackupFailureAtom);
    const failingDestination = useFailingBackupDestination();
    return managedFailure != null || failingDestination != null;
}
