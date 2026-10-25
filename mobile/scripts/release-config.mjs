import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import profileRegistry from "../config/profiles.cjs";
import androidVersion from "../config/android-version.cjs";

import publicConfig from "../config/release-config.cjs";
export const { configHash, loadReleaseConfig, validateReleaseConfig } =
    publicConfig;

const mobile = fileURLToPath(new URL("../", import.meta.url));
export const { getProfile } = profileRegistry;
export const { architectures, selectedArchitectures, releaseVersion } =
    androidVersion;

export function artifactName({
    profile = "production",
    distribution = "standard",
    offlineServices = false,
    unsigned = false,
    reproduceFrom,
    arch = "all",
} = {}) {
    selectedArchitectures(arch);
    const target =
        distribution === "fdroid" && !unsigned && arch !== "all"
            ? releaseVersion(
                  JSON.parse(readFileSync(join(mobile, "app.json"), "utf8"))
                      .expo,
                  { distribution, arch },
              ).code
            : arch;
    return `${getProfile(profile).artifactBase}${distribution === "standard" ? "" : `-${distribution}`}${offlineServices ? "-offline" : ""}${reproduceFrom ? "-reproduced" : ""}${arch !== "all" ? `-${target}` : ""}${unsigned ? "-unsigned" : ""}.apk`;
}

export function parseReleaseOptions(
    args,
    {
        cwd = process.cwd(),
        allowApk = false,
        allowReproduction = false,
        allowBuild = false,
    } = {},
) {
    const seen = new Set();
    const options = {
        profile: "production",
        distribution: "standard",
        unsigned: false,
        offlineServices: false,
    };
    let hasApk = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (allowApk && !arg.startsWith("--")) {
            assert.ok(!hasApk && arg.trim(), "Specify only one APK path.");
            hasApk = true;
            options.apk = resolve(cwd, arg);
            continue;
        }
        assert.ok(
            [
                "--unsigned",
                "--offline-services",
                "--config",
                "--profile",
                "--distribution",
                ...(allowReproduction ? ["--reproduce-from"] : []),
                ...(allowBuild ? ["--clean", "--jobs", "--heap"] : []),
                ...(allowBuild || allowApk ? ["--arch"] : []),
            ].includes(arg) && !seen.has(arg),
            `Invalid or repeated release option: ${arg}. Use mobile:build --help for build options.`,
        );
        seen.add(arg);
        if (
            [
                "--config",
                "--profile",
                "--distribution",
                "--reproduce-from",
                "--arch",
                "--jobs",
                "--heap",
            ].includes(arg)
        ) {
            const path = args[++index];
            assert.ok(
                typeof path === "string" &&
                    path.trim() &&
                    !path.startsWith("--"),
                `${arg} requires a value.`,
            );
            if (arg === "--config") options.configPath = resolve(cwd, path);
            else if (arg === "--reproduce-from")
                options.reproduceFrom = resolve(cwd, path);
            else options[arg.slice(2)] = path;
        } else if (arg === "--unsigned") options.unsigned = true;
        else if (arg === "--clean") options.clean = true;
        else options.offlineServices = true;
    }
    const profile = getProfile(options.profile);
    assert.ok(
        ["standard", "fdroid", "play"].includes(options.distribution),
        "Choose standard, fdroid or play distribution.",
    );
    options.configPath ??= join(mobile, profile.configFile);
    if (options.distribution === "play") {
        assert.ok(
            !options.offlineServices,
            "Google Play builds require Online Services.",
        );
        assert.ok(
            !options.reproduceFrom,
            "Google Play bundles do not support --reproduce-from.",
        );
        assert.ok(
            !options.arch || options.arch === "all",
            "Google Play builds require all four architectures.",
        );
    }
    assert.ok(
        !options.reproduceFrom || !options.unsigned,
        "--reproduce-from already builds without signing keys; do not combine it with --unsigned.",
    );
    selectedArchitectures(options.arch);
    assert.ok(
        options.jobs === undefined ||
            options.jobs === "auto" ||
            (/^[1-9]\d*$/.test(options.jobs) &&
                Number.isSafeInteger(Number(options.jobs))),
        "--jobs requires a positive integer or auto.",
    );
    assert.ok(
        options.heap === undefined ||
            (/^[1-9]\d*$/.test(options.heap) &&
                Number.isSafeInteger(Number(options.heap))),
        "--heap requires a positive number of MiB.",
    );
    if (options.reproduceFrom || options.distribution === "fdroid") {
        assert.ok(
            options.jobs === undefined && options.heap === undefined,
            "Reproduction and F-Droid builds use pinned resource settings.",
        );
    }
    if (allowApk) options.apk ??= join(mobile, "dist", artifactName(options));
    return options;
}
