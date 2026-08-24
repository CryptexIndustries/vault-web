import { spawnSync } from "node:child_process";

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
    { stdio: "inherit" },
);

const cleanup = spawnSync("docker", [...compose, "down", "--remove-orphans"], {
    stdio: "inherit",
});

if (run.error) {
    console.error(run.error.message);
}
if (cleanup.error) {
    console.error(`Failed to clean up the E2E stack: ${cleanup.error.message}`);
}

process.exit(run.status ?? 1);
