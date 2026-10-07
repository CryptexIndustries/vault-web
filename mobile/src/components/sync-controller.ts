/**
 * Connects mobile session access and persistence to shared synchronization.
 */
import "@/vault-core-runtime";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    Directory,
    hashCredential,
    shouldAcceptVersionedRecord,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    applyReceivedSyncDirectories,
    getSyncVersionVectors,
    selectSyncItems,
} from "@cryptex-industries/vault-core/sync-operations";
import {
    SyncConnectionController,
    type VaultOperations,
} from "@cryptex-industries/vault-core/synchronization";
import {
    getVaultSessionGeneration,
    getVaultDEKFromSession,
} from "@/utils/vault-session";
import { getUnlockedVault } from "@/utils/atoms";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { vaultLog } from "@/utils/logging";

export const createVaultOperations = (): VaultOperations => {
    const generation = getVaultSessionGeneration();
    const getVault = () => {
        if (
            generation !== getVaultSessionGeneration() ||
            getVaultDEKFromSession().isErr()
        ) {
            throw new Error("Synchronization session is no longer unlocked.");
        }
        return getUnlockedVault();
    };
    return {
        getCredentialVersionVectors: async () =>
            getSyncVersionVectors(getVault().Credentials),
        getDirectoryVersionVectors: async () =>
            getSyncVersionVectors(getVault().Directories),
        getItems: async (items: VaultUtilTypes.SyncItemReference[]) =>
            selectSyncItems(getVault(), items),
        updateItems: async (
            directories: VaultUtilTypes.Directory[],
            credentials: VaultUtilTypes.Credential[],
        ) => {
            const mutationResult = await persistVaultMutation(
                "synchronization.apply",
                async (currentVault) => {
                    getVault();
                    const credentialsMap = new Map(
                        currentVault.Credentials.map((credential) => [
                            credential.ID,
                            credential,
                        ]),
                    );
                    for (const incoming of credentials) {
                        const existing = credentialsMap.get(incoming.ID);
                        if (
                            existing &&
                            !shouldAcceptVersionedRecord(existing, incoming)
                        ) {
                            continue;
                        }
                        const next = Object.assign(
                            Object.create(
                                VaultCredential.prototype,
                            ) as VaultCredential,
                            incoming,
                        );
                        next.Hash = await hashCredential(next);
                        credentialsMap.set(incoming.ID, next);
                    }

                    const updatedVault = Object.assign(
                        Object.create(Object.getPrototypeOf(currentVault)),
                        currentVault,
                    );
                    updatedVault.Directories =
                        await applyReceivedSyncDirectories(
                            currentVault.Directories,
                            directories,
                            (directory) =>
                                Object.assign(
                                    Object.create(
                                        Directory.prototype,
                                    ) as Directory,
                                    directory,
                                ),
                        );
                    updatedVault.Credentials = [...credentialsMap.values()];
                    return { vault: updatedVault, result: undefined };
                },
            );
            if (mutationResult.isErr()) {
                vaultLog.error("Sync apply failed", {
                    error: mutationResult.error,
                });
                throw new Error("Failed to apply sync items");
            }
        },
        recordSynchronization: async (linkedDeviceId) => {
            getVault();
            const result = await persistVaultMutation(
                "synchronization.apply",
                (current) => {
                    getVault();
                    const next = Object.assign(
                        Object.create(Object.getPrototypeOf(current)),
                        current,
                    );
                    next.LinkedDevices = {
                        ...current.LinkedDevices,
                        Devices: current.LinkedDevices.Devices.map((device) =>
                            device.ID === linkedDeviceId
                                ? {
                                      ...device,
                                      LastSync: new Date().toISOString(),
                                  }
                                : device,
                        ),
                    };
                    return { vault: next, result: undefined };
                },
            );
            if (result.isErr())
                throw new Error("Failed to save synchronization status");
        },
        getSynchronizationConfig: async () => getVault().LinkedDevices,
        getSyncSigningPublicKey: async () => {
            return getVault().LinkedDevices.SyncSigningPublicKey || null;
        },
        getSyncSigningPrivateKey: async () => {
            return getVault().LinkedDevices.SyncSigningPrivateKey || null;
        },
        getSyncKemPublicKey: async () => {
            return getVault().LinkedDevices.SyncKemPublicKey || null;
        },
        getSyncKemPrivateKey: async () => {
            return getVault().LinkedDevices.SyncKemPrivateKey || null;
        },
        getRemoteSyncPublicKey: async (linkedDeviceId: string) => {
            const device = getVault().LinkedDevices.Devices.find(
                (entry) => entry.ID === linkedDeviceId,
            );
            return device?.RemoteSyncPublicKey || null;
        },
        getRemoteSyncKemPublicKey: async (linkedDeviceId: string) => {
            const device = getVault().LinkedDevices.Devices.find(
                (entry) => entry.ID === linkedDeviceId,
            );
            return device?.RemoteSyncKemPublicKey || null;
        },
    };
};

export const createSyncConnectionController = () => {
    return new SyncConnectionController(createVaultOperations());
};
