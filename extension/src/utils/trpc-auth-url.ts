/**
 * Helpers for inspecting tRPC `httpBatchLink` URLs so the SW interceptor
 * can decide whether a request needs an Authorization header.
 *
 * `httpBatchLink` encodes batched operation paths into the URL path itself:
 *
 *     {API_BASE_URL}/api/trpc/v1.auth.challenge,v1.foo.bar?batch=1&input=...
 *
 * The leading "/api/trpc/" segment is constant and the trailing segment is a
 * comma-separated list of procedure paths. Single (non-batched) calls have
 * only one path. Treating the path list as the source of truth lets us reuse
 * the same "is this auth-only" rule as the web app's
 * `shouldEnsureFreshSession` helper in `web/src/app_lib/auth-session.ts`.
 */

const TRPC_PATH_PREFIX = "/api/trpc/";

/** True iff `url` targets the configured tRPC HTTP endpoint. */
export function isTrpcApiRequest(url: string, apiBaseUrl: string): boolean {
    try {
        const requestUrl = new URL(url);
        const configuredApiUrl = new URL(apiBaseUrl);
        if (
            requestUrl.protocol !== "http:" &&
            requestUrl.protocol !== "https:"
        ) {
            return false;
        }
        if (
            configuredApiUrl.protocol !== "http:" &&
            configuredApiUrl.protocol !== "https:"
        ) {
            return false;
        }
        if (requestUrl.origin !== configuredApiUrl.origin) return false;

        const apiPath = configuredApiUrl.pathname.replace(/\/+$/, "");
        return requestUrl.pathname.startsWith(`${apiPath}${TRPC_PATH_PREFIX}`);
    } catch {
        return false;
    }
}

/**
 * Extracts the batched tRPC procedure paths from a URL.
 * Returns an empty array when the URL is malformed or not a tRPC request.
 */
export function parseTrpcOperationPaths(url: string): string[] {
    const trpcIdx = url.indexOf(TRPC_PATH_PREFIX);
    if (trpcIdx === -1) return [];

    const afterPrefix = url.slice(trpcIdx + TRPC_PATH_PREFIX.length);
    // Strip the query string (input/batch params) and trailing slashes.
    const pathSegment = afterPrefix.split("?")[0]?.replace(/\/+$/, "") ?? "";
    if (!pathSegment) return [];

    return pathSegment
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
}

/**
 * Mirrors `web/src/app_lib/auth-session.ts#shouldEnsureFreshSession`: every
 * procedure under `v1.auth.*` is itself the auth bootstrap (challenge /
 * verify / refresh / recover / register), so they must NOT recurse through
 * the authenticated path.
 */
export function trpcBatchRequiresAuth(url: string): boolean {
    const paths = parseTrpcOperationPaths(url);
    if (paths.length === 0) return false;
    return paths.some((p) => !p.startsWith("v1.auth."));
}
