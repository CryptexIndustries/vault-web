// src/utils/trpc.ts
import {
    createTRPCClient,
    httpBatchLink,
    loggerLink,
    type Operation,
} from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import type { VersionedRouter } from "@cryptex-industries/api-contract";
import {
    getOnlineServicesTrpcUrl,
    isCloudServicesEnabled,
} from "./online-services-api-url";
import {
    createBareAuthHeader,
    ensureFreshOnlineServicesSession,
} from "../app_lib/auth-session";

function shouldEnsureFreshSession(opList: Operation[]) {
    return opList.some((op) => {
        if (op.path === "v1.auth.logout") return true;
        return !op.path.startsWith("v1.auth.");
    });
}

async function createHeadersWithFreshSession(opList: Operation[]) {
    if (shouldEnsureFreshSession(opList)) {
        await ensureFreshOnlineServicesSession();
    }

    return createBareAuthHeader();
}

export const reactQueryClientConfig = (baseUrl: string) => {
    /**
     * If you want to use SSR, you need to use the server's full URL
     * @link https://trpc.io/docs/ssr
     */
    const url = isCloudServicesEnabled()
        ? getOnlineServicesTrpcUrl()
        : `${baseUrl}/api/trpc`;

    return {
        links: [
            loggerLink({
                enabled: (opts) =>
                    process.env.NODE_ENV === "development" ||
                    (opts.direction === "down" && opts.result instanceof Error),
            }),
            httpBatchLink({
                url,
                headers: async ({ opList }) =>
                    createHeadersWithFreshSession(opList),
                transformer: superjson,
            }),
        ],
        url,
        /**
         * @link https://react-query.tanstack.com/reference/QueryClient
         */
        // queryClientConfig: { defaultOptions: { queries: { staleTime: 60 } } },
    };
};

export const trpcReact = createTRPCReact<VersionedRouter>({});

export const trpc = createTRPCClient<VersionedRouter>({
    links: [
        loggerLink({
            enabled: (opts) =>
                process.env.NODE_ENV === "development" ||
                (opts.direction === "down" && opts.result instanceof Error),
        }),
        httpBatchLink({
            url: isCloudServicesEnabled()
                ? getOnlineServicesTrpcUrl()
                : "/api/trpc",
            headers: async ({ opList }) =>
                createHeadersWithFreshSession(opList),
            transformer: superjson,
        }),
    ],
});
