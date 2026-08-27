import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, "../..");

export default defineConfig({
    testDir: path.resolve(currentDirectory, "tests"),
    testIgnore:
        process.env.CRYPTEX_LIVE_E2E === "1"
            ? []
            : ["**/autofill-me-live.spec.ts"],
    outputDir: path.resolve(repositoryRoot, "test-results/e2e"),
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: process.env.CI
        ? [
              ["line"],
              [
                  "html",
                  {
                      open: "never",
                      outputFolder: path.resolve(
                          repositoryRoot,
                          "playwright-report/extension-e2e",
                      ),
                  },
              ],
          ]
        : [["list"]],
    use: {
        baseURL: "http://127.0.0.1:4173",
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },
    webServer: {
        command: "node extension/e2e/fixture-server.mjs",
        url: "http://127.0.0.1:4173/health",
        cwd: repositoryRoot,
        reuseExistingServer: true,
        timeout: 30_000,
    },
});
