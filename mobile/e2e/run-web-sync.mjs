// Links the phone with the web app in both directions, over the production web
// build and the linking servers from compose.e2e.yaml.
import { mkdirSync } from "node:fs";
import { isIosSimulator } from "./profile.mjs";
import { repository, resultsDirectory, run, xcode } from "./ios-simulator.mjs";

const serial = process.env.MAESTRO_DEVICE;
const ports = [
    process.env.E2E_SIGNALING_PORT ?? "6001",
    process.env.E2E_TURN_PORT ?? "3478",
];
const adb = (...args) => run("adb", ["-s", serial, ...args]);
const compose = (...args) =>
    run(
        "docker",
        [
            "compose",
            "--project-name",
            "cryptex-vault-e2e-mobile",
            "--file",
            "compose.e2e.yaml",
            "--file",
            "web/e2e/compose.host-servers.yaml",
            ...args,
        ],
        { cwd: repository },
    );

mkdirSync(resultsDirectory, { recursive: true });
try {
    await compose("up", "--detach", "--wait", "web", "signaling", "turn");
    if (isIosSimulator(serial)) await xcode("build-for-testing");
    else {
        for (const port of ports)
            await adb("reverse", `tcp:${port}`, `tcp:${port}`);
        // Earlier runs leave invitations that would get the new one renamed.
        await adb(
            "shell",
            "content delete --uri content://media/external/file --where \"_display_name LIKE 'e2e-%invitation%.cryxlink'\"",
        );
    }
    await run(
        "pnpm",
        [
            "exec",
            "playwright",
            "test",
            "--config",
            "mobile/e2e/web-sync.config.ts",
        ],
        { cwd: repository },
    );
} finally {
    if (!isIosSimulator(serial))
        for (const port of ports)
            await adb("reverse", "--remove", `tcp:${port}`).catch(
                () => undefined,
            );
    await compose("down", "--remove-orphans");
}
