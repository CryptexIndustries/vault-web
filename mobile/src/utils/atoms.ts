/**
 * Vault and Online Services state stored in Jotai atoms.
 * Keep this store compatible with the shared vault mutation coordinator.
 */
import { atom, createStore } from "jotai";
import { focusAtom } from "jotai-optics";
import { selectAtom } from "jotai/utils";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import type { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { isAutoLockDue } from "@/utils/session-timeout";

export type OnlineServicesData = {
    sessionToken?: string | null;
    sessionExpiresAt?: number | null;
    refreshToken?: string | null;
    refreshExpiresAt?: number | null;
    deviceId?: string;
    remoteData: {
        deviceId?: string;
        root: boolean;
        canLink: boolean;
        canPromoteDevices?: boolean;
        maxLinks: number;
        recoveryTokenCreatedAt: Date | null;
        recoveryGenerationNeeded?: boolean;
    } | null;
};

const ONLINE_SERVICES_AUTH_STATES = [
    "CONNECTED",
    "CONNECTING",
    "DISCONNECTED",
    "FAILED",
] as const;

type OnlineServicesAuthenticationState =
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

const createOnlineServicesAuthenticationStatus = (
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

export const vaultStore = createStore();
export const unlockedVaultMetadataAtom = atom<VaultMetadata | null>(null);
export const unlockedVaultAtom = atom(new Vault());
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
    if (isAutoLockDue()) throw new Error("Vault session expired.");
    return vaultStore.get(unlockedVaultAtom);
};

export const onlineServicesStore = createStore();
export const onlineServicesDataAtom = atom<OnlineServicesData | null>(null);
export const onlineServicesAuthConnectionStatusAtom =
    atom<OnlineServicesAuthenticationStatus>(
        onlineServicesAuthenticationStatus.disconnected(),
    );

export const setOnlineServicesData = (data: OnlineServicesData | null) => {
    onlineServicesStore.set(onlineServicesDataAtom, data);
};

export const clearOnlineServicesSession = () => {
    setOnlineServicesData(null);
};
