import { atom, createStore } from "jotai";
import { focusAtom } from "jotai-optics";
import { selectAtom } from "jotai/utils";
import { LinkedDevices, Vault } from "../app_lib/vault-utils/vault";
import { type VaultMetadata } from "../app_lib/vault-utils/storage";

type OnlineServicesData = {
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

type OnlineServicesAuthenticationStatus = {
    status: "CONNECTED" | "CONNECTING" | "DISCONNECTED" | "FAILED";
    statusDescription: string;
};

export class OnlineServicesAuthenticationStatusHelpers {
    static setConnected(): OnlineServicesAuthenticationStatus {
        return {
            status: "CONNECTED",
            statusDescription: "Signed in",
        };
    }

    static setConnecting(): OnlineServicesAuthenticationStatus {
        return {
            status: "CONNECTING",
            statusDescription: "Signing in...",
        };
    }

    static setDisconnected(): OnlineServicesAuthenticationStatus {
        return {
            status: "DISCONNECTED",
            statusDescription: "Disconnected",
        };
    }

    static setFailed(error?: string): OnlineServicesAuthenticationStatus {
        return {
            status: "FAILED",
            statusDescription: error ?? "Unknown failure occurred",
        };
    }
}

//#region Unlocked Vault
export const vaultStore = createStore();
export const unlockedVaultMetadataAtom = atom<VaultMetadata | null>(null);
export const unlockedVaultAtom = atom(new Vault());
export const unlockedVaultWriteOnlyAtom = atom(
    (get): Vault => {
        return get(unlockedVaultAtom);
    },
    async (get, set, val: ((pre: Vault) => Promise<Vault> | Vault) | Vault) => {
        const vault = await (typeof val === "function"
            ? val(get(unlockedVaultAtom))
            : val);

        set(unlockedVaultAtom, vault);
    },
);
export const isVaultUnlockedAtom = selectAtom(
    unlockedVaultMetadataAtom,
    (vault) => vault !== null,
);

export const vaultCredentialsAtom = focusAtom(unlockedVaultAtom, (baseAtom) =>
    baseAtom.prop("Credentials"),
);

export const linkedDevicesAtom = focusAtom(unlockedVaultAtom, (baseAtom) =>
    baseAtom.prop("LinkedDevices").prop("Devices"),
);

export const vaultGet = () => {
    return vaultStore.get(unlockedVaultAtom);
};

export const vaultGetLinkedDevices = () => {
    return vaultStore.get(unlockedVaultAtom).LinkedDevices;
};
//#endregion Unlocked Vault

export const onlineServicesBoundAtom = selectAtom(unlockedVaultAtom, (vault) =>
    LinkedDevices.isBound(vault.LinkedDevices),
);

export const onlineServicesStore = createStore();
export const onlineServicesDataAtom = atom<OnlineServicesData | null>(null);
export const onlineServicesAuthConnectionStatusAtom =
    atom<OnlineServicesAuthenticationStatus>({
        status: "DISCONNECTED",
        statusDescription: "Disconnected",
    });

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
