import React, { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAtomValue, useSetAtom } from "jotai";

import dayjs from "dayjs";
import RelativeTime from "dayjs/plugin/relativeTime";

import * as Storage from "../../app_lib/vault-utils/storage";
import * as Vault from "@cryptex-industries/vault-core/vault-utils/vault";
import * as FormSchemas from "@cryptex-industries/vault-core/vault-utils/form-schemas";
import * as VaultEncryption from "@cryptex-industries/vault-core/vault-utils/encryption";
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
    VaultCreateAdditionalKeyProtectionOptions,
    VaultPendingUnlock,
    VaultRevealSecrets,
} from "@cryptex-industries/vault-core/vault-utils/vault-unlock-types";
import type { ImportResult } from "@cryptex-industries/vault-core/vault-utils/import-export";
import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import {
    establishPremiumSession,
    syncOnlineServicesRemoteConfiguration,
} from "src/app_lib/auth-session";
import { onlineServicesLog } from "src/utils/logging";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import {
    consumePurchasePlanUrl,
    readPurchasePlan,
    type PurchasePlan,
} from "@/utils/purchase-onboarding";

dayjs.extend(RelativeTime);

const AppIndex: React.FC = () => {
    const isVaultUnlocked = useAtomValue(isVaultUnlockedAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);
    const [purchasePlan, setPurchasePlan] = useState<PurchasePlan | null>(null);

    useEffect(() => {
        if (isCloudServicesEnabled()) {
            setPurchasePlan(readPurchasePlan(window.location.search));
        } else {
            consumePurchasePlanUrl();
        }
    }, []);

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
            protectionPhrase?: string;
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
                protectionPhrase: unlockExtras?.protectionPhrase,
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
        if (unlockExtras?.useRecovery) {
            toast.info(
                "Vault unlocked with a recovery code. Open Vault Settings > Encryption & Security to set a new master password.",
            );
        }
        return ok({});
    };

    const tryCreateVault = async (
        formData: FormSchemas.NewVaultFormSchemaType &
            FormSchemas.EncryptionFormGroupSchemaType,
        additionalKeyProtectionOptions?: VaultCreateAdditionalKeyProtectionOptions,
        initialImport?: ImportResult,
    ): Promise<
        | false
        | {
              ok: true;
              revealSecrets: VaultRevealSecrets;
              pendingUnlock: VaultPendingUnlock<Storage.VaultMetadata>;
          }
    > => {
        try {
            const created = await Storage.VaultMetadata.createNewVault(
                formData,
                formData,
                false,
                0,
                additionalKeyProtectionOptions,
                initialImport,
            );

            await created.metadata.save(null, created.dek);

            if (
                additionalKeyProtectionOptions?.additionalKeyProtection &&
                additionalKeyProtectionOptions.additionalKeyProtection.kind !==
                    AdditionalKeyProtectionKind.NONE
            ) {
                await created.metadata.persistAdditionalKeyProtectionEnrollment(
                    created.enrolledProtection,
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
    ): Promise<{ dbIndex: number } | false> => {
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

        const dbIndex = newVaultMetadataInst.DBIndex;
        if (dbIndex == null) {
            console.error(
                "Failed to restore the vault. Missing local database index.",
            );
            return false;
        }

        return { dbIndex };
    };

    return (
        <>
            <HTMLHeader
                title="Cryptex Vault"
                description="Local-first password manager"
            />

            <HTMLMain additionalClasses="content flex h-svh grow flex-col overflow-hidden">
                {
                    // If the vault is not unlocked, show the welcome screen
                    !isVaultUnlocked && (
                        <>
                            <div className="flex grow flex-col items-center justify-center">
                                <VaultManager
                                    purchasePlan={purchasePlan}
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

                {isVaultUnlocked && (
                    <VaultDashboard
                        purchasePlan={purchasePlan}
                        onPurchaseConsumed={() => setPurchasePlan(null)}
                    />
                )}
            </HTMLMain>
        </>
    );
};

export default AppIndex;
