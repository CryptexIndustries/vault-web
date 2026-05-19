/**
 * SW-side execution of a `MessageType.ProxyFetch` request.
 *
 * This is the file that does the "intercept the requests that need an
 * Authorization token and override the header value" job. The popup /
 * link page / offscreen document never call `fetch` directly for tRPC -
 * they hand the SW a serialised request and the SW:
 *
 *   1. Decides whether this batch needs a session token at all (auth
 *      bootstrap procedures must NOT recurse through auth).
 *   2. Refreshes / re-establishes the session if needed (see
 *      `ensureFreshOnlineServicesSession`).
 *   3. Strips any caller-provided `Authorization` header so the UI
 *      contexts can never inject a token that bypasses the SW's
 *      lifecycle, then writes the SW-owned `Bearer <jwt>` value.
 *   4. Executes the real cross-origin fetch and serialises the response
 *      back to the caller via `chrome.runtime.sendMessage`.
 */

import {
    ensureFreshOnlineServicesSession,
    getOnlineServicesAuthorizationHeader,
} from "../app_lib/auth-session-ext";
import { env } from "../env";
import type {
    ProxyFetchRequestPayload,
    ProxyFetchResponsePayload,
} from "../types/sw-messaging";
import {
    isTrpcApiRequest,
    trpcBatchRequiresAuth,
} from "../utils/trpc-auth-url";

/**
 * Returns a new headers map without any caller-supplied `Authorization`
 * entry. Comparing on lowercased keys covers the casing variants tRPC and
 * fetch implementations occasionally produce (`Authorization` vs
 * `authorization`).
 */
function stripAuthorizationHeader(
    headers: Record<string, string>,
): Record<string, string> {
    const next: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() === "authorization") continue;
        next[name] = value;
    }
    return next;
}

function serializeResponseHeaders(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    headers.forEach((value, name) => {
        out[name] = value;
    });
    return out;
}

export async function handleProxyFetch(
    payload: ProxyFetchRequestPayload,
): Promise<ProxyFetchResponsePayload> {
    if (!payload || typeof payload.url !== "string") {
        return {
            ok: false,
            status: 0,
            statusText: "Bad proxy fetch payload",
            headers: {},
            body: "",
            error: "INVALID_PROXY_FETCH_PAYLOAD",
        };
    }

    const appUrl = env.NEXT_PUBLIC_APP_URL;
    const isTrpc = isTrpcApiRequest(payload.url, appUrl);
    const needsAuth = isTrpc && trpcBatchRequiresAuth(payload.url);

    // Always start from a sanitised header set so the popup can never
    // forge or override the SW's session token by mistake.
    const headers = stripAuthorizationHeader(payload.headers ?? {});

    if (needsAuth) {
        // Best-effort: if the session can't be refreshed we still send
        // the request, but without a token. The server will then return
        // its real `UNAUTHORIZED` error, which the UI knows how to handle.
        await ensureFreshOnlineServicesSession();
        const authHeader = await getOnlineServicesAuthorizationHeader();
        if (authHeader) {
            headers["Authorization"] = authHeader;
        }
    }

    try {
        const response = await fetch(payload.url, {
            method: payload.method ?? "GET",
            headers,
            body: payload.body ?? undefined,
            // The popup talks to the API over the extension origin -
            // `omit` makes sure we never leak cookies for the API host
            // (the JWT we just injected is the only credential we want).
            credentials: "omit",
        });

        const body = await response.text();
        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: serializeResponseHeaders(response.headers),
            body,
        };
    } catch (error) {
        console.error("[SW] Proxy fetch failed", error);
        return {
            ok: false,
            status: 0,
            statusText: "Proxy fetch failed",
            headers: {},
            body: "",
            error: error instanceof Error ? error.message : "FETCH_FAILED",
        };
    }
}
