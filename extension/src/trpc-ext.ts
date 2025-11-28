import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import superjson from "superjson";
import { onlineServicesDataAtom, onlineServicesStore } from "@/utils/atoms";
import { env } from "./env";

export const createAuthHeader = () => {
    const onlineServicesData = onlineServicesStore.get(onlineServicesDataAtom);

    const headers: Record<string, string> = { Authorization: "" };
    if (onlineServicesData) headers.Authorization = onlineServicesData.key;
    return headers;
};

export const trpc = createTRPCClient<any>({
    links: [
        // loggerLink({
        //     enabled: (opts) =>
        //         process.env.NODE_ENV === "development" ||
        //         (opts.direction === "down" && opts.result instanceof Error),
        // }),
        httpBatchLink({
            url: `${env.NEXT_PUBLIC_APP_URL}/api/trpc`,
            headers: createAuthHeader,
            transformer: superjson,
        }),
    ],
});
