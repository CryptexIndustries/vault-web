import { err, ok, type Result } from "neverthrow";

import type {
    VaultMetadata,
    VaultSecurityUpdate,
} from "@/app_lib/vault-utils/storage";
import { queueManagedBackupNow } from "@/app_lib/managed-backup-hooks";
import { unlockedVaultMetadataAtom, vaultStore } from "@/utils/atoms";
import { setVaultDEKInSession } from "@/utils/vault-session";
import { vaultWriteCoordinator } from "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator";

export type PublishedVaultSecurityUpdate = Omit<
    VaultSecurityUpdate,
    "sessionDek"
>;

export type VaultSecurityMutationError = string;

function publishMetadata(metadata: VaultMetadata): void {
    // Publish a new reference only after durable persistence succeeds.
    const published = Object.assign(
        Object.create(Object.getPrototypeOf(metadata)) as VaultMetadata,
        metadata,
    );
    vaultStore.set(unlockedVaultMetadataAtom, published);
}

async function runSecurityMutation(
    kind: "vault.security.reconfigure" | "vault.recovery.rotate",
    operation: (
        metadata: VaultMetadata,
    ) => Promise<Result<VaultSecurityUpdate, string>>,
    deleteOlderManagedBackups: boolean,
): Promise<Result<PublishedVaultSecurityUpdate, VaultSecurityMutationError>> {
    return vaultWriteCoordinator.run(kind, async () => {
        const metadata = vaultStore.get(unlockedVaultMetadataAtom);
        if (!metadata) return err("VAULT_METADATA_MISSING");

        let result: Result<VaultSecurityUpdate, string>;
        try {
            result = await operation(metadata);
        } catch {
            return err("VAULT_SECURITY_UPDATE_FAILED");
        }
        if (result.isErr()) return err(result.error);

        const { sessionDek, ...published } = result.value;
        if (sessionDek) setVaultDEKInSession(sessionDek);
        publishMetadata(metadata);
        queueManagedBackupNow(deleteOlderManagedBackups);
        return ok(published);
    });
}

export function reconfigureUnlockedVaultSecurity(
    params: Parameters<VaultMetadata["reconfigureSecurity"]>[0] & {
        deleteOlderManagedBackups?: boolean;
    },
): Promise<Result<PublishedVaultSecurityUpdate, VaultSecurityMutationError>> {
    const { deleteOlderManagedBackups = false, ...securityParams } = params;
    return runSecurityMutation(
        "vault.security.reconfigure",
        (metadata) => metadata.reconfigureSecurity(securityParams),
        deleteOlderManagedBackups,
    );
}

export function rotateUnlockedVaultRecoveryCode(
    params: Parameters<VaultMetadata["resetRecoveryCode"]>[0] & {
        deleteOlderManagedBackups?: boolean;
    },
): Promise<Result<PublishedVaultSecurityUpdate, VaultSecurityMutationError>> {
    const { deleteOlderManagedBackups = false, ...securityParams } = params;
    return runSecurityMutation(
        "vault.recovery.rotate",
        (metadata) => metadata.resetRecoveryCode(securityParams),
        deleteOlderManagedBackups,
    );
}
