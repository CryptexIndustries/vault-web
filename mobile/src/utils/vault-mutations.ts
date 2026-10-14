import { err, ok, type Result } from "neverthrow";

import type { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    vaultWriteCoordinator,
    type VaultWriteKind,
} from "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator";
import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "@/utils/atoms";
import {
    saveVaultWithSessionDEK,
    getVaultSessionGeneration,
    type VaultSessionError,
} from "@/utils/vault-session";
import { markManagedBackupDirty } from "@/app_lib/managed-backup-hooks";
import { isAutoLockDue } from "@/utils/session-timeout";

export type VaultMutationError =
    | "VAULT_METADATA_MISSING"
    | VaultSessionError
    | "VAULT_MUTATION_FAILED";

export type VaultMutation<T> = (
    currentVault: Vault,
) => Promise<{ vault: Vault; result: T }> | { vault: Vault; result: T };

export async function persistVaultMutation<T>(
    kind: VaultWriteKind,
    mutate: VaultMutation<T>,
): Promise<Result<T, VaultMutationError>> {
    const generation = getVaultSessionGeneration();
    return vaultWriteCoordinator.run(kind, async () => {
        if (generation !== getVaultSessionGeneration() || isAutoLockDue())
            return err("VAULT_MUTATION_FAILED");
        const metadata = vaultStore.get(unlockedVaultMetadataAtom);
        if (!metadata) return err("VAULT_METADATA_MISSING");

        const currentVault = vaultStore.get(unlockedVaultAtom);
        let mutation: { vault: Vault; result: T };
        try {
            mutation = await mutate(currentVault);
        } catch {
            return err("VAULT_MUTATION_FAILED");
        }

        if (generation !== getVaultSessionGeneration() || isAutoLockDue())
            return err("VAULT_MUTATION_FAILED");
        const saveResult = await saveVaultWithSessionDEK(
            metadata,
            mutation.vault,
        );
        if (saveResult.isErr()) return err(saveResult.error);
        if (generation !== getVaultSessionGeneration() || isAutoLockDue())
            return err("VAULT_MUTATION_FAILED");

        vaultStore.set(unlockedVaultAtom, mutation.vault);
        markManagedBackupDirty();
        return ok(mutation.result);
    });
}
