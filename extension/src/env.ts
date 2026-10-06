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

import { validateProductionEnv } from "./utils/production-env";

const e = import.meta.env;

if (e.MODE === "production") validateProductionEnv(e);

export const env = {
    NEXT_PUBLIC_APP_URL: e.VITE_APP_URL ?? "",

    NEXT_PUBLIC_PUSHER_APP_ID: e.VITE_PUSHER_APP_ID ?? "",
    NEXT_PUBLIC_PUSHER_APP_KEY: e.VITE_PUSHER_APP_KEY ?? "",
    NEXT_PUBLIC_PUSHER_APP_HOST: e.VITE_PUSHER_APP_HOST ?? "",
    NEXT_PUBLIC_PUSHER_APP_PORT: e.VITE_PUSHER_APP_PORT ?? "",
    NEXT_PUBLIC_PUSHER_APP_TLS:
        (e.VITE_PUSHER_APP_TLS ?? "false").toLowerCase() === "true",

    /** Optional Cryptex Vault Cloud API origin (tRPC). Defaults to app URL. */
    NEXT_PUBLIC_ONLINE_SERVICES_API_URL: e.VITE_ONLINE_SERVICES_API_URL ?? "",

    /** When false, online-services UI and tRPC calls are disabled. */
    NEXT_PUBLIC_CLOUD_ENABLED:
        (e.VITE_CLOUD_ENABLED ?? "true").toLowerCase() !== "false",
};
