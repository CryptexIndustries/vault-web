/// <reference types="vite/client" />
/// <reference types="chrome" />

interface ImportMetaEnv {
    readonly VITE_APP_URL?: string;
    readonly VITE_EXTENSION_NAME_PREFIX?: string;

    readonly VITE_PUSHER_APP_ID?: string;
    readonly VITE_PUSHER_APP_KEY?: string;
    readonly VITE_PUSHER_APP_HOST?: string;
    readonly VITE_PUSHER_APP_PORT?: string;
    readonly VITE_PUSHER_APP_TLS?: string;
    readonly VITE_ONLINE_SERVICES_API_URL?: string;
    readonly VITE_CLOUD_ENABLED?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
