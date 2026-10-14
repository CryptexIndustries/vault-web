import type { QueryClient } from "@tanstack/react-query";
import {
    vaultStore,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
} from "@/utils/atoms";
import { getVaultSessionGeneration } from "@/utils/vault-session";

/** tRPC keys are shared across vaults. Drop old queries before a new identity renders. */
export function bindOnlineServicesQueryCache(queryClient: QueryClient) {
    const scope = () => {
        const metadata = vaultStore.get(unlockedVaultMetadataAtom);
        return JSON.stringify([
            metadata?.DBIndex ?? null,
            metadata
                ? (vaultStore.get(unlockedVaultAtom).OnlineServices?.DeviceId ??
                  null)
                : null,
            getVaultSessionGeneration(),
        ]);
    };
    let currentScope = scope();
    const reconcile = () => {
        const nextScope = scope();
        if (nextScope === currentScope) return;
        currentScope = nextScope;
        // TanStack clear destroys and cancels pending queries as well as cached data.
        queryClient.clear();
    };
    const stopMetadata = vaultStore.sub(unlockedVaultMetadataAtom, reconcile);
    const stopVault = vaultStore.sub(unlockedVaultAtom, reconcile);
    return () => {
        stopMetadata();
        stopVault();
    };
}
