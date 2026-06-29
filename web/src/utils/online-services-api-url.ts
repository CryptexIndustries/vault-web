import { buildTrpcUrl } from "@cryptex-industries/api-contract";

/**
 * Base URL for Cryptex Cloud (tRPC + webhooks). Falls back to the web app URL
 * when unset so same-origin dev (single stack) still works.
 */
export function getOnlineServicesApiBaseUrl(): string {
    const cloudUrl =
        process.env.NEXT_PUBLIC_ONLINE_SERVICES_API_URL?.replace(/\/+$/, "") ??
        "";
    if (cloudUrl.length > 0) {
        return cloudUrl;
    }

    return (
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ??
        "http://localhost:3000"
    );
}

export function getOnlineServicesTrpcUrl(): string {
    if (!isCloudServicesEnabled()) {
        return "";
    }
    return buildTrpcUrl(getOnlineServicesApiBaseUrl());
}

export function isCloudServicesEnabled(): boolean {
    return process.env.NEXT_PUBLIC_CLOUD_ENABLED !== "false";
}
