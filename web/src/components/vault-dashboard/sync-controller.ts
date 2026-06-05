import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import * as VaultUtilTypes from "@/app_lib/proto/vault";
import { Vault } from "@/app_lib/vault-utils/vault";
import { VaultMetadata } from "@/app_lib/vault-utils/storage";
import {
    SyncConnectionController,
    type VaultOperations,
} from "@/app_lib/synchronization";
import { uiLog } from "@/utils/logging";
import { vaultGet } from "@/utils/atoms";
import { getVaultDEKFromSession } from "@/utils/vault-session";

type SetUnlockedVault = (vault: Vault | ((prev: Vault) => Vault)) => void;
type VaultMetadataProvider = () => VaultMetadata | null;

const fallbackVaultMetadataKeys = new WeakMap<VaultMetadata, string>();
let fallbackVaultMetadataKeyCounter = 0;

export function getVaultMetadataLifecycleKey(
    vaultMetadata: VaultMetadata | null,
) {
    if (!vaultMetadata) return "locked";

    const vaultID = vaultMetadata.Blob?.Envelope?.VaultID;
    if (vaultMetadata.DBIndex != null && vaultID) {
        return `db:${vaultMetadata.DBIndex}:vault:${vaultID}`;
    }

    if (vaultMetadata.DBIndex != null) {
        return `db:${vaultMetadata.DBIndex}`;
    }

    if (vaultID) {
        return `vault:${vaultID}`;
    }

    let fallbackKey = fallbackVaultMetadataKeys.get(vaultMetadata);
    if (!fallbackKey) {
        fallbackVaultMetadataKeyCounter += 1;
        fallbackKey = `metadata:${fallbackVaultMetadataKeyCounter}`;
        fallbackVaultMetadataKeys.set(vaultMetadata, fallbackKey);
    }

    return fallbackKey;
}

export const createVaultOperations = (
    setUnlockedVault: SetUnlockedVault,
    getVaultMetadata: VaultMetadataProvider,
): VaultOperations => {
    return {
        getItemVersionVectors: async () => {
            return vaultGet().Credentials.map((c) => ({
                ID: c.ID,
                Hash: c.Hash,
                Version: c.Version,
                DateModifiedTimestamp: c.DateModifiedTimestamp,
                Deleted: c.Deleted,
            }));
        },
        getItemCredentials: async (itemIDs: string[]) =>
            vaultGet().Credentials.filter((c) => itemIDs.includes(c.ID)),
        updateCredentials: async (credentials: VaultUtilTypes.Credential[]) => {
            const currentVault = vaultGet();
            const credentialsMap = new Map(
                currentVault.Credentials.map((credential) => [
                    credential.ID,
                    credential,
                ]),
            );

            // Update existing credentials and append missing ones without mutating state in place.
            for (const credential of credentials) {
                credentialsMap.set(credential.ID, credential);
            }

            const updatedVault = Object.assign(
                Object.create(Object.getPrototypeOf(currentVault)),
                currentVault,
                {
                    Credentials: Array.from(credentialsMap.values()),
                },
            );

            setUnlockedVault(updatedVault);

            const toastId = toast.loading("Updating vault data...");

            try {
                const vaultSecretRes = getVaultDEKFromSession();
                if (vaultSecretRes.isErr()) {
                    uiLog.error(
                        "Failed to save vault data after synchronization. Failed to retrieve the encryption secret.",
                        {
                            error: vaultSecretRes.error,
                        },
                    );
                    toast.error(
                        "Failed to save vault data after synchronization. Please check the logs for more information.",
                        {
                            id: toastId,
                        },
                    );
                    return;
                }

                const vaultMetadata = getVaultMetadata();
                if (vaultMetadata) {
                    await vaultMetadata.save(updatedVault, vaultSecretRes.value);
                }

                toast.success("Vault data saved.", {
                    id: toastId,
                    duration: 3000,
                });
            } catch (e) {
                uiLog.error(
                    "An error occurred while saving vault data after synchronization.",
                    {
                        error: e,
                    },
                );
                toast.error(
                    "An error occurred while saving the vault data after synchronization. Please check the logs for more information.",
                    {
                        id: toastId,
                        duration: 3000,
                    },
                );
            }
        },
        getSynchronizationConfig: async () => vaultGet().LinkedDevices,
    };
};

export const createSyncConnectionController = (
    setUnlockedVault: SetUnlockedVault,
    getVaultMetadata: VaultMetadataProvider,
) => {
    return new SyncConnectionController(
        createVaultOperations(setUnlockedVault, getVaultMetadata),
    );
};

export function useSyncConnectionController(
    setUnlockedVault: SetUnlockedVault,
    vaultMetadata: VaultMetadata | null,
) {
    const vaultMetadataRef = useRef(vaultMetadata);
    vaultMetadataRef.current = vaultMetadata;

    const vaultMetadataLifecycleKey = getVaultMetadataLifecycleKey(vaultMetadata);
    const syncConnectionControllerEntry = useMemo(
        () => ({
            key: vaultMetadataLifecycleKey,
            controller: createSyncConnectionController(
                setUnlockedVault,
                () => vaultMetadataRef.current,
            ),
        }),
        [setUnlockedVault, vaultMetadataLifecycleKey],
    );
    const syncConnectionController = syncConnectionControllerEntry.controller;

    useEffect(() => {
        syncConnectionController.init();
        return () => {
            syncConnectionController.teardown();
        };
    }, [syncConnectionController]);

    return syncConnectionController;
}
