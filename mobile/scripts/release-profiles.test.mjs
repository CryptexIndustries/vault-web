import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getProfile, artifactName, configHash, loadReleaseConfig, parseReleaseOptions, validateReleaseConfig } from "./release-config.mjs";
import publicConfig from "../config/release-config.cjs";
import { discoverToolchain } from "./toolchain.mjs";
import { defaultSigningDirectory, loadSigningEnvironment, validateSigningIdentity } from "./signing.mjs";
import { runDevice } from "./device.mjs";
import { assertUpdatesPolicy } from "./verify-release.mjs";
import { prepareProduction, productionEnvironment, releaseMetadata } from "./build-android.mjs";
import { signingSetupOptions } from "./create-signing-identity.mjs";
import { regenerateNativeProject, requireNativeIdentity, runMobile } from "./mobile.mjs";

const toolchain = JSON.parse(readFileSync(new URL("../fdroid/toolchain.json", import.meta.url)));
const identity = JSON.parse(readFileSync(new URL("../release-signing.json", import.meta.url)));
const config = loadReleaseConfig();
const temporary = run => {
    const directory = mkdtempSync(join(tmpdir(), "cryptex-profile-test-"));
    try { return run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
};

test("release endpoints reject canonical loopback URLs while allowing private HTTPS hosts", () => {
    for (const name of ["EXPO_PUBLIC_APP_URL", "EXPO_PUBLIC_ONLINE_SERVICES_API_URL"]) {
        for (const endpoint of ["https://[::1]", "https://[0:0:0:0:0:0:0:1]", "https://localhost.", "https://LOCALHOST", "https://127.0.0.2", "https://127.254.10.1", "https://2130706433", "https://0x7f000001"])
            assert.throws(() => validateReleaseConfig({ ...config, [name]: endpoint }), /loopback/);
        assert.equal(validateReleaseConfig({ ...config, [name]: "https://10.0.0.1" })[name], "https://10.0.0.1");
    }
});

test("missing or blank signaling host fails before release toolchain discovery and staging", () => temporary(directory => {
    const path = join(directory, "incomplete.json");
    for (const host of [undefined, "", "  \t"]) {
        const incomplete = { ...config };
        if (host === undefined) delete incomplete.EXPO_PUBLIC_PUSHER_APP_HOST;
        else incomplete.EXPO_PUBLIC_PUSHER_APP_HOST = host;
        writeFileSync(path, JSON.stringify(incomplete));
        assert.throws(() => loadReleaseConfig(path), /EXPO_PUBLIC_PUSHER_APP_HOST must be a non-empty/);
        assert.throws(() => publicConfig.loadReleaseConfig(path), /EXPO_PUBLIC_PUSHER_APP_HOST must be a non-empty/);
        assert.throws(() => prepareProduction(["--config", path], { JAVA_HOME: "/deliberately-invalid-jdk", ANDROID_HOME: "/deliberately-invalid-sdk" }), /EXPO_PUBLIC_PUSHER_APP_HOST must be a non-empty/);
    }
}));

test("release profiles select distinct identities, configuration and artifacts without an arbitrary package override", () => {
    const prod = parseReleaseOptions([]);
    const preprod = parseReleaseOptions(["--profile", "preprod"]);
    assert.equal(getProfile().applicationId, "com.cryptexindustries.vault");
    assert.equal(getProfile("preprod").applicationId, "com.cryptexindustries.vault.preprod");
    assert.ok(prod.configPath.endsWith("/release-config.json"));
    assert.ok(preprod.configPath.endsWith("/prerelease-config.json"));
    assert.equal(artifactName(preprod), "cryptex-vault-preprod.apk");
    assert.equal(artifactName({ ...prod, distribution: "fdroid", offlineServices: true, unsigned: true }), "cryptex-vault-fdroid-offline-unsigned.apk");
    assert.equal(parseReleaseOptions(["--profile", "preprod"], { allowApk: true }).apk.split("/").at(-1), "cryptex-vault-preprod.apk");
    for (const args of [["--profile"], ["--profile", "other"], ["--profile", "preprod", "--profile", "production"], ["--profile", "preprod", "--distribution", "fdroid"]]) assert.throws(() => parseReleaseOptions(args));
});

test("profile selection does not relax release mode, offline intent or mandatory E2E stripping", () => {
    const env = productionEnvironment({ CRYPTEX_APP_PROFILE: "production", CRYPTEX_OFFLINE_SERVICES: "0", CRYPTEX_DISTRIBUTION: "fdroid", EXPO_PUBLIC_CRYPTEX_E2E: "1" }, config, { profile: "preprod", offlineServices: true });
    assert.equal(env.CRYPTEX_APP_PROFILE, "preprod");
    assert.equal(env.CRYPTEX_BUILD_PROFILE, "production");
    assert.equal(env.CRYPTEX_DISTRIBUTION, "standard");
    assert.equal(env.CRYPTEX_OFFLINE_SERVICES, "1");
    assert.equal(env.EXPO_PUBLIC_CLOUD_ENABLED, "false");
    assert.equal(env.EXPO_PUBLIC_CRYPTEX_E2E, "0");
    assert.equal(loadReleaseConfig().EXPO_PUBLIC_OTA_SIGNING_ENABLED, "false");
    assert.equal(loadReleaseConfig(new URL("../prerelease-config.json", import.meta.url)).EXPO_PUBLIC_OTA_SIGNING_ENABLED, "false");
});

test("release provenance identifies profile, source, selected JSON and public signer without credentials", () => {
    const metadata = releaseMetadata({ profile: "preprod", config, toolchain, identity, sourceRevision: { commit: "a".repeat(40), dirty: true }, version: { name: "0.1.0", code: 1 } });
    assert.equal(metadata.applicationId, getProfile("preprod").applicationId);
    assert.equal(metadata.configHash, configHash(config));
    assert.equal(configHash(config), configHash(Object.fromEntries(Object.entries(config).reverse())));
    assert.notEqual(configHash(config), configHash({ ...config, EXPO_PUBLIC_APP_URL: "https://other.example" }));
    assert.deepEqual(metadata.signer, { alias: identity.alias, certificateSha256: identity.certificateSha256 });
    assert.ok(!JSON.stringify(metadata).includes("CRYPTEX_KEYSTORE_PASSWORD"));
});

test("tool discovery requires JDK 21 and the complete SDK; explicit wrong tools never silently fall back", () => temporary(home => {
    const java = join(home, ".gradle/jdks/temurin21/Contents/Home");
    mkdirSync(join(java, "bin"), { recursive: true });
    writeFileSync(join(java, "bin/java"), "fixture");
    writeFileSync(join(java, "release"), 'JAVA_VERSION="21.0.12"\nIMPLEMENTOR="Eclipse Adoptium"');
    const sdk = join(home, "Android/Sdk");
    for (const path of [`build-tools/${toolchain.buildTools}`, `build-tools/${toolchain.signingBuildTools}`, `platforms/android-${toolchain.compileSdk}`, `ndk/${toolchain.ndk}`, `cmake/${toolchain.cmake}`]) mkdirSync(join(sdk, path), { recursive: true });
    const calls = [];
    const run = (command, args) => { calls.push([command, args]); return { status: 0, stdout: command === "pnpm" ? toolchain.pnpm : `Gradle ${toolchain.gradle}` }; };
    const options = { home, run, nodeVersion: toolchain.node };
    assert.equal(discoverToolchain({}, toolchain, options).JAVA_HOME, java);
    writeFileSync(join(java, "release"), 'JAVA_VERSION="21.0.12.1"\nIMPLEMENTOR="Debian"');
    assert.equal(discoverToolchain({}, toolchain, options).JAVA_HOME, java);
    writeFileSync(join(java, "release"), 'JAVA_VERSION="17.0.19"\nIMPLEMENTOR="Eclipse Adoptium"');
    assert.throws(() => discoverToolchain({ JAVA_HOME: java }, toolchain, options), /JDK/);
    writeFileSync(join(java, "release"), 'JAVA_VERSION="21.0.12.1"\nIMPLEMENTOR="Debian"');
    assert.equal(discoverToolchain({}, toolchain, options).ANDROID_HOME, sdk);
    assert.throws(() => discoverToolchain({ JAVA_HOME: join(home, "missing") }, toolchain, options), /JDK/);
    assert.throws(() => discoverToolchain({ ANDROID_HOME: join(home, "missing") }, toolchain, options), error => /Selected Android SDK/.test(error.message) && error.message.includes(sdk));
    assert.throws(() => discoverToolchain({ ANDROID_HOME: sdk, ANDROID_SDK_ROOT: join(home, "other") }, toolchain, options), /same SDK/);
    assert.throws(() => discoverToolchain({}, toolchain, { ...options, nodeVersion: "0.0.0" }), /Node/);
    assert.throws(() => discoverToolchain({}, toolchain, { ...options, run: () => ({ status: 0, stdout: "wrong" }) }), /pnpm/);
    discoverToolchain({ CRYPTEX_GRADLE_COMMAND: "/custom/gradle" }, toolchain, options);
    assert.deepEqual(calls.at(-1), ["/custom/gradle", ["--version"]]);
    assert.throws(() => discoverToolchain({ CRYPTEX_GRADLE_COMMAND: "/custom/gradle" }, toolchain, { ...options, run: command => ({ status: 0, stdout: command === "pnpm" ? toolchain.pnpm : "Gradle 0.0" }) }), /Gradle/);
}));

test("profile signing credentials load without shell execution; explicit values override and public identity remains mandatory", () => temporary(home => {
    const directory = defaultSigningDirectory("preprod", home);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keystore = join(directory, "release.p12");
    writeFileSync(keystore, "fixture", { mode: 0o600 });
    const file = join(directory, "signing.env");
    writeFileSync(file, `export CRYPTEX_KEYSTORE='${keystore}'\nCRYPTEX_KEYSTORE_PASSWORD='$(touch never-executed)'\nCRYPTEX_KEY_PASSWORD=fixture\nCRYPTEX_KEY_ALIAS=${identity.alias}\n`, { mode: 0o600 });
    const env = loadSigningEnvironment({ CRYPTEX_KEY_PASSWORD: "explicit", JAVA_HOME: "/fixture/jdk" }, { profile: "preprod", home });
    assert.equal(env.CRYPTEX_KEY_PASSWORD, "explicit");
    assert.equal(env.CRYPTEX_KEYSTORE_PASSWORD, "$(touch never-executed)");
    assert.ok(!existsSync(join(home, "never-executed")));
    validateSigningIdentity(env, identity, { run: () => ({ status: 0, stdout: Buffer.from(identity.certificateDerBase64, "base64") }) });
    assert.throws(() => validateSigningIdentity({ ...env, CRYPTEX_KEY_ALIAS: "wrong" }, identity), /alias/);
    assert.throws(() => validateSigningIdentity(env, { ...identity, certificateSha256: "0".repeat(64) }, { unsigned: true }), /inconsistent/);
    assert.equal(loadSigningEnvironment(env, { profile: "preprod", home, unsigned: true }).CRYPTEX_KEY_PASSWORD, undefined);
    chmodSync(file, 0o644);
    assert.throws(() => loadSigningEnvironment({}, { profile: "preprod", home }), /chmod 600/);
    chmodSync(file, 0o600);
    writeFileSync(file, "UNREVIEWED_COMMAND=fixture\n");
    assert.throws(() => loadSigningEnvironment({}, { profile: "preprod", home }), /Unexpected key/);
    rmSync(file);
    symlinkSync(keystore, file);
    assert.throws(() => loadSigningEnvironment({}, { profile: "preprod", home }), /symlink/);
}));

test("preprod signing setup selects a dedicated directory and never changes production defaults", () => {
    assert.ok(signingSetupOptions([]).directory.endsWith("/cryptex-vault/signing"));
    assert.ok(signingSetupOptions(["--profile", "preprod"]).directory.endsWith("/cryptex-vault/signing-preprod"));
    assert.equal(signingSetupOptions(["--profile", "preprod", "--write-public"]).writePublic, true);
    assert.throws(() => signingSetupOptions(["--profile", "unknown"]));
    assert.throws(() => signingSetupOptions(["--profile", "preprod", "--profile", "production"]));
});

test("dev native identity mismatch fails before prebuild and retains the existing Android tree", () => temporary(directory => {
    mkdirSync(join(directory, "app"));
    const path = join(directory, "app/build.gradle");
    const previous = 'namespace "com.cryptex.vault"\napplicationId "com.cryptex.vault"\n';
    writeFileSync(path, previous);
    let calls = 0;
    assert.throws(() => runMobile(["build", "--e2e", "--profile", "preprod"], { run: () => { calls++; return { status: 0 }; },
        checkNativeIdentity: profile => requireNativeIdentity(profile, directory) }), /--regenerate-native/);
    assert.equal(calls, 0);
    assert.equal(readFileSync(path, "utf8"), previous);
    writeFileSync(path, `namespace "${getProfile("preprod").applicationId}"\napplicationId "${getProfile("preprod").applicationId}"\n`);
    requireNativeIdentity(getProfile("preprod"), directory);
    assert.throws(() => requireNativeIdentity(getProfile(), directory));
}));

test("explicit native regeneration retains original bytes in a unique backup before prebuild", () => temporary(directory => {
    const project = join(directory, "android");
    mkdirSync(join(project, "app"), { recursive: true });
    writeFileSync(join(project, "app/manual.kt"), "manual native changes");
    const first = regenerateNativeProject(getProfile("preprod"), project, join(directory, "backups"));
    assert.equal(readFileSync(join(first, "app/manual.kt"), "utf8"), "manual native changes");
    assert.equal(existsSync(project), false);
    mkdirSync(project);
    writeFileSync(join(project, "second.txt"), "another native tree");
    const second = regenerateNativeProject(getProfile("preprod"), project, join(directory, "backups"));
    assert.notEqual(first, second);
    assert.equal(readFileSync(join(second, "second.txt"), "utf8"), "another native tree");
    assert.equal(readFileSync(join(first, "app/manual.kt"), "utf8"), "manual native changes");
}));

test("install guards profile artifacts and protected serial before ADB; installation preserves existing app data", () => {
    const calls = [];
    const env = { ANDROID_HOME: "/fixture/sdk", CRYPTEX_E2E_PROTECTED_DEVICE: "protected", CRYPTEX_KEY_PASSWORD: "secret" };
    const run = (binary, args, options) => { calls.push([binary, args, options]); return { status: 0 }; };
    let verified = false;
    runDevice("install", ["--device", "owned"], { env, run, verify: (_path, options) => { assert.equal(options.profile, "production"); verified = true; } });
    assert.equal(verified, true);
    assert.deepEqual(calls[0][1].slice(0, 4), ["-s", "owned", "install", "-r"]);
    assert.equal(calls[0][2].env.CRYPTEX_KEY_PASSWORD, undefined);
    assert.throws(() => runDevice("install", ["--device", "protected"], { env, run }), /protected/);
    assert.throws(() => runDevice("install", [], { env, run }), /Select a device/);
    assert.throws(() => runDevice("install", ["--device", "owned", "--unsigned"], { env, run }), /Unsigned/);
    assert.throws(() => runDevice("install", ["--device", "owned"], { env, run, verify: () => { throw new Error("Wrong application profile ID"); } }), /Wrong application/);
    assert.equal(calls.length, 1, "All rejection paths must stop before ADB.");
});

test("logs selects only the requested profile PID and never launches or uninstalls apps", () => {
    const calls = [];
    runDevice("logs", ["--device", "owned", "--profile", "preprod"], { env: { ANDROID_HOME: "/fixture/sdk" }, run: (_binary, args) => { calls.push(args); return { status: 0, stdout: "1234\n" }; } });
    assert.deepEqual(calls, [["-s", "owned", "shell", "pidof", getProfile("preprod").applicationId], ["-s", "owned", "logcat", "-v", "threadtime", "--pid", "1234"]]);
    assert.throws(() => runDevice("logs", ["--device", "owned"], { env: { ANDROID_HOME: "/fixture/sdk" }, run: () => ({ status: 0, stdout: "1234 5678" }) }), /Launch/);
});

function otaManifest(overrides = {}) {
    const values = { ENABLED: "true", EXPO_UPDATE_URL: "https://u.expo.dev/fixture", EXPO_RUNTIME_VERSION: "a".repeat(40), UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY: JSON.stringify({ "expo-channel-name": "preprod" }), ...overrides };
    return "E: application\n" + Object.entries(values).filter(([, value]) => value !== undefined).map(([name, value]) => `  E: meta-data\n    A: android:name(0x01010003)="expo.modules.updates.${name}"\n    A: android:value(0x01010024)=${JSON.stringify(value)}\n`).join("");
}

test("compiled OTA verification rejects disabled engines, cross-profile channels, wrong URLs and unapproved signing", () => {
    const expected = { enabled: true, url: "https://u.expo.dev/fixture", requestHeaders: { "expo-channel-name": "preprod" } };
    const valid = otaManifest();
    assert.deepEqual(assertUpdatesPolicy(valid, "", expected), { runtimeVersion: "a".repeat(40), otaSigned: false,
        otaChannel: "preprod", otaUpdateUrl: "https://u.expo.dev/fixture" });
    for (const fields of [{ ENABLED: "false" }, { EXPO_UPDATE_URL: "https://u.expo.dev/wrong" }, { UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY: '{"expo-channel-name":"production"}' }, { EXPO_RUNTIME_VERSION: "0.1.0" }, { CODE_SIGNING_METADATA: "{}" }, { DISABLE_ANTI_BRICKING_MEASURES: "true" }]) assert.throws(() => assertUpdatesPolicy(otaManifest(fields), "", expected));
    assert.throws(() => assertUpdatesPolicy(valid.replace("  E: meta-data", "  E: activity\n    E: meta-data"), "", expected), /enabled policy/);
});

test("F-Droid compiled OTA policy requires a disabled engine and rejects retained remote configuration", () => {
    const expected = { enabled: false, checkAutomatically: "NEVER", fallbackToCacheTimeout: 0 };
    const fields = { ENABLED: "false", EXPO_UPDATES_CHECK_ON_LAUNCH: "NEVER", EXPO_UPDATE_URL: undefined, UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY: undefined, EXPO_RUNTIME_VERSION: "file:fingerprint" };
    const fingerprintAsset = "a".repeat(40);
    assert.deepEqual(assertUpdatesPolicy(otaManifest(fields), "", expected, { fingerprintAsset }), {
        runtimeVersion: fingerprintAsset, otaSigned: false, otaChannel: null, otaUpdateUrl: null,
    });
    for (const invalid of [
        { ENABLED: "true" }, { EXPO_UPDATES_CHECK_ON_LAUNCH: "ALWAYS" }, { EXPO_UPDATES_CHECK_ON_LAUNCH: undefined },
        { EXPO_UPDATE_URL: "https://u.expo.dev/fixture" }, { UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY: '{"expo-channel-name":"production"}' },
        { CODE_SIGNING_CERTIFICATE: "retained certificate" }, { CODE_SIGNING_METADATA: "{}" }, { DISABLE_ANTI_BRICKING_MEASURES: "true" },
    ]) assert.throws(() => assertUpdatesPolicy(otaManifest({ ...fields, ...invalid }), "", expected, { fingerprintAsset }));
    assert.throws(() => assertUpdatesPolicy(otaManifest(fields), "", expected), /fingerprint runtime/);
});

test("SDK 57 runtime sentinel requires the exact packaged fingerprint and records its verified OTA target", () => {
    const expected = { enabled: true, url: "https://u.expo.dev/fixture", requestHeaders: { "expo-channel-name": "preprod" } };
    const manifest = otaManifest({ EXPO_RUNTIME_VERSION: "file:fingerprint" });
    const fingerprintAsset = "b".repeat(40);
    assert.deepEqual(assertUpdatesPolicy(manifest, "", expected, { fingerprintAsset }), {
        runtimeVersion: fingerprintAsset, otaSigned: false, otaChannel: "preprod", otaUpdateUrl: expected.url,
    });
    for (const invalid of [undefined, "", "file:fingerprint", "b".repeat(39), "b".repeat(65), "B".repeat(40), fingerprintAsset + "\n", "../fingerprint"])
        assert.throws(() => assertUpdatesPolicy(manifest, "", expected, { fingerprintAsset: invalid }), /fingerprint runtime/);
    assert.throws(() => assertUpdatesPolicy(otaManifest({ EXPO_RUNTIME_VERSION: "file:elsewhere" }), "", expected, { fingerprintAsset }), /fingerprint runtime/);
});

test("actual AAPT2 compiled indentation, raw JSON quotes and untyped string resources resolve OTA policy", () => {
    const expected = { enabled: true, url: "https://u.expo.dev/fixture", requestHeaders: { "expo-channel-name": "production" } };
    const manifest = `      E: application (line=30)
        A: android:allowBackup(0x01010280)=false
          E: meta-data (line=97)
            A: android:name(0x01010003)="expo.modules.updates.ENABLED" (Raw: "expo.modules.updates.ENABLED")
            A: android:value(0x01010024)=true
          E: meta-data (line=103)
            A: android:name(0x01010003)="expo.modules.updates.EXPO_RUNTIME_VERSION"
            A: android:value(0x01010024)=@0x7f110068
          E: meta-data (line=112)
            A: android:name(0x01010003)="expo.modules.updates.EXPO_UPDATE_URL"
            A: android:value(0x01010024)="https://u.expo.dev/fixture" (Raw: "https://u.expo.dev/fixture")
          E: meta-data (line=115)
            A: android:name(0x01010003)="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY"
            A: android:value(0x01010024)="{"expo-channel-name":"production"}" (Raw: "{"expo-channel-name":"production"}")
`;
    const resources = '    resource 0x7f110068 string/expo_runtime_version\n      () "file:fingerprint"\n';
    assert.deepEqual(assertUpdatesPolicy(manifest, resources, expected, { fingerprintAsset: "c".repeat(40) }), {
        runtimeVersion: "c".repeat(40), otaSigned: false, otaChannel: "production", otaUpdateUrl: expected.url,
    });
    const nested = manifest.replace('          E: meta-data (line=97)', '          E: activity\n              E: meta-data (line=97)');
    assert.throws(() => assertUpdatesPolicy(nested, resources, expected, { fingerprintAsset: "c".repeat(40) }), /enabled policy/);
    assert.throws(() => assertUpdatesPolicy(manifest, resources + '      (fr) "wrong-runtime"\n', expected, { fingerprintAsset: "c".repeat(40) }), /Ambiguous OTA resource/);
});

test("compiled signed OTA policy verifies the profile certificate bytes and signing key metadata", () => temporary(directory => {
    const pem = bytes => `-----BEGIN CERTIFICATE-----\n${bytes.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
    const der = Buffer.from(identity.certificateDerBase64, "base64");
    const certificate = join(directory, "approved.pem");
    writeFileSync(certificate, pem(der));
    const metadata = { keyid: "preprod", alg: "rsa-v1_5-sha256" };
    const expected = { enabled: true, url: "https://u.expo.dev/fixture", requestHeaders: { "expo-channel-name": "preprod" }, codeSigningCertificate: certificate, codeSigningMetadata: metadata };
    const fields = { CODE_SIGNING_CERTIFICATE: pem(der), CODE_SIGNING_METADATA: JSON.stringify(metadata) };
    assert.equal(assertUpdatesPolicy(otaManifest(fields), "", expected).otaSigned, true);
    assert.throws(() => assertUpdatesPolicy(otaManifest({ ...fields, CODE_SIGNING_METADATA: '{"keyid":"production","alg":"rsa-v1_5-sha256"}' }), "", expected), /signing key metadata/);
    const wrong = Buffer.from(der);
    wrong[wrong.length - 1] ^= 1;
    assert.throws(() => assertUpdatesPolicy(otaManifest({ ...fields, CODE_SIGNING_CERTIFICATE: pem(wrong) }), "", expected), /certificate differs/);
}));
