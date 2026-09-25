/**
 * Extension env shim.
 *
 * Values come from Vite's per-mode `.env.{development,production}` files via
 * `import.meta.env`. Keys are re-exported under the same `NEXT_PUBLIC_*` names
 * that web/ uses, so shared code (`web/src/app_lib/...`) sees the same shape
 * in both environments.
 *
 * Validation: in production mode, missing required values throw at module
 * load time so we fail fast instead of pointing the shipped extension at
 * placeholder/localhost hosts.
 */

const isProduction = import.meta.env.MODE === "production";

const required = (key: string, value: string | undefined): string => {
    if (value == null || value === "") {
        if (isProduction) {
            throw new Error(
                `Missing required extension env var "${key}" in production build. ` +
                    `Set it in extension/.env.production (or .env.production.local).`,
            );
        }
        return "";
    }

    if (isProduction && value.includes("REPLACE_ME")) {
        throw new Error(
            `Placeholder value detected for "${key}" in production build. ` +
                `Replace the REPLACE_ME default in extension/.env.production.`,
        );
    }

    return value;
};

const requireHttps = (key: string, value: string): string => {
    if (isProduction && !value.startsWith("https://")) {
        throw new Error(
            `"${key}" must use https:// in production builds. Got "${value}".`,
        );
    }
    return value;
};

const e = import.meta.env;

export const env = {
    NEXT_PUBLIC_APP_URL: requireHttps(
        "VITE_APP_URL",
        required("VITE_APP_URL", e.VITE_APP_URL),
    ),

    NEXT_PUBLIC_PUSHER_APP_ID: required(
        "VITE_PUSHER_APP_ID",
        e.VITE_PUSHER_APP_ID,
    ),
    NEXT_PUBLIC_PUSHER_APP_KEY: required(
        "VITE_PUSHER_APP_KEY",
        e.VITE_PUSHER_APP_KEY,
    ),
    NEXT_PUBLIC_PUSHER_APP_HOST: required(
        "VITE_PUSHER_APP_HOST",
        e.VITE_PUSHER_APP_HOST,
    ),
    NEXT_PUBLIC_PUSHER_APP_PORT: required(
        "VITE_PUSHER_APP_PORT",
        e.VITE_PUSHER_APP_PORT,
    ),
    NEXT_PUBLIC_PUSHER_APP_TLS:
        (e.VITE_PUSHER_APP_TLS ?? "false").toLowerCase() === "true",

    /** Optional Cryptex Vault Cloud API origin (tRPC). Defaults to app URL. */
    NEXT_PUBLIC_ONLINE_SERVICES_API_URL: e.VITE_ONLINE_SERVICES_API_URL ?? "",

    /** When false, online-services UI and tRPC calls are disabled. */
    NEXT_PUBLIC_CLOUD_ENABLED:
        (e.VITE_CLOUD_ENABLED ?? "true").toLowerCase() !== "false",
};
