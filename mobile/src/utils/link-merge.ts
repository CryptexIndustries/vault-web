/**
 * Persists received items into the unlocked vault.
 * Retains existing item IDs; an explicit Online Services binding may replace the current one.
 */
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    Directory,
    LinkedDevices,
    OnlineServices,
    TOTP,
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { ensureSyncKemKeypair } from "@cryptex-industries/vault-core/vault-utils/post-quantum-kem";
import { ensureSyncSigningKeypair } from "@cryptex-industries/vault-core/vault-utils/sync-signing";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { MISSING_VAULT_SECRET_ERROR } from "@/utils/vault-session";
import {
    mergeReceivedVaultContents,
    receiverSyncKeyMaterial,
    type ReceiveMergeSummary,
    type ReceiverSyncKeyMaterial,
} from "@/utils/link-merge-policy";

export type { ReceiveMergeSummary };
export type { ReceiverSyncKeyMaterial };
export {
    mergeReceivedVaultContents,
    receiverSyncKeyMaterial,
} from "@/utils/link-merge-policy";

/**
 * The receiver handshake for an unlocked merge must advertise the active
 * vault's identity. Generate and persist missing keys before the handshake so
 * the merged vault later signs with the same keys the sender pinned.
 */
export async function ensureActiveVaultSyncKeyMaterial(): Promise<ReceiverSyncKeyMaterial> {
    const mutationResult = await persistVaultMutation(
        "vault.configuration",
        async (currentVault) => {
            const updatedVault = Object.assign(new Vault(), currentVault);
            updatedVault.LinkedDevices = LinkedDevices.fromGeneric(
                currentVault.LinkedDevices,
            );
            await ensureSyncSigningKeypair(updatedVault.LinkedDevices);
            await ensureSyncKemKeypair(updatedVault.LinkedDevices);
            return {
                vault: updatedVault,
                result: receiverSyncKeyMaterial(updatedVault.LinkedDevices),
            };
        },
    );
    if (mutationResult.isErr()) {
        throw new Error(
            mutationResult.error === "VAULT_DEK_NOT_FOUND"
                ? MISSING_VAULT_SECRET_ERROR
                : "Failed to prepare this vault's synchronization identity.",
        );
    }
    return mutationResult.value;
}

const cloneCredential = (credential: VaultUtilTypes.Credential) => {
    const cloned = Object.assign(new VaultCredential(), credential);
    if (credential.TOTP) {
        cloned.TOTP = Object.assign(new TOTP(), credential.TOTP);
    }
    return cloned;
};

async function parseReceivedVault(data: Uint8Array): Promise<Vault> {
    const rawVault = VaultUtilTypes.Vault.decode(data);
    const receivedVault = Object.assign(new Vault(), rawVault);
    receivedVault.LinkedDevices = LinkedDevices.fromGeneric(
        receivedVault.LinkedDevices,
    );
    receivedVault.Credentials = receivedVault.Credentials.map(cloneCredential);
    receivedVault.Directories = receivedVault.Directories.map((directory) =>
        Object.assign(new Directory(), directory),
    );
    await receivedVault.upgrade();
    return receivedVault;
}

export async function mergeReceivedVaultIntoActive(params: {
    receivedVaultData: Uint8Array;
    onlineServicesOverwrite: OnlineServices | null;
    senderKeyBundle: VaultUtilTypes.SyncKeyBundle;
}): Promise<ReceiveMergeSummary> {
    const { receivedVaultData, onlineServicesOverwrite, senderKeyBundle } =
        params;

    const mutationResult = await persistVaultMutation(
        "link.merge",
        async (currentVault) => {
            const receivedVault = await parseReceivedVault(receivedVaultData);
            const { vault: mergedVault, summary } = mergeReceivedVaultContents({
                currentVault,
                receivedVault,
                onlineServicesOverwrite,
                senderKeyBundle,
            });

            await ensureSyncSigningKeypair(mergedVault.LinkedDevices);
            await ensureSyncKemKeypair(mergedVault.LinkedDevices);

            return {
                vault: mergedVault,
                result: summary,
            };
        },
    );

    if (mutationResult.isErr()) {
        throw new Error(
            mutationResult.error === "VAULT_DEK_NOT_FOUND"
                ? MISSING_VAULT_SECRET_ERROR
                : "Failed to persist merged vault.",
        );
    }

    return mutationResult.value;
}
