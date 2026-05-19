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
import {
    parseJwkFromString,
    signChallenge,
} from "@/app_lib/vault-utils/passkey";
import { Vault } from "@/app_lib/vault-utils/vault";
import type { VersionedRouter } from "@/server/trpc";

const SESSION_REFRESH_LEAD_MS = 60_000;

let refreshInFlight: Promise<boolean> | null = null;

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
    return expiresAtMs - Date.now() <= SESSION_REFRESH_LEAD_MS;
}

export async function refreshOnlineServicesSession(): Promise<boolean> {
    const data = onlineServicesStore.get(onlineServicesDataAtom);
    if (!data?.sessionToken) return false;

    try {
        const res = await authSessionClient.v1.auth.refresh.mutate({
            sessionToken: data.sessionToken,
        });
        const latest = onlineServicesStore.get(onlineServicesDataAtom);
        if (!latest) {
            return false;
        }
        setOnlineServicesData({
            ...latest,
            sessionToken: res.sessionToken,
            sessionExpiresAt: res.expiresAt,
        });
        return true;
    } catch {
        return false;
    }
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

export async function ensureFreshOnlineServicesSession(): Promise<boolean> {
    const data = onlineServicesStore.get(onlineServicesDataAtom);
    if (!data?.sessionToken?.length) {
        return false;
    }

    if (
        typeof data.sessionExpiresAt !== "number" ||
        !shouldRefreshSession(data.sessionExpiresAt)
    ) {
        return false;
    }

    if (refreshInFlight) {
        return refreshInFlight;
    }

    refreshInFlight = (async () => {
        const refreshed = await refreshOnlineServicesSession();
        if (refreshed) {
            return true;
        }

        return reauthenticateOnlineServicesSession();
    })().finally(() => {
        refreshInFlight = null;
    });

    return refreshInFlight;
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
        const ch = await authSessionClient.v1.auth.challenge.mutate({
            deviceId: options.deviceId,
        });

        const challengeBytes = Uint8Array.fromBase64(ch.challenge);

        const signature = await signChallenge(
            parseJwkFromString(options.privateKeyJWK),
            challengeBytes,
        );

        const verified = await authSessionClient.v1.auth.verify.mutate({
            challengeId: ch.challengeId,
            signature,
            deviceId: options.deviceId,
        });

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

    // TODO: Remove this. Unnecessary vault save.
    // const saveRes = await saveVaultWithSessionSecret(meta, next);
    // if (saveRes.isErr()) {
    //     console.warn(
    //         "[syncOnlineServicesRemoteConfiguration] could not persist IsRootDevice",
    //         saveRes.error,
    //     );
    //     return;
    // }

    vaultStore.set(unlockedVaultAtom, next);
}
