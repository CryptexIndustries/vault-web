import { type EncryptionFormGroupSchemaType } from "@/app_lib/vault-utils/form-schemas";
import { type VaultMetadata } from "@/app_lib/vault-utils/storage";
import { type Vault } from "@/app_lib/vault-utils/vault";
import { err, ok, type Result } from "neverthrow";

export const SESSION_STORAGE_VAULT_SECRET_KEY = "vaultSecret";
export const MISSING_VAULT_SECRET_ERROR =
    "Vault encryption secret is missing. Unlock your vault again.";
export type VaultSessionError = "VAULT_SECRET_NOT_FOUND" | "VAULT_SAVE_FAILED";

export const getVaultSecretFromSession = (): Result<
    Uint8Array,
    "VAULT_SECRET_NOT_FOUND"
> => {
    const vaultSecret = sessionStorage.getItem(SESSION_STORAGE_VAULT_SECRET_KEY);
    if (!vaultSecret?.length) return err("VAULT_SECRET_NOT_FOUND");

    try {
        return ok(Uint8Array.from(atob(vaultSecret), (char) => char.charCodeAt(0)));
    } catch {
        return err("VAULT_SECRET_NOT_FOUND");
    }
};

export const setVaultSecretInSession = (secret: Uint8Array) => {
    sessionStorage.setItem(
        SESSION_STORAGE_VAULT_SECRET_KEY,
        btoa(String.fromCharCode(...secret)),
    );
};

export const clearVaultSecretFromSession = () => {
    sessionStorage.removeItem(SESSION_STORAGE_VAULT_SECRET_KEY);
};

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
