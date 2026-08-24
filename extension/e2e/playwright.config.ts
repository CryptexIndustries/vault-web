import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    testDir: path.resolve(currentDirectory, "tests"),
    outputDir: path.resolve(currentDirectory, "../../test-results/e2e"),
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: process.env.CI
        ? [["line"], ["html", { open: "never" }]]
        : [["list"]],
    use: {
        baseURL: "http://127.0.0.1:4173",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },
    webServer: {
        command: "node extension/e2e/fixture-server.mjs",
        url: "http://127.0.0.1:4173/health",
        cwd: path.resolve(currentDirectory, "../.."),
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
