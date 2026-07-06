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
    clearVaultDEKFromSession,
    setVaultDEKInSessionForMetadata,
} from "@/utils/vault-session";
import type {
    VaultCreateSecondFactorOptions,
    VaultPendingUnlock,
    VaultRevealSecrets,
} from "@/app_lib/vault-utils/vault-unlock-types";
import type { ImportResult } from "@/app_lib/vault-utils/import-export";
import { SecondFactorKind } from "@/app_lib/proto/vault";
import {
    establishPremiumSession,
    syncOnlineServicesRemoteConfiguration,
} from "src/app_lib/auth-session";
import { onlineServicesLog } from "src/utils/logging";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";

dayjs.extend(RelativeTime);

const AppIndex: React.FC = () => {
    const isVaultUnlocked = useAtomValue(isVaultUnlockedAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);

    // Register the beforeunload event handler
    useEffect(() => {
        const onUnload = () => {
            clearVaultDEKFromSession();
        };
        window.addEventListener("beforeunload", onUnload);
        return () => {
            window.removeEventListener("beforeunload", onUnload);
        };
    }, []);

    const finalizeVaultUnlock = (
        metadata: Storage.VaultMetadata,
        vault: Vault.Vault,
        dek: CryptoKey,
    ) => {
        setVaultDEKInSessionForMetadata(metadata, dek);
        setUnlockedVaultMetadata(metadata);
        setUnlockedVault(vault);
    };

    const tryVaultDecrypt = async (
        metadata: Storage.VaultMetadata,
        formData: FormSchemas.EncryptionFormGroupSchemaType,
        unlockExtras?: {
            useRecovery?: boolean;
            recoveryCode?: string;
            secondFactorPassphrase?: string;
        },
    ) => {
        // WebAuthn unlock is resolved inside decryptVault from the synced
        // envelope slot; no device-local lookup needed.
        const vaultRes = await metadata.decryptVault(
            formData.Secret,
            formData.Encryption,
            formData.EncryptionKeyDerivationFunction,
            formData.EncryptionConfig,
            {
                masterPassword: formData.Secret,
                useRecovery: unlockExtras?.useRecovery,
                recoveryCode: unlockExtras?.recoveryCode,
                secondFactorPassphrase: unlockExtras?.secondFactorPassphrase,
            },
        );

        if (vaultRes.isErr()) return err(vaultRes.error);

        const { vault, dek, revealSecrets } = vaultRes.value;

        try {
            if (
                vault &&
                Vault.Vault.isOnlineServicesBound(vault) &&
                isCloudServicesEnabled()
            ) {
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

        if (revealSecrets) {
            return ok({
                revealSecrets,
                pendingUnlock: { metadata, vault, dek },
            });
        }

        finalizeVaultUnlock(metadata, vault, dek);
        return ok({});
    };

    const tryCreateVault = async (
        formData: FormSchemas.NewVaultFormSchemaType &
            FormSchemas.EncryptionFormGroupSchemaType,
        secondFactorOptions?: VaultCreateSecondFactorOptions,
        initialImport?: ImportResult,
    ): Promise<
        | false
        | {
              ok: true;
              revealSecrets: VaultRevealSecrets;
              pendingUnlock: VaultPendingUnlock;
          }
    > => {
        try {
            const created = await Storage.VaultMetadata.createNewVault(
                formData,
                formData,
                false,
                0,
                secondFactorOptions,
                initialImport,
            );

            await created.metadata.save(null, created.dek);

            if (
                secondFactorOptions?.secondFactor &&
                secondFactorOptions.secondFactor.kind !== SecondFactorKind.NONE
            ) {
                await created.metadata.persistSecondFactorEnrollment(
                    created.enrolledFactor,
                );
            }

            // Defer unlocked atoms until the reveal dialog is acknowledged.
            // Setting them here unmounts VaultManager before the dialog renders.
            return {
                ok: true,
                revealSecrets: created.revealSecrets,
                pendingUnlock: {
                    metadata: created.metadata,
                    vault: created.vault,
                    dek: created.dek,
                },
            };
        } catch (e) {
            console.error("Failed to create a vault", e);
            return false;
        }
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
                                    finalizeVaultUnlockCallback={
                                        finalizeVaultUnlock
                                    }
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
