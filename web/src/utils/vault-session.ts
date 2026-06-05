import { type VaultMetadata } from "@/app_lib/vault-utils/storage";
import { type Vault } from "@/app_lib/vault-utils/vault";
import { err, ok, type Result } from "neverthrow";

export const MISSING_VAULT_SECRET_ERROR =
    "Vault data encryption key is missing. Please unlock your vault again.";
export type VaultSessionError = "VAULT_DEK_NOT_FOUND" | "VAULT_SAVE_FAILED";

/**
 * Active vault DEK for session lookup.
 */
let activeVaultDEK: CryptoKey | null = null;

const isSessionVaultDEK = (dek: unknown): dek is CryptoKey =>
    typeof dek === "object" &&
    dek !== null &&
    "type" in dek &&
    (dek as CryptoKey).type === "secret";

export const setVaultDEKInSession = (dek: CryptoKey): void => {
    activeVaultDEK = dek;
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
    if (activeVaultDEK == null) {
        return err("VAULT_DEK_NOT_FOUND");
    }
    return ok(activeVaultDEK);
};

export const clearVaultDEKFromSession = (): void => {
    activeVaultDEK = null;
};

export const saveVaultWithSessionDEK = async (
    vaultMetadata: VaultMetadata,
    vault: Vault | null,
): Promise<Result<void, VaultSessionError>> => {
    const dekRes = getVaultDEKFromSession();
    if (dekRes.isErr()) {
        return err(dekRes.error);
    }

    try {
        await vaultMetadata.save(vault, dekRes.value);
        return ok(undefined);
    } catch {
        return err("VAULT_SAVE_FAILED");
    }
};
