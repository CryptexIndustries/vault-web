import { env } from "@/env";

export function getOnlineServicesApiBaseUrl(): string {
    const cloudUrl = env.ONLINE_SERVICES_API_URL.replace(/\/+$/, "");
    if (cloudUrl.length > 0) {
        return cloudUrl;
    }

    return env.APP_URL.replace(/\/+$/, "");
}

export function isCloudServicesEnabled(): boolean {
    return env.CLOUD_ENABLED;
}
