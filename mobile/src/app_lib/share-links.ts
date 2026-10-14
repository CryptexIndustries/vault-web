/**
 * One-time share links on mobile: vault-backed record store, Online Services
 * tickets, and the share server choice for this device.
 */
import { TRPCClientError } from "@trpc/client";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    ShareSetupError,
    type ShareLinkStore,
    type ShareServiceDeps,
} from "@cryptex-industries/vault-core/vault-utils/share-service";
import { env } from "@/env";
import { getUnlockedVault, onlineServicesDataAtom, onlineServicesStore } from "@/utils/atoms";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { trpc } from "@/utils/trpc";
import { getVaultSessionGeneration } from "@/utils/vault-session";
import { persistVaultMutation } from "@/utils/vault-mutations";

export const mobileShareLinkStore: ShareLinkStore = {
    getShareLinks: async () => getUnlockedVault().ShareLinks ?? [],
    updateShareLinks: async (update) => {
        const result = await persistVaultMutation("share.update", async (current) => {
            const vault = Object.assign(Object.create(Object.getPrototypeOf(current)), current) as Vault;
            vault.ShareLinks = await update(current.ShareLinks ?? []);
            return { vault, result: undefined };
        });
        if (result.isErr()) throw new Error(result.error);
    },
    getShareSettings: async () => getUnlockedVault().ShareSettings,
    // Changes on every lock and unlock, so a link never lands in another vault.
    vaultKey: async () => getVaultSessionGeneration(),
};

export async function saveMobileShareSettings(settings: VaultUtilTypes.ShareSettings) {
    const result = await persistVaultMutation("share.settings", (current) => {
        const vault = Object.assign(Object.create(Object.getPrototypeOf(current)), current) as Vault;
        vault.ShareSettings = settings;
        return { vault, result: undefined };
    });
    if (result.isErr()) throw new Error(result.error);
}

async function requestShareTicket(): Promise<string> {
    try {
        return (await trpc.v1.share.ticket.mutate()).ticket;
    } catch (error) {
        if (error instanceof TRPCClientError) {
            const code = (error.data as { code?: string } | undefined)?.code;
            if (code === "FORBIDDEN") throw new ShareSetupError("subscription_required");
            if (code === "UNAUTHORIZED") throw new ShareSetupError("sign_in_required");
        }
        throw error;
    }
}

export function hasOnlineServicesSession(): boolean {
    return isCloudServicesEnabled() && !!onlineServicesStore.get(onlineServicesDataAtom)?.sessionToken;
}

/** Undefined while signed out or before the account configuration loads. */
export function hasOnlineServicesSharing(): boolean | undefined {
    if (!hasOnlineServicesSession()) return undefined;
    return onlineServicesStore.get(onlineServicesDataAtom)?.remoteData?.passwordSharing;
}

export function mobileShareDeps(): ShareServiceDeps {
    return {
        store: mobileShareLinkStore,
        defaultOrigin: env.APP_URL,
        getTicket: hasOnlineServicesSession() ? requestShareTicket : undefined,
    };
}
