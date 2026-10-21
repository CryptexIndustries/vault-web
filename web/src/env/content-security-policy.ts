type ContentSecurityPolicyEnv = {
    NEXT_PUBLIC_APP_URL?: string;
    NEXT_PUBLIC_CLOUD_ENABLED: boolean;
    NEXT_PUBLIC_ONLINE_SERVICES_API_URL?: string;
    NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN?: string;
    NEXT_PUBLIC_RELAY_URL?: string;
};

/** The hosted SSH agent relay unless the deployment names another. */
const DEFAULT_RELAY_URL = "https://relay.cryptex-vault.com";

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
    // Any device may revoke an agent paired on a self-hosted relay, so
    // connect-src allows https: (never http:). ws: and wss: were open to any
    // host already, so injected script gains no new way out. Listing the
    // configured relay lets a plain http development relay work.
    const relayOrigin = env.NEXT_PUBLIC_CLOUD_ENABLED
        ? toOrigin(env.NEXT_PUBLIC_RELAY_URL || DEFAULT_RELAY_URL)
        : null;
    const externalApiOrigin = apiOrigin === appOrigin ? null : apiOrigin;
    const connectSrc = [
        "connect-src 'self' https: ws: wss: https://challenges.cloudflare.com https://api.stripe.com",
        externalApiOrigin,
        backupStorageOrigin,
        relayOrigin,
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
        "frame-src https://challenges.cloudflare.com https://js.stripe.com https://www.youtube-nocookie.com",
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

/**
 * CSP for the public /s/<id> share page. The page talks only to its own
 * origin; the decryption key never leaves the browser.
 */
export const shareRecipientContentSecurityPolicy = (development: boolean) =>
    [
        "default-src 'none'",
        "base-uri 'none'",
        "object-src 'none'",
        // libsodium runs Argon2id for passphrase-protected shares.
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        // Development needs the HMR socket.
        development ? "connect-src 'self' ws:" : "connect-src 'self'",
        "manifest-src 'self'",
        "frame-ancestors 'none'",
        "form-action 'none'",
    ].join("; ");
