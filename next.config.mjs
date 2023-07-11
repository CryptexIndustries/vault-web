// NOTE: In order to run bundle analysis, this file needs to be a .js file

// Comment out this part if using ANALYZE=true
import { env } from "./src/env/server.mjs";

import withPWA from "next-pwa";

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

const headers = () => {
    return [
        {
            source: "/(.*)",
            headers: [
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
                {
                    // Allow the service worker to be loaded from all domains
                    key: "Service-Worker-Allowed",
                    value: "/",
                },
            ],
        },
    ];
};

const _withPWA = withPWA({
    dest: "public",
    // disable: process.env.NODE_ENV === "development",
    register: true,
    scope: "/",
    sw: "/app/service-worker.js",
    reloadOnOnline: false,
    skipWaiting: true,
    buildExcludes: ["app-build-manifest.json"],
    dynamicStartUrl: false,
    cacheStartUrl: false,
    runtimeCaching: [
        {
            urlPattern: ({ url }) => url.pathname.startsWith("/api"),
            handler: "NetworkOnly",
        },
        // Make sure we update /app when we're online but still cache it
        {
            urlPattern: ({ url }) => url.pathname.startsWith("/app"),
            handler: "NetworkFirst",
            options: {
                cacheName: "app-cache",
                cacheableResponse: {
                    statuses: [0, 200],
                },
            },
        },
    ],
});

// Remove console logs from production build, but keep errors and warnings
// Development build will still have all console logs
const rmConsoleFromBuild =
    process.env.NODE_ENV === "development"
        ? false
        : {
              exclude: ["error", "warn"],
          };

const nextConfig = {
    reactStrictMode: true,
    swcMinify: true,
    images: {
        domains: ["play.google.com"],
    },
    typescript: {
        ignoreBuildErrors: true,
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
};

// Comment out this part if using ANALYZE=true
export default _withPWA(defineNextConfig(nextConfig));

// Uncomment this part if using ANALYZE=true
// const withBundleAnalyzer = require("@next/bundle-analyzer")({
//     enabled: process.env.ANALYZE === "true",
// });
// module.exports = withBundleAnalyzer(defineNextConfig(nextConfig));
////////////////
