import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyRelease } from "./verify-release.mjs";
import { resolveExportRuntime } from "./native-runtime.mjs";
import { assertReproductionTools, reconstructSignedReference } from "./verify-reproducibility.mjs";
import { loadReleaseConfig, parseReleaseOptions, validateReleaseConfig } from "./release-config.mjs";
import { getProfile, configHash, artifactName } from "./release-config.mjs";
import { discoverToolchain } from "./toolchain.mjs";
import ota from "../config/ota.cjs";
import { loadSigningEnvironment, signingNames, validateSigningIdentity } from "./signing.mjs";
import { dependencyDirectories, invalidateDependencies, openBuildWorkspace, synchronizeSources, writeIfChanged } from "./build-cache.mjs";
import resources from "./build-resources.cjs";
import { selectedArchitectures } from "./release-config.mjs";

const mobile = fileURLToPath(new URL("../", import.meta.url));
const checkout = resolve(mobile, "..");

export function productionBuildOptions(args, cwd = process.cwd()) {
    return parseReleaseOptions(args, { cwd, allowReproduction: true, allowBuild: true });
}

export function productionEnvironment(inherited, config, { unsigned = false, offlineServices = false, profile = "production", distribution = "standard" } = {}) {
    validateReleaseConfig(config);
    const env = { ...inherited };
    // Neither ignored .env files nor ambient public variables define a release.
    for (const name of Object.keys(env)) {
        if (name.startsWith("EXPO_PUBLIC_") || name.startsWith("NEXT_PUBLIC_") ||
            name.startsWith("EXPO_UPDATES_") ||
            name.startsWith("CRYPTEX_EMBEDDED_UPDATE_") ||
            name.startsWith("CRYPTEX_LOCAL_BUILD_") ||
            name.startsWith("ORG_GRADLE_PROJECT_") ||
            ["ENTRY_FILE", "NODE_OPTIONS", "NODE_PATH", "BABEL_ENV", "EXPO_NO_CLIENT_ENV_VARS", "GRADLE_OPTS", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS",
                "CC", "CXX", "CFLAGS", "CXXFLAGS", "CPPFLAGS", "ASFLAGS", "LDFLAGS", "AR", "AS", "LD", "RANLIB", "MAKEFLAGS", "MFLAGS", "CMAKE_GENERATOR", "CMAKE_PREFIX_PATH"].includes(name)) delete env[name];
    }
    Object.assign(env, config);
    if (unsigned) signingNames.forEach(name => delete env[name]);
    return {
        ...env,
        NODE_ENV: "production",
        EXPO_NO_DOTENV: "1",
        EXPO_PUBLIC_CRYPTEX_E2E: "0",
        EXPO_PUBLIC_CLOUD_ENABLED: offlineServices ? "false" : "true",
        CRYPTEX_BUILD_PROFILE: "production",
        CRYPTEX_APP_PROFILE: getProfile(profile).name,
        CRYPTEX_DISTRIBUTION: distribution,
        CRYPTEX_OFFLINE_SERVICES: offlineServices ? "1" : "0",
        CI: "1",
        TZ: "UTC",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        SOURCE_DATE_EPOCH: "315532800",
    };
}

function run(command, args, options) {
    const result = spawnSync(command, args, { stdio: "inherit", ...options });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${command} failed`);
}

export function releaseMetadata({ profile = "production", distribution = "standard", config, toolchain, identity, sourceRevision, version, offlineServices = false }) {
    return { profile, buildProfile: "production", distribution, applicationId: getProfile(profile).applicationId,
        version, sourceRevision, configHash: configHash(config), signer: { alias: identity.alias, certificateSha256: identity.certificateSha256 },
        e2e: false, onlineServicesEnabled: !offlineServices,
        appUrl: config.EXPO_PUBLIC_APP_URL, apiUrl: config.EXPO_PUBLIC_ONLINE_SERVICES_API_URL, toolchain };
}

export function embeddedManifestEnvironment(metadata) {
    if (metadata.distribution !== "fdroid") return {};
    // OTA is disabled. Derive its unused embedded identity from reviewed inputs.
    const hash = createHash("sha256").update(JSON.stringify(metadata)).digest("hex");
    return { CRYPTEX_EMBEDDED_UPDATE_ID: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
        CRYPTEX_EMBEDDED_UPDATE_COMMIT_TIME: "0" };
}

export function stageSource(destination) {
    const snapshot = synchronizeSources(checkout, destination);
    copyInstalledDependencies(destination);
    return snapshot;
}

export function finalizeNativeSources(stagedMobile, { toolchain, metadata }) {
    const android = join(stagedMobile, "android");
    const wrapper = join(android, "gradle/wrapper/gradle-wrapper.properties");
    let properties = readFileSync(wrapper, "utf8");
    properties = properties.replace(/^distributionUrl=.*$/m, `distributionUrl=https\\://services.gradle.org/distributions/gradle-${toolchain.gradle}-bin.zip`);
    properties = properties.replace(/^distributionSha256Sum=.*\n?/m, "").trimEnd() + `\n\ndistributionSha256Sum=${toolchain.gradleDistributionSha256}\n`;
    writeIfChanged(wrapper, properties);
    const assets = join(android, "app/src/main/assets");
    mkdirSync(assets, { recursive: true });
    writeIfChanged(join(assets, "cryptex-release.json"), JSON.stringify(metadata) + "\n");
}

export function copyInstalledDependencies(destination, sourceCheckout = checkout) {
    // Preserve pnpm's relative links inside a materialized copy. Symlinking
    // whole directories would send Metro/native builds outside this checkout.
    for (const directory of dependencyDirectories) {
        const modules = join(sourceCheckout, directory, "node_modules");
        if (existsSync(modules)) {
            mkdirSync(join(destination, directory), { recursive: true });
            cpSync(modules, join(destination, directory, "node_modules"), {
                recursive: true, dereference: false, verbatimSymlinks: true,
                filter: source => {
                    const path = relative(modules, source).replaceAll("\\", "/");
                    return !/(?:^|\/)(?:\.cxx|\.gradle|\.kotlin)(?:\/|$)/.test(path) &&
                        !/(?:^|\/)android\/(?:[^/]+\/)*build(?:\/|$)/.test(path) &&
                        !/(?:^|\/)expo-updates-gradle-plugin\/build(?:\/|$)/.test(path) &&
                        !/(?:^|\/)@react-native\/gradle-plugin\/(?:[^/]+\/)*build(?:\/|$)/.test(path);
                },
            });
        }
    }
}

export function finishStaging(staging, successful) {
    if (successful) rmSync(staging, { recursive: true, force: true });
    else console.error(`Failed build preserved for inspection: ${staging}`);
}

export function prepareProduction(args, inherited = process.env) {
    const options = productionBuildOptions(args);
    const { unsigned, reproduceFrom, configPath, profile, distribution } = options;
    const config = loadReleaseConfig(configPath);
    const toolchain = JSON.parse(readFileSync(join(mobile, "fdroid/toolchain.json"), "utf8"));
    const identityFile = join(mobile, getProfile(profile).signingIdentityFile);
    assert.ok(existsSync(identityFile), `Missing public signing identity at ${identityFile}. Run pnpm mobile:signing -- setup --profile ${profile}.`);
    const identity = JSON.parse(readFileSync(identityFile, "utf8"));
    const inspectionEnv = productionEnvironment(inherited, config, { ...options, unsigned: true });
    const sourceRevision = { commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: checkout, env: inspectionEnv, encoding: "utf8" }).trim(),
        dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: checkout, env: inspectionEnv, encoding: "utf8" }).trim()) };
    const nativeOptions = { ...options, unsigned: unsigned || Boolean(reproduceFrom) };
    const credentials = loadSigningEnvironment(inherited, nativeOptions);
    const env = discoverToolchain(productionEnvironment(credentials, config, nativeOptions), toolchain);
    env.CRYPTEX_SOURCE_REVISION = JSON.stringify(sourceRevision);
    env.CRYPTEX_RELEASE_CONFIG = configPath;
    ota.requireOtaConfiguration(profile, { distribution, signingEnabled: config.EXPO_PUBLIC_OTA_SIGNING_ENABLED ?? "false" });
    validateSigningIdentity(env, identity, nativeOptions);
    const app = JSON.parse(readFileSync(join(mobile, "app.json"), "utf8")).expo;
    const metadata = releaseMetadata({ ...options, config, toolchain, identity, sourceRevision, version: { name: app.version, code: app.android.versionCode } });
    return { options, config, toolchain, identity, env, metadata };
}

export function buildAndroid(args = process.argv.slice(2)) {
    const { options, config, toolchain, env, metadata } = prepareProduction(args);
    const { unsigned, reproduceFrom, profile } = options;
    const execution = resources.buildResources(options);
    const buildEnv = { ...env };
    signingNames.forEach(name => delete buildEnv[name]);
    const sdk = buildEnv.ANDROID_HOME;
    const stagingDirectory = join(checkout, ".mobile-build");
    mkdirSync(stagingDirectory, { recursive: true, mode: 0o700 });
    const cache = execution.fresh ? undefined : openBuildWorkspace(checkout, options);
    const staging = cache?.staging || mkdtempSync(join(stagingDirectory, "clean-"));
    let successful = false;
    console.log(`Building ${cache ? "incremental" : "fresh"} native sources in ${staging}; existing mobile/android is untouched.`);
    console.log(`Architectures: ${selectedArchitectures(options.arch).join(", ")}; jobs: ${execution.jobs}${execution.accelerated ? " (local parallel build)" : " (reproduction settings)"}.`);
    try {
        let reference, referencePolicy, referenceSha256;
        if (reproduceFrom) {
            const destinations = [join(mobile, "dist", artifactName(options)), join(mobile, "dist", artifactName({ ...options, unsigned: true }))];
            for (const output of [...destinations, ...destinations.map(path => `${path}.json`)]) {
                assert.notEqual(resolve(output), resolve(reproduceFrom), "Reproduction must not overwrite its reference APK.");
                if (existsSync(output)) {
                    assert.notEqual(realpathSync(output), realpathSync(reproduceFrom), "Reproduction must not overwrite a reference alias.");
                    const a = statSync(output), b = statSync(reproduceFrom);
                    assert.ok(a.dev !== b.dev || a.ino !== b.ino, "Reproduction must not overwrite a hard-linked reference.");
                }
            }
            reference = join(staging, "reference-signed.apk");
            copyFileSync(reproduceFrom, reference);
            chmodSync(reference, 0o400);
            referenceSha256 = createHash("sha256").update(readFileSync(reference)).digest("hex");
            referencePolicy = verifyRelease(reference, { ...options, unsigned: false, env: buildEnv, config });
            assert.deepEqual(metadata.sourceRevision, referencePolicy.sourceRevision, "Reference source revision or dirty marker differs from the checkout.");
            assertReproductionTools(buildEnv);
        }
        const snapshot = cache ? synchronizeSources(checkout, staging, cache.state.files) : stageSource(staging);
        const dependenciesChanged = Boolean(cache && (cache.state.dependencyHash !== snapshot.dependencyHash || !existsSync(join(staging, "node_modules/.modules.yaml"))));
        if (cache) {
            cache.save({ files: snapshot.files });
            if (dependenciesChanged) {
                invalidateDependencies(staging);
                copyInstalledDependencies(staging);
            }
            console.log(`Source snapshot: ${snapshot.changed} updated, ${snapshot.removed} removed; dependencies ${dependenciesChanged ? "refreshed" : "reused"}.`);
        }
        const stagedMobile = join(staging, "mobile");
        const stagedConfig = join(stagedMobile, getProfile(profile).configFile);
        writeIfChanged(stagedConfig, JSON.stringify(config) + "\n");
        buildEnv.CRYPTEX_RELEASE_CONFIG = stagedConfig;
        // Validate the materialized packages against the committed lockfile and
        // refresh pnpm metadata/bin paths without network or install scripts.
        if (!cache || dependenciesChanged) {
            run("pnpm", ["install", "--frozen-lockfile", "--offline", "--ignore-scripts"], { cwd: staging, env: buildEnv });
            cache?.save({ dependencyHash: snapshot.dependencyHash });
        }
        // pnpm's copied .bin shims may contain their original NODE_PATH.
        const android = join(stagedMobile, "android");
        const nativeHash = createHash("sha256").update(snapshot.nativeHash).update(configHash(config)).update(JSON.stringify({ toolchain, profile, distribution: options.distribution, offlineServices: options.offlineServices })).digest("hex");
        if (!cache || cache.state.nativeHash !== nativeHash || !existsSync(join(android, "gradlew"))) {
            if (cache) {
                cache.save({ nativeHash: null });
                rmSync(android, { recursive: true, force: true });
            }
            run(process.execPath, ["node_modules/expo/bin/cli", "prebuild", "--platform", "android", "--no-install"], { cwd: stagedMobile, env: buildEnv });
            cache?.save({ nativeHash });
        } else console.log("Reusing generated Android sources.");
        finalizeNativeSources(stagedMobile, { toolchain, metadata });
        const nativeRuntime = resolveExportRuntime(stagedMobile, buildEnv);
        Object.assign(buildEnv, embeddedManifestEnvironment(metadata));
        if (referencePolicy) {
            assert.equal(nativeRuntime.runtimeVersion, referencePolicy.runtimeVersion, "Reference native runtime differs from the staged source.");
            buildEnv.CRYPTEX_EMBEDDED_UPDATE_ID = referencePolicy.embeddedUpdate.id;
            buildEnv.CRYPTEX_EMBEDDED_UPDATE_COMMIT_TIME = String(referencePolicy.embeddedUpdate.commitTime);
        }
        const gradle = env.CRYPTEX_GRADLE_COMMAND || "./gradlew";
        if (env.CRYPTEX_GRADLE_COMMAND) {
            const version = execFileSync(gradle, ["--version"], { cwd: android, env: buildEnv, encoding: "utf8" });
            assert.match(version, new RegExp(`^Gradle ${toolchain.gradle.replaceAll(".", "\\.")}$`, "m"), "Use the pinned Gradle version");
        }
        if (execution.accelerated) {
            const make = buildEnv.PATH.split(process.platform === "win32" ? ";" : ":").map(directory => join(directory, "make")).find(path => existsSync(path));
            assert.ok(make, "Install make to build OpenSSL.");
            const makeWrapper = join(stagedMobile, "scripts/local-build-make.mjs");
            chmodSync(makeWrapper, 0o755);
            Object.assign(buildEnv, {
                CRYPTEX_LOCAL_BUILD_JOBS: String(execution.jobs),
                CRYPTEX_LOCAL_BUILD_MAKE: make,
                CRYPTEX_LOCAL_BUILD_MAKE_WRAPPER: makeWrapper,
                CRYPTEX_LOCAL_BUILD_SOURCE_HASH: snapshot.sourceHash,
                CRYPTEX_LOCAL_BUILD_CONFIG_HASH: configHash(config),
            });
        }
        run(gradle, [":app:assembleRelease", ...(execution.accelerated ? ["--daemon", cache ? "--build-cache" : "--no-build-cache", `--max-workers=${execution.jobs}`, "--parallel",
            `-Dorg.gradle.jvmargs=${execution.jvmArguments}`, "--init-script", join(stagedMobile, "scripts/local-build.gradle")] : ["--no-daemon", "--no-build-cache", "--max-workers=2", "--no-parallel"]), "--console=plain",
            "-PcryptexUnsignedRelease=true", `-PreactNativeArchitectures=${selectedArchitectures(options.arch).join(",")}`,
            `-Pandroid.buildToolsVersion=${toolchain.buildTools}`, `-Pandroid.compileSdkVersion=${toolchain.compileSdk}`,
            `-Pandroid.targetSdkVersion=${toolchain.targetSdk}`, `-Pandroid.ndkVersion=${toolchain.ndk}`], { cwd: android, env: buildEnv });
        const unaligned = join(android, "app/build/outputs/apk/release/app-release-unsigned.apk");
        const aligned = join(staging, "aligned-unsigned.apk");
        run(join(sdk, "build-tools", toolchain.buildTools, "zipalign"), ["-P", "16", "-f", "4", unaligned, aligned], { env: buildEnv });
        const updates = verifyRelease(aligned, { ...options, unsigned: true, env: buildEnv, config });
        assert.equal(updates.runtimeVersion, nativeRuntime.runtimeVersion, "Packaged native runtime differs from the pre-build SDK resolution.");
        if (selectedArchitectures(options.arch).length === 4) {
            run(process.execPath, [join(stagedMobile, "scripts/verify-native-crypto.mjs"), "--apk", aligned], { cwd: stagedMobile, env: buildEnv });
        }
        let apk = aligned;
        if (reference) {
            apk = join(staging, "reconstructed.apk");
            reconstructSignedReference(reference, aligned, apk, { ...options, env: buildEnv, config, referenceSha256 });
        } else if (!unsigned) {
            apk = join(staging, "signed.apk");
            // F-Droid signature copying currently requires apksigner before 35.
            // Password values stay in environment variables, never arguments.
            run(join(sdk, "build-tools", toolchain.signingBuildTools, "apksigner"), ["sign",
                "--ks", env.CRYPTEX_KEYSTORE, "--ks-key-alias", env.CRYPTEX_KEY_ALIAS,
                "--ks-pass", "env:CRYPTEX_KEYSTORE_PASSWORD", "--key-pass", "env:CRYPTEX_KEY_PASSWORD",
                "--v1-signing-enabled", "true", "--v2-signing-enabled", "true", "--v3-signing-enabled", "true",
                "--v4-signing-enabled", "false", "--out", apk, aligned], { env });
        }
        if (!unsigned && !reference) verifyRelease(apk, { ...options, env: buildEnv, config });
        const output = join(mobile, "dist", artifactName(options));
        mkdirSync(dirname(output), { recursive: true });
        const unsignedOutput = join(mobile, "dist", artifactName({ ...options, unsigned: true }));
        copyFileSync(aligned, unsignedOutput);
        copyFileSync(apk, output);
        for (const [path, signed] of [[unsignedOutput, false], [output, !unsigned]]) {
            writeFileSync(`${path}.json`, JSON.stringify({ ...metadata, ...updates, signed,
                build: { strategy: cache ? "incremental" : "clean", jobs: execution.jobs, architectures: selectedArchitectures(options.arch), sourceHash: snapshot.sourceHash },
                apkSha256: createHash("sha256").update(readFileSync(path)).digest("hex") }, null, 2) + "\n");
        }
        if (!unsigned) console.log(`Verified unsigned counterpart: ${unsignedOutput}`);
        console.log(`Verified production APK: ${output}`);
        successful = true;
        return output;
    } finally {
        if (cache) cache.close();
        else finishStaging(staging, successful);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try { buildAndroid(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
