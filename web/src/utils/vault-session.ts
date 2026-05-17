import { type EncryptionFormGroupSchemaType } from "@/app_lib/vault-utils/form-schemas";
import { type VaultMetadata } from "@/app_lib/vault-utils/storage";
import { type Vault } from "@/app_lib/vault-utils/vault";
import { err, ok, type Result } from "neverthrow";

export const SESSION_STORAGE_VAULT_SECRET_KEY = "vaultSecret";
export const MISSING_VAULT_SECRET_ERROR =
    "Vault encryption secret is missing. Unlock your vault again.";
export type VaultSessionError = "VAULT_SECRET_NOT_FOUND" | "VAULT_SAVE_FAILED";


/**
 * Get the vault secret from the session storage
 * @returns The vault secret as a Uint8Array
 */
export const getVaultSecretFromSession = (): Result<
    Uint8Array,
    "VAULT_SECRET_NOT_FOUND"
> => {
    const vaultSecret = sessionStorage.getItem(SESSION_STORAGE_VAULT_SECRET_KEY);
    if (!vaultSecret?.length) return err("VAULT_SECRET_NOT_FOUND");

    try {
        return ok(Uint8Array.fromBase64(vaultSecret));
    } catch {
        return err("VAULT_SECRET_NOT_FOUND");
    }
};

/**
 * Set the vault secret in the session storage
 * @param secret The secret to set in the session storage
 */
export const setVaultSecretInSession = (secret: Uint8Array) => {
    sessionStorage.setItem(
        SESSION_STORAGE_VAULT_SECRET_KEY,
        secret.toBase64(),
    );
};

/**
 * Clear the vault secret from the session storage
 */
export const clearVaultSecretFromSession = () => {
    sessionStorage.removeItem(SESSION_STORAGE_VAULT_SECRET_KEY);
};

/**
 * Save the vault with the session secret
 * @param vaultMetadata The vault metadata
 * @param vault The vault to save
 * @param encryptionConfigFormSchema The encryption config form schema
 * @returns The result of the save operation
 */
export const saveVaultWithSessionSecret = async (
    vaultMetadata: VaultMetadata,
    vault: Vault | null,
    encryptionConfigFormSchema?: EncryptionFormGroupSchemaType,
) : Promise<Result<void, VaultSessionError>> => {
    const secretRes = getVaultSecretFromSession();
    if (secretRes.isErr()) {
        return err(secretRes.error);
    }

    try {
        await vaultMetadata.save(
            vault,
            secretRes.value,
            encryptionConfigFormSchema,
        );
        return ok(undefined);
    } catch {
        return err("VAULT_SAVE_FAILED");
    }
};
