// Shared steps for the scripted suites and for the native XCUITests that drive
// the iOS Files screens, which Maestro can't read.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { maestroProfileArgs } from "./profile.mjs";

const serial = process.env.MAESTRO_DEVICE;
// Unique per run: deleting files behind the Files service stalls its screens.
// Counting down sorts the newest run's files first, so nothing needs scrolling.
export const EXPORT_PREFIX = `e2e-${1e13 - Date.now()}`;
const flowsDirectory = fileURLToPath(new URL("./flows/", import.meta.url));
export const resultsDirectory = fileURLToPath(
    new URL("./results/", import.meta.url),
);
const project = fileURLToPath(
    new URL("./fixtures/ios-transfer/IosTransfer.xcodeproj", import.meta.url),
);

export function run(program, args, { cwd } = {}) {
    const child = spawn(program, args, {
        cwd,
        stdio: "inherit",
        env: {
            ...process.env,
            TEST_RUNNER_CRYPTEX_APP_ID: process.env.CRYPTEX_APP_ID,
            TEST_RUNNER_CRYPTEX_EXPORT_PREFIX: EXPORT_PREFIX,
        },
    });
    // Ctrl+C stops the command, not this script, so callers still clean up.
    const stop = () => child.kill("SIGTERM");
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (status, signal) =>
            status === 0
                ? resolve()
                : reject(new Error(`${program} failed (${signal ?? status}).`)),
        );
    }).finally(() => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
    });
}

export const flow = (name, { env = {}, args = [] } = {}) =>
    run("maestro", [
        "--device",
        serial,
        "test",
        ...args,
        ...maestroProfileArgs(),
        ...Object.entries(env).flatMap(([key, value]) => [
            "-e",
            `${key}=${value}`,
        ]),
        join(flowsDirectory, name),
    ]);

/** Runs a flow and returns its Maestro log, which holds its console output. */
export async function flowLog(name) {
    const output = mkdtempSync(join(tmpdir(), "cryptex-maestro-"));
    try {
        await flow(name, { args: ["--debug-output", output] });
        const logs = readdirSync(output, { recursive: true }).filter((file) =>
            file.endsWith("maestro.log"),
        );
        return logs
            .map((file) => readFileSync(join(output, file), "utf8"))
            .join("");
    } finally {
        rmSync(output, { recursive: true, force: true });
    }
}

export const xcode = (action, ...args) =>
    run("xcodebuild", [
        action,
        "-project",
        project,
        "-scheme",
        "TransferTests",
        "-destination",
        `id=${serial}`,
        "-derivedDataPath",
        join(resultsDirectory, "ios-transfer-build"),
        ...args,
    ]);

export const test = (name) =>
    xcode(
        "test-without-building",
        `-only-testing:TransferTests/TransferTests/${name}`,
        "-resultBundlePath",
        join(resultsDirectory, `${name}-${EXPORT_PREFIX}.xcresult`),
    );

/** The Simulator's On My iPhone folder. */
export function filesDirectory() {
    const { stdout, status } = spawnSync(
        "xcrun",
        [
            "simctl",
            "get_app_container",
            serial,
            "com.apple.DocumentsApp",
            "groups",
        ],
        { encoding: "utf8" },
    );
    if (status !== 0)
        throw new Error("Could not locate the Files app storage.");
    const group = stdout
        .split("\n")
        .find((line) =>
            line.startsWith("group.com.apple.FileProvider.LocalStorage"),
        );
    if (!group) throw new Error("The Simulator has no On My iPhone storage.");
    return join(group.split(/\s+/).slice(1).join(" "), "File Provider Storage");
}

/** The path of the file saved under On My iPhone whose name starts with stem. */
export function savedFile(stem) {
    const directory = filesDirectory();
    const name = readdirSync(directory).find((file) => file.startsWith(stem));
    if (!name) throw new Error(`${stem} did not reach On My iPhone.`);
    return join(directory, name);
}
