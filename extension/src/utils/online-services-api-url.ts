import { env } from "../env";
import { buildTrpcUrl } from "@cryptex-industries/api-contract";

/**
 * Base URL for Cryptex Cloud tRPC. Uses VITE_ONLINE_SERVICES_API_URL when set,
 * otherwise the web app URL (same-origin combined deploy).
 */
export function getExtensionOnlineServicesApiBaseUrl(): string {
    const cloudUrl = env.NEXT_PUBLIC_ONLINE_SERVICES_API_URL?.replace(
        /\/+$/,
        "",
    );
    if (cloudUrl?.length) {
        return cloudUrl;
    }

    return env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
}

export function getExtensionOnlineServicesTrpcUrl(): string {
    if (!isExtensionCloudServicesEnabled()) {
        return "";
    }
    return buildTrpcUrl(getExtensionOnlineServicesApiBaseUrl());
}

export function isExtensionCloudServicesEnabled(): boolean {
    return env.NEXT_PUBLIC_CLOUD_ENABLED !== false;
}
