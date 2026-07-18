/**
 * Service-worker side mirror of `web/src/app_lib/auth-session.ts`.
 *
 * The web app keeps its session in a jotai store because every authenticated
 * tRPC request happens inside the same JavaScript realm as the React tree.
 * In the extension that assumption breaks: the popup and link page
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
    performOnlineServicesPasskeyAuth,
    refreshOnlineServicesSessionTokens,
    shouldRefreshOnlineServicesSession,
    type OnlineServicesSessionTokens,
} from "@/app_lib/online-services-session/protocol";

import {
    clearOnlineServicesSession as clearStoredSession,
    getOnlineServicesSession,
    replaceOnlineServicesSession,
    type OnlineServicesSessionRecord,
} from "../utils/online-services-session-storage";
import { getExtensionOnlineServicesTrpcUrl } from "../utils/online-services-api-url";

let forcedReauthGate = createForcedReauthGate();
let sessionGeneration = 0;
let sessionEstablishmentBlocked = false;

type SessionTask = {
    generation: number;
    promise: Promise<unknown>;
};

let sessionTaskInFlight: SessionTask | null = null;

/** Deduplicates lifecycle work only within the current generation. */
function runSessionTask<T>(task: () => Promise<T>): Promise<T> {
    const generation = sessionGeneration;
    if (sessionTaskInFlight?.generation === generation) {
        return sessionTaskInFlight.promise as Promise<T>;
    }

    const promise = task().finally(() => {
        if (sessionTaskInFlight?.promise === promise) {
            sessionTaskInFlight = null;
        }
    });
    sessionTaskInFlight = { generation, promise };
    return promise;
}

/** Begins a new lifecycle in which challenge/verify and refresh may commit. */
export function allowOnlineServicesSessionEstablishment(): void {
    sessionGeneration += 1;
    sessionEstablishmentBlocked = false;
    forcedReauthGate = createForcedReauthGate();
}

/** Invalidates all in-flight work before logout performs its first await. */
function blockOnlineServicesSessionEstablishment(): void {
    sessionGeneration += 1;
    sessionEstablishmentBlocked = true;
}

function applySessionTokens(
    tokens: OnlineServicesSessionTokens,
    patch: Partial<OnlineServicesSessionRecord> = {},
): Partial<OnlineServicesSessionRecord> {
    return {
        ...patch,
        sessionToken: tokens.sessionToken,
        sessionExpiresAt: tokens.expiresAt,
        refreshToken: tokens.refreshToken,
        refreshExpiresAt: tokens.refreshExpiresAt,
    };
}

async function createBareAuthHeader(): Promise<Record<string, string>> {
    const record = await getOnlineServicesSession();
    const headers: Record<string, string> = {
        Authorization: "",
    };

    if (record.sessionToken) {
        headers.Authorization = `Bearer ${record.sessionToken}`;
    }

    return headers;
}

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
function createDirectAuthTrpcClient(
    headers: () => Promise<Record<string, string>>,
) {
    return createTRPCClient<any>({
        links: [
            httpBatchLink({
                url: getExtensionOnlineServicesTrpcUrl(),
                transformer: superjson,
                headers,
                fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
                    globalThis.fetch(input, init)) as typeof fetch as never,
            }),
        ],
    }) as any;
}

const authTrpcClient = createDirectAuthTrpcClient(createBareAuthHeader);

function createSessionBoundAuthTrpcClient(sessionToken: string) {
    return createDirectAuthTrpcClient(async () => ({
        Authorization: `Bearer ${sessionToken}`,
    }));
}

/**
 * Returns `Authorization: Bearer <token>` for a valid session, or `null`
 * when there is no usable token. Caller is expected to have already
 * called `ensureFreshOnlineServicesSession` if it requires freshness.
 */
export async function getOnlineServicesAuthorizationHeader(): Promise<
    string | null
> {
    if (sessionEstablishmentBlocked) return null;
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
        hasSession: !sessionEstablishmentBlocked && !!record.sessionToken,
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
    refresh: (refreshToken: string) =>
        authTrpcClient.v1.auth.refresh.mutate({ refreshToken }),
};

/**
 * Trades the current refresh token for a fresh session pair via `v1.auth.refresh`.
 * Returns `false` if there is no refresh token or the refresh failed.
 */
async function refreshOnlineServicesSession(): Promise<boolean> {
    if (sessionEstablishmentBlocked) return false;
    const record = await getOnlineServicesSession();
    if (!record.refreshToken) return false;
    const refreshToken = record.refreshToken;
    const generation = sessionGeneration;

    const refreshed = await refreshOnlineServicesSessionTokens(
        swOnlineServicesAuthApi,
        refreshToken,
    );
    if (!refreshed) {
        console.warn("[SW] OS session refresh failed");
        return false;
    }

    const latest = await getOnlineServicesSession();
    if (
        sessionEstablishmentBlocked ||
        generation !== sessionGeneration ||
        latest.refreshToken !== refreshToken
    ) {
        return false;
    }

    await replaceOnlineServicesSession({
        ...latest,
        ...applySessionTokens(refreshed),
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
    if (sessionEstablishmentBlocked) {
        return { ok: false, error: "SESSION_ESTABLISHMENT_BLOCKED" };
    }
    const generation = sessionGeneration;

    try {
        const verified = await performOnlineServicesPasskeyAuth(
            swOnlineServicesAuthApi,
            args,
        );

        if (sessionEstablishmentBlocked || generation !== sessionGeneration) {
            return { ok: false, error: "SESSION_LIFECYCLE_CHANGED" };
        }

        await replaceOnlineServicesSession({
            sessionToken: verified.sessionToken,
            sessionExpiresAt: verified.expiresAt,
            refreshToken: verified.refreshToken,
            refreshExpiresAt: verified.refreshExpiresAt,
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
async function getUnlockedVaultOnlineServicesCredentials(): Promise<{
    deviceId: string;
    privateKeyJWK: string;
} | null> {
    // Key kept in sync with `UNLOCKED_VAULT_KEY` in `background.ts`.
    const stored = await chrome.storage.session.get(["UV"]);
    const vault = stored["UV"] as
        | { OnlineServices?: { DeviceId?: string; PrivateKeyJWK?: string } }
        | null
        | undefined;
    const os = vault?.OnlineServices;
    if (!os?.DeviceId || !os?.PrivateKeyJWK) return null;

    return {
        deviceId: os.DeviceId,
        privateKeyJWK: os.PrivateKeyJWK,
    };
}

async function establishOnlineServicesSessionFromUnlockedVault(): Promise<boolean> {
    const credentials = await getUnlockedVaultOnlineServicesCredentials();
    if (!credentials) return false;

    const result = await establishOnlineServicesSession(credentials);
    return result.ok;
}

/**
 * Public entry point so the SW Unlock handler can eagerly seed the OS
 * session from the just-unlocked vault without coupling to the storage
 * key layout.
 */
export async function ensureOnlineServicesSessionFromUnlockedVault(): Promise<boolean> {
    return runSessionTask(async () => {
        const credentials = await getUnlockedVaultOnlineServicesCredentials();
        const existing = await getOnlineServicesSession();

        if (!credentials) {
            if (existing.sessionToken || existing.refreshToken) {
                await logoutOnlineServicesSession();
            }
            return false;
        }

        if (existing.deviceId && existing.deviceId !== credentials.deviceId) {
            await logoutOnlineServicesSession();
            allowOnlineServicesSessionEstablishment();
        }

        return establishOnlineServicesSession(credentials).then(
            (result) => result.ok,
        );
    });
}

/**
 * The function that the proxy-fetch interceptor calls before injecting the
 * Authorization header. Returns `true` if the SW now has a valid token
 * (either still-fresh or just refreshed); `false` means callers should
 * proceed without an Authorization header so the server can return a
 * clear `UNAUTHORIZED` instead of a stale token.
 */
export async function ensureFreshOnlineServicesSession(): Promise<boolean> {
    if (sessionEstablishmentBlocked) return false;
    const record = await getOnlineServicesSession();

    const unlockedCredentials =
        await getUnlockedVaultOnlineServicesCredentials();
    if (
        unlockedCredentials &&
        record.deviceId &&
        record.deviceId !== unlockedCredentials.deviceId
    ) {
        await logoutOnlineServicesSession();
        allowOnlineServicesSessionEstablishment();
        return runSessionTask(() =>
            establishOnlineServicesSession(unlockedCredentials).then(
                (result) => result.ok,
            ),
        );
    }

    if (!record.sessionToken) {
        if (record.refreshToken) {
            return runSessionTask(async () => {
                if (await refreshOnlineServicesSession()) return true;
                if (
                    record.deviceId &&
                    record.privateKeyJWK &&
                    (await reauthenticateFromStoredCredentials())
                ) {
                    return true;
                }
                return establishOnlineServicesSessionFromUnlockedVault();
            });
        }

        const hasStoredCreds = !!record.deviceId && !!record.privateKeyJWK;
        return runSessionTask(async () => {
            if (
                hasStoredCreds &&
                (await reauthenticateFromStoredCredentials())
            ) {
                return true;
            }
            return establishOnlineServicesSessionFromUnlockedVault();
        });
    }

    const sessionNeedsRefresh =
        typeof record.sessionExpiresAt !== "number" ||
        shouldRefreshSession(record.sessionExpiresAt);
    const refreshNeedsRotation =
        typeof record.refreshExpiresAt === "number" &&
        shouldRefreshSession(record.refreshExpiresAt);

    if (!sessionNeedsRefresh && !refreshNeedsRotation) {
        return true;
    }

    if (!record.refreshToken) {
        return runSessionTask(async () => {
            if (await reauthenticateFromStoredCredentials()) return true;
            return establishOnlineServicesSessionFromUnlockedVault();
        });
    }

    return runSessionTask(async () => {
        const refreshed = await refreshOnlineServicesSession();
        if (refreshed) return true;

        if (await reauthenticateFromStoredCredentials()) return true;
        return establishOnlineServicesSessionFromUnlockedVault();
    });
}

/**
 * Forces credential rotation after a protected request fails: refresh first,
 * then full passkey re-auth. Mirrors `auth-session.ts` and its cooldown.
 */
export async function forceOnlineServicesSessionReauthentication(): Promise<boolean> {
    if (sessionEstablishmentBlocked) return false;
    return runSessionTask(async () => {
        if (!forcedReauthGate.tryEnter()) {
            return false;
        }

        if (await refreshOnlineServicesSession()) {
            return true;
        }

        if (await reauthenticateFromStoredCredentials()) return true;
        return establishOnlineServicesSessionFromUnlockedVault();
    });
}

/**
 * Invalidates local credentials immediately, then best-effort revokes the
 * captured server session with a client bound to the captured bearer.
 */
export async function logoutOnlineServicesSession(): Promise<void> {
    blockOnlineServicesSessionEstablishment();
    const record = await getOnlineServicesSession();
    await clearStoredSession();

    if (record.sessionToken) {
        try {
            const logoutClient = createSessionBoundAuthTrpcClient(
                record.sessionToken,
            );
            await logoutClient.v1.auth.logout.mutate({
                refreshToken: record.refreshToken ?? undefined,
            });
        } catch {
            // Local clear still proceeds when revocation fails offline.
        }
    }
}

/**
 * Drops the session entirely. Used when the vault locks, the user clears
 * the linked device, or the link receive flow signals "no online services".
 */
export async function clearOnlineServicesSession(): Promise<void> {
    await logoutOnlineServicesSession();
}

export type { OnlineServicesSessionRecord };
