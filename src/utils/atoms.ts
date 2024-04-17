import { atom, createStore } from "jotai";
import { selectAtom } from "jotai/utils";
import {
    Synchronization,
    Vault,
    type VaultMetadata,
} from "../app_lib/vault_utils";

export type OnlineServicesData = {
    key: string;
    remoteData: {
        root: boolean;
        canLink: boolean;
        maxLinks: number;
        alwaysConnected: boolean;
        canFeatureVote: boolean;
        recoveryTokenCreatedAt: Date | null;
    } | null;
};

type OnlineServicesStatus = {
    status: "CONNECTED" | "CONNECTING" | "DISCONNECTED" | "FAILED";
    statusDescription: string;
};

export class OnlineServicesStatusHelpers {
    static setConnected(): OnlineServicesStatus {
        return {
            status: "CONNECTED",
            statusDescription: "Connected",
        };
    }

    static setConnecting(): OnlineServicesStatus {
        return {
            status: "CONNECTING",
            statusDescription: "Connecting...",
        };
    }

    static setDisconnected(): OnlineServicesStatus {
        return {
            status: "DISCONNECTED",
            statusDescription: "Disconnected",
        };
    }

    static setFailed(error?: string): OnlineServicesStatus {
        return {
            status: "FAILED",
            statusDescription: error ?? "Unknown failure occurred",
        };
    }
}

export const unlockedVaultMetadataAtom = atom<VaultMetadata | null>(null);
export const unlockedVaultAtom = atom(new Vault());
export const unlockedVaultWriteOnlyAtom = atom(
    (get): Vault => {
        return get(unlockedVaultAtom);
    },
    async (get, set, val: ((pre: Vault) => Promise<Vault> | Vault) | Vault) => {
        const vault: Vault = await (typeof val === "function"
            ? val(get(unlockedVaultAtom))
            : val);

        set(unlockedVaultAtom, Object.assign(new Vault(), vault));
    },
);
export const isVaultUnlockedAtom = selectAtom(
    unlockedVaultMetadataAtom,
    (vault) => vault !== null,
);

export const onlineServicesBoundAtom = selectAtom(unlockedVaultAtom, (vault) =>
    vault.OnlineServices.isBound(),
);

export const onlineServicesStore = createStore();
export const onlineServicesDataAtom = atom<OnlineServicesData | null>(null);
export const onlineServicesConnectionStatusAtom = atom<OnlineServicesStatus>({
    status: "DISCONNECTED",
    statusDescription: "Disconnected",
});
export const webRTCConnectionsAtom = atom(
    new Synchronization.WebRTCConnections(),
);

export const setOnlineServicesAPIKey = (apiKey: string) => {
    if (!apiKey.length) {
        throw new Error("API key is empty");
    }

    onlineServicesStore.set(onlineServicesDataAtom, {
        key: apiKey,
        remoteData: null,
    });
};
export const clearOnlineServicesAPIKey = () => {
    onlineServicesStore.set(onlineServicesDataAtom, null);
};
