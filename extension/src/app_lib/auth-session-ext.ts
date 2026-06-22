/**
 * Service-worker side mirror of `web/src/app_lib/auth-session.ts`.
 *
 * The web app keeps its session in a jotai store because every authenticated
 * tRPC request happens inside the same JavaScript realm as the React tree.
 * In the extension that assumption breaks: the popup, link page, offscreen
 * document, and SW each get their own realm, and the popup atoms vanish
 * the moment the popup closes. To stop the Authorization header from being
 * "out of line" we move ownership entirely into the SW, which:
 *
 *   1. holds the JWT and refresh credentials in `chrome.storage.session`,
 *   2. exposes `ensureFreshOnlineServicesSession()` to other SW code paths
 *      (notably the proxy-fetch interceptor), and
 *   3. uses its own tRPC client that bypasses the proxy (otherwise auth
 *      calls would recurse through themselves).
 *
 * Shape mirrors the web helpers so behaviour - including the
 * `v1.auth.*`-only bootstrap rule and the 60s refresh-lead-time - stays
 * symmetric across the two surfaces.
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

import {
    createForcedReauthGate,
    createRefreshInFlightRunner,
    performOnlineServicesPasskeyAuth,
    refreshOnlineServicesSessionTokens,
    shouldRefreshOnlineServicesSession,
} from "@/app_lib/online-services-session/protocol";

import { env } from "../env";
import {
    clearOnlineServicesSession as clearStoredSession,
    getOnlineServicesSession,
    setOnlineServicesSession,
    type OnlineServicesSessionRecord,
} from "../utils/online-services-session-storage";

const sessionRefreshRunner = createRefreshInFlightRunner();
const forcedReauthGate = createForcedReauthGate();

/**
 * SW-internal tRPC client. It MUST NOT use the proxy fetch - the proxy
 * fetch is the very thing that calls into this module, so reusing it
 * here would deadlock and ensure-fresh would never resolve. Using
 * `globalThis.fetch` keeps the call to a direct cross-origin fetch
 * permitted by `host_permissions` in the manifest.
 *
 * `any` matches `trpc-ext.ts` to avoid pulling the server router type
 * (which transitively imports node-only modules) into the extension build.
 */
// `as any` on the client: `<any>` for the router gives us `any.v1.auth.x`
// at runtime but tsgo's stricter inference doesn't expose `.v1` through
// the `DecoratedProcedureRecord` fallback. We deliberately stay
// untyped here so the extension doesn't have to import the server
// router type (which transitively pulls node-only modules).
// The `fetch` cast bridges between native `fetch` and tRPC's
// `FetchEsque` shape - both call signatures are structurally
// compatible at runtime.
const authTrpcClient = createTRPCClient<any>({
    links: [
        httpBatchLink({
            url: `${env.NEXT_PUBLIC_APP_URL}/api/trpc`,
            transformer: superjson,
            fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
                globalThis.fetch(input, init)) as typeof fetch as never,
        }),
    ],
}) as any;

/**
 * Returns `Authorization: Bearer <token>` for a valid session, or `null`
 * when there is no usable token. Caller is expected to have already
 * called `ensureFreshOnlineServicesSession` if it requires freshness.
 */
export async function getOnlineServicesAuthorizationHeader(): Promise<
    string | null
> {
    const record = await getOnlineServicesSession();
    if (!record.sessionToken) return null;
    return `Bearer ${record.sessionToken}`;
}

export async function getOnlineServicesStateSnapshot(): Promise<{
    hasSession: boolean;
    sessionExpiresAt: number | null;
    deviceId: string | null;
}> {
    const record = await getOnlineServicesSession();
    return {
        hasSession: !!record.sessionToken,
        sessionExpiresAt: record.sessionExpiresAt,
        deviceId: record.deviceId,
    };
}

function shouldRefreshSession(expiresAtMs: number): boolean {
    return shouldRefreshOnlineServicesSession(expiresAtMs);
}

const swOnlineServicesAuthApi = {
    challenge: (deviceId: string) =>
        authTrpcClient.v1.auth.challenge.mutate({ deviceId }),
    verify: (input: {
        challengeId: string;
        signature: string;
        deviceId: string;
    }) => authTrpcClient.v1.auth.verify.mutate(input),
    refresh: (sessionToken: string) =>
        authTrpcClient.v1.auth.refresh.mutate({ sessionToken }),
};

/**
 * Trades the current session token for a fresh one via `v1.auth.refresh`.
 * Returns `false` if there is no current session or the refresh failed.
 */
async function refreshOnlineServicesSession(): Promise<boolean> {
    const record = await getOnlineServicesSession();
    if (!record.sessionToken) return false;

    const refreshed = await refreshOnlineServicesSessionTokens(
        swOnlineServicesAuthApi,
        record.sessionToken,
    );
    if (!refreshed) {
        console.warn("[SW] OS session refresh failed");
        return false;
    }

    await setOnlineServicesSession({
        sessionToken: refreshed.sessionToken,
        sessionExpiresAt: refreshed.expiresAt,
    });
    return true;
}

/**
 * Performs the full passkey challenge/verify dance and stores the resulting
 * token (plus the credentials used to obtain it, so future refreshes /
 * re-auths don't need them passed in again).
 *
 * `deviceId` + `privateKeyJWK` originate from either the unlocked vault
 * (`vault.OnlineServices`) or, during the link receive flow, the freshly
 * decrypted link package.
 */
export async function establishOnlineServicesSession(args: {
    deviceId: string;
    privateKeyJWK: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
        const verified = await performOnlineServicesPasskeyAuth(
            swOnlineServicesAuthApi,
            args,
        );

        await setOnlineServicesSession({
            sessionToken: verified.sessionToken,
            sessionExpiresAt: verified.expiresAt,
            deviceId: args.deviceId,
            privateKeyJWK: args.privateKeyJWK,
        });

        return { ok: true };
    } catch (error) {
        console.error("[SW] OS session establish failed", error);
        return {
            ok: false,
            error: error instanceof Error ? error.message : "ESTABLISH_FAILED",
        };
    }
}

async function reauthenticateFromStoredCredentials(): Promise<boolean> {
    const record = await getOnlineServicesSession();
    if (!record.deviceId || !record.privateKeyJWK) return false;

    const result = await establishOnlineServicesSession({
        deviceId: record.deviceId,
        privateKeyJWK: record.privateKeyJWK,
    });
    return result.ok;
}

/**
 * Last-resort credential source: the unlocked vault itself. The SW reads
 * the vault out of `chrome.storage.session` (where the Unlock handler put
 * it) and pulls `OnlineServices.{DeviceId,PrivateKeyJWK}`. Used when the
 * SW has no stored session record yet - typically right after a fresh
 * unlock if the eager bootstrap hasn't completed, or after a `storage.session`
 * clear that left the vault key intact.
 */
async function establishOnlineServicesSessionFromUnlockedVault(): Promise<boolean> {
    // Key kept in sync with `UNLOCKED_VAULT_KEY` in `background.ts`.
    const stored = await chrome.storage.session.get(["UV"]);
    const vault = stored["UV"] as
        | { OnlineServices?: { DeviceId?: string; PrivateKeyJWK?: string } }
        | null
        | undefined;
    const os = vault?.OnlineServices;
    if (!os?.DeviceId || !os?.PrivateKeyJWK) return false;

    const result = await establishOnlineServicesSession({
        deviceId: os.DeviceId,
        privateKeyJWK: os.PrivateKeyJWK,
    });
    return result.ok;
}

/**
 * Public entry point so the SW Unlock handler can eagerly seed the OS
 * session from the just-unlocked vault without coupling to the storage
 * key layout.
 */
export async function ensureOnlineServicesSessionFromUnlockedVault(): Promise<boolean> {
    return sessionRefreshRunner.run(
        establishOnlineServicesSessionFromUnlockedVault,
    );
}

/**
 * The function that the proxy-fetch interceptor calls before injecting the
 * Authorization header. Returns `true` if the SW now has a valid token
 * (either still-fresh or just refreshed); `false` means callers should
 * proceed without an Authorization header so the server can return a
 * clear `UNAUTHORIZED` instead of a stale token.
 */
export async function ensureFreshOnlineServicesSession(): Promise<boolean> {
    const record = await getOnlineServicesSession();

    if (!record.sessionToken) {
        const hasStoredCreds = !!record.deviceId && !!record.privateKeyJWK;
        return sessionRefreshRunner.run(async () => {
            if (
                hasStoredCreds &&
                (await reauthenticateFromStoredCredentials())
            ) {
                return true;
            }
            return establishOnlineServicesSessionFromUnlockedVault();
        });
    }

    if (
        typeof record.sessionExpiresAt === "number" &&
        !shouldRefreshSession(record.sessionExpiresAt)
    ) {
        return true;
    }

    return sessionRefreshRunner.run(async () => {
        const refreshed = await refreshOnlineServicesSession();
        if (refreshed) return true;

        if (await reauthenticateFromStoredCredentials()) return true;
        return establishOnlineServicesSessionFromUnlockedVault();
    });
}

/**
 * Forces a full passkey re-auth, bypassing refresh. Used when a protected
 * API call fails with UNAUTHORIZED. Mirrors `auth-session.ts` cooldown.
 */
export async function forceOnlineServicesSessionReauthentication(): Promise<boolean> {
    return sessionRefreshRunner.run(async () => {
        if (!forcedReauthGate.tryEnter()) {
            return false;
        }

        if (await reauthenticateFromStoredCredentials()) return true;
        return establishOnlineServicesSessionFromUnlockedVault();
    });
}

/**
 * Drops the session entirely. Used when the vault locks, the user clears
 * the linked device, or the link receive flow signals "no online services".
 */
export async function clearOnlineServicesSession(): Promise<void> {
    await clearStoredSession();
}

export type { OnlineServicesSessionRecord };
