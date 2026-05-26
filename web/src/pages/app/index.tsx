import React, { useEffect } from "react";

import { useAtomValue, useSetAtom } from "jotai";

import dayjs from "dayjs";
import RelativeTime from "dayjs/plugin/relativeTime";

import * as Storage from "../../app_lib/vault-utils/storage";
import * as Vault from "../../app_lib/vault-utils/vault";
import * as FormSchemas from "../../app_lib/vault-utils/form-schemas";
import * as VaultEncryption from "../../app_lib/vault-utils/encryption";
import HTMLHeader from "../../components/html-header";
import HTMLMain from "../../components/html-main";

import {
    isVaultUnlockedAtom,
    setOnlineServicesData,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
} from "../../utils/atoms";
import VaultManager from "@/components/vault-manager/layout";
import { err, ok } from "neverthrow";
import { VaultDashboard } from "@/components/vault-dashboard/vault-dashboard";
import {
    clearVaultSecretFromSession,
    setVaultSecretInSession,
} from "@/utils/vault-session";
import {
    establishPremiumSession,
    syncOnlineServicesRemoteConfiguration,
} from "src/app_lib/auth-session";
import { onlineServicesLog } from "src/utils/logging";

dayjs.extend(RelativeTime);

const AppIndex: React.FC = () => {
    const isVaultUnlocked = useAtomValue(isVaultUnlockedAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);
    // const refreshOnlineServicesRemoteData = useFetchOnlineServicesData();

    // Create sync connection controller with vault operations
    // const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    // if (!GlobalSyncConnectionController) {
    //     GlobalSyncConnectionController = createSyncConnectionController(setUnlockedVault, vaultMetadata);
    //     GlobalSyncConnectionController.init();
    // }

    console.debug("MAIN RERENDER", isVaultUnlocked);

    // useEffect(() => {
    //     return () => {
    //         console.warn(
    //             "[SCC - Verbose Signaling] Cleaning up the sync connection controller...",
    //             isVaultUnlocked,
    //         );
    //         // Clean up the synchronization connections, if any
    //         GlobalSyncConnectionController.teardown();
    //     };
    // }, [isVaultUnlocked]);
    //

    // Register the beforeunload event handler
    useEffect(() => {
        window.addEventListener("beforeunload", clearVaultSecretFromSession);
        return () => {
            window.removeEventListener(
                "beforeunload",
                clearVaultSecretFromSession,
            );
        };
    }, []);

    const tryVaultDecrypt = async (
        metadata: Storage.VaultMetadata,
        formData: FormSchemas.EncryptionFormGroupSchemaType,
    ) => {
        const vaultRes = await metadata.decryptVault(
            formData.Secret,
            formData.Encryption,
            formData.EncryptionKeyDerivationFunction,
            formData.EncryptionConfig,
        );

        if (vaultRes.isErr()) return err(vaultRes.error);

        const { vault, encryptionData } = vaultRes.value;

        // Set the vault metadata and vault atoms
        setVaultSecretInSession(encryptionData);

        // Rewrite the encryption data to random bytes
        crypto.getRandomValues(encryptionData);

        try {
            if (vault && Vault.Vault.isOnlineServicesBound(vault)) {
                setOnlineServicesData({
                    deviceId: vault.OnlineServices.DeviceId,
                    sessionToken: null,
                    sessionExpiresAt: null,
                    remoteData: null,
                });

                await establishPremiumSession({
                    deviceId: vault.OnlineServices.DeviceId,
                    privateKeyJWK: vault.OnlineServices.PrivateKeyJWK,
                });
                await syncOnlineServicesRemoteConfiguration();
            }
        } catch (e) {
            onlineServicesLog.error(
                "Failed to establish Online Services session",
                {
                    error: e,
                },
            );
        }

        setUnlockedVaultMetadata(metadata);
        setUnlockedVault(vault);

        return ok();
    };

    const tryCreateVault = async (
        formData: FormSchemas.NewVaultFormSchemaType &
            FormSchemas.EncryptionFormGroupSchemaType,
    ) => {
        try {
            const vaultMetadata = await Storage.VaultMetadata.createNewVault(
                formData,
                formData,
                false,
                0,
            );

            // Passing a null vault instance and a new Uint8Array(0) as the secret is valid, as we are just saving the already-encrypted blob to the database
            await vaultMetadata.save(null, new Uint8Array(0));
        } catch (e) {
            console.error("Failed to create a vault", e);
            return false;
        }

        return true;
    };

    const tryRestoreVault = async (
        formData: FormSchemas.VaultRestoreFormSchema,
    ) => {
        let validBackupFile: VaultEncryption.EncryptedBlob | null = null;
        try {
            validBackupFile = VaultEncryption.EncryptedBlob.fromBinary(
                new Uint8Array(await formData.BackupFile.arrayBuffer()),
            );
        } catch (e) {
            console.error(
                "Failed to restore the vault. Could not deserialize the blob.",
                e,
            );
            return false;
        }

        const newVaultMetadataInst = new Storage.VaultMetadata();
        newVaultMetadataInst.Name = formData.Name;
        newVaultMetadataInst.Description = formData.Description;
        newVaultMetadataInst.Blob = validBackupFile;

        try {
            // Passing a null vault instance and a new Uint8Array(0) as the secret is valid, as we are just saving the already-encrypted blob to the database
            await newVaultMetadataInst.save(null, new Uint8Array(0));
        } catch (e) {
            console.error("Failed to save the restored vault metadata", e);
            return false;
        }

        return true;
    };

    return (
        <>
            <HTMLHeader
                title="Cryptex Vault"
                description="Decentralized Password Manager"
            />

            <HTMLMain additionalClasses="content flex min-h-screen grow flex-col overflow-clip">
                {
                    // If the vault is not unlocked, show the welcome screen
                    !isVaultUnlocked && (
                        <>
                            <div className="flex grow flex-col items-center justify-center">
                                <VaultManager
                                    tryDecryptVaultCallback={tryVaultDecrypt}
                                    tryCreateVaultCallback={tryCreateVault}
                                    tryRestoreVaultCallback={tryRestoreVault}
                                />
                            </div>
                        </>
                    )
                }

                {isVaultUnlocked && <VaultDashboard />}
            </HTMLMain>
        </>
    );
};

export default AppIndex;
