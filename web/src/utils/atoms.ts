import { atom, createStore } from "jotai";
import { focusAtom } from "jotai-optics";
import { selectAtom } from "jotai/utils";
import { Vault } from "../app_lib/vault-utils/vault";
import { type VaultMetadata } from "../app_lib/vault-utils/storage";

export type OnlineServicesData = {
    /** Passkey session JWT (`Authorization: Bearer`). */
    sessionToken?: string | null;
    sessionExpiresAt?: number | null;
    deviceId?: string;
    remoteData: {
        deviceId?: string;
        root: boolean;
        canLink: boolean;
        maxLinks: number;
        alwaysConnected: boolean;
        canFeatureVote: boolean;
        recoveryTokenCreatedAt: Date | null;
    } | null;
};

export const ONLINE_SERVICES_AUTH_STATES = [
    "CONNECTED",
    "CONNECTING",
    "DISCONNECTED",
    "FAILED",
] as const;

export type OnlineServicesAuthenticationState =
    (typeof ONLINE_SERVICES_AUTH_STATES)[number];

export type OnlineServicesAuthenticationStatus = {
    status: OnlineServicesAuthenticationState;
    statusDescription: string;
};

const ONLINE_SERVICES_AUTH_STATUS_LABELS: Record<
    OnlineServicesAuthenticationState,
    string
> = {
    CONNECTED: "Signed in",
    CONNECTING: "Signing in...",
    DISCONNECTED: "Disconnected",
    FAILED: "Unknown failure occurred",
};

export const createOnlineServicesAuthenticationStatus = (
    status: OnlineServicesAuthenticationState,
    statusDescription = ONLINE_SERVICES_AUTH_STATUS_LABELS[status],
): OnlineServicesAuthenticationStatus => ({
    status,
    statusDescription,
});

export const onlineServicesAuthenticationStatus = {
    connected: (): OnlineServicesAuthenticationStatus =>
        createOnlineServicesAuthenticationStatus("CONNECTED"),
    connecting: (): OnlineServicesAuthenticationStatus =>
        createOnlineServicesAuthenticationStatus("CONNECTING"),
    disconnected: (): OnlineServicesAuthenticationStatus =>
        createOnlineServicesAuthenticationStatus("DISCONNECTED"),
    failed: (error?: string): OnlineServicesAuthenticationStatus =>
        createOnlineServicesAuthenticationStatus(
            "FAILED",
            error ?? ONLINE_SERVICES_AUTH_STATUS_LABELS.FAILED,
        ),
};

export class OnlineServicesAuthenticationStatusHelpers {
    static setConnected(): OnlineServicesAuthenticationStatus {
        return onlineServicesAuthenticationStatus.connected();
    }

    static setConnecting(): OnlineServicesAuthenticationStatus {
        return onlineServicesAuthenticationStatus.connecting();
    }

    static setDisconnected(): OnlineServicesAuthenticationStatus {
        return onlineServicesAuthenticationStatus.disconnected();
    }

    static setFailed(error?: string): OnlineServicesAuthenticationStatus {
        return onlineServicesAuthenticationStatus.failed(error);
    }
}

//#region Unlocked Vault
export const vaultStore = createStore();
export const unlockedVaultMetadataAtom = atom<VaultMetadata | null>(null);
export const unlockedVaultAtom = atom(new Vault());
type VaultWriteValue = ((pre: Vault) => Promise<Vault> | Vault) | Vault;

export const unlockedVaultWriteOnlyAtom = atom(
    (get): Vault => {
        return get(unlockedVaultAtom);
    },
    async (get, set, val: VaultWriteValue) => {
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

export const getUnlockedVault = () => {
    return vaultStore.get(unlockedVaultAtom);
};
export const vaultGet = getUnlockedVault;
//#endregion Unlocked Vault

export const onlineServicesBoundAtom = selectAtom(unlockedVaultAtom, (vault) =>
    Vault.isOnlineServicesBound(vault),
);

export const onlineServicesStore = createStore();
export const onlineServicesDataAtom = atom<OnlineServicesData | null>(null);
export const DEFAULT_ONLINE_SERVICES_AUTH_CONNECTION_STATUS =
    onlineServicesAuthenticationStatus.disconnected();
export const onlineServicesAuthConnectionStatusAtom =
    atom<OnlineServicesAuthenticationStatus>(
        DEFAULT_ONLINE_SERVICES_AUTH_CONNECTION_STATUS,
    );

export const setOnlineServicesData = (data: OnlineServicesData | null) => {
    onlineServicesStore.set(onlineServicesDataAtom, data);
};

export const clearOnlineServicesSession = () => {
    setOnlineServicesData(null);
};
