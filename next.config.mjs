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
                    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
                },
            ],
        },
    ];
};

const _withPWA = withPWA({
    dest: "public",
    // disable: process.env.NODE_ENV === "development",
    register: true,
    scope: "/app",
    sw: "/app/service-worker.js",
});

const nextConfig = {
    reactStrictMode: true,
    trailingSlash: true, // This is required for the service worker to work
    swcMinify: true,
    images: {
        domains: ["play.google.com"],
    },
    typescript: {
        ignoreBuildErrors: true,
    },
    headers,
};

// Comment out this part if using ANALYZE=true
export default _withPWA(defineNextConfig(nextConfig));

// Uncomment this part if using ANALYZE=true
// const withBundleAnalyzer = require("@next/bundle-analyzer")({
//     enabled: process.env.ANALYZE === "true",
// });
// module.exports = withBundleAnalyzer(defineNextConfig(nextConfig));
////////////////
