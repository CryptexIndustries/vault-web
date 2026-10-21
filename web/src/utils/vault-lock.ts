import type { SyncConnectionController } from "@cryptex-industries/vault-core/synchronization";
import type { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { vaultWriteCoordinator } from "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator";
import { logoutOnlineServicesSession } from "@/app_lib/auth-session";
import { vaultLog, vaultLogger } from "@/utils/logging";
import { unlockedVaultAtom, vaultStore } from "@/utils/atoms";
import {
    clearVaultDEKFromSession,
    saveVaultWithSessionDEK,
    type VaultSessionError,
} from "@/utils/vault-session";
import { err, ok, type Result } from "neverthrow";
import {
    flushManagedBackupBeforeLock,
    stopManagedBackup,
} from "@/app_lib/managed-backup-hooks";

type SetUnlockedVault = (
    vault: Vault | ((previous: Vault) => Vault | Promise<Vault>),
) => void | Promise<void>;

type SetUnlockedVaultMetadata = (metadata: VaultMetadata | null) => void;

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

/** The lock running for a session, shared by everyone asking to lock it. */
let locking: {
    metadata: VaultMetadata;
    result: Promise<Result<void, VaultLockError>>;
} | null = null;

export function lockUnlockedVault(
    options: LockUnlockedVaultOptions,
): Promise<Result<void, VaultLockError>> {
    const metadata = options.unlockedVaultMetadata;
    // Already locking this session (the Lock button, then leaving the
    // page): wait for that lock instead of queueing a second one, which
    // would find the session closed and fail.
    if (metadata && locking?.metadata === metadata) return locking.result;
    const result = lockVaultNow(options).catch(
        (error: unknown): Result<void, VaultLockError> => {
            vaultLog.error("Failed to lock vault", { error });
            return err("VAULT_LOCK_FAILED");
        },
    );
    if (!metadata) return result;
    const current = { metadata, result };
    locking = current;
    void result.finally(() => {
        if (locking === current) locking = null;
    });
    return result;
}

function lockVaultNow({
    unlockedVaultMetadata,
    setUnlockedVault,
    setUnlockedVaultMetadata,
    syncConnectionController,
}: LockUnlockedVaultOptions): Promise<Result<void, VaultLockError>> {
    return vaultWriteCoordinator.run("vault.lock", async () => {
        if (!unlockedVaultMetadata) {
            return err("VAULT_METADATA_MISSING");
        }

        const saveRes = await saveVaultWithSessionDEK(
            unlockedVaultMetadata,
            vaultStore.get(unlockedVaultAtom),
        );
        if (saveRes.isErr()) {
            return err(saveRes.error);
        }

        await flushManagedBackupBeforeLock();

        try {
            syncConnectionController?.teardown();
            clearVaultDEKFromSession();
            stopManagedBackup();

            await logoutOnlineServicesSession();
            setUnlockedVaultMetadata(null);
            await setUnlockedVault(async () => new Vault());
            vaultLogger.clearAll();

            return ok(undefined);
        } catch (error) {
            vaultLog.error("Failed to lock vault", { error });
            return err("VAULT_LOCK_FAILED");
        }
    });
}

/**
 * Closes a vault without saving it, when this tab doesn't hold the one-tab
 * claim for it (see vault-tab-owner.ts): saving a copy no claim covered
 * could overwrite another tab's newer changes.
 */
export async function discardUnlockedVault({
    setUnlockedVault,
    setUnlockedVaultMetadata,
}: Pick<
    LockUnlockedVaultOptions,
    "setUnlockedVault" | "setUnlockedVaultMetadata"
>): Promise<void> {
    clearVaultDEKFromSession();
    try {
        await logoutOnlineServicesSession();
    } catch (error) {
        vaultLog.error("Failed to sign out of Online Services", { error });
    }
    setUnlockedVaultMetadata(null);
    await setUnlockedVault(async () => new Vault());
    vaultLogger.clearAll();
}
