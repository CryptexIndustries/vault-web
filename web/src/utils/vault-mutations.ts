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
    type VaultSessionError,
} from "@/utils/vault-session";

export type VaultMutationError =
    | "VAULT_METADATA_MISSING"
    | VaultSessionError
    | "VAULT_MUTATION_FAILED";

export type VaultMutation<T> = (
    currentVault: Vault,
) => Promise<{ vault: Vault; result: T }> | { vault: Vault; result: T };

/**
 * The web application's unlocked-vault mutation persistence boundary.
 *
 * The latest state is read after entering the single-writer queue. The next
 * state is persisted before it is published to Jotai, so failed writes never
 * masquerade as durable UI changes.
 */
export async function persistVaultMutation<T>(
    kind: VaultWriteKind,
    mutate: VaultMutation<T>,
): Promise<Result<T, VaultMutationError>> {
    return vaultWriteCoordinator.run(kind, async () => {
        const metadata = vaultStore.get(unlockedVaultMetadataAtom);
        if (!metadata) return err("VAULT_METADATA_MISSING");

        const currentVault = vaultStore.get(unlockedVaultAtom);
        let mutation: { vault: Vault; result: T };
        try {
            mutation = await mutate(currentVault);
        } catch {
            return err("VAULT_MUTATION_FAILED");
        }

        const saveResult = await saveVaultWithSessionDEK(
            metadata,
            mutation.vault,
        );
        if (saveResult.isErr()) return err(saveResult.error);

        vaultStore.set(unlockedVaultAtom, mutation.vault);
        return ok(mutation.result);
    });
}
