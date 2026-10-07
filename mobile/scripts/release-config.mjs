import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import profileRegistry from "../config/profiles.cjs";

import publicConfig from "../config/release-config.cjs";
export const { configHash, loadReleaseConfig, validateReleaseConfig } = publicConfig;

const mobile = fileURLToPath(new URL("../", import.meta.url));
export const { getProfile } = profileRegistry;
export const architectures = ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"];

export function selectedArchitectures(arch = "all") {
    assert.ok(arch === "all" || architectures.includes(arch), "--arch must be all, armeabi-v7a, arm64-v8a, x86 or x86_64.");
    return arch === "all" ? [...architectures] : [arch];
}

export function artifactName({ profile = "production", distribution = "standard", offlineServices = false, unsigned = false, reproduceFrom, arch = "all" } = {}) {
    selectedArchitectures(arch);
    return `${getProfile(profile).artifactBase}${distribution === "fdroid" ? "-fdroid" : ""}${offlineServices ? "-offline" : ""}${reproduceFrom ? "-reproduced" : ""}${arch !== "all" ? `-${arch}` : ""}${unsigned ? "-unsigned" : ""}.apk`;
}

export function parseReleaseOptions(args, { cwd = process.cwd(), allowApk = false, allowReproduction = false, allowBuild = false } = {}) {
    const seen = new Set();
    const options = { profile: "production", distribution: "standard", unsigned: false, offlineServices: false };
    let hasApk = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (allowApk && !arg.startsWith("--")) {
            assert.ok(!hasApk && arg.trim(), "Specify only one APK path.");
            hasApk = true;
            options.apk = resolve(cwd, arg);
            continue;
        }
        assert.ok(["--unsigned", "--offline-services", "--config", "--profile", "--distribution", ...(allowReproduction ? ["--reproduce-from"] : []), ...(allowBuild ? ["--clean", "--jobs", "--heap"] : []), ...(allowBuild || allowApk ? ["--arch"] : [])].includes(arg) && !seen.has(arg),
            `Invalid or repeated release option: ${arg}. Use mobile:build --help for build options.`);
        seen.add(arg);
        if (["--config", "--profile", "--distribution", "--reproduce-from", "--arch", "--jobs", "--heap"].includes(arg)) {
            const path = args[++index];
            assert.ok(typeof path === "string" && path.trim() && !path.startsWith("--"), `${arg} requires a value.`);
            if (arg === "--config") options.configPath = resolve(cwd, path);
            else if (arg === "--reproduce-from") options.reproduceFrom = resolve(cwd, path);
            else options[arg.slice(2)] = path;
        } else if (arg === "--unsigned") options.unsigned = true;
        else if (arg === "--clean") options.clean = true;
        else options.offlineServices = true;
    }
    const profile = getProfile(options.profile);
    assert.ok(["standard", "fdroid"].includes(options.distribution), "Choose standard or fdroid distribution.");
    assert.ok(options.distribution !== "fdroid" || options.profile === "production", "F-Droid distribution requires the production profile.");
    options.configPath ??= join(mobile, profile.configFile);
    assert.ok(!options.reproduceFrom || !options.unsigned, "--reproduce-from already builds without signing keys; do not combine it with --unsigned.");
    selectedArchitectures(options.arch);
    assert.ok(options.jobs === undefined || options.jobs === "auto" || (/^[1-9]\d*$/.test(options.jobs) && Number.isSafeInteger(Number(options.jobs))), "--jobs requires a positive integer or auto.");
    assert.ok(options.heap === undefined || (/^[1-9]\d*$/.test(options.heap) && Number.isSafeInteger(Number(options.heap))), "--heap requires a positive number of MiB.");
    if (options.reproduceFrom || options.distribution === "fdroid") {
        assert.ok(!options.arch || options.arch === "all", "Reproduction and F-Droid builds require all four architectures.");
        assert.ok(options.jobs === undefined && options.heap === undefined, "Reproduction and F-Droid builds use pinned resource settings.");
    }
    if (allowApk) options.apk ??= join(mobile, "dist", artifactName(options));
    return options;
}
