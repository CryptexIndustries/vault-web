import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import * as VaultUtilTypes from "@/app_lib/proto/vault";
import {
    Directory,
    hashCredential,
    resolveDirectoryNameCollisions,
    shouldAcceptVersionedRecord,
    Vault,
    VaultCredential,
} from "@/app_lib/vault-utils/vault";
import { VaultMetadata } from "@/app_lib/vault-utils/storage";
import {
    SyncConnectionController,
    type VaultOperations,
} from "@/app_lib/synchronization";
import { WebRTCStatus } from "@/app_lib/synchronization-utils";
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

export function shouldAutoReconnectAfterWebRTCStatus(
    device: Pick<VaultUtilTypes.LinkedDevice, "AutoConnect">,
    connectionState: WebRTCStatus,
) {
    return device.AutoConnect && connectionState === WebRTCStatus.Disconnected;
}

export const createVaultOperations = (
    setUnlockedVault: SetUnlockedVault,
    getVaultMetadata: VaultMetadataProvider,
): VaultOperations => {
    return {
        getCredentialVersionVectors: async () => {
            return vaultGet().Credentials.map((c) => ({
                ID: c.ID,
                Hash: c.Hash,
                Version: c.Version,
                DateModifiedTimestamp: c.DateModifiedTimestamp,
                Deleted: c.Deleted,
            }));
        },
        getDirectoryVersionVectors: async () =>
            vaultGet().Directories.map((directory) => ({
                ID: directory.ID,
                Hash: directory.Hash,
                Version: directory.Version,
                DateModifiedTimestamp: directory.DateModifiedTimestamp,
                Deleted: directory.Deleted,
            })),
        getItems: async (items: VaultUtilTypes.SyncItemReference[]) => {
            const credentialIDs = new Set(
                items
                    .filter(
                        (item) =>
                            item.Type ===
                            VaultUtilTypes.SyncItemType.CredentialItem,
                    )
                    .map((item) => item.ID),
            );
            const directoryIDs = new Set(
                items
                    .filter(
                        (item) =>
                            item.Type ===
                            VaultUtilTypes.SyncItemType.DirectoryItem,
                    )
                    .map((item) => item.ID),
            );
            const vault = vaultGet();
            return {
                Credentials: vault.Credentials.filter((credential) =>
                    credentialIDs.has(credential.ID),
                ),
                Directories: vault.Directories.filter((directory) =>
                    directoryIDs.has(directory.ID),
                ),
            };
        },
        updateItems: async (
            directories: VaultUtilTypes.Directory[],
            credentials: VaultUtilTypes.Credential[],
        ) => {
            const currentVault = vaultGet();
            const directoriesMap = new Map(
                currentVault.Directories.map((directory) => [
                    directory.ID,
                    Object.assign(new Directory(), directory),
                ]),
            );
            for (const directory of directories) {
                const existing = directoriesMap.get(directory.ID);
                if (!shouldAcceptVersionedRecord(existing, directory)) {
                    continue;
                }
                directoriesMap.set(
                    directory.ID,
                    Object.assign(new Directory(), directory),
                );
            }
            const updatedDirectories = Array.from(directoriesMap.values());
            await resolveDirectoryNameCollisions(updatedDirectories);
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
                if (!shouldAcceptVersionedRecord(existing, credential)) {
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
                    await vaultMetadata.save(
                        updatedVault,
                        vaultSecretRes.value,
                    );
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

    const vaultMetadataLifecycleKey =
        getVaultMetadataLifecycleKey(vaultMetadata);
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
