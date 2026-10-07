import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import "@/app_lib/vault-core-runtime";
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
import { VaultMetadata } from "@/app_lib/vault-utils/storage";
import {
    SyncConnectionController,
    type VaultOperations,
} from "@cryptex-industries/vault-core/synchronization";
import { WebRTCStatus } from "@cryptex-industries/vault-core/synchronization-utils";
import { uiLog } from "@/utils/logging";
import { vaultGet } from "@/utils/atoms";
import { persistVaultMutation } from "@/utils/vault-mutations";

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

export function shouldAutoReconnectAfterWebRTCStatus(
    device: Pick<VaultUtilTypes.LinkedDevice, "AutoConnect">,
    connectionState: WebRTCStatus,
) {
    return device.AutoConnect && connectionState === WebRTCStatus.Disconnected;
}

export const createVaultOperations = (): VaultOperations => {
    return {
        getCredentialVersionVectors: async () =>
            getSyncVersionVectors(vaultGet().Credentials),
        getDirectoryVersionVectors: async () =>
            getSyncVersionVectors(vaultGet().Directories),
        getItems: async (items: VaultUtilTypes.SyncItemReference[]) =>
            selectSyncItems(vaultGet(), items),
        updateItems: async (
            directories: VaultUtilTypes.Directory[],
            credentials: VaultUtilTypes.Credential[],
        ) => {
            const toastId = toast.loading("Updating vault data...");
            const mutationResult = await persistVaultMutation(
                "synchronization.apply",
                async (currentVault) => {
                    const updatedDirectories =
                        await applyReceivedSyncDirectories(
                            currentVault.Directories,
                            directories,
                            (directory) =>
                                Object.assign(new Directory(), directory),
                        );
                    const activeDirectoryIDs = new Set(
                        updatedDirectories
                            .filter((directory) => !directory.Deleted)
                            .map((directory) => directory.ID),
                    );
                    const deletedDirectoryIDs = new Set(
                        updatedDirectories
                            .filter((directory) => directory.Deleted)
                            .map((directory) => directory.ID),
                    );
                    const credentialsMap = new Map(
                        currentVault.Credentials.map((credential) => [
                            credential.ID,
                            Object.assign(new VaultCredential(), credential),
                        ]),
                    );

                    // Update existing credentials and append missing ones without mutating state in place.
                    for (const credential of credentials) {
                        const existing = credentialsMap.get(credential.ID);
                        if (
                            !shouldAcceptVersionedRecord(existing, credential)
                        ) {
                            continue;
                        }
                        const hydrated = Object.assign(
                            new VaultCredential(),
                            credential,
                        );
                        if (
                            hydrated.DirectoryID &&
                            (!activeDirectoryIDs.has(hydrated.DirectoryID) ||
                                deletedDirectoryIDs.has(hydrated.DirectoryID))
                        ) {
                            hydrated.Name = "Unnamed item";
                            hydrated.Username = "";
                            hydrated.Password = "";
                            hydrated.TOTP = undefined;
                            hydrated.Tags = "";
                            hydrated.URL = "";
                            hydrated.URLMatchMode =
                                VaultUtilTypes.CredentialURLMatchMode.ExactHost;
                            hydrated.AdditionalURLs = [];
                            hydrated.Notes = "";
                            hydrated.CustomFields = [];
                            hydrated.Deleted = true;
                            hydrated.Hash = await hashCredential(hydrated);
                        }
                        credentialsMap.set(hydrated.ID, hydrated);
                    }
                    for (const credential of credentialsMap.values()) {
                        if (
                            !credential.Deleted &&
                            deletedDirectoryIDs.has(credential.DirectoryID)
                        ) {
                            credential.Name = "Unnamed item";
                            credential.Username = "";
                            credential.Password = "";
                            credential.TOTP = undefined;
                            credential.Tags = "";
                            credential.URL = "";
                            credential.URLMatchMode =
                                VaultUtilTypes.CredentialURLMatchMode.ExactHost;
                            credential.AdditionalURLs = [];
                            credential.Notes = "";
                            credential.CustomFields = [];
                            credential.Deleted = true;
                            credential.Version += 1;
                            credential.DateModifiedTimestamp =
                                updatedDirectories.find(
                                    (directory) =>
                                        directory.ID === credential.DirectoryID,
                                )?.DateModifiedTimestamp ?? Date.now();
                            credential.Hash = await hashCredential(credential);
                        }
                    }

                    const updatedVault = Object.assign(
                        Object.create(Object.getPrototypeOf(currentVault)),
                        currentVault,
                        {
                            Directories: updatedDirectories,
                            Credentials: Array.from(credentialsMap.values()),
                        },
                    );
                    return { vault: updatedVault, result: undefined };
                },
            );

            if (mutationResult.isErr()) {
                uiLog.error(
                    "An error occurred while saving vault data after synchronization.",
                    {
                        error: mutationResult.error,
                    },
                );
                toast.error(
                    "An error occurred while saving the vault data after synchronization. Please check the logs for more information.",
                    {
                        id: toastId,
                        duration: 3000,
                    },
                );
                throw new Error(mutationResult.error);
            }

            toast.success("Vault data saved.", {
                id: toastId,
                duration: 3000,
            });
        },
        getSynchronizationConfig: async () => vaultGet().LinkedDevices,
        getSyncSigningPublicKey: async () => {
            const publicKey = vaultGet().LinkedDevices.SyncSigningPublicKey;
            return publicKey || null;
        },
        getSyncSigningPrivateKey: async () => {
            const privateKey = vaultGet().LinkedDevices.SyncSigningPrivateKey;
            return privateKey || null;
        },
        getSyncKemPublicKey: async () => {
            const publicKey = vaultGet().LinkedDevices.SyncKemPublicKey;
            return publicKey || null;
        },
        getSyncKemPrivateKey: async () => {
            const privateKey = vaultGet().LinkedDevices.SyncKemPrivateKey;
            return privateKey || null;
        },
        getRemoteSyncPublicKey: async (linkedDeviceId: string) => {
            const device = vaultGet().LinkedDevices.Devices.find(
                (entry) => entry.ID === linkedDeviceId,
            );
            return device?.RemoteSyncPublicKey || null;
        },
        getRemoteSyncKemPublicKey: async (linkedDeviceId: string) => {
            const device = vaultGet().LinkedDevices.Devices.find(
                (entry) => entry.ID === linkedDeviceId,
            );
            return device?.RemoteSyncKemPublicKey || null;
        },
    };
};

export const createSyncConnectionController = () => {
    return new SyncConnectionController(createVaultOperations());
};

export function useSyncConnectionController(
    vaultMetadata: VaultMetadata | null,
) {
    const vaultMetadataLifecycleKey =
        getVaultMetadataLifecycleKey(vaultMetadata);
    const syncConnectionControllerEntry = useMemo(
        () => ({
            key: vaultMetadataLifecycleKey,
            controller: createSyncConnectionController(),
        }),
        [vaultMetadataLifecycleKey],
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
