import type { SyncConnectionController } from "@/app_lib/synchronization";
import type { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { Vault } from "@/app_lib/vault-utils/vault";
import {
    clearOnlineServicesSession,
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesAuthenticationStatus,
    onlineServicesStore,
} from "@/utils/atoms";
import { vaultLog, vaultLogger } from "@/utils/logging";
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
    unlockedVault: Vault;
    setUnlockedVault: SetUnlockedVault;
    setUnlockedVaultMetadata: SetUnlockedVaultMetadata;
    syncConnectionController?: SyncConnectionController;
};

export async function lockUnlockedVault({
    unlockedVaultMetadata,
    unlockedVault,
    setUnlockedVault,
    setUnlockedVaultMetadata,
    syncConnectionController,
}: LockUnlockedVaultOptions): Promise<Result<void, VaultLockError>> {
    if (!unlockedVaultMetadata) {
        return err("VAULT_METADATA_MISSING");
    }

    const saveRes = await saveVaultWithSessionDEK(
        unlockedVaultMetadata,
        unlockedVault,
    );
    if (saveRes.isErr()) {
        return err(saveRes.error);
    }

    try {
        syncConnectionController?.teardown();
        clearVaultDEKFromSession();

        onlineServicesStore.set(
            onlineServicesAuthConnectionStatusAtom,
            onlineServicesAuthenticationStatus.disconnected(),
        );
        clearOnlineServicesSession();
        setUnlockedVaultMetadata(null);
        await setUnlockedVault(async () => new Vault());
        vaultLogger.clearAll();

        return ok(undefined);
    } catch (error) {
        vaultLog.error("Failed to lock vault", { error });
        return err("VAULT_LOCK_FAILED");
    }
}
