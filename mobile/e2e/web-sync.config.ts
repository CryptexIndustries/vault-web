import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// run-web-sync.mjs starts the app and the linking servers from compose.e2e.yaml
// on loopback, which the Simulator shares and Android reaches through adb reverse.
process.env.E2E_SIGNALING_HOST ??= "127.0.0.1";
// Docker Desktop drops UDP replies on loopback, and a firewall can refuse
// direct connections, so both sides relay through TURN over TCP.
process.env.E2E_TURN_URL ??= `turn:localhost:${process.env.E2E_TURN_PORT ?? "3478"}?transport=tcp`;

const repositoryRoot = process.cwd();

export default defineConfig({
    testDir: path.resolve(repositoryRoot, "mobile/e2e"),
    testMatch: "web-sync.spec.mts",
    outputDir: path.resolve(repositoryRoot, "test-results/mobile-web-sync"),
    workers: 1,
    timeout: 20 * 60_000,
    expect: { timeout: 15_000 },
    reporter: [["list"]],
    use: {
        baseURL: `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "4174"}`,
        ...devices["Desktop Chrome"],
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
});
