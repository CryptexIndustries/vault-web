import React, { useEffect, useRef, useState } from "react";
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
    unlockedVaultWriteOnlyAtom,
    vaultStore,
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
import { VaultOpenElsewhere } from "@/components/vault-open-elsewhere";
import { useUnlockedTab } from "@/utils/use-unlocked-tab";
import {
    OpeningCancelledError,
    vaultTabOwner,
    type VaultOpening,
} from "@/utils/vault-tab-owner";
import { discardUnlockedVault, lockUnlockedVault } from "@/utils/vault-lock";
import { resumeAgentSigning } from "@/utils/vault-lock-listeners";

dayjs.extend(RelativeTime);

const AppIndex: React.FC = () => {
    const isVaultUnlocked = useAtomValue(isVaultUnlockedAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);
    const [purchasePlan, setPurchasePlan] = useState<PurchasePlan | null>(null);
    // An unlock publishes its vault only while this page is mounted, it is
    // the latest attempt and it still holds the tab's claim (taken before
    // the vault was read, see vault-tab-owner.ts).
    const mounted = useRef(false);
    const unlockAttempt = useRef(0);
    // An opening whose recovery code is on screen: it keeps the claim until
    // acknowledged, or until the page goes away.
    const revealing = useRef<{
        opening: VaultOpening;
        vault: Vault.Vault;
    } | null>(null);
    useEffect(() => {
        const page = mounted;
        const attempts = unlockAttempt;
        page.current = true;
        return () => {
            page.current = false;
            // Unlocks still running are void now.
            attempts.current++;
        };
    }, []);
    const tab = useUnlockedTab(
        isVaultUnlocked,
        () =>
            discardUnlockedVault({
                setUnlockedVault: () => setUnlockedVault(new Vault.Vault()),
                setUnlockedVaultMetadata,
            }),
        // Leaving /app inside the app: lock as the Lock button does. A lock
        // already running for this session is shared (vault-lock.ts).
        async () => {
            const locked = await lockUnlockedVault({
                unlockedVaultMetadata: vaultStore.get(
                    unlockedVaultMetadataAtom,
                ),
                setUnlockedVault: (vault) =>
                    vaultStore.set(unlockedVaultWriteOnlyAtom, vault),
                setUnlockedVaultMetadata,
            });
            if (locked.isOk()) toast.info("Vault locked.");
            else
                toast.error(
                    "Couldn't lock your vault. Open it again and lock it there.",
                );
            return locked.isOk();
        },
    );

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

    /** Publishes a decrypted vault while its opening still owns the tab. */
    const publish = (
        opening: VaultOpening,
        metadata: Storage.VaultMetadata,
        vault: Vault.Vault,
        dek: CryptoKey,
    ) => {
        if (!mounted.current || !opening.active || !vaultTabOwner().holds)
            return false;
        // An authenticated unlock: the agent may sign again.
        resumeAgentSigning();
        setVaultDEKInSessionForMetadata(metadata, dek);
        setUnlockedVaultMetadata(metadata);
        setUnlockedVault(vault);
        return true;
    };

    /** Keeps the claim until the recovery code is acknowledged. */
    const holdForReveal = (opening: VaultOpening, vault: Vault.Vault) => {
        revealing.current?.opening.end();
        revealing.current = { opening, vault };
    };

    // The recovery code was acknowledged: publish the vault it was for.
    const finalizeVaultUnlock = (
        metadata: Storage.VaultMetadata,
        vault: Vault.Vault,
        dek: CryptoKey,
    ) => {
        const pending = revealing.current;
        if (!pending || pending.vault !== vault) return;
        revealing.current = null;
        publish(pending.opening, metadata, vault, dek);
        pending.opening.end();
    };

    const tryVaultDecrypt = async (
        selected: Storage.VaultMetadata,
        formData: FormSchemas.EncryptionFormGroupSchemaType,
        unlockExtras?: {
            useRecovery?: boolean;
            recoveryCode?: string;
            protectionPhrase?: string;
        },
    ) => {
        const attempt = ++unlockAttempt.current;
        // Claim the tab before reading the vault: no other tab can change
        // it from here until this one locks.
        const opening = await vaultTabOwner().begin();
        if (!opening) {
            if (mounted.current) tab.showElsewhere();
            return err("VAULT_OPEN_ELSEWHERE");
        }
        const current = () =>
            mounted.current &&
            attempt === unlockAttempt.current &&
            opening.active;
        try {
            if (!current()) return err("UNLOCK_CANCELLED");
            // Read again now that no other tab can save it: the list the
            // user picked from may be older.
            const dbIndex = selected.DBIndex;
            const metadata =
                dbIndex == null
                    ? selected
                    : await opening.run(() =>
                          Storage.VaultMetadata.load(dbIndex),
                      );
            if (!metadata) return err("VAULT_NOT_FOUND");
            if (!current()) return err("UNLOCK_CANCELLED");
            // WebAuthn unlock is resolved inside decryptVault from the
            // synced envelope slot; no device-local lookup needed. It may
            // save an upgraded vault, still under the claim.
            const vaultRes = await opening.run(() =>
                metadata.decryptVault(
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
                ),
            );

            if (vaultRes.isErr()) return err(vaultRes.error);
            if (!current()) return err("UNLOCK_CANCELLED");

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

            if (!current()) return err("UNLOCK_CANCELLED");

            if (revealSecrets) {
                holdForReveal(opening, vault);
                return ok({
                    revealSecrets,
                    pendingUnlock: { metadata, vault, dek },
                });
            }

            if (!publish(opening, metadata, vault, dek))
                return err("UNLOCK_CANCELLED");
            if (unlockExtras?.useRecovery) {
                toast.info(
                    "Vault unlocked with a recovery code. Open Vault Settings > Encryption & Security to set a new master password.",
                );
            }
            return ok({});
        } catch (error) {
            // A newer opening or leaving the page cancelled this one.
            if (error instanceof OpeningCancelledError)
                return err("UNLOCK_CANCELLED");
            throw error;
        } finally {
            // Published, failed or waiting for its recovery code to be seen.
            if (revealing.current?.opening !== opening) opening.end();
        }
    };

    const tryCreateVault = async (
        formData: FormSchemas.NewVaultFormSchemaType &
            FormSchemas.EncryptionFormGroupSchemaType,
        additionalKeyProtectionOptions?: VaultCreateAdditionalKeyProtectionOptions,
        initialImport?: ImportResult,
        linkedVault?: Vault.Vault,
    ): Promise<
        | false
        | {
              ok: true;
              revealSecrets: VaultRevealSecrets;
              pendingUnlock: VaultPendingUnlock<Storage.VaultMetadata>;
          }
    > => {
        // A new vault is opened too: claim the tab first.
        const opening = await vaultTabOwner().begin();
        if (!opening) {
            if (mounted.current) tab.showElsewhere();
            return false;
        }
        if (!opening.active) {
            opening.end();
            return false;
        }
        try {
            const created = await opening.run(async () => {
                const created = await Storage.VaultMetadata.createNewVault(
                    formData,
                    formData,
                    false,
                    0,
                    additionalKeyProtectionOptions,
                    initialImport,
                    linkedVault,
                );

                await created.metadata.save(null, created.dek);

                if (
                    additionalKeyProtectionOptions?.additionalKeyProtection &&
                    additionalKeyProtectionOptions.additionalKeyProtection
                        .kind !== AdditionalKeyProtectionKind.NONE
                ) {
                    await created.metadata.persistAdditionalKeyProtectionEnrollment(
                        created.enrolledProtection,
                    );
                }
                return created;
            });
            if (!mounted.current || !opening.active) {
                opening.end();
                return false;
            }

            // Defer unlocked atoms until the reveal dialog is acknowledged.
            // Setting them here unmounts VaultManager before the dialog renders.
            holdForReveal(opening, created.vault);
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
            opening.end();
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
                {!isVaultUnlocked && tab.elsewhere && (
                    <VaultOpenElsewhere
                        releasing={tab.releasing}
                        failed={tab.releaseFailed}
                        onUseHere={tab.useHere}
                    />
                )}

                {
                    // If the vault is not unlocked, show the welcome screen
                    !isVaultUnlocked && !tab.elsewhere && !tab.checking && (
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
