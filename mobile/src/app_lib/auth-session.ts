import { createTRPCClient } from "@trpc/client";
import type { VersionedRouter } from "@cryptex-industries/api-contract";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    performOnlineServicesDeviceSigningKeyAuth,
    refreshOnlineServicesSessionTokens,
    shouldRefreshOnlineServicesSession,
    type OnlineServicesSessionTokens,
} from "@cryptex-industries/vault-core/online-services-session/protocol";
import {
    getUnlockedVault,
    onlineServicesStore,
    onlineServicesDataAtom,
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesAuthenticationStatus,
    setOnlineServicesData,
    vaultStore,
    unlockedVaultAtom,
    type OnlineServicesData,
} from "@/utils/atoms";
import { getVaultSessionGeneration } from "@/utils/vault-session";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { onlineServicesLinks } from "@/utils/online-services-transport";
import { stopManagedBackup } from "./managed-backup-hooks";

let generation = 0;
let pendingAuth: {
    deviceId: string;
    promise: Promise<void>;
    vaultGeneration: number;
} | null = null;
let pendingRefresh: Promise<boolean> | null = null;
let sessionIdentityTransitionActive = false;

/** Pause automatic session reconciliation while an unlocked link merge changes identity. */
export function setOnlineServicesSessionIdentityTransition(active: boolean) {
    sessionIdentityTransitionActive = active;
}
let lastForcedRefresh = -Infinity;
let signedOutVaultGeneration: number | null = null;

const data = () => onlineServicesStore.get(onlineServicesDataAtom);
const setStatus = (
    status: ReturnType<typeof onlineServicesAuthenticationStatus.connected>,
) => onlineServicesStore.set(onlineServicesAuthConnectionStatusAtom, status);

export function createBareAuthHeader(): Record<string, string> {
    const token = data()?.sessionToken;
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export function hasOnlineServicesSession(): boolean {
    const session = data();
    const vault = getUnlockedVault();
    return (
        !!session?.sessionToken &&
        (session.sessionExpiresAt ?? 0) > Date.now() &&
        (!Vault.isOnlineServicesBound(vault) ||
            session.deviceId === vault.OnlineServices.DeviceId)
    );
}

// Challenge/refresh must never enter the authenticated transport recursively.
const authClient = createTRPCClient<VersionedRouter>({
    links: onlineServicesLinks({}),
});
const authApi = {
    challenge: (deviceId: string) =>
        authClient.v1.auth.challenge.mutate({ deviceId }),
    verify: (input: {
        deviceId: string;
        challengeId: string;
        signature: string;
    }) => authClient.v1.auth.verify.mutate(input),
    refresh: (refreshToken: string) =>
        authClient.v1.auth.refresh.mutate({ refreshToken }),
};

function isCurrent(epoch: number, vaultGeneration: number) {
    return (
        epoch === generation && vaultGeneration === getVaultSessionGeneration()
    );
}

function applyTokens(
    base: OnlineServicesData,
    tokens: OnlineServicesSessionTokens,
) {
    setOnlineServicesData({
        ...base,
        sessionToken: tokens.sessionToken,
        sessionExpiresAt: tokens.expiresAt,
        refreshToken: tokens.refreshToken,
        refreshExpiresAt: tokens.refreshExpiresAt,
    });
    setStatus(onlineServicesAuthenticationStatus.connected());
}

export function establishOnlineServicesSession(options: {
    deviceId: string;
    privateKeyJWK: string;
}): Promise<void> {
    if (!isCloudServicesEnabled())
        return Promise.reject(new Error("Online Services are disabled."));
    const vaultGeneration = getVaultSessionGeneration();
    signedOutVaultGeneration = null;
    if (
        pendingAuth?.deviceId === options.deviceId &&
        pendingAuth.vaultGeneration === vaultGeneration
    ) {
        return pendingAuth.promise;
    }
    const epoch = ++generation;
    pendingRefresh = null;
    lastForcedRefresh = -Infinity;
    if (data()?.deviceId !== options.deviceId) setOnlineServicesData(null);
    setStatus(onlineServicesAuthenticationStatus.connecting());
    const promise = (async () => {
        try {
            const tokens = await performOnlineServicesDeviceSigningKeyAuth(
                authApi,
                options,
            );
            if (!isCurrent(epoch, vaultGeneration))
                throw new Error("Online Services session changed.");
            const previous = data();
            applyTokens(
                {
                    deviceId: options.deviceId,
                    remoteData:
                        previous?.deviceId === options.deviceId
                            ? previous.remoteData
                            : null,
                },
                tokens,
            );
        } catch (error) {
            if (isCurrent(epoch, vaultGeneration)) {
                setStatus(
                    onlineServicesAuthenticationStatus.failed(
                        error instanceof Error ? error.message : undefined,
                    ),
                );
            }
            throw error;
        } finally {
            if (generation === epoch) pendingAuth = null;
        }
    })();
    pendingAuth = { deviceId: options.deviceId, vaultGeneration, promise };
    return promise;
}

export function refreshOnlineServicesSession(): Promise<boolean> {
    if (pendingRefresh) return pendingRefresh;
    const previous = data();
    if (!previous?.refreshToken) return Promise.resolve(false);
    const epoch = generation;
    const vaultGeneration = getVaultSessionGeneration();
    const promise = (async () => {
        const tokens = await refreshOnlineServicesSessionTokens(
            authApi,
            previous.refreshToken!,
        );
        const latest = data();
        if (
            !tokens ||
            !latest ||
            !isCurrent(epoch, vaultGeneration) ||
            latest.refreshToken !== previous.refreshToken
        )
            return false;
        applyTokens(latest, tokens);
        return true;
    })().finally(() => {
        if (pendingRefresh === promise) pendingRefresh = null;
    });
    pendingRefresh = promise;
    return promise;
}

async function renewSession(): Promise<boolean> {
    const epoch = generation;
    const vaultGeneration = getVaultSessionGeneration();
    if (await refreshOnlineServicesSession()) return true;
    if (!isCurrent(epoch, vaultGeneration)) return false;
    const vault = getUnlockedVault();
    if (!Vault.isOnlineServicesBound(vault)) return false;
    try {
        await establishOnlineServicesSession({
            deviceId: vault.OnlineServices.DeviceId,
            privateKeyJWK: vault.OnlineServices.PrivateKeyJWK,
        });
        return true;
    } catch {
        return false;
    }
}

/** The shared port returns whether credentials changed, not whether already valid. */
export async function ensureFreshOnlineServicesSession(): Promise<boolean> {
    if (!isCloudServicesEnabled()) return false;
    if (sessionIdentityTransitionActive) return false;
    if (signedOutVaultGeneration === getVaultSessionGeneration()) return false;
    if (pendingAuth) {
        await pendingAuth.promise;
        return true;
    }
    const vault = getUnlockedVault();
    let current = data();
    if (
        Vault.isOnlineServicesBound(vault) &&
        current?.deviceId &&
        current.deviceId !== vault.OnlineServices.DeviceId
    ) {
        await logoutOnlineServicesSession();
        signedOutVaultGeneration = null;
        current = null;
    }
    if (
        current?.sessionToken &&
        typeof current.sessionExpiresAt === "number" &&
        !shouldRefreshOnlineServicesSession(current.sessionExpiresAt) &&
        !(
            typeof current.refreshExpiresAt === "number" &&
            shouldRefreshOnlineServicesSession(current.refreshExpiresAt)
        )
    )
        return false;
    return renewSession();
}

export async function forceOnlineServicesSessionReauthentication(): Promise<boolean> {
    if (sessionIdentityTransitionActive) return false;
    if (signedOutVaultGeneration === getVaultSessionGeneration()) return false;
    if (pendingAuth) {
        await pendingAuth.promise;
        return true;
    }
    if (pendingRefresh) return pendingRefresh;
    if (Date.now() - lastForcedRefresh < 30_000) return false;
    lastForcedRefresh = Date.now();
    return renewSession();
}

/** Local invalidation is immediate. Revocation uses the old token, never a new session's. */
export async function logoutOnlineServicesSession(): Promise<void> {
    const previous = data();
    generation += 1;
    signedOutVaultGeneration = getVaultSessionGeneration();
    stopManagedBackup();
    pendingAuth = null;
    pendingRefresh = null;
    lastForcedRefresh = -Infinity;
    setOnlineServicesData(null);
    setStatus(onlineServicesAuthenticationStatus.disconnected());
    if (previous?.sessionToken) {
        const client = createTRPCClient<VersionedRouter>({
            links: onlineServicesLinks({
                Authorization: `Bearer ${previous.sessionToken}`,
            }),
        });
        void client.v1.auth.logout
            .mutate({ refreshToken: previous.refreshToken ?? undefined })
            .catch(() => undefined);
    }
}

export async function syncOnlineServicesRemoteConfiguration(): Promise<void> {
    const previous = data();
    if (!previous?.sessionToken) return;
    const epoch = generation;
    const vaultGeneration = getVaultSessionGeneration();
    const { trpc } = await import("@/utils/trpc");
    const config = await trpc.v1.user.configuration.query();
    const latest = data();
    if (
        !isCurrent(epoch, vaultGeneration) ||
        !latest ||
        latest.deviceId !== previous.deviceId ||
        config.deviceId !== latest.deviceId
    )
        return;
    setOnlineServicesData({ ...latest, remoteData: config });
    const vault = getUnlockedVault();
    if (
        !Vault.isOnlineServicesBound(vault) ||
        vault.OnlineServices.DeviceId !== config.deviceId ||
        vault.OnlineServices.IsRootDevice === config.root
    )
        return;
    const next = Object.assign(
        Object.create(Object.getPrototypeOf(vault)),
        vault,
    );
    next.OnlineServices = {
        ...vault.OnlineServices,
        IsRootDevice: config.root,
    };
    vaultStore.set(unlockedVaultAtom, next);
}
