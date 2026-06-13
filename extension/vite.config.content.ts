/**
 * Separate Vite config for the autofill content script.
 *
 * MV3 content scripts are loaded as classic scripts (no native ESM
 * support), so we need a single self-contained bundle. Rollup can only
 * emit one output format per build, so we keep this config isolated
 * from the multi-page `vite.config.ts` and run them sequentially.
 *
 * Output: `dist/assets/autofill-cs.js` (IIFE, sourcemap in dev).
 */

import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
    const isProduction = mode === "production";

    return {
        resolve: {
            alias: {
                "@/env/client.mjs": path.resolve(__dirname, "src/env.ts"),
                "../../env/client.mjs": path.resolve(__dirname, "src/env.ts"),
                "../env/client.mjs": path.resolve(__dirname, "src/env.ts"),
                "@": path.resolve(__dirname, "../web/src"),
                "@ui": path.resolve(__dirname, "../packages/shared-ui/src"),
                "@cryptex-industries/shared-ui": path.resolve(
                    __dirname,
                    "../packages/shared-ui",
                ),
            },
        },
        build: {
            sourcemap: !isProduction,
            // Keep the main build's output intact. Cleaning is the
            // responsibility of the `clean` script.
            emptyOutDir: false,
            outDir: "dist",
            target: "es2022",
            rollupOptions: {
                input: path.resolve(__dirname, "src/content/autofill-cs.ts"),
                output: {
                    format: "iife",
                    entryFileNames: "assets/autofill-cs.js",
                    inlineDynamicImports: true,
                },
            },
        },
    };
});
