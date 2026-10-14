import { httpBatchLink } from "@trpc/client";
import type { VersionedRouter } from "@cryptex-industries/api-contract";
import { buildTrpcUrl } from "@cryptex-industries/api-contract";
import superjson from "superjson";
import {
    getOnlineServicesApiBaseUrl,
    isCloudServicesEnabled,
} from "./online-services-api-url";

/** Bounded requests, including on networks that accept a socket but never reply. */
export async function fetchWithTimeout(
    input: string | URL | Request,
    init?: RequestInit,
) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const signal = init?.signal;
    if (signal?.aborted) cancel();
    signal?.addEventListener("abort", cancel);
    const timeout = setTimeout(cancel, 15_000);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
    }
}

type Headers = Parameters<typeof httpBatchLink<VersionedRouter>>[0]["headers"];

export function onlineServicesLinks(headers: Headers) {
    return [
        httpBatchLink<VersionedRouter>({
            url: buildTrpcUrl(getOnlineServicesApiBaseUrl()),
            transformer: superjson,
            headers,
            fetch: (input, init) => {
                if (!isCloudServicesEnabled()) {
                    return Promise.reject(
                        new Error("Online Services are disabled."),
                    );
                }
                return fetchWithTimeout(input, init);
            },
        }),
    ];
}
