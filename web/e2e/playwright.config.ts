import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repositoryRoot = process.cwd();
const e2eDirectory = path.resolve(repositoryRoot, "web/e2e");
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4174";
const composeUpstream = process.env.E2E_UPSTREAM_URL;
const externalServer = process.env.E2E_EXTERNAL_SERVER === "1";

export default defineConfig({
    testDir: path.resolve(e2eDirectory, "tests"),
    outputDir: path.resolve(repositoryRoot, "test-results/web-e2e"),
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    timeout: 120_000,
    expect: { timeout: 15_000 },
    reporter: process.env.CI
        ? [
              ["line"],
              [
                  "html",
                  {
                      open: "never",
                      outputFolder: path.resolve(
                          repositoryRoot,
                          "playwright-report/web-e2e",
                      ),
                  },
              ],
          ]
        : [["list"]],
    use: {
        baseURL,
        ...devices["Desktop Chrome"],
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },
    projects: [{ name: "chromium", use: { browserName: "chromium" } }],
    webServer: externalServer
        ? undefined
        : composeUpstream
          ? {
                command: "node web/e2e/compose-proxy.mjs",
                url: `${baseURL}/app`,
                cwd: repositoryRoot,
                reuseExistingServer: false,
                timeout: 30_000,
            }
          : {
                command:
                    "pnpm --filter web exec next dev --hostname 127.0.0.1 --port 4174",
                url: "http://127.0.0.1:4174/app",
                cwd: repositoryRoot,
                env: {
                    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:4174",
                    NEXT_PUBLIC_CLOUD_ENABLED: "false",
                },
                reuseExistingServer: !process.env.CI,
                timeout: 120_000,
            },
});
