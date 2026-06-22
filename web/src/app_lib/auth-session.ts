import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
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
import { Vault } from "@/app_lib/vault-utils/vault";
import type { VersionedRouter } from "@/server/trpc";
import {
    createForcedReauthGate,
    createRefreshInFlightRunner,
    performOnlineServicesPasskeyAuth,
    refreshOnlineServicesSessionTokens,
    shouldRefreshOnlineServicesSession,
} from "./online-services-session/protocol";

const sessionRefreshRunner = createRefreshInFlightRunner();
const forcedReauthGate = createForcedReauthGate();

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
            url: "/api/trpc",
            headers: createBareAuthHeader,
            transformer: superjson,
        }),
    ],
});

function shouldRefreshSession(expiresAtMs: number) {
    return shouldRefreshOnlineServicesSession(expiresAtMs);
}

const webOnlineServicesAuthApi = {
    challenge: (deviceId: string) =>
        authSessionClient.v1.auth.challenge.mutate({ deviceId }),
    verify: (input: {
        challengeId: string;
        signature: string;
        deviceId: string;
    }) => authSessionClient.v1.auth.verify.mutate(input),
    refresh: (sessionToken: string) =>
        authSessionClient.v1.auth.refresh.mutate({ sessionToken }),
};

export async function refreshOnlineServicesSession(): Promise<boolean> {
    const data = onlineServicesStore.get(onlineServicesDataAtom);
    if (!data?.sessionToken) return false;

    const refreshed = await refreshOnlineServicesSessionTokens(
        webOnlineServicesAuthApi,
        data.sessionToken,
    );
    if (!refreshed) {
        return false;
    }

    const latest = onlineServicesStore.get(onlineServicesDataAtom);
    if (!latest) {
        return false;
    }
    setOnlineServicesData({
        ...latest,
        sessionToken: refreshed.sessionToken,
        sessionExpiresAt: refreshed.expiresAt,
    });
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
        if (!vaultOnlineServices) return false;

        return runOnlineServicesSessionRefresh(
            reauthenticateOnlineServicesSession,
        );
    }

    if (vaultOnlineServices && data.deviceId !== vaultOnlineServices.DeviceId) {
        setOnlineServicesData(null);
        return runOnlineServicesSessionRefresh(
            reauthenticateOnlineServicesSession,
        );
    }

    if (
        typeof data.sessionExpiresAt !== "number" ||
        !shouldRefreshSession(data.sessionExpiresAt)
    ) {
        if (typeof data.sessionExpiresAt === "number") {
            return false;
        }

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
 * Full passkey challenge-response: obtain JWT for premium APIs.
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
        const verified = await performOnlineServicesPasskeyAuth(
            webOnlineServicesAuthApi,
            options,
        );

        const prev = onlineServicesStore.get(onlineServicesDataAtom);
        const next: OnlineServicesData = {
            deviceId: options.deviceId,
            sessionToken: verified.sessionToken,
            sessionExpiresAt: verified.expiresAt,
            remoteData: prev?.remoteData ?? null,
        };
        setOnlineServicesData(next);

        onlineServicesStore.set(
            onlineServicesAuthConnectionStatusAtom,
            onlineServicesAuthenticationStatus.connected(),
        );

        // return {
        //     sessionToken: verified.sessionToken,
        //     expiresAt: verified.expiresAt,
        // };
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
