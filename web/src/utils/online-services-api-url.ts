import { buildTrpcUrl } from "@cryptex-industries/api-contract";
import { env } from "@/env/public";

/**
 * Base URL for Cryptex Cloud (tRPC + webhooks). Falls back to the web app URL
 * when unset so same-origin dev (single stack) still works.
 */
export function getOnlineServicesApiBaseUrl(): string {
    const cloudUrl = env.NEXT_PUBLIC_ONLINE_SERVICES_API_URL.replace(
        /\/+$/,
        "",
    );
    if (cloudUrl.length > 0) {
        return cloudUrl;
    }

    return env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
}

export function getOnlineServicesTrpcUrl(): string {
    if (!isCloudServicesEnabled()) {
        return "";
    }
    return buildTrpcUrl(getOnlineServicesApiBaseUrl());
}

export function isCloudServicesEnabled(): boolean {
    return env.NEXT_PUBLIC_CLOUD_ENABLED;
}
