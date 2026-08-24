import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
    build: {
        sourcemap: mode !== "production",
        emptyOutDir: false,
        outDir: "dist",
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
