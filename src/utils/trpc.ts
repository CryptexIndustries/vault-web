// src/utils/trpc.ts
import { createTRPCProxyClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import type { VersionedRouter } from "../server/trpc";
import { onlineServicesDataAtom, onlineServicesStore } from "./atoms";

export const createAuthHeader = () => {
    const onlineServicesData = onlineServicesStore.get(onlineServicesDataAtom);

    const headers = {
        Authorization: "",
    };

    if (onlineServicesData) {
        headers.Authorization = onlineServicesData.key;
    }

    return headers;
};

export const reactQueryClientConfig = (baseUrl: string) => {
    /**
     * If you want to use SSR, you need to use the server's full URL
     * @link https://trpc.io/docs/ssr
     */
    const url = `${baseUrl}/api/trpc`;

    return {
        links: [
            loggerLink({
                enabled: (opts) =>
                    process.env.NODE_ENV === "development" ||
                    (opts.direction === "down" && opts.result instanceof Error),
            }),
            httpBatchLink({
                url,
                headers: createAuthHeader,
            }),
        ],
        url,
        transformer: superjson,
        /**
         * @link https://react-query.tanstack.com/reference/QueryClient
         */
        // queryClientConfig: { defaultOptions: { queries: { staleTime: 60 } } },
    };
};

export const trpcReact = createTRPCReact<VersionedRouter>({});

export const trpc = createTRPCProxyClient<VersionedRouter>({
    links: [
        loggerLink({
            enabled: (opts) =>
                process.env.NODE_ENV === "development" ||
                (opts.direction === "down" && opts.result instanceof Error),
        }),
        httpBatchLink({
            url: "/api/trpc",
            headers: createAuthHeader,
        }),
    ],
    transformer: superjson,
});
