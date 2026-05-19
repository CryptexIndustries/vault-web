import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, __dirname, ["VITE_"]);
    const isProduction = mode === "production";

    if (isProduction) {
        if (!env.VITE_APP_URL) {
            throw new Error(
                "Missing VITE_APP_URL for production build. " +
                    "Set it in extension/.env.production (or .env.production.local).",
            );
        }
        if (env.VITE_APP_URL.includes("REPLACE_ME")) {
            throw new Error(
                "VITE_APP_URL still contains the REPLACE_ME placeholder. " +
                    "Replace it in extension/.env.production before shipping.",
            );
        }
        if (!env.VITE_APP_URL.startsWith("https://")) {
            throw new Error(
                `VITE_APP_URL must use https:// in production builds. Got "${env.VITE_APP_URL}".`,
            );
        }
    }

    const productionHostPermissions = (): string[] => {
        const hosts = new Set<string>();
        const add = (url: string | undefined) => {
            if (!url) return;
            try {
                const parsed = new URL(url);
                hosts.add(`${parsed.protocol}//${parsed.host}/*`);
            } catch {
                // Ignore malformed values; build-time env checks above catch the rest.
            }
        };

        add(env.VITE_APP_URL);

        if (env.VITE_PUSHER_APP_HOST) {
            const scheme =
                (env.VITE_PUSHER_APP_TLS ?? "true").toLowerCase() === "false"
                    ? "http"
                    : "https";
            const port =
                env.VITE_PUSHER_APP_PORT &&
                env.VITE_PUSHER_APP_PORT !== "80" &&
                env.VITE_PUSHER_APP_PORT !== "443"
                    ? `:${env.VITE_PUSHER_APP_PORT}`
                    : "";
            add(`${scheme}://${env.VITE_PUSHER_APP_HOST}${port}`);
        }

        return [...hosts];
    };

    return {
        plugins: [react()],
        resolve: {
            alias: {
                // Use extension env shim when importing web env
                "@/env/client.mjs": path.resolve(__dirname, "src/env.ts"),
                "../../env/client.mjs": path.resolve(__dirname, "src/env.ts"),
                "../env/client.mjs": path.resolve(__dirname, "src/env.ts"),
                "@": path.resolve(__dirname, "../web/src"),
                "@ui": path.resolve(__dirname, "../packages/shared-ui/src"),
                "@cryptex-industries/shared-ui": path.resolve(
                    __dirname,
                    "../packages/shared-ui",
                ),
                // Route all relative trpc imports in web to the extension shim
                "../utils/trpc": path.resolve(__dirname, "src/trpc-ext.ts"),
                "@/utils/trpc": path.resolve(__dirname, "src/trpc-ext.ts"),
                // Use Pusher worker build in SW and popup to avoid window references
                "pusher-js": "pusher-js/worker",
            },
        },
        publicDir: "public",
        build: {
            sourcemap: !isProduction,
            emptyOutDir: true,
            outDir: "dist",
            target: "es2022",
            rollupOptions: {
                input: {
                    popup: path.resolve(__dirname, "popup.html"),
                    background: path.resolve(__dirname, "src/background.ts"),
                    offscreen: path.resolve(__dirname, "offscreen.html"),
                    logs: path.resolve(__dirname, "logs.html"),
                    link: path.resolve(__dirname, "link.html"),
                },
                output: {
                    entryFileNames: (chunk) => {
                        if (chunk.name === "background")
                            return "background.js";
                        if (chunk.name === "offscreen") return "offscreen.js";
                        return "assets/[name]-[hash].js";
                    },
                    chunkFileNames: "assets/[name]-[hash].js",
                    assetFileNames: ({ names }) => {
                        const name = names?.length ? names[0] : null;

                        if (name && name.endsWith(".css"))
                            return "assets/[name][extname]";
                        return "assets/[name]-[hash]";
                    },
                },
                plugins: [
                    {
                        name: "copy-manifest",
                        writeBundle() {
                            const sourcePath = path.resolve(
                                __dirname,
                                "manifest.json",
                            );
                            const targetPath = path.resolve(
                                __dirname,
                                "dist/manifest.json",
                            );

                            const manifest = JSON.parse(
                                fs.readFileSync(sourcePath, "utf-8"),
                            ) as {
                                host_permissions?: string[];
                                [key: string]: unknown;
                            };

                            if (isProduction) {
                                const prodHosts = productionHostPermissions();
                                if (prodHosts.length === 0) {
                                    throw new Error(
                                        "Production manifest would have empty host_permissions; " +
                                            "check VITE_APP_URL / VITE_PUSHER_APP_HOST in .env.production.",
                                    );
                                }
                                manifest.host_permissions = prodHosts;
                            }

                            fs.writeFileSync(
                                targetPath,
                                JSON.stringify(manifest, null, 4) + "\n",
                            );
                        },
                    },
                ],
            },
        },
    };
});
