// Expo inlines these exact process.env.EXPO_PUBLIC_* property accesses.
export const env = {
    get APP_URL() {
        return process.env.EXPO_PUBLIC_APP_URL ?? "http://localhost:3000";
    },
    TURNSTILE_SITE_KEY: process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "",
    PUSHER_APP_KEY: process.env.EXPO_PUBLIC_PUSHER_APP_KEY ?? "",
    PUSHER_APP_HOST: process.env.EXPO_PUBLIC_PUSHER_APP_HOST ?? "",
    PUSHER_APP_PORT: process.env.EXPO_PUBLIC_PUSHER_APP_PORT ?? "",
    PUSHER_APP_TLS:
        process.env.EXPO_PUBLIC_PUSHER_APP_TLS?.toLowerCase() === "true",
    get ONLINE_SERVICES_API_URL() {
        return process.env.EXPO_PUBLIC_ONLINE_SERVICES_API_URL ?? "";
    },
    get CLOUD_ENABLED() {
        return (
            (process.env.EXPO_PUBLIC_CLOUD_ENABLED ?? "true").toLowerCase() !==
            "false"
        );
    },
} as const;
