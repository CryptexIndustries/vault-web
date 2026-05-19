/**
 * Extension-side tRPC client.
 *
 * Critical difference vs. `web/src/utils/trpc.ts`:
 *
 *   - The web app injects `Authorization: Bearer <jwt>` from the jotai
 *     `onlineServicesDataAtom` straight from the same JS realm that runs
 *     the React tree, because every authenticated tRPC call lives there.
 *   - The extension has multiple realms (popup, link page, offscreen,
 *     SW) and the popup's atoms vanish the moment the popup closes. So
 *     header ownership moves into the SW, and this file's
 *     `httpBatchLink` is just a transport that hands the raw request to
 *     the SW via {@link swProxyFetch}.
 *
 * Everything Authorization-related happens in:
 *
 *   - `background/request-auth-interceptor.ts` (header injection),
 *   - `app_lib/auth-session-ext.ts` (token lifecycle).
 *
 * Keeping this file dumb means: there is exactly one place that knows
 * about the JWT, and the popup cannot accidentally race or stale-cache.
 */

import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import superjson from "superjson";

import { env } from "./env";
import { swProxyFetch } from "./utils/sw-proxy-fetch";

export const trpc = createTRPCClient<any>({
    links: [
        loggerLink({
            enabled: (opts) =>
                process.env.NODE_ENV === "development" ||
                (opts.direction === "down" && opts.result instanceof Error),
        }),
        httpBatchLink({
            url: `${env.NEXT_PUBLIC_APP_URL}/api/trpc`,
            transformer: superjson,
            // No `headers` callback here on purpose. The SW will set
            // Authorization (or deliberately leave it off for the
            // `v1.auth.*` bootstrap procedures).
            // Cast bridges the native `Response`/`RequestInit` shape to
            // tRPC's `FetchEsque` - structurally compatible at runtime.
            fetch: swProxyFetch as typeof fetch as never,
        }),
    ],
});
