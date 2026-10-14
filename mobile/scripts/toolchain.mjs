import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function javaMatches(path, toolchain) {
    if (!existsSync(join(path, "release")) || !existsSync(join(path, "bin/java"))) return false;
    const release = readFileSync(join(path, "release"), "utf8");
    return release.match(/^JAVA_VERSION="(\d+)(?:\.[^"]*)?"$/m)?.[1] === toolchain.java;
}

function javaCandidates(directory, depth = 0) {
    if (depth > 4 || !existsSync(directory)) return [];
    if (existsSync(join(directory, "release"))) return [directory];
    const candidates = [];
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory()) candidates.push(...javaCandidates(join(directory, entry.name), depth + 1));
    }
    return candidates;
}

export function discoverToolchain(env, toolchain, { home = homedir(), run = spawnSync, nodeVersion = process.versions.node } = {}) {
    assert.equal(nodeVersion, toolchain.node, `Use Node ${toolchain.node}`);
    const inspectionEnv = { ...env };
    for (const name of ["CRYPTEX_KEYSTORE", "CRYPTEX_KEYSTORE_PASSWORD", "CRYPTEX_KEY_ALIAS", "CRYPTEX_KEY_PASSWORD"]) delete inspectionEnv[name];
    const inspect = (command, args) => {
        const result = run(command, args, { env: inspectionEnv, encoding: "utf8" });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, `${command} tool inspection failed.`);
        return result.stdout.trim();
    };
    assert.equal(inspect("pnpm", ["--version"]), toolchain.pnpm, `Use pnpm ${toolchain.pnpm}`);
    const javaHome = env.JAVA_HOME ? resolve(env.JAVA_HOME) : javaCandidates(join(home, ".gradle/jdks")).find(path => javaMatches(path, toolchain));
    assert.ok(javaHome && javaMatches(javaHome, toolchain), `Set JAVA_HOME or install JDK ${toolchain.java} under ~/.gradle/jdks.`);
    const required = [join("build-tools", toolchain.buildTools), join("build-tools", toolchain.signingBuildTools), join("platforms", `android-${toolchain.compileSdk}`), join("ndk", toolchain.ndk), join("cmake", toolchain.cmake)];
    const complete = path => required.every(item => existsSync(join(path, item)));
    if (env.ANDROID_HOME && env.ANDROID_SDK_ROOT) assert.equal(resolve(env.ANDROID_HOME), resolve(env.ANDROID_SDK_ROOT), "ANDROID_HOME and ANDROID_SDK_ROOT must identify the same SDK.");
    const explicitSdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
    const discoveredSdk = [join(home, "Android/Sdk"), join(home, "Library/Android/sdk"), join(home, ".android/sdk")].find(complete);
    const sdk = explicitSdk ? resolve(explicitSdk) : discoveredSdk;
    const missing = sdk ? required.filter(item => !existsSync(join(sdk, item))) : required;
    assert.ok(sdk && !missing.length, explicitSdk
        ? `Selected Android SDK ${sdk} from ${env.ANDROID_HOME ? "ANDROID_HOME" : "ANDROID_SDK_ROOT"} is missing: ${missing.join(", ")}.${discoveredSdk ? ` A complete pinned SDK exists at ${discoveredSdk}; set both ANDROID_HOME and ANDROID_SDK_ROOT to that path, or unset both for discovery.` : " Install the missing pinned tools or select a complete SDK."}`
        : `Install pinned Android tools (${required.join(", ")}) and set ANDROID_HOME if automatic discovery fails.`);
    if (env.CRYPTEX_GRADLE_COMMAND) assert.match(inspect(env.CRYPTEX_GRADLE_COMMAND, ["--version"]), new RegExp(`^Gradle ${toolchain.gradle.replaceAll(".", "\\.")}$`, "m"), `Use Gradle ${toolchain.gradle}`);
    return { ...env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
}
