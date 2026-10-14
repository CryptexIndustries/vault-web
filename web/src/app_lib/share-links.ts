import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { TRPCClientError } from "@trpc/client";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    ShareSetupError,
    type ShareLinkStore,
} from "@cryptex-industries/vault-core/vault-utils/share-service";
import type { ShareBackend } from "@/components/share/share-backend";
import {
    onlineServicesDataAtom,
    onlineServicesStore,
    unlockedVaultMetadataAtom,
    vaultGet,
    vaultStore,
} from "@/utils/atoms";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { persistVaultMutation } from "@/utils/vault-mutations";

const webShareLinkStore: ShareLinkStore = {
    getShareLinks: async () => vaultGet().ShareLinks ?? [],
    updateShareLinks: async (update) => {
        const result = await persistVaultMutation(
            "share.update",
            async (currentVault) => {
                const vault = Object.assign(new Vault(), currentVault);
                vault.ShareLinks = await update(currentVault.ShareLinks ?? []);
                return { vault, result: undefined };
            },
        );
        if (result.isErr()) throw new Error(result.error);
    },
    // The web app always talks to its own origin.
    getShareSettings: async () => {
        const settings = vaultGet().ShareSettings;
        return settings ? { ...settings, ServerOrigin: "" } : undefined;
    },
    vaultKey: async () => vaultStore.get(unlockedVaultMetadataAtom)?.DBIndex,
};

async function saveWebShareSettings(settings: VaultUtilTypes.ShareSettings) {
    const result = await persistVaultMutation(
        "share.settings",
        (currentVault) => {
            const vault = Object.assign(new Vault(), currentVault);
            vault.ShareSettings = { ...settings, ServerOrigin: "" };
            return { vault, result: undefined };
        },
    );
    if (result.isErr()) throw new Error(result.error);
}

async function requestShareTicket(): Promise<string> {
    const { trpc } = await import("@/utils/trpc");
    try {
        return (await trpc.v1.share.ticket.mutate()).ticket;
    } catch (error) {
        if (error instanceof TRPCClientError) {
            const code = (error.data as { code?: string } | undefined)?.code;
            if (code === "FORBIDDEN") {
                throw new ShareSetupError("subscription_required");
            }
            if (code === "UNAUTHORIZED") {
                throw new ShareSetupError("sign_in_required");
            }
        }
        throw error;
    }
}

/** Share UI wiring for the web dashboard. */
export function useWebShareBackend(onOpenAccount?: () => void): ShareBackend {
    const onlineServicesData = useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    });
    const signedIn =
        isCloudServicesEnabled() && !!onlineServicesData?.sessionToken;
    const passwordSharing = onlineServicesData?.remoteData?.passwordSharing;

    return useMemo(
        () => ({
            deps: {
                store: webShareLinkStore,
                defaultOrigin:
                    typeof window === "undefined"
                        ? "http://localhost"
                        : window.location.origin,
                getTicket: signedIn ? requestShareTicket : undefined,
            },
            hasOnlineServicesSharing: signedIn ? passwordSharing : undefined,
            allowCustomServer: false,
            saveSettings: saveWebShareSettings,
            onOpenAccount,
        }),
        [onOpenAccount, passwordSharing, signedIn],
    );
}
