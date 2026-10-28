/**
 * Starts the signaling and TURN servers from compose.e2e.yaml for runs on the
 * host, and stops them afterwards. The Compose run starts them itself.
 */
import { spawnSync } from "node:child_process";

const compose = [
    "compose",
    // Apart from the Compose run's project, so neither stops the other's servers.
    "--project-name",
    "cryptex-vault-e2e-host",
    "--file",
    "compose.e2e.yaml",
    "--file",
    "web/e2e/compose.host-servers.yaml",
];

function docker(...args: string[]) {
    const run = spawnSync("docker", [...compose, ...args], {
        stdio: "inherit",
    });
    if (run.status !== 0)
        throw new Error(`docker compose ${args.join(" ")} failed`);
}

export default function globalSetup() {
    if (process.env.E2E_UPSTREAM_URL) return;

    docker("up", "--detach", "--wait", "signaling", "turn");
    // The tests read these; the ports come from compose.host-servers.yaml.
    process.env.E2E_SIGNALING_HOST = "127.0.0.1";
    process.env.E2E_TURN_HOST = "127.0.0.1";
    return () => docker("down", "--remove-orphans");
}
