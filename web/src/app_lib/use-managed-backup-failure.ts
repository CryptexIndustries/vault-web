import { useSyncExternalStore } from "react";

import {
    MANAGED_BACKUP_STATUS_EVENT,
    managedBackupCoordinator,
} from "./managed-backup-coordinator";

function subscribe(onChange: () => void) {
    window.addEventListener(MANAGED_BACKUP_STATUS_EVENT, onChange);
    return () =>
        window.removeEventListener(MANAGED_BACKUP_STATUS_EVENT, onChange);
}

/** The last managed backup failure, until an upload succeeds or backups stop. */
export function useManagedBackupFailure() {
    return useSyncExternalStore(
        subscribe,
        () => managedBackupCoordinator.failure,
        () => undefined,
    );
}
