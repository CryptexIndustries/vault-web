// NOTE: In order to run bundle analysis, this file needs to be a .js file

/**
 * Don't be scared of the generics here.
 * All they do is to give us autocompletion when using this.
 *
 * @template {import('next').NextConfig} T
 * @param {T} config - A generic parameter that flows through to the return type
 * @constraint {{import('next').NextConfig}}
 */
function defineNextConfig(config) {
    return config;
}

const onlineServicesApiOrigin = (() => {
    if (process.env.NEXT_PUBLIC_CLOUD_ENABLED === "false") {
        return null;
    }

    const rawApiUrl =
        process.env.NEXT_PUBLIC_ONLINE_SERVICES_API_URL ||
        process.env.NEXT_PUBLIC_APP_URL;
    if (!rawApiUrl) {
        return null;
    }

    try {
        const apiOrigin = new URL(rawApiUrl).origin;
        const appOrigin = process.env.NEXT_PUBLIC_APP_URL
            ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
            : null;
        return apiOrigin === appOrigin ? null : apiOrigin;
    } catch {
        return null;
    }
})();

const backupStorageOrigin = (() => {
    const raw = process.env.NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN;
    if (!raw) return null;
    try {
        return new URL(raw).origin;
    } catch {
        return null;
    }
})();

const connectSrc = [
    "connect-src 'self' ws: wss: https://challenges.cloudflare.com https://api.stripe.com",
    onlineServicesApiOrigin,
    backupStorageOrigin,
]
    .filter(Boolean)
    .join(" ");

const contentSecurityPolicy = [
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

/** Narrow CSP for the native Turnstile WebView bridge only — no Stripe/app APIs. */
const turnstileMobileContentSecurityPolicy = [
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

const securityHeadersBase = [
    {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
    },
    {
        key: "X-DNS-Prefetch-Control",
        value: "on",
    },
    {
        key: "X-Frame-Options",
        value: "DENY",
    },
    {
        key: "X-XSS-Protection",
        value: "1; mode=block",
    },
    {
        key: "X-Content-Type-Options",
        value: "nosniff",
    },
    {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
    },
    {
        key: "Permissions-Policy",
        value: "microphone=(), geolocation=(), interest-cohort=()",
    },
];

const headers = () => {
    return [
        {
            source: "/turnstile/mobile",
            headers: [
                {
                    key: "Content-Security-Policy",
                    value: turnstileMobileContentSecurityPolicy,
                },
                ...securityHeadersBase,
            ],
        },
        {
            source: "/turnstile/mobile/",
            headers: [
                {
                    key: "Content-Security-Policy",
                    value: turnstileMobileContentSecurityPolicy,
                },
                ...securityHeadersBase,
            ],
        },
        {
            // Exclude the Turnstile bridge so its narrow CSP is not merged with app CSP.
            source: "/((?!turnstile/mobile(?:/)?$).*)",
            headers: [
                {
                    key: "Content-Security-Policy",
                    value: contentSecurityPolicy,
                },
                ...securityHeadersBase,
            ],
        },
    ];
};

// Remove console logs from production build, but keep errors and warnings
// Development build will still have all console logs
const rmConsoleFromBuild =
    process.env.NODE_ENV === "development"
        ? false
        : {
              exclude: ["error", "warn"],
          };
const nextConfig = {
    output: "standalone",
    reactStrictMode: true,
    images: {
        domains: [],
    },
    headers,
    compiler: {
        removeConsole: rmConsoleFromBuild,
    },
    modularizeImports: {
        "@heroicons/react/20/solid": {
            transform: "@heroicons/react/20/solid/{{member}}",
        },
    },
    // Dev-only: allow HMR /_next from private LAN hosts without hardcoding one IP.
    // Override with comma-separated ALLOWED_DEV_ORIGINS (hostnames or *.segment wildcards).
    allowedDevOrigins: (
        process.env.ALLOWED_DEV_ORIGINS ||
        [
            "192.168.*.*",
            "10.*.*.*",
            "172.16.*.*",
            "172.17.*.*",
            "172.18.*.*",
            "172.19.*.*",
            "172.20.*.*",
            "172.21.*.*",
            "172.22.*.*",
            "172.23.*.*",
            "172.24.*.*",
            "172.25.*.*",
            "172.26.*.*",
            "172.27.*.*",
            "172.28.*.*",
            "172.29.*.*",
            "172.30.*.*",
            "172.31.*.*",
        ].join(",")
    )
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
};

// Comment out this part if using ANALYZE=true
export default defineNextConfig(nextConfig);

// Uncomment this part if using ANALYZE=true
// const withBundleAnalyzer = require("@next/bundle-analyzer")({
//     enabled: process.env.ANALYZE === "true",
// });
// module.exports = withBundleAnalyzer(defineNextConfig(nextConfig));
////////////////
