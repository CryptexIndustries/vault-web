import path from "node:path";
import { defineConfig } from "vite";
import { outDir } from "./build-target.ts";

export default defineConfig(({ mode }) => ({
    build: {
        sourcemap: mode !== "production",
        emptyOutDir: false,
        outDir: outDir(),
        target: "es2022",
        minify: mode === "production" ? "terser" : undefined,
        rolldownOptions: {
            input: path.resolve(
                __dirname,
                "src/content/passkey-page-bridge.ts",
            ),
            output: {
                format: "iife",
                entryFileNames: "assets/passkey-page-bridge.js",
                inlineDynamicImports: true,
            },
        },
    },
}));
