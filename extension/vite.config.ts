import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
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
        emptyOutDir: true,
        outDir: "dist",
        target: "es2022",
        rollupOptions: {
            input: {
                popup: path.resolve(__dirname, "popup.html"),
                background: path.resolve(__dirname, "src/background.ts"),
                offscreen: path.resolve(__dirname, "offscreen.html"),
            },
            output: {
                entryFileNames: (chunk) => {
                    if (chunk.name === "background") return "background.js";
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
            // Copy the manifest.json to the dist folder
            plugins: [
                {
                    name: "copy-manifest",
                    writeBundle() {
                        this.fs.copyFile(path.resolve(__dirname, "manifest.json"), path.resolve(__dirname, "dist/manifest.json"));
                    },
                },
            ],
        },
    },
});
