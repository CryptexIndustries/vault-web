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
