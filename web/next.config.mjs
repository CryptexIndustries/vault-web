import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));

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

const securityHeadersBase = [
    {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
    },
    {
        key: "X-DNS-Prefetch-Control",
        value: "off",
    },
    {
        key: "X-Frame-Options",
        value: "DENY",
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
        // Stripe's checkout frames request payment, plus
        // publickey-credentials-get for Link passkey sign-in. Its 3-D Secure
        // frame requests publickey-credentials-create for bank passkey
        // registration. Vault security keys use WebAuthn PRF, so self keeps
        // both credential features. Turnstile's frame requests autoplay,
        // fullscreen, gamepad, keyboard-map, xr-spatial-tracking and
        // cross-origin-isolated, so those stay unlisted.
        value: [
            "camera=(self)",
            'payment=(self "https://js.stripe.com")',
            'publickey-credentials-get=(self "https://js.stripe.com")',
            'publickey-credentials-create=(self "https://js.stripe.com")',
            "microphone=()",
            "geolocation=()",
            "display-capture=()",
            "usb=()",
            "serial=()",
            "hid=()",
            "midi=()",
            "accelerometer=()",
            "gyroscope=()",
            "magnetometer=()",
            "idle-detection=()",
            "browsing-topics=()",
        ].join(", "),
    },
];

const headers = () => {
    return [
        {
            source: "/(.*)",
            headers: securityHeadersBase,
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
    turbopack: {
        root: workspaceRoot,
        rules: {
            "CHANGELOG.md": {
                loaders: [
                    fileURLToPath(
                        new URL("./changelog-loader.cjs", import.meta.url),
                    ),
                ],
                as: "*.js",
            },
        },
    },
    transpilePackages: [
        "@cryptex-industries/api-contract",
        "@cryptex-industries/shared-ui",
        "@cryptex-industries/vault-core",
    ],
    reactStrictMode: true,
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

export default defineNextConfig(nextConfig);
