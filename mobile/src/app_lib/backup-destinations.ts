import AsyncStorage from "@react-native-async-storage/async-storage";
import { t } from "@lingui/core/macro";
import { atom } from "jotai";
import {
    BackupDestinationScheduler,
    type BackupDestinationState,
    type BackupDestinationStatus,
} from "@cryptex-industries/vault-core/vault-utils/backup-destination-scheduler";
import {
    applyBackupDestinationChange,
    backupSourceHash,
    newBackupDeviceIdentity,
    type BackupDestinationChange,
} from "@cryptex-industries/vault-core/vault-utils/backup-destinations";
import {
    LinkedDevices,
    Vault,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { vaultWriteCoordinator } from "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator";

import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "@/utils/atoms";
import { vaultLog } from "@/utils/logging";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { getVaultDEKFromSession } from "@/utils/vault-session";
import { registerBackupDestinationHooks } from "./backup-destination-hooks";
import { describeBackupDestinationError } from "./backup-destination-messages";
import { createEncryptedBackupBytes } from "./managed-backups";

export const backupDestinationStatusesAtom = atom<
    Record<string, BackupDestinationStatus>
>({});

const stateKey = (destinationID: string): string => {
    const vaultID = vaultStore.get(unlockedVaultMetadataAtom)?.Blob?.Envelope
        ?.VaultID;
    return `cryptex:backup-destination:${vaultID ?? "unknown"}:${destinationID}`;
};

/** A copy of the vault with this installation's backup folder name and key. */
function withBackupDeviceIdentity(currentVault: Vault): Vault {
    const identity = newBackupDeviceIdentity(
        currentVault.LinkedDevices,
        "android",
    );
    if (!identity) return currentVault;
    return Object.assign(new Vault(), currentVault, {
        LinkedDevices: Object.assign(
            new LinkedDevices(),
            currentVault.LinkedDevices,
            identity,
        ),
    });
}

export async function saveBackupDestinations(
    change: BackupDestinationChange,
): Promise<void> {
    const result = await persistVaultMutation(
        "backup.destinations",
        (currentVault) => {
            const vault = Object.assign(
                new Vault(),
                withBackupDeviceIdentity(currentVault),
                {
                    BackupDestinations: applyBackupDestinationChange(
                        currentVault.BackupDestinations ?? [],
                        change,
                    ),
                },
            );
            return { vault, result: undefined };
        },
    );
    if (result.isErr()) throw new Error(result.error);
}

async function getDeviceID(): Promise<string> {
    const vault = vaultStore.get(unlockedVaultAtom);
    if (!newBackupDeviceIdentity(vault.LinkedDevices, "android")) {
        return vault.LinkedDevices.BackupDeviceID;
    }
    const result = await persistVaultMutation(
        "backup.device",
        (currentVault) => {
            const vault = withBackupDeviceIdentity(currentVault);
            return { vault, result: vault.LinkedDevices.BackupDeviceID };
        },
    );
    if (result.isErr()) throw new Error(result.error);
    return result.value;
}

async function sourceHashOf(vault: Vault): Promise<string | null> {
    const envelope = vaultStore.get(unlockedVaultMetadataAtom)?.Blob?.Envelope;
    const key = vault.LinkedDevices.BackupMarkerKey;
    return envelope && key ? backupSourceHash(vault, envelope, key) : null;
}

export const backupDestinationScheduler = new BackupDestinationScheduler({
    getDestinations: () =>
        vaultStore.get(unlockedVaultAtom).BackupDestinations ?? [],
    getDeviceID,
    getSourceHash: () => sourceHashOf(vaultStore.get(unlockedVaultAtom)),
    // A key rotation publishes the new envelope before the new key.
    createBackup: () =>
        vaultWriteCoordinator.readBetweenKeyChanges(async () => {
            const vault = vaultStore.get(unlockedVaultAtom);
            const metadata = vaultStore.get(unlockedVaultMetadataAtom);
            const dek = getVaultDEKFromSession();
            const sourceHash = await sourceHashOf(vault);
            if (!metadata || dek.isErr() || !sourceHash) {
                throw new Error(
                    t`The vault locked before the backup was ready.`,
                );
            }
            return {
                sourceHash,
                bytes: await createEncryptedBackupBytes(
                    vault,
                    metadata,
                    dek.value,
                ),
            };
        }),
    loadState: async (destinationID) => {
        const raw = await AsyncStorage.getItem(stateKey(destinationID));
        try {
            return raw ? (JSON.parse(raw) as BackupDestinationState) : null;
        } catch {
            return null;
        }
    },
    saveState: (destinationID, state) =>
        AsyncStorage.setItem(stateKey(destinationID), JSON.stringify(state)),
    onStatus: (destinationID, status) =>
        vaultStore.set(backupDestinationStatusesAtom, (current) => ({
            ...current,
            [destinationID]: status,
        })),
    describeError: describeBackupDestinationError,
    onError: (destinationID, error) =>
        vaultLog.error("Backup destination upload failed", {
            destinationID,
            code: (error as { code?: string } | null)?.code,
            status: (error as { status?: number } | null)?.status,
        }),
});

registerBackupDestinationHooks({
    markDirty: () => backupDestinationScheduler.markDirty(),
    flushBeforeLock: () => backupDestinationScheduler.flushBeforeLock(),
    replaceAfterSecurityChange: (deleteOlder) =>
        backupDestinationScheduler.replaceAfterSecurityChange(deleteOlder),
    stop: () => {
        backupDestinationScheduler.stop();
        vaultStore.set(backupDestinationStatusesAtom, {});
    },
});
