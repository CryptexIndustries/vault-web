import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getProfile, loadReleaseConfig, parseReleaseOptions } from "./release-config.mjs";
import { verifyRelease } from "./verify-release.mjs";
import { signingNames } from "./signing.mjs";

export function runDevice(command, args, { env = process.env, run = spawnSync, verify = verifyRelease, home = homedir() } = {}) {
    assert.ok(["install", "logs"].includes(command), "Choose install or logs.");
    const flags = [...args];
    let serial = env.MAESTRO_DEVICE || env.ANDROID_SERIAL;
    const deviceIndex = flags.indexOf("--device");
    if (deviceIndex >= 0) {
        assert.equal(flags.lastIndexOf("--device"), deviceIndex, "Specify one device.");
        const value = flags[deviceIndex + 1];
        assert.ok(value && value.trim() && !value.startsWith("--"), "--device requires a serial.");
        serial = value;
        flags.splice(deviceIndex, 2);
    }
    assert.ok(serial && /^[A-Za-z0-9._:-]+$/.test(serial), "Select a device with --device, MAESTRO_DEVICE or ANDROID_SERIAL.");
    assert.notEqual(serial, env.CRYPTEX_E2E_PROTECTED_DEVICE, "Refusing to touch the protected device.");
    const options = parseReleaseOptions(flags, { allowApk: command === "install" });
    assert.ok(!options.unsigned, "Unsigned APKs cannot be installed; select a signed artifact.");
    if (command === "logs") assert.ok(!options.offlineServices && !flags.includes("--config"), "Logs accepts only profile/distribution and device selection.");
    const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || [join(home, "Android/Sdk"), join(home, "Library/Android/sdk")].find(path => existsSync(join(path, "platform-tools/adb")));
    assert.ok(sdk, "Set ANDROID_HOME or run mobile:doctor to locate Android tools.");
    const adb = join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
    const selectedEnv = { ...env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_SERIAL: serial, MAESTRO_DEVICE: serial };
    for (const name of signingNames) delete selectedEnv[name];
    const execute = (parameters, capture = false) => {
        const result = run(adb, ["-s", serial, ...parameters], { env: selectedEnv, ...(capture ? { encoding: "utf8" } : { stdio: "inherit" }) });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, `ADB ${parameters[0]} failed.`);
        return result.stdout?.trim();
    };
    if (command === "install") {
        verify(options.apk, { ...options, config: loadReleaseConfig(options.configPath), env: selectedEnv });
        execute(["install", "-r", options.apk]);
    } else {
        const pid = execute(["shell", "pidof", getProfile(options.profile).applicationId], true);
        assert.match(pid || "", /^\d+$/, "Launch the selected app before streaming its logs.");
        execute(["logcat", "-v", "threadtime", "--pid", pid]);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try { runDevice(process.argv[2], process.argv.slice(3)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
