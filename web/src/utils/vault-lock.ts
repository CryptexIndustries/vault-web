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

export async function lockUnlockedVault({
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

        try {
            syncConnectionController?.teardown();
            clearVaultDEKFromSession();

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
