import type { VaultMetadata } from "@/app_lib/vault-utils/storage";
import type { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { err, ok, type Result } from "neverthrow";
import {
    isAutoLockDue,
    startVaultTimeoutSession,
    stopVaultTimeoutSession,
} from "@/utils/session-timeout";
import { androidCredentials } from "@/utils/android-credentials";

export const MISSING_VAULT_SECRET_ERROR =
    "Vault data encryption key is missing. Please unlock your vault again.";
export type VaultSessionError = "VAULT_DEK_NOT_FOUND" | "VAULT_SAVE_FAILED";

let activeVaultDEK: CryptoKey | null = null;
let sessionGeneration = 0;

/** Changes on unlock/lock, not on edits or saves within the same vault. */
export const getVaultSessionGeneration = () => sessionGeneration;

export const isSameActiveVaultSession = (generation: number): boolean =>
    generation === sessionGeneration && getVaultDEKFromSession().isOk();

const isSessionVaultDEK = (dek: unknown): dek is CryptoKey =>
    typeof dek === "object" &&
    dek !== null &&
    "type" in dek &&
    (dek as CryptoKey).type === "secret";

export const setVaultDEKInSession = (dek: CryptoKey): void => {
    // A late security-change callback cannot turn an expired session into a
    // fresh unlock. The locked route clears the old session before unlocking.
    if (activeVaultDEK != null && isAutoLockDue()) {
        throw new Error("Vault session expired before key update.");
    }
    const freshUnlock = activeVaultDEK == null;
    sessionGeneration += 1;
    activeVaultDEK = dek;
    startVaultTimeoutSession();
    // A fresh unlock is allowed to republish provider metadata. Routine
    // credential-list updates must not revive an expired native cache.
    if (freshUnlock) {
        try {
            androidCredentials.clearProviderCredentials();
        } catch {
            // Native provider availability must not block vault unlock.
        }
    }
};

export const setVaultDEKInSessionForMetadata = (
    vaultMetadata: VaultMetadata,
    dek: CryptoKey | undefined,
): void => {
    if (vaultMetadata.DBIndex == null || !isSessionVaultDEK(dek)) {
        return;
    }
    setVaultDEKInSession(dek);
};

export const getVaultDEKFromSession = (): Result<
    CryptoKey,
    "VAULT_DEK_NOT_FOUND"
> => {
    if (activeVaultDEK == null || isAutoLockDue()) {
        return err("VAULT_DEK_NOT_FOUND");
    }
    return ok(activeVaultDEK);
};

export const clearVaultDEKFromSession = (): void => {
    sessionGeneration += 1;
    activeVaultDEK = null;
    stopVaultTimeoutSession();
};

export const saveVaultWithSessionDEK = async (
    vaultMetadata: VaultMetadata,
    vault: Vault | null,
    forLock = false,
): Promise<Result<void, VaultSessionError>> => {
    // Lock may need to persist pending edits after the timeout has passed.
    // All ordinary reads and writes go through getVaultDEKFromSession().
    const checked = forLock ? null : getVaultDEKFromSession();
    const dek = forLock ? activeVaultDEK : checked?.isOk() ? checked.value : null;
    if (dek == null) return err("VAULT_DEK_NOT_FOUND");

    try {
        await vaultMetadata.save(vault, dek);
        return ok(undefined);
    } catch {
        return err("VAULT_SAVE_FAILED");
    }
};
