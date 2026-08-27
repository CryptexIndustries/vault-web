import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

mkdirSync("test-results", { recursive: true });
mkdirSync("playwright-report", { recursive: true });

const composeEnvironment = {
    ...process.env,
    E2E_UID: String(process.getuid?.() ?? 1000),
    E2E_GID: String(process.getgid?.() ?? 1000),
};

const compose = ["compose", "-f", "compose.e2e.yaml"];
const run = spawnSync(
    "docker",
    [
        ...compose,
        "up",
        "--build",
        "--abort-on-container-exit",
        "--exit-code-from",
        "web-e2e",
    ],
    { stdio: "inherit", env: composeEnvironment },
);

const cleanup = spawnSync("docker", [...compose, "down", "--remove-orphans"], {
    stdio: "inherit",
    env: composeEnvironment,
});

if (run.error) {
    console.error(run.error.message);
}
if (cleanup.error) {
    console.error(`Failed to clean up the E2E stack: ${cleanup.error.message}`);
}

process.exit(run.status ?? 1);
