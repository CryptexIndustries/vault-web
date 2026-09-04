type ContentSecurityPolicyEnv = {
    NEXT_PUBLIC_APP_URL?: string;
    NEXT_PUBLIC_CLOUD_ENABLED: boolean;
    NEXT_PUBLIC_ONLINE_SERVICES_API_URL?: string;
    NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN?: string;
};

const toOrigin = (value: string | undefined) => {
    if (!value) return null;
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
};

/** Build the application CSP from the running container's public settings. */
export const createContentSecurityPolicy = (env: ContentSecurityPolicyEnv) => {
    const appOrigin = toOrigin(env.NEXT_PUBLIC_APP_URL);
    const apiOrigin = env.NEXT_PUBLIC_CLOUD_ENABLED
        ? toOrigin(
              env.NEXT_PUBLIC_ONLINE_SERVICES_API_URL ||
                  env.NEXT_PUBLIC_APP_URL,
          )
        : null;
    const backupStorageOrigin = env.NEXT_PUBLIC_CLOUD_ENABLED
        ? toOrigin(env.NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN)
        : null;
    const externalApiOrigin = apiOrigin === appOrigin ? null : apiOrigin;
    const connectSrc = [
        "connect-src 'self' ws: wss: https://challenges.cloudflare.com https://api.stripe.com",
        externalApiOrigin,
        backupStorageOrigin,
    ]
        .filter(Boolean)
        .join(" ");

    return [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://js.stripe.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        connectSrc,
        "frame-src https://challenges.cloudflare.com https://js.stripe.com",
        "frame-ancestors 'none'",
        "form-action 'self'",
    ].join("; ");
};

/** Narrow CSP for the native Turnstile WebView bridge only. */
export const turnstileMobileContentSecurityPolicy = [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    // Next Pages emits small inline bootstrap scripts; keep this exception
    // isolated to the bridge route.
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://challenges.cloudflare.com",
    "font-src 'self' data:",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com about:blank about:srcdoc",
    "child-src https://challenges.cloudflare.com about:blank about:srcdoc",
    "worker-src 'none'",
    "manifest-src 'none'",
    "media-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
].join("; ");
