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

    const withExtensionNamePrefix = (
        base: string,
        prefix: string | undefined,
    ): string => {
        const trimmed = prefix?.trim();
        if (!trimmed) return base;
        const spacer = /[\s]$/.test(trimmed) ? "" : " ";
        return `${trimmed}${spacer}${base}`;
    };

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
        add(env.VITE_ONLINE_SERVICES_API_URL);

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
                // Route web tRPC imports to the extension shim before the broad @ alias.
                "@/utils/trpc": path.resolve(__dirname, "src/trpc-ext.ts"),
                "../utils/trpc": path.resolve(__dirname, "src/trpc-ext.ts"),
                "../../utils/trpc": path.resolve(__dirname, "src/trpc-ext.ts"),
                "@/app_lib/online-services-session/port": path.resolve(
                    __dirname,
                    "../web/src/app_lib/online-services-session/port.ts",
                ),
                "@/app_lib/online-services-session/protocol": path.resolve(
                    __dirname,
                    "../web/src/app_lib/online-services-session/protocol.ts",
                ),
                "@/app_lib/online-services-session": path.resolve(
                    __dirname,
                    "src/app_lib/online-services-session/extension.ts",
                ),
                "@": path.resolve(__dirname, "../web/src"),
                "@ui": path.resolve(__dirname, "../packages/shared-ui/src"),
                "@cryptex-industries/shared-ui": path.resolve(
                    __dirname,
                    "../packages/shared-ui",
                ),
                // Use Pusher worker build in SW and popup to avoid window references
                "pusher-js": "pusher-js/worker",
            },
        },
        publicDir: "public",
        build: {
            sourcemap: !isProduction,
            // emptyOutDir is `false` here because we run a second
            // Vite invocation (`vite.config.content.ts`) right after
            // this one that emits the autofill content script. If we
            // emptied during watch mode we'd race-delete the content
            // script's output. The `clean` script wipes `dist/` once
            // before each build sequence instead.
            emptyOutDir: false,
            outDir: "dist",
            target: "es2022",
            minify: isProduction ? "terser" : undefined,
            terserOptions: isProduction
                ? {
                      compress: {
                          drop_debugger: true,
                          drop_console: ["log", "info", "debug"],
                      },
                  }
                : undefined,
            rollupOptions: {
                input: {
                    popup: path.resolve(__dirname, "popup.html"),
                    background: path.resolve(__dirname, "src/background.ts"),
                    logs: path.resolve(__dirname, "logs.html"),
                    link: path.resolve(__dirname, "link.html"),
                    "autofill-icon": path.resolve(
                        __dirname,
                        "autofill-icon.html",
                    ),
                    "autofill-menu": path.resolve(
                        __dirname,
                        "autofill-menu.html",
                    ),
                    "autofill-save": path.resolve(
                        __dirname,
                        "autofill-save.html",
                    ),
                    "autofill-generator": path.resolve(
                        __dirname,
                        "autofill-generator.html",
                    ),
                },
                output: {
                    entryFileNames: (chunk) => {
                        if (chunk.name === "background") return "background.js";
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
                                name?: string;
                                action?: { default_title?: string };
                                host_permissions?: string[];
                                [key: string]: unknown;
                            };

                            const namePrefix = env.VITE_EXTENSION_NAME_PREFIX;
                            if (typeof manifest.name === "string") {
                                manifest.name = withExtensionNamePrefix(
                                    manifest.name,
                                    namePrefix,
                                );
                            }
                            if (
                                typeof manifest.action?.default_title ===
                                "string"
                            ) {
                                manifest.action.default_title =
                                    withExtensionNamePrefix(
                                        manifest.action.default_title,
                                        namePrefix,
                                    );
                            }

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
