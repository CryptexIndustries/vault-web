import type { SyncConnectionController } from "@cryptex-industries/vault-core/synchronization";
import { atom } from "jotai";
import { logoutOnlineServicesSession } from "@/app_lib/auth-session";
import type { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { vaultWriteCoordinator } from "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator";
import { vaultLog, vaultLogger } from "@/utils/logging";
import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "@/utils/atoms";
import {
    clearVaultDEKFromSession,
    saveVaultWithSessionDEK,
    type VaultSessionError,
} from "@/utils/vault-session";
import { clearPendingSecretFromClipboard } from "@/utils/clipboard";
import {
    flushManagedBackupBeforeLock,
    stopManagedBackup,
} from "@/app_lib/managed-backup-hooks";
import { err, ok, type Result } from "neverthrow";
import { androidCredentials } from "@/utils/android-credentials";
import { purgeSecretTempFiles } from "@/utils/secret-temp-files";
import { teardownActiveSyncControllers } from "@/utils/active-sync-controllers";

type SetUnlockedVault = (
    vault: Vault | ((previous: Vault) => Vault | Promise<Vault>),
) => void | Promise<void>;

type SetUnlockedVaultMetadata = (metadata: VaultMetadata | null) => void;

export const vaultLockStateAtom = atom<"idle" | "locking" | "failed">("idle");

export type VaultLockError =
    | "VAULT_METADATA_MISSING"
    | VaultSessionError
    | "VAULT_LOCK_FAILED";

export type LockUnlockedVaultOptions = {
    unlockedVaultMetadata: VaultMetadata | null;
    setUnlockedVault: SetUnlockedVault;
    setUnlockedVaultMetadata: SetUnlockedVaultMetadata;
    syncConnectionController?: SyncConnectionController;
};

export async function lockUnlockedVault({
    unlockedVaultMetadata,
    setUnlockedVault,
    setUnlockedVaultMetadata,
    syncConnectionController,
}: LockUnlockedVaultOptions): Promise<Result<void, VaultLockError>> {
    if (vaultStore.get(vaultLockStateAtom) === "locking")
        return err("VAULT_LOCK_FAILED");
    vaultStore.set(vaultLockStateAtom, "locking");
    try {
        // Let the opaque lock screen commit before encryption starts.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const result = await vaultWriteCoordinator.run(
            "vault.lock",
            async () => {
                if (!unlockedVaultMetadata) {
                    return err("VAULT_METADATA_MISSING");
                }

                const saveRes = await saveVaultWithSessionDEK(
                    unlockedVaultMetadata,
                    vaultStore.get(unlockedVaultAtom),
                    true,
                );
                if (saveRes.isErr()) {
                    return err(saveRes.error);
                }

                await flushManagedBackupBeforeLock();
                clearVaultDEKFromSession();
                teardownActiveSyncControllers(syncConnectionController);
                try {
                    androidCredentials.clearProviderCredentials();
                } catch (error) {
                    vaultLog.error("Failed to clear Android provider metadata", { error });
                }
                setUnlockedVaultMetadata(null);
                vaultStore.set(unlockedVaultAtom, new Vault());
                await setUnlockedVault(async () => new Vault());
                await clearPendingSecretFromClipboard();
                await logoutOnlineServicesSession();
                vaultLogger.clearAll();
                stopManagedBackup();
                void purgeSecretTempFiles().catch((error) => {
                    vaultLog.error("Failed to purge secret temporary files", { error });
                });
                return ok(undefined);
            },
        );
        vaultStore.set(vaultLockStateAtom, result.isOk() ? "idle" : "failed");
        return result;
    } catch (error) {
        vaultStore.set(vaultLockStateAtom, "failed");
        vaultLog.error("Failed to lock vault", { error });
        return err("VAULT_LOCK_FAILED");
    }
}

/** Discard changes still in memory after a failed save and revoke the session. */
export async function lockVaultWithoutSaving(
    syncConnectionController?: SyncConnectionController,
): Promise<
    Result<void, VaultLockError>
> {
    if (vaultStore.get(vaultLockStateAtom) !== "failed")
        return err("VAULT_LOCK_FAILED");

    vaultStore.set(vaultLockStateAtom, "locking");
    try {
        // Revoke secret access before any cleanup that can wait on native code.
        clearVaultDEKFromSession();
        vaultStore.set(unlockedVaultMetadataAtom, null);
        vaultStore.set(unlockedVaultAtom, new Vault());

        // Cleanup remains best effort after active session references are cleared.
        const cleanup = async (action: () => void | Promise<void>) => {
            try {
                await action();
            } catch (error) {
                vaultLog.error("Failed to finish vault lock cleanup", { error });
            }
        };
        await cleanup(() => teardownActiveSyncControllers(syncConnectionController));
        await cleanup(() => androidCredentials.clearProviderCredentials());
        await cleanup(() => stopManagedBackup());
        await cleanup(() => logoutOnlineServicesSession());
        await cleanup(() => clearPendingSecretFromClipboard());
        await cleanup(() => purgeSecretTempFiles());
        vaultLogger.clearAll();
        vaultStore.set(vaultLockStateAtom, "idle");
        return ok(undefined);
    } catch (error) {
        vaultStore.set(vaultLockStateAtom, "failed");
        vaultLog.error("Failed to revoke vault session", { error });
        return err("VAULT_LOCK_FAILED");
    }
}
