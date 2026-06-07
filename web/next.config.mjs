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

const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss: https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "form-action 'self'",
].join("; ");

const headers = () => {
    return [
        {
            source: "/(.*)",
            headers: [
                {
                    key: "Content-Security-Policy",
                    value: contentSecurityPolicy,
                },
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
};

// Comment out this part if using ANALYZE=true
export default defineNextConfig(nextConfig);

// Uncomment this part if using ANALYZE=true
// const withBundleAnalyzer = require("@next/bundle-analyzer")({
//     enabled: process.env.ANALYZE === "true",
// });
// module.exports = withBundleAnalyzer(defineNextConfig(nextConfig));
////////////////
