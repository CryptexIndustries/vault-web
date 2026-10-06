import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { validateProductionEnv } from "./src/utils/production-env.ts";

const require = createRequire(import.meta.url);

const ZXING_READER_WASM_DEST = "wasm-libs/zxing_reader.wasm";
const ZXING_JSDELIVR_NEEDLE = "https://fastly.jsdelivr.net/npm/zxing-wasm@";

function resolveZxingReaderWasmPath(): string {
    const qrScannerEntry = require.resolve("@yudiel/react-qr-scanner");
    const barcodeDetectorEntry = require.resolve("barcode-detector/ponyfill", {
        paths: [path.dirname(qrScannerEntry)],
    });
    return require.resolve("zxing-wasm/reader/zxing_reader.wasm", {
        paths: [path.dirname(barcodeDetectorEntry)],
    });
}

function stripRemoteZxingWasmUrls(code: string): string {
    return code.replaceAll(ZXING_JSDELIVR_NEEDLE, "");
}

function packageZxingWasm(): Plugin {
    return {
        name: "package-zxing-wasm",
        transform(code, id) {
            if (
                !id.includes("zxing-wasm") ||
                !code.includes(ZXING_JSDELIVR_NEEDLE)
            ) {
                return;
            }
            return { code: stripRemoteZxingWasmUrls(code), map: null };
        },
        renderChunk(code) {
            if (!code.includes(ZXING_JSDELIVR_NEEDLE)) return;
            return { code: stripRemoteZxingWasmUrls(code), map: null };
        },
        generateBundle(_options, bundle) {
            for (const [fileName, output] of Object.entries(bundle)) {
                if (output.type !== "chunk") continue;
                if (output.code.includes("jsdelivr.net/npm/zxing-wasm")) {
                    throw new Error(
                        `Remote ZXing Wasm URL leaked into ${fileName}. ` +
                            "The QR scanner must load packaged wasm only.",
                    );
                }
            }
        },
        writeBundle(options) {
            const outDir = options.dir ?? path.resolve(__dirname, "dist");
            const source = resolveZxingReaderWasmPath();
            if (!fs.existsSync(source)) {
                throw new Error(
                    `Missing packaged ZXing reader Wasm at ${source}`,
                );
            }
            const dest = path.join(outDir, ZXING_READER_WASM_DEST);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(source, dest);
        },
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, __dirname, ["VITE_"]);
    const isProduction = mode === "production";
    const isE2E = process.env.CRYPTEX_E2E === "1";

    if (isProduction) {
        validateProductionEnv(env);
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
                // Production values are validated before generating permissions.
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
        plugins: [react(), packageZxingWasm()],
        resolve: {
            alias: {
                // Use extension env shim when importing web env
                "@/env/public": path.resolve(__dirname, "src/env.ts"),
                "../../env/public": path.resolve(__dirname, "src/env.ts"),
                "../env/public": path.resolve(__dirname, "src/env.ts"),
                // Route web tRPC imports to the extension shim before the broad @ alias.
                "@/utils/trpc": path.resolve(__dirname, "src/trpc-ext.ts"),
                "../utils/trpc": path.resolve(__dirname, "src/trpc-ext.ts"),
                "../../utils/trpc": path.resolve(__dirname, "src/trpc-ext.ts"),
                "@/app_lib/online-services-session/port": path.resolve(
                    __dirname,
                    "../packages/vault-core/src/online-services-session/port.ts",
                ),
                "@/app_lib/online-services-session/protocol": path.resolve(
                    __dirname,
                    "../packages/vault-core/src/online-services-session/protocol.ts",
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
            // Chrome extension pages cannot use <link rel="modulepreload">
            // for chrome-extension:// scripts. The preload scanner and the
            // module graph run in different isolated worlds, so Chromium
            // logs "cross-world extension resource mismatch" and ignores
            // every hint. Chunks still load via import().
            modulePreload: false,
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
                    link: path.resolve(__dirname, "link.html"),
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
                    ...(isE2E
                        ? {
                              "e2e-bootstrap": path.resolve(
                                  __dirname,
                                  "e2e-bootstrap.html",
                              ),
                          }
                        : {}),
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
