import { useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai/react";
import { toast } from "sonner";

import { type Vault } from "@/app_lib/vault-utils/vault";
import {
    unlockedVaultMetadataAtom,
    unlockedVaultWriteOnlyAtom,
} from "@/utils/atoms";
import {
    MISSING_VAULT_SECRET_ERROR,
    saveVaultWithSessionDEK,
} from "@/utils/vault-session";

export function useSaveVault() {
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);

    return useCallback(
        async (next: Vault) => {
            if (!vaultMetadata) {
                toast.error("Vault metadata is unavailable.");
                return false;
            }
            setUnlockedVault(next);
            const res = await saveVaultWithSessionDEK(vaultMetadata, next);
            if (res.isErr()) {
                if (res.error === "VAULT_DEK_NOT_FOUND") {
                    toast.error(MISSING_VAULT_SECRET_ERROR);
                } else {
                    toast.error("Failed to save vault.");
                }
                return false;
            }
            return true;
        },
        [setUnlockedVault, vaultMetadata],
    );
}
