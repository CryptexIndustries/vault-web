import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { VersionedRouter } from "@cryptex-industries/api-contract";
import type { OnlineServicesData } from "@/utils/atoms";
import {
    getUnlockedVault,
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesAuthenticationStatus,
    onlineServicesDataAtom,
    onlineServicesStore,
    setOnlineServicesData,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "@/utils/atoms";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { getOnlineServicesTrpcUrl } from "@/utils/online-services-api-url";
import {
    createForcedReauthGate,
    createRefreshInFlightRunner,
    performOnlineServicesDeviceSigningKeyAuth,
    refreshOnlineServicesSessionTokens,
    shouldRefreshOnlineServicesSession,
    type OnlineServicesSessionTokens,
} from "./online-services-session/protocol";

const sessionRefreshRunner = createRefreshInFlightRunner();
const forcedReauthGate = createForcedReauthGate();
let sessionGeneration = 0;

export function createBareAuthHeader() {
    const onlineServicesData = onlineServicesStore.get(onlineServicesDataAtom);
    const headers: Record<string, string> = {
        Authorization: "",
    };

    if (onlineServicesData?.sessionToken) {
        headers.Authorization = `Bearer ${onlineServicesData.sessionToken}`;
    }

    return headers;
}

const authSessionClient = createTRPCClient<VersionedRouter>({
    links: [
        httpBatchLink({
            url: getOnlineServicesTrpcUrl() || "/api/trpc",
            headers: createBareAuthHeader,
            transformer: superjson,
        }),
    ],
});

function shouldRefreshSession(expiresAtMs: number) {
    return shouldRefreshOnlineServicesSession(expiresAtMs);
}

function applySessionTokens(
    base: OnlineServicesData,
    tokens: OnlineServicesSessionTokens,
): OnlineServicesData {
    return {
        ...base,
        sessionToken: tokens.sessionToken,
        sessionExpiresAt: tokens.expiresAt,
        refreshToken: tokens.refreshToken,
        refreshExpiresAt: tokens.refreshExpiresAt,
    };
}

const webOnlineServicesAuthApi = {
    challenge: (deviceId: string) =>
        authSessionClient.v1.auth.challenge.mutate({ deviceId }),
    verify: (input: {
        challengeId: string;
        signature: string;
        deviceId: string;
    }) => authSessionClient.v1.auth.verify.mutate(input),
    refresh: (refreshToken: string) =>
        authSessionClient.v1.auth.refresh.mutate({ refreshToken }),
};

export async function refreshOnlineServicesSession(): Promise<boolean> {
    const data = onlineServicesStore.get(onlineServicesDataAtom);
    if (!data?.refreshToken) return false;
    const refreshToken = data.refreshToken;
    const generation = sessionGeneration;

    const refreshed = await refreshOnlineServicesSessionTokens(
        webOnlineServicesAuthApi,
        refreshToken,
    );
    if (!refreshed) {
        return false;
    }

    const latest = onlineServicesStore.get(onlineServicesDataAtom);
    if (
        generation !== sessionGeneration ||
        !latest ||
        latest.refreshToken !== refreshToken
    ) {
        return false;
    }
    setOnlineServicesData(applySessionTokens(latest, refreshed));
    return true;
}

async function reauthenticateOnlineServicesSession(): Promise<boolean> {
    const vault = getUnlockedVault();

    if (!Vault.isOnlineServicesBound(vault)) return false;

    const vaultOs = vault.OnlineServices;

    try {
        await establishPremiumSession({
            deviceId: vaultOs.DeviceId,
            privateKeyJWK: vaultOs.PrivateKeyJWK,
        });
        return true;
    } catch {
        return false;
    }
}

function runOnlineServicesSessionRefresh(
    refresh: () => Promise<boolean>,
): Promise<boolean> {
    return sessionRefreshRunner.run(refresh);
}

export async function forceOnlineServicesSessionReauthentication(): Promise<boolean> {
    return sessionRefreshRunner.run(async () => {
        if (!forcedReauthGate.tryEnter()) {
            return false;
        }

        // Revoked access JWTs may still be within expiry — rotate via refresh first.
        if (await refreshOnlineServicesSession()) {
            return true;
        }

        return reauthenticateOnlineServicesSession();
    });
}

export async function ensureFreshOnlineServicesSession(): Promise<boolean> {
    const data = onlineServicesStore.get(onlineServicesDataAtom);
    const vault = getUnlockedVault();
    const vaultOnlineServices = Vault.isOnlineServicesBound(vault)
        ? vault.OnlineServices
        : null;

    if (!data?.sessionToken?.length) {
        if (data?.refreshToken) {
            return runOnlineServicesSessionRefresh(async () => {
                if (await refreshOnlineServicesSession()) {
                    return true;
                }
                if (!vaultOnlineServices) return false;
                return reauthenticateOnlineServicesSession();
            });
        }

        if (!vaultOnlineServices) return false;

        return runOnlineServicesSessionRefresh(
            reauthenticateOnlineServicesSession,
        );
    }

    if (vaultOnlineServices && data.deviceId !== vaultOnlineServices.DeviceId) {
        await logoutOnlineServicesSession();
        return runOnlineServicesSessionRefresh(
            reauthenticateOnlineServicesSession,
        );
    }

    const sessionNeedsRefresh =
        typeof data.sessionExpiresAt !== "number" ||
        shouldRefreshSession(data.sessionExpiresAt);
    const refreshNeedsRotation =
        typeof data.refreshExpiresAt === "number" &&
        shouldRefreshSession(data.refreshExpiresAt);

    if (!sessionNeedsRefresh && !refreshNeedsRotation) {
        return false;
    }

    if (!data.refreshToken) {
        if (!vaultOnlineServices) return false;

        return runOnlineServicesSessionRefresh(
            reauthenticateOnlineServicesSession,
        );
    }

    return runOnlineServicesSessionRefresh(async () => {
        const refreshed = await refreshOnlineServicesSession();
        if (refreshed) {
            return true;
        }

        return reauthenticateOnlineServicesSession();
    });
}

/**
 * Revokes the current server session (JWT jti + refresh token) then clears
 * local state. Best-effort when the network call fails.
 */
export async function logoutOnlineServicesSession(): Promise<void> {
    const data = onlineServicesStore.get(onlineServicesDataAtom);
    sessionGeneration += 1;

    if (data?.sessionToken) {
        try {
            await authSessionClient.v1.auth.logout.mutate({
                refreshToken: data.refreshToken ?? undefined,
            });
        } catch {
            // Local clear still proceeds when revocation fails offline.
        }
    }

    setOnlineServicesData(null);
    onlineServicesStore.set(
        onlineServicesAuthConnectionStatusAtom,
        onlineServicesAuthenticationStatus.disconnected(),
    );
}

/**
 * Full device signing key challenge-response: obtain JWT for premium APIs.
 */
export async function establishPremiumSession(options: {
    deviceId: string;
    privateKeyJWK: string;
}): Promise<void> {
    onlineServicesStore.set(
        onlineServicesAuthConnectionStatusAtom,
        onlineServicesAuthenticationStatus.connecting(),
    );

    try {
        const verified = await performOnlineServicesDeviceSigningKeyAuth(
            webOnlineServicesAuthApi,
            options,
        );

        const prev = onlineServicesStore.get(onlineServicesDataAtom);
        const next: OnlineServicesData = applySessionTokens(
            {
                deviceId: options.deviceId,
                remoteData: prev?.remoteData ?? null,
            },
            verified,
        );
        setOnlineServicesData(next);

        onlineServicesStore.set(
            onlineServicesAuthConnectionStatusAtom,
            onlineServicesAuthenticationStatus.connected(),
        );
    } catch (e) {
        onlineServicesStore.set(
            onlineServicesAuthConnectionStatusAtom,
            onlineServicesAuthenticationStatus.failed(
                e instanceof Error ? e.message : undefined,
            ),
        );
        throw e;
    }
}

/** Refresh subscription/root flags from the server after auth is established. */
export async function syncOnlineServicesRemoteConfiguration(): Promise<void> {
    const prev = onlineServicesStore.get(onlineServicesDataAtom);
    if (!prev?.sessionToken?.length) {
        return;
    }

    // We need to use the trpc client (lazily) here to avoid circular dependencies
    const { trpc } = await import("@/utils/trpc");
    const config = await trpc.v1.user.configuration.query();
    setOnlineServicesData({
        ...prev,
        deviceId: config.deviceId,
        remoteData: config,
    });

    const vault = vaultStore.get(unlockedVaultAtom);
    const meta = vaultStore.get(unlockedVaultMetadataAtom);
    if (!meta?.Blob || !Vault.isOnlineServicesBound(vault)) {
        return;
    }

    const cachedRoot = vault.OnlineServices.IsRootDevice;
    if (cachedRoot === config.root) {
        return;
    }

    const next = Object.assign(new Vault(), vault);
    next.OnlineServices.IsRootDevice = config.root;

    vaultStore.set(unlockedVaultAtom, next);
}
