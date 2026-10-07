import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chmodSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAndroid, copyInstalledDependencies, finishStaging, productionBuildOptions, productionEnvironment, releaseMetadata } from "./build-android.mjs";
import { assertBackupResources, assertEmbeddedUpdate, assertNetworkPolicy, assertProductionManifest, assertProductionSignature, loadReleaseConfig, releaseVerificationOptions, verifyRelease, xmlResourcePath } from "./verify-release.mjs";
import ota from "../config/ota.cjs";
import { apkSha256, reproductionOptions, verifyReproducibility } from "./verify-reproducibility.mjs";

const require = createRequire(import.meta.url);
const { configureReleaseSigning, configureToolchain } = require("../plugins/with-release-signing-config.js");
const config = JSON.parse(readFileSync(new URL("../release-config.json", import.meta.url), "utf8"));
const identity = JSON.parse(readFileSync(new URL("../release-signing.json", import.meta.url), "utf8"));
const template = `android {
  signingConfigs {
    debug { storeFile file('debug.keystore') }
  }
  buildTypes {
    debug { signingConfig signingConfigs.debug }
    release {
      // Caution! In production, you need to generate your own keystore file.
      // see https://reactnative.dev/docs/signed-apk-android.
      signingConfig signingConfigs.debug
    }
  }
}`;

test("embedded replay accepts only canonical UUIDs and exact millisecond timestamps", () => {
    const update = { id: "12345678-1234-4123-8123-123456789abc", commitTime: 1790549889123 };
    assert.deepEqual(assertEmbeddedUpdate({ ...update, assets: [] }), update);
    for (const commitTime of ["1790549889123", -1, 1.5, Infinity, 8640000000000001]) assert.throws(() => assertEmbeddedUpdate({ ...update, commitTime }));
    for (const id of [update.id.toUpperCase(), "bad", update.id.replace("-8123", "-0123")]) assert.throws(() => assertEmbeddedUpdate({ ...update, id }));
});

test("production and verification config arguments retain defaults and reject ambiguous input", () => {
    assert.deepEqual(loadReleaseConfig(), config);
    assert.equal(productionBuildOptions([]).configPath, new URL("../release-config.json", import.meta.url).pathname);
    assert.equal(releaseVerificationOptions([]).configPath, productionBuildOptions([]).configPath);
    assert.equal(productionBuildOptions(["--config", "preprod.json"], "/tmp/caller").configPath, "/tmp/caller/preprod.json");
    assert.equal(releaseVerificationOptions(["app.apk", "--config", "preprod.json"], "/tmp/caller").configPath, "/tmp/caller/preprod.json");
    for (const args of [["--config"], ["--config", " "], ["--config", "--unsigned"], ["--config", "a", "--config", "b"], ["--unknown"], ["--unsigned", "--unsigned"]]) {
        assert.throws(() => productionBuildOptions(args));
        assert.throws(() => releaseVerificationOptions(args));
    }
    assert.throws(() => releaseVerificationOptions(["first.apk", "second.apk"]));
});

test("custom JSON selects public endpoints without permitting inherited test flags or private config", () => {
    const temporary = mkdtempSync(join(tmpdir(), "cryptex-release-config-"));
    const path = join(temporary, "preprod.json");
    try {
        const selected = { ...config, EXPO_PUBLIC_APP_URL: "https://preprod.example.test", EXPO_PUBLIC_ONLINE_SERVICES_API_URL: "https://api.preprod.example.test", EXPO_PUBLIC_CRYPTEX_E2E: "1" };
        writeFileSync(path, JSON.stringify(selected));
        const env = productionEnvironment({ EXPO_PUBLIC_APP_URL: "http://localhost", ENTRY_FILE: "test.js" }, loadReleaseConfig(path));
        assert.equal(env.EXPO_PUBLIC_APP_URL, selected.EXPO_PUBLIC_APP_URL);
        assert.equal(env.EXPO_PUBLIC_ONLINE_SERVICES_API_URL, selected.EXPO_PUBLIC_ONLINE_SERVICES_API_URL);
        assert.equal(env.EXPO_PUBLIC_CRYPTEX_E2E, "0");
        assert.equal(env.EXPO_NO_DOTENV, "1");
        assert.equal(env.ENTRY_FILE, undefined);
        assert.deepEqual(loadReleaseConfig(), config, "Selecting an external JSON must not change the default file");
        for (const invalid of ["{", "null", "[]", JSON.stringify({ ...selected, CRYPTEX_KEY_PASSWORD: "private" }), JSON.stringify({ ...selected, EXPO_PUBLIC_APP_URL: "http://localhost" })]) {
            writeFileSync(path, invalid);
            assert.throws(() => buildAndroid(["--unsigned", "--config", path]), /JSON|configuration|Only public|HTTPS/);
        }
        assert.throws(() => buildAndroid(["--unsigned", "--config", join(temporary, "missing.json")]), /ENOENT/);
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
});

test("release signing has no debug fallback and requires explicit unsigned builds", () => {
    const result = configureReleaseSigning(template);
    assert.match(result, /cryptexUnsignedRelease.*\? null : signingConfigs\.release/);
    assert.match(result, /Missing release signing environment variable/);
    assert.match(result, /EXPO_PUBLIC_CRYPTEX_E2E/);
    assert.match(result, /Test flags and alternate entry points are forbidden/);
    assert.match(result, /CRYPTEX_BUILD_PROFILE/);
    assert.equal(configureReleaseSigning(result), result);
    assert.equal((result.match(/signingConfig signingConfigs\.debug/g) || []).length, 1);
    assert.throws(() => configureReleaseSigning(result.replace("? null : signingConfigs.release", "? signingConfigs.debug : signingConfigs.release")), /was modified/);
});

test("the earlier debug-signing fallback migrates without duplicate configurations", () => {
    const previous = template.replace("signingConfigs {", `signingConfigs {
      release {
        if (System.getenv("CRYPTEX_KEYSTORE")) {
          storeFile file(System.getenv("CRYPTEX_KEYSTORE"))
          storePassword System.getenv("CRYPTEX_KEYSTORE_PASSWORD")
          keyAlias System.getenv("CRYPTEX_KEY_ALIAS")
          keyPassword System.getenv("CRYPTEX_KEY_PASSWORD")
        }
      }`).replace("signingConfig signingConfigs.debug\n    }", 'signingConfig System.getenv("CRYPTEX_KEYSTORE") ? signingConfigs.release : signingConfigs.debug\n    }');
    const result = configureReleaseSigning(previous);
    assert.equal((result.match(/storePassword System.getenv/g) || []).length, 1);
    assert.doesNotMatch(result, /\? signingConfigs\.release : signingConfigs\.debug/);
});

test("unknown Gradle template fails instead of preserving unsafe signing", () => {
    assert.throws(() => configureReleaseSigning("android {}"), /signingConfigs/);
    assert.throws(() => configureReleaseSigning("signingConfigs {}\nrelease {}"), /release signing/);
});

test("production ignores local endpoint/test overrides while retaining private signing only for signed output", () => {
    const nativeOverrides = ["CC", "CXX", "CFLAGS", "CXXFLAGS", "CPPFLAGS", "ASFLAGS", "LDFLAGS", "AR", "AS", "LD", "RANLIB", "MAKEFLAGS", "MFLAGS", "CMAKE_GENERATOR", "CMAKE_PREFIX_PATH"];
    const inherited = {
        ...Object.fromEntries(nativeOverrides.map(name => [name, "unreviewed-native-override"])),
        PATH: "/bin", EXPO_PUBLIC_APP_URL: "http://localhost:3000", EXPO_PUBLIC_CLOUD_ENABLED: "false",
        EXPO_PUBLIC_CRYPTEX_E2E: "1", EXPO_NO_CLIENT_ENV_VARS: "1", ENTRY_FILE: "tests/native-crypto-entry.tsx",
        NODE_OPTIONS: "--require /tmp/injection.cjs", ORG_GRADLE_PROJECT_reactNativeArchitectures: "x86",
        EXPO_UPDATES_FINGERPRINT_OVERRIDE: "a".repeat(40), EXPO_UPDATES_WORKFLOW_OVERRIDE: "bare",
        CRYPTEX_EMBEDDED_UPDATE_COMMIT_TIME: "1", CRYPTEX_EMBEDDED_UPDATE_ID: "12345678-1234-4123-8123-123456789abc", CRYPTEX_EMBEDDED_UPDATE_UNKNOWN: "poison",
        NODE_PATH: "/outside/node_modules",
        CRYPTEX_KEYSTORE: "/private/release.p12", CRYPTEX_KEYSTORE_PASSWORD: "test-secret",
        CRYPTEX_KEY_ALIAS: identity.alias, CRYPTEX_KEY_PASSWORD: "test-secret",
    };
    const signed = productionEnvironment(inherited, config);
    assert.equal(signed.EXPO_PUBLIC_APP_URL, "https://www.cryptex-vault.com");
    assert.equal(signed.EXPO_PUBLIC_CLOUD_ENABLED, "true");
    assert.equal(signed.EXPO_PUBLIC_CRYPTEX_E2E, "0");
    assert.equal(signed.EXPO_NO_DOTENV, "1");
    assert.equal(signed.NODE_ENV, "production");
    for (const name of ["ENTRY_FILE", "NODE_OPTIONS", "NODE_PATH", "EXPO_NO_CLIENT_ENV_VARS", "ORG_GRADLE_PROJECT_reactNativeArchitectures", "EXPO_UPDATES_FINGERPRINT_OVERRIDE", "EXPO_UPDATES_WORKFLOW_OVERRIDE"]) assert.equal(signed[name], undefined);
    for (const name of nativeOverrides) assert.equal(signed[name], undefined, `${name} must not override production native configuration`);
    assert.equal(signed.CRYPTEX_KEYSTORE, inherited.CRYPTEX_KEYSTORE);
    assert.ok(!Object.keys(signed).some(name => name.startsWith("CRYPTEX_EMBEDDED_UPDATE_")));
    const unsigned = productionEnvironment(inherited, config, { unsigned: true });
    for (const name of nativeOverrides) assert.equal(unsigned[name], undefined, `${name} must not override unsigned reproduction`);
    assert.ok(!Object.keys(unsigned).some(name => name.startsWith("CRYPTEX_KEY")));
    assert.ok(!Object.keys(unsigned).some(name => name.startsWith("CRYPTEX_EMBEDDED_UPDATE_")));
    assert.equal(productionEnvironment(inherited, config, { offlineServices: true }).EXPO_PUBLIC_CLOUD_ENABLED, "false");
});

test("release configuration rejects accidental offline defaults and non-HTTPS endpoints", () => {
    assert.throws(() => productionEnvironment({}, { ...config, EXPO_PUBLIC_CLOUD_ENABLED: "false" }), /enable Online Services/);
    assert.throws(() => productionEnvironment({}, { ...config, EXPO_PUBLIC_APP_URL: "http://localhost:3000" }), /HTTPS/);
    assert.throws(() => productionEnvironment({}, { ...config, CRYPTEX_KEY_PASSWORD: "secret" }), /Only public/);
});

const manifest = `A: package="com.cryptexindustries.vault"
A: android:versionName(0x0101021c)="0.1.0"
A: android:versionCode(0x0101021b)=1
E: application
A: android:allowBackup(0x01010280)=false
A: android:fullBackupContent(0x010104eb)=@0x7f120001
A: android:dataExtractionRules(0x0101063e)=@0x7f120002
A: android:networkSecurityConfig(0x01010527)=@0x7f120003
A: android:debuggable(0x0101000f)=false
A: android:testOnly(0x01010272)=false
E: activity
A: android:name(0x01010003)="com.cryptex.vault.credentials.CredentialRequestActivity"
A: android:exported(0x01010010)=false
A: android:excludeFromRecents(0x01010017)=true
E: service
A: android:name(0x01010003)="com.cryptex.vault.credentials.CryptexAutofillService"
A: android:exported(0x01010010)=true
A: android:permission(0x01010006)="android.permission.BIND_AUTOFILL_SERVICE"
E: service
A: android:name(0x01010003)="com.cryptex.vault.credentials.CryptexAccessibilityService"
A: android:exported(0x01010010)=true
A: android:permission(0x01010006)="android.permission.BIND_ACCESSIBILITY_SERVICE"
E: service
A: android:name(0x01010003)="com.cryptex.vault.credentials.CryptexCredentialProviderService"
A: android:exported(0x01010010)=true
A: android:permission(0x01010006)="android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE"`;

test("APK policy rejects debuggable, test-only, wrong-package, E2E and native-test artifacts", () => {
    assertProductionManifest(manifest);
    for (const unsafe of [manifest.replace("debuggable(0x0101000f)=false", "debuggable(0x0101000f)=true"),
        manifest.replace("testOnly(0x01010272)=false", "testOnly(0x01010272)=true"),
        manifest.replace("com.cryptex.vault", "com.cryptex.vault.cryptotest"),
        manifest.replace('"0.1.0"', '"0.1.0-e2e"'), manifest + "\nClipboardTestActivity"]) {
        assert.throws(() => assertProductionManifest(unsafe));
    }
});

test("release verification selects the intended application identity and an explicit bumped version", () => {
    const preprod = manifest.replace('package="com.cryptexindustries.vault"', 'package="com.cryptexindustries.vault.preprod"');
    assertProductionManifest(preprod, { profile: "preprod" });
    assert.throws(() => assertProductionManifest(preprod), /profile ID/);
    const bumped = manifest.replace('="0.1.0"', '="0.2.0"').replace('versionCode(0x0101021b)=1', 'versionCode(0x0101021b)=2');
    assertProductionManifest(bumped, { version: { name: "0.2.0", code: 2 } });
    assert.throws(() => assertProductionManifest(bumped), /version/);
});

test("APK policy preserves private relays and framework-protected service bindings", () => {
    assert.throws(() => assertProductionManifest(manifest.replace("allowBackup(0x01010280)=false", "allowBackup(0x01010280)=true")), /backup/);
    assert.throws(() => assertProductionManifest(manifest.replace("exported(0x01010010)=false", "exported(0x01010010)=true")), /relay/);
    for (const permission of ["BIND_AUTOFILL_SERVICE", "BIND_ACCESSIBILITY_SERVICE", "BIND_CREDENTIAL_PROVIDER_SERVICE"]) {
        assert.throws(() => assertProductionManifest(manifest.replace(permission, "INTERNET")), /binding permission/);
    }
});

test("nested metadata cannot stand in for a component name or bind permission", () => {
    const permission = 'A: android:permission(0x01010006)="android.permission.BIND_AUTOFILL_SERVICE"';
    const misleadingPermission = manifest.replace(permission,
        'A: android:permission(0x01010006)="android.permission.INTERNET"\nE: meta-data\nA: android:name(0x01010003)="android.permission.BIND_AUTOFILL_SERVICE"');
    assert.throws(() => assertProductionManifest(misleadingPermission), /binding permission/);
    const name = 'A: android:name(0x01010003)="com.cryptex.vault.credentials.CryptexAutofillService"';
    const misleadingName = manifest.replace(name,
        'A: android:name(0x01010003)="com.cryptex.vault.credentials.OtherService"\nE: meta-data\n' + name);
    assert.throws(() => assertProductionManifest(misleadingName), /Missing security-sensitive component/);
});

test("APK policy requires the application to use the reviewed network resource", () => {
    const resources = "resource 0x7f120003 xml/network_security_config\n";
    const policy = "E: network-security-config\nE: base-config\nA: cleartextTrafficPermitted=false\n";
    assertNetworkPolicy(manifest, resources, policy);
    assert.throws(() => assertNetworkPolicy(manifest.replace("@0x7f120003", "@0x7f120004"), resources, policy), /reference/);
    assert.throws(() => assertNetworkPolicy(manifest.replace(/^A: android:networkSecurityConfig[^\n]*\n/m, ""), resources, policy), /reference/);
    assert.throws(() => assertNetworkPolicy(manifest, resources, policy + "A: cleartextTrafficPermitted=true\n"), /Development cleartext/);
});

test("compiled XML lookup follows reviewed resource names through obfuscated APK paths", () => {
    const resources = `  type xml id=14 entryCount=13
    resource 0x7f140004 xml/cryptex_no_backup_rules
      () (file) res/h8.xml type=XML
    resource 0x7f140005 xml/cryptex_no_data_extraction_rules
      () (file) res/Im.xml type=XML
    resource 0x7f14000c xml/network_security_config
      () (file) res/8G.xml type=XML
`;
    assert.equal(xmlResourcePath(resources, "cryptex_no_backup_rules"), "res/h8.xml");
    assert.equal(xmlResourcePath(resources, "cryptex_no_data_extraction_rules"), "res/Im.xml");
    assert.equal(xmlResourcePath(resources, "network_security_config"), "res/8G.xml");
    assert.equal(xmlResourcePath(resources.replace("res/8G.xml", "res/xml/network_security_config.xml"), "network_security_config"), "res/xml/network_security_config.xml");
    assert.throws(() => xmlResourcePath(resources, "missing"), /Missing or ambiguous reviewed/);
    assert.throws(() => xmlResourcePath(resources + resources, "cryptex_no_backup_rules"), /ambiguous reviewed/);
    assert.throws(() => xmlResourcePath(resources.replace("res/h8.xml type=XML", "res/h8.xml type=XML\n      (v31) (file) res/other.xml type=XML"), "cryptex_no_backup_rules"), /ambiguous compiled/);
    assert.throws(() => xmlResourcePath(resources.replace("res/h8.xml type=XML", "@0x7f140005"), "cryptex_no_backup_rules"), /Missing or ambiguous compiled/);
    for (const path of ["../outside.xml", "/res/h8.xml", "res/../outside.xml", "res//h8.xml", "res/unsafe file.xml", "res/h8.xml/extra"]) {
        assert.throws(() => xmlResourcePath(resources.replace("res/h8.xml", path), "cryptex_no_backup_rules"), /Unsafe compiled XML/);
    }
});

test("APK policy verifies referenced backup exclusions for cloud and device transfer", () => {
    const resources = "resource 0x7f120001 xml/cryptex_no_backup_rules\nresource 0x7f120002 xml/cryptex_no_data_extraction_rules\n";
    const exclusions = ["root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"]
        .map(domain => `E: exclude\nA: domain="${domain}"\nA: path="."\n`).join("");
    const backup = "E: full-backup-content\n" + exclusions;
    const extraction = "E: data-extraction-rules\nE: cloud-backup\n" + exclusions + "E: device-transfer\n" + exclusions;
    assertBackupResources(manifest, resources, backup, extraction);
    assert.throws(() => assertBackupResources(manifest.replace("@0x7f120001", "@0x7f120003"), resources, backup, extraction), /reference/);
    for (const [attribute, id] of [["fullBackupContent", "0x7f120001"], ["dataExtractionRules", "0x7f120002"]]) {
        const misleadingNestedReference = manifest.replace(`=@${id}`, "=@0x7f120003")
            + `\nE: meta-data\nA: android:${attribute}(0x010104eb)=@${id}\n`;
        assert.throws(() => assertBackupResources(misleadingNestedReference, resources, backup, extraction), /reference/);
    }
    assert.throws(() => assertBackupResources(manifest, resources, backup.replace('domain="file"', 'domain="other"'), extraction), /domain file/);
    assert.throws(() => assertBackupResources(manifest, resources, backup, extraction.split("E: device-transfer")[0]), /device-transfer/);
    assert.throws(() => assertBackupResources(manifest, resources, backup + "\nE: include", extraction), /include/);
});

test("APK policy requires the checked-in public signing identity", () => {
    const report = `Signer #1 certificate SHA-256 digest: ${identity.certificateSha256}\nSigner #1 certificate DN: CN=Cryptex Vault\n`;
    assertProductionSignature(report, identity);
    assert.throws(() => assertProductionSignature(report.replace(identity.certificateSha256, "a".repeat(64)), identity), /unapproved/);
    assert.throws(() => assertProductionSignature(report + report.replace("#1", "#2"), identity), /one expected signer/);
    assert.throws(() => assertProductionSignature(report + "CN=Android Debug", identity), /Debug-signed/);
    assert.throws(() => assertProductionSignature(report, { ...identity, certificateSha256: "0".repeat(64) }), /inconsistent/);
});

test("every APK and signature-reproduction inspection child gets an explicit environment without signing credentials", { skip: process.platform === "win32" }, () => {
    const temporary = mkdtempSync(join(tmpdir(), "cryptex-inspection-env-"));
    const signingNames = ["CRYPTEX_KEYSTORE", "CRYPTEX_KEYSTORE_PASSWORD", "CRYPTEX_KEY_ALIAS", "CRYPTEX_KEY_PASSWORD"];
    const previous = Object.fromEntries(signingNames.map(name => [name, process.env[name]]));
    const toolchain = JSON.parse(readFileSync(new URL("../fdroid/toolchain.json", import.meta.url), "utf8"));
    const tools = join(temporary, "sdk/build-tools", toolchain.buildTools);
    const fixture = join(temporary, "fixture.json");
    const calls = join(temporary, "calls.txt");
    const apk = join(temporary, "synthetic.apk");
    const exclusions = ["root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"]
        .map(domain => `E: exclude\nA: domain="${domain}"\nA: path="."\n`).join("");
    try {
        mkdirSync(tools, { recursive: true });
        const resources = [["cryptex_no_backup_rules", "0x7f120001", "res/h8.xml"], ["cryptex_no_data_extraction_rules", "0x7f120002", "res/Im.xml"], ["network_security_config", "0x7f120003", "res/8G.xml"]]
            .map(([name, id, path]) => `    resource ${id} xml/${name}\n      () (file) ${path} type=XML\n`).join("");
        writeFileSync(fixture, JSON.stringify({
            manifest: manifest.replace("E: activity\n", Object.entries({
                ENABLED: "true", EXPO_UPDATE_URL: ota.requireOtaConfiguration("production").updates.url,
                EXPO_RUNTIME_VERSION: "a".repeat(40), UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY: JSON.stringify({ "expo-channel-name": "production" }),
            }).map(([name, value]) => `  E: meta-data\n    A: android:name(0x01010003)="expo.modules.updates.${name}"\n    A: android:value(0x01010024)=${JSON.stringify(value)}\n`).join("") + "E: activity\n"), resources,
            xml: { "res/h8.xml": "E: full-backup-content\n" + exclusions,
                "res/Im.xml": "E: data-extraction-rules\nE: cloud-backup\n" + exclusions + "E: device-transfer\n" + exclusions,
                "res/8G.xml": "E: network-security-config\nE: base-config\nA: cleartextTrafficPermitted=false\n" },
            entries: ["assets/app.manifest", "assets/cryptex-release.json", "assets/index.android.bundle", "classes.dex", ...["armeabi-v7a", "arm64-v8a", "x86", "x86_64"].map(abi => `lib/${abi}/libfixture.so`)].join("\n"),
            embedded: JSON.stringify({ id: "12345678-1234-4123-8123-123456789abc", commitTime: 1790549889123, assets: [] }),
            metadata: JSON.stringify(releaseMetadata({ config, toolchain, identity, sourceRevision: { commit: "a".repeat(40), dirty: true }, version: { name: "0.1.0", code: 1 } })),
            bundle: [config.EXPO_PUBLIC_APP_URL, config.EXPO_PUBLIC_ONLINE_SERVICES_API_URL, config.EXPO_PUBLIC_PUSHER_APP_HOST].join("\n"),
            signature: `Signer #1 certificate SHA-256 digest: ${identity.certificateSha256}\n`,
        }));
        const script = `#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
for (const name of ${JSON.stringify(signingNames)}) assert.equal(process.env[name], undefined, "Signing credential reached inspection child: " + name);
const fixture = JSON.parse(readFileSync(process.env.CRYPTEX_POLICY_FIXTURE, "utf8"));
const tool = basename(process.argv[1]);
appendFileSync(process.env.CRYPTEX_POLICY_CALLS, tool + "\\n");
const args = process.argv.slice(2);
if (tool === "aapt2") process.stdout.write(args[1] === "resources" ? fixture.resources : args.at(-1) === "AndroidManifest.xml" ? fixture.manifest : fixture.xml[args.at(-1)]);
else if (tool === "unzip") process.stdout.write(args[0] === "-Z1" ? fixture.entries : args.at(-1) === "assets/cryptex-release.json" ? fixture.metadata : args.at(-1) === "assets/app.manifest" ? fixture.embedded : args.at(-1) === "assets/index.android.bundle" ? fixture.bundle : "fixture dex");
else if (tool === "apksigner") { if (process.env.CRYPTEX_POLICY_UNSIGNED === "1" || args.at(-1).includes("-unsigned.apk")) process.exit(1); process.stdout.write(fixture.signature); }
else if (tool === "python") {
    if (args[0] === "--version") process.stdout.write("Python ${toolchain.reproductionPython}");
    else {
    assert.deepEqual(args.slice(0, 2), ["-c", "from apksigcopier import main; raise SystemExit(main())"]);
    if (args[2] === "--version") process.stdout.write("apksigcopier, version " + (process.env.CRYPTEX_POLICY_BAD_COPIER === "1" ? "0.0.0" : "${toolchain.apksigcopier}"));
    else if (args[2] === "copy") { copyFileSync(args[3], args[5]); if (process.env.CRYPTEX_POLICY_BAD_RECONSTRUCTION === "1") writeFileSync(args[5], "different signed bytes"); }
    else throw new Error("Unexpected copier arguments");
    }
}
else throw new Error("Unexpected inspection tool " + tool);
`;
        for (const path of [join(tools, "aapt2"), join(tools, "apksigner"), join(temporary, "unzip"), join(temporary, "python")]) {
            writeFileSync(path, script);
            chmodSync(path, 0o700);
        }
        writeFileSync(apk, "synthetic public unsigned bytes");
        // Poison both the passed environment and ambient process environment. An
        // omitted env option would inherit credentials and fail inside the child.
        for (const name of signingNames) process.env[name] = "synthetic-signing-poison";
        for (const unsigned of [true, false]) {
            verifyRelease(apk, { unsigned, env: { ...process.env, ANDROID_HOME: join(temporary, "sdk"), PATH: `${temporary}:${process.env.PATH}`,
                CRYPTEX_POLICY_FIXTURE: fixture, CRYPTEX_POLICY_CALLS: calls, CRYPTEX_POLICY_UNSIGNED: unsigned ? "1" : "0" } });
        }
        const [signed, firstUnsigned, secondUnsigned] = ["reference-signed.apk", "first-unsigned.apk", "second-unsigned.apk"]
            .map(name => join(temporary, name));
        for (const path of [signed, firstUnsigned, secondUnsigned]) copyFileSync(apk, path);
        const inherited = { ...process.env, ANDROID_HOME: join(temporary, "sdk"), PATH: `${temporary}:${process.env.PATH}`,
            CRYPTEX_POLICY_FIXTURE: fixture, CRYPTEX_POLICY_CALLS: calls, CRYPTEX_POLICY_UNSIGNED: "0", CRYPTEX_REPRODUCTION_PYTHON: join(temporary, "python") };
        verifyReproducibility(signed, firstUnsigned, secondUnsigned, { env: inherited });
        for (const name of signingNames) assert.equal(inherited[name], "synthetic-signing-poison", "Inspection must not mutate its caller environment");
        const invoked = readFileSync(calls, "utf8").trim().split("\n");
        for (const [tool, count] of [["aapt2", 30], ["unzip", 30], ["apksigner", 6], ["python", 5]]) assert.equal(invoked.filter(value => value === tool).length, count);
        const universalFixture = readFileSync(fixture, "utf8");
        const targetedFixture = JSON.parse(universalFixture);
        targetedFixture.entries = targetedFixture.entries.split("\n").filter(entry => !entry.startsWith("lib/") || entry.startsWith("lib/arm64-v8a/")).join("\n");
        writeFileSync(fixture, JSON.stringify(targetedFixture));
        const targetedOptions = { unsigned: true, env: { ...inherited, CRYPTEX_POLICY_UNSIGNED: "1" } };
        verifyRelease(apk, { ...targetedOptions, arch: "arm64-v8a" });
        assert.throws(() => verifyRelease(apk, targetedOptions), /architectures differ/);
        assert.throws(() => verifyRelease(apk, { ...targetedOptions, arch: "x86" }), /architectures differ/);
        writeFileSync(fixture, universalFixture);
        assert.throws(() => verifyReproducibility(signed, firstUnsigned, secondUnsigned, { env: { ...inherited, CRYPTEX_POLICY_BAD_COPIER: "1" } }), /pinned apksigcopier version/);
        assert.throws(() => verifyReproducibility(signed, firstUnsigned, secondUnsigned, { env: { ...inherited, CRYPTEX_POLICY_BAD_RECONSTRUCTION: "1" } }), /Reconstructed signed APK differs/);
        // Exercise the real builder in a tiny isolated source tree. Only external
        // commands are replaced inside the child; staging, policy and delivery run.
        const checkout = join(temporary, "checkout"), project = join(checkout, "mobile");
        for (const directory of ["scripts", "config", "fdroid"]) mkdirSync(join(project, directory), { recursive: true });
        for (const file of ["scripts/build-android.mjs", "scripts/build-cache.mjs", "scripts/build-resources.cjs", "scripts/verify-release.mjs", "scripts/verify-reproducibility.mjs", "scripts/release-config.mjs", "scripts/native-runtime.mjs", "scripts/signing.mjs", "scripts/toolchain.mjs", "config/profiles.cjs", "config/release-config.cjs", "config/ota.cjs", "fdroid/toolchain.json", "app.json", "eas-project.json", "release-config.json", "release-signing.json", "release-signing-preprod.json"]) copyFileSync(new URL("../" + file, import.meta.url), join(project, file));
        writeFileSync(join(project, "App.tsx"), "independently staged source");
        const java = join(temporary, "java"); mkdirSync(join(java, "bin"), { recursive: true });
        writeFileSync(join(java, "bin/java"), "fixture"); writeFileSync(join(java, "release"), 'JAVA_RUNTIME_VERSION="' + toolchain.java + '"\nIMPLEMENTOR="' + toolchain.javaVendor + '"\n');
        for (const directory of ["build-tools/" + toolchain.signingBuildTools, "platforms/android-" + toolchain.compileSdk, "ndk/" + toolchain.ndk, "cmake/" + toolchain.cmake]) mkdirSync(join(temporary, "sdk", directory), { recursive: true });
        const reference = join(checkout, "reference.apk");
        const referenceBytes = JSON.stringify({ signed: true, payload: "independently staged source", metadata: JSON.parse(readFileSync(fixture, "utf8")).metadata, embedded: JSON.parse(readFileSync(fixture, "utf8")).embedded });
        writeFileSync(reference, referenceBytes);
        async function fixtureWorker() {
            const fs = await import("node:fs"), path = await import("node:path"), assert = (await import("node:assert/strict")).default;
            const { createRequire, syncBuiltinESMExports } = await import("node:module");
            const child = createRequire(import.meta.url)("node:child_process");
            const fixture = JSON.parse(fs.readFileSync(process.env.CRYPTEX_POLICY_FIXTURE, "utf8"));
            const project = process.env.CRYPTEX_POLICY_PROJECT;
            const pins = JSON.parse(fs.readFileSync(path.join(project, "fdroid/toolchain.json"), "utf8"));
            const clean = env => { for (const key of ["CRYPTEX_KEYSTORE", "CRYPTEX_KEYSTORE_PASSWORD", "CRYPTEX_KEY_ALIAS", "CRYPTEX_KEY_PASSWORD"]) assert.equal(env?.[key], undefined, "Private key reached a child"); };
            child.execFileSync = (binary, args, options = {}) => {
                clean(options.env);
                const tool = path.basename(binary);
                if (tool === "git") {
                    if (args[0] === "rev-parse") return (process.env.CRYPTEX_POLICY_WRONG_REVISION ? "b" : "a").repeat(40);
                    if (args[0] === "status") return "?? fixture";
                    if (process.env.CRYPTEX_POLICY_REPLACE_REFERENCE) fs.writeFileSync(process.env.CRYPTEX_POLICY_REPLACE_REFERENCE, "replaced after snapshot");
                    return "mobile/App.tsx\0mobile/app.json\0";
                }
                if (tool === "aapt2") return args[1] === "resources" ? fixture.resources : args.at(-1) === "AndroidManifest.xml" ? fixture.manifest : fixture.xml[args.at(-1)];
                if (tool === "unzip") {
                    if (args[0] === "-Z1") return fixture.entries;
                    const apk = JSON.parse(fs.readFileSync(args[1], "utf8"));
                    return Buffer.from(args.at(-1) === "assets/cryptex-release.json" ? apk.metadata : args.at(-1) === "assets/app.manifest" ? apk.embedded : args.at(-1) === "assets/index.android.bundle" ? fixture.bundle : "fixture dex");
                }
                if (tool === "python") {
                    if (args[0] === "--version") return "Python " + pins.reproductionPython;
                    if (args[2] === "--version") return "apksigcopier, version " + pins.apksigcopier;
                    assert.deepEqual(args.slice(0, 3), ["-c", "from apksigcopier import main; raise SystemExit(main())", "copy"]);
                    const rebuilt = JSON.parse(fs.readFileSync(args[4], "utf8"));
                    rebuilt.signed = true; fs.writeFileSync(args[5], JSON.stringify(rebuilt)); return "";
                }
                throw new Error("Unexpected fixture command " + binary);
            };
            child.spawnSync = (binary, args, options = {}) => {
                clean(options.env);
                const ok = stdout => ({ status: 0, stdout: stdout ?? "", stderr: "" });
                if (path.basename(binary) === "pnpm") {
                    assert.equal(options.env.CRYPTEX_EMBEDDED_UPDATE_ID, undefined);
                    return ok(args[0] === "--version" ? pins.pnpm : "");
                }
                if (binary === process.execPath) {
                    assert.equal(options.env.CRYPTEX_EMBEDDED_UPDATE_ID, undefined);
                    if (args[0].includes("expo-updates")) return ok(JSON.stringify({ runtimeVersion: (process.env.CRYPTEX_POLICY_WRONG_RUNTIME ? "b" : "a").repeat(40), workflow: "managed" }));
                    const wrapper = path.join(options.cwd, "android/gradle/wrapper"); fs.mkdirSync(wrapper, { recursive: true });
                    fs.writeFileSync(path.join(wrapper, "gradle-wrapper.properties"), "distributionUrl=stock\n"); return ok();
                }
                if (binary === "./gradlew") {
                    for (const required of [":app:assembleRelease", "--no-daemon", "--no-build-cache", "--max-workers=2", "--no-parallel",
                        "-PcryptexUnsignedRelease=true", "-PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64",
                        `-Pandroid.buildToolsVersion=${pins.buildTools}`, `-Pandroid.compileSdkVersion=${pins.compileSdk}`,
                        `-Pandroid.targetSdkVersion=${pins.targetSdk}`, `-Pandroid.ndkVersion=${pins.ndk}`]) {
                        assert.ok(args.includes(required), `Missing production Gradle argument: ${required}`);
                    }
                    const embedded = JSON.parse(fixture.embedded);
                    assert.equal(options.env.CRYPTEX_EMBEDDED_UPDATE_ID, embedded.id);
                    assert.equal(options.env.CRYPTEX_EMBEDDED_UPDATE_COMMIT_TIME, String(embedded.commitTime));
                    const output = path.join(options.cwd, "app/build/outputs/apk/release"); fs.mkdirSync(output, { recursive: true });
                    const payload = fs.readFileSync(path.join(options.cwd, "../App.tsx"), "utf8") + (process.env.CRYPTEX_POLICY_CHANGED_BUILD ? "changed" : "");
                    fs.writeFileSync(path.join(output, "app-release-unsigned.apk"), JSON.stringify({ signed: false, payload, metadata: fs.readFileSync(path.join(options.cwd, "app/src/main/assets/cryptex-release.json"), "utf8").trim(), embedded: fixture.embedded }));
                    console.log("fixture native build"); return ok();
                }
                if (path.basename(binary) === "zipalign") { fs.copyFileSync(args.at(-2), args.at(-1)); return ok(); }
                if (path.basename(binary) === "apksigner") {
                    assert.equal(args[0], "verify", "Reproduction must never invoke private signing");
                    return JSON.parse(fs.readFileSync(args.at(-1), "utf8")).signed ? ok(fixture.signature) : { status: 1, stdout: "", stderr: "unsigned" };
                }
                throw new Error("Unexpected fixture child " + binary);
            };
            syncBuiltinESMExports();
            const { buildAndroid } = await import("./checkout/mobile/scripts/build-android.mjs");
            buildAndroid(process.argv.slice(2));
        }
        const worker = join(temporary, "builder-fixture.mjs");
        writeFileSync(worker, "(" + fixtureWorker.toString() + ")().catch(error => { console.error(error.message); process.exitCode = 1; });\n");
        const stages = [];
        const runBuild = (extra = {}, args = ["--reproduce-from", reference]) => {
            const result = spawnSync(process.execPath, [worker, ...args], { encoding: "utf8", cwd: checkout, env: { ...inherited, JAVA_HOME: java, ANDROID_SDK_ROOT: join(temporary, "sdk"), CRYPTEX_POLICY_PROJECT: project, ...extra } });
            const stage = result.stdout.match(/Building fresh native sources in ([^;]+);/)?.[1]; if (stage) stages.push(stage);
            return { ...result, stage };
        };
        try {
            const built = runBuild(); assert.equal(built.status, 0, built.stderr);
            const outputs = ["cryptex-vault-reproduced.apk", "cryptex-vault-reproduced-unsigned.apk"].flatMap(name => [join(project, "dist", name), join(project, "dist", name + ".json")]);
            assert.equal(readFileSync(outputs[0], "utf8"), referenceBytes);
            assert.equal(existsSync(built.stage), false, "Successful cold staging is cleaned");
            const before = outputs.map(file => readFileSync(file));
            for (const [extra, error] of [[{ CRYPTEX_POLICY_CHANGED_BUILD: "1" }, /differs from the reference byte-for-byte/], [{ CRYPTEX_POLICY_WRONG_REVISION: "1" }, /source revision or dirty marker/], [{ CRYPTEX_POLICY_WRONG_RUNTIME: "1" }, /native runtime differs/]]) {
                const failed = runBuild(extra); assert.equal(failed.status, 1); assert.match(failed.stderr, error);
                assert.equal(existsSync(failed.stage), true, "Failed work must remain quarantined");
                outputs.forEach((file, index) => assert.deepEqual(readFileSync(file), before[index], "Failure must not overwrite any existing artifact"));
                if (!extra.CRYPTEX_POLICY_CHANGED_BUILD) assert.ok(!failed.stdout.includes("fixture native build"));
            }
            const wrongProfile = runBuild({}, ["--reproduce-from", reference, "--profile", "preprod", "--config", join(project, "release-config.json")]);
            assert.equal(wrongProfile.status, 1); assert.match(wrongProfile.stderr, /Wrong application profile ID/); assert.ok(!wrongProfile.stdout.includes("fixture native build"));
            writeFileSync(reference, JSON.stringify({ ...JSON.parse(referenceBytes), signed: false }));
            const unsignedReference = runBuild(); assert.equal(unsignedReference.status, 1); assert.match(unsignedReference.stderr, /signature verification failed/); assert.ok(!unsignedReference.stdout.includes("fixture native build"));
            writeFileSync(reference, referenceBytes);
            rmSync(outputs[1]); linkSync(reference, outputs[1]);
            const aliased = runBuild(); assert.equal(aliased.status, 1); assert.match(aliased.stderr, /hard-linked reference/);
            assert.equal(readFileSync(reference, "utf8"), referenceBytes); rmSync(outputs[1]); writeFileSync(outputs[1], before[1]);
            const frozen = runBuild({ CRYPTEX_POLICY_REPLACE_REFERENCE: reference }); assert.equal(frozen.status, 0, frozen.stderr);
            assert.equal(readFileSync(reference, "utf8"), "replaced after snapshot");
            assert.equal(readFileSync(outputs[0], "utf8"), referenceBytes, "Proof must use the original verified snapshot");
        } finally { for (const stage of stages) rmSync(stage, { recursive: true, force: true }); }
        const selected = { ...config, EXPO_PUBLIC_APP_URL: "https://preprod.example.test", EXPO_PUBLIC_ONLINE_SERVICES_API_URL: "https://api.preprod.example.test", EXPO_PUBLIC_PUSHER_APP_HOST: "signal.preprod.example.test" };
        const selectedPath = join(temporary, "preprod.json");
        writeFileSync(selectedPath, JSON.stringify(selected));
        const preprod = JSON.parse(readFileSync(fixture, "utf8"));
        preprod.metadata = JSON.stringify(releaseMetadata({ config: selected, toolchain, identity, sourceRevision: { commit: "a".repeat(40), dirty: true }, version: { name: "0.1.0", code: 1 } }));
        preprod.bundle = [selected.EXPO_PUBLIC_APP_URL, selected.EXPO_PUBLIC_ONLINE_SERVICES_API_URL, selected.EXPO_PUBLIC_PUSHER_APP_HOST].join("\n");
        writeFileSync(fixture, JSON.stringify(preprod));
        assert.throws(() => verifyRelease(apk, { env: inherited }), /Production build configuration mismatch/);
        for (const unsigned of [true, false]) {
            verifyRelease(apk, { unsigned, config: loadReleaseConfig(selectedPath), env: { ...inherited, CRYPTEX_POLICY_UNSIGNED: unsigned ? "1" : "0" } });
        }
        verifyReproducibility(signed, firstUnsigned, secondUnsigned, { configPath: selectedPath, env: inherited });
        preprod.bundle = preprod.bundle.replace(selected.EXPO_PUBLIC_PUSHER_APP_HOST, "wrong-signaling-host");
        writeFileSync(fixture, JSON.stringify(preprod));
        assert.throws(() => verifyRelease(apk, { config: selected, env: inherited }), /EXPO_PUBLIC_PUSHER_APP_HOST absent/);
    } finally {
        for (const name of signingNames) {
            if (previous[name] === undefined) delete process.env[name];
            else process.env[name] = previous[name];
        }
        rmSync(temporary, { recursive: true, force: true });
    }
});

test("standalone native audit removes signing credentials before launching an inspector", { skip: process.platform === "win32" }, () => {
    const temporary = mkdtempSync(join(tmpdir(), "cryptex-native-audit-env-"));
    const mobile = join(temporary, "mobile");
    const signingNames = ["CRYPTEX_KEYSTORE", "CRYPTEX_KEYSTORE_PASSWORD", "CRYPTEX_KEY_ALIAS", "CRYPTEX_KEY_PASSWORD"];
    const inspected = join(temporary, "inspected.txt");
    try {
        mkdirSync(join(mobile, "scripts"), { recursive: true });
        mkdirSync(join(mobile, "android"), { recursive: true });
        mkdirSync(join(mobile, "config"), { recursive: true });
        copyFileSync(new URL("./verify-native-crypto.mjs", import.meta.url), join(mobile, "scripts/verify-native-crypto.mjs"));
        copyFileSync(new URL("../config/profiles.cjs", import.meta.url), join(mobile, "config/profiles.cjs"));
        for (const [name, version] of Object.entries({ "react-native-quick-crypto": "1.1.7", "react-native-quick-base64": "3.0.1", "react-native-nitro-modules": "0.33.2" })) {
            const directory = join(mobile, "node_modules", name);
            mkdirSync(directory, { recursive: true });
            writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version }));
        }
        const inspector = join(mobile, "android/gradlew");
        writeFileSync(inspector, `#!/usr/bin/env node
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
for (const name of ${JSON.stringify(signingNames)}) assert.equal(process.env[name], undefined, "Signing credential reached native inspector: " + name);
writeFileSync(process.env.CRYPTEX_INSPECTED_MARKER, "no signing credentials");
// Stop before APK inspection. This test exercises credential isolation only.
process.exit(37);
`);
        chmodSync(inspector, 0o700);
        const result = spawnSync(process.execPath, [join(mobile, "scripts/verify-native-crypto.mjs")], {
            env: { ...process.env, ...Object.fromEntries(signingNames.map(name => [name, "synthetic-signing-poison"])), CRYPTEX_INSPECTED_MARKER: inspected },
            encoding: "utf8", timeout: 10_000,
        });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 1, "Native audit must stop on the synthetic inspector failure");
        assert.equal(readFileSync(inspected, "utf8"), "no signing credentials");
        assert.match(result.stderr, /status: 37/);
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
});

test("archives have deterministic timestamps/order and pinned NDK", () => {
    const result = configureToolchain("apply plugin: 'expo-root-project'\n");
    assert.match(result, /ext.ndkVersion = '27\.1\.12297006'/);
    assert.match(result, /preserveFileTimestamps = false/);
    assert.match(result, /reproducibleFileOrder = true/);
    assert.match(result, /CRYPTEX_BUILD_PROFILE'\) == 'production'/);
    assert.match(result, /androidComponents\.finalizeDsl/);
    assert.match(result, /def arguments = android\.defaultConfig\.externalNativeBuild\.cmake\.arguments/);
    assert.match(result, /arguments\.addAll/);
    assert.match(result, /Review the existing CMake project include/);
    assert.match(result, /startsWith\('-DCMAKE_PROJECT_INCLUDE:'\)/);
    assert.match(result, /rootProject\.rootDir\.parentFile\.toPath\(\)\.resolve\('fdroid\/reproducible-native\.cmake'\)/);
    assert.match(result, /gradle\.gradleUserHomeDir/);
    assert.equal(configureToolchain(result), result);
});

test("native toolchain callbacks register before root plugins can eagerly evaluate the app", () => {
    const marker = "// Cryptex reproducible archive settings";
    for (const applies of [
        'apply plugin: "expo-root-project"\napply plugin: "com.facebook.react.rootproject"\n',
        "apply plugin: 'expo-root-project'\napply plugin: 'com.facebook.react.rootproject'\n",
        'apply plugin: "com.facebook.react.rootproject"\napply plugin: "expo-root-project"\n',
    ]) {
        const existing = 'buildscript { dependencies { classpath("com.android.tools.build:gradle") } }\nallprojects { repositories { google(); mavenCentral() } }\n';
        const template = existing + applies;
        const result = configureToolchain(template);
        assert.ok(result.startsWith(existing), "Keep existing buildscript/repository configuration unchanged");
        for (const plugin of ["expo-root-project", "com.facebook.react.rootproject"]) {
            assert.ok(result.indexOf(marker) < result.indexOf(plugin), "Callbacks must register before " + plugin);
            assert.ok(result.indexOf("androidComponents.finalizeDsl") < result.indexOf(plugin), "Native callback registration must precede " + plugin);
        }
        assert.ok(result.endsWith(applies), "Keep root plugin applications unchanged");
        assert.equal(configureToolchain(result), result);
        const oldAppended = template + "\n" + result.slice(result.indexOf(marker), result.indexOf(applies));
        const migrated = configureToolchain(oldAppended);
        assert.ok(migrated.indexOf(marker) < migrated.indexOf(applies), "Migrate only the known earlier late policy");
        assert.equal(migrated.split(marker).length, 2);
        assert.equal(configureToolchain(migrated), migrated);
        assert.throws(() => configureToolchain(result.replace("preserveFileTimestamps = false", "preserveFileTimestamps = true")), /policy was modified/);
        assert.throws(() => configureToolchain(result + result.slice(result.indexOf(marker), result.indexOf(applies))), /policy was modified/);
    }
    assert.throws(() => configureToolchain("buildscript {}\n"), /root plugin application not found/);
});

test("production native maps cover C, C++ and ASM without replacing existing compiler flags", () => {
    const cmake = readFileSync(new URL("../fdroid/reproducible-native.cmake", import.meta.url), "utf8");
    assert.match(cmake, /CMAKE_CURRENT_LIST_DIR}\/\.\.\/\.\./);
    assert.equal((cmake.match(/REALPATH/g) || []).length, 4);
    for (const target of ["/src", "/gradle", "/android-sdk"]) {
        assert.ok(cmake.includes(`=${target}>`));
    }
    assert.match(cmake, /-ffile-prefix-map=\$\{CRYPTEX_BUILD_ROOT\}=\/build\/\$\{CMAKE_PROJECT_NAME\}/);
    assert.ok(cmake.indexOf("-ffile-prefix-map=${CRYPTEX_BUILD_ROOT}") > cmake.indexOf("-ffile-prefix-map=${CRYPTEX_WORKSPACE_ROOT}"));
    assert.match(cmake, /-ffile-prefix-map=\$\{CMAKE_BINARY_DIR\}=\/build\/\$\{CMAKE_PROJECT_NAME\}/);
    assert.match(cmake, /-fdebug-compilation-dir=\/build\/\$\{CMAKE_PROJECT_NAME\}/);
    assert.equal((cmake.match(/COMPILE_LANGUAGE:C,CXX,ASM/g) || []).length, 6);
    assert.match(cmake, /add_compile_options\(/);
    assert.doesNotMatch(cmake, /set\(CMAKE_(?:C|CXX|ASM)_FLAGS/);
    assert.match(cmake, /add_link_options\("-Wl,--strip-all"\)/);
    assert.doesNotMatch(cmake, /--build-id=(?:none|0x)|fno-lto/);
});

test("OpenSSL retains version and algorithms without embedding absolute prefix-map flags", () => {
    const patch = readFileSync(new URL("../../patches/react-native-quick-crypto@1.1.7.patch", import.meta.url), "utf8");
    const configure = patch.split("+    <SOURCE_DIR>/Configure")[1].split("+  BUILD_COMMAND")[0];
    assert.doesNotMatch(configure, /prefix-map|no-buildinfo/);
    assert.match(configure, /--prefix=\/usr --libdir=lib --openssldir=\/etc\/ssl/);
    assert.match(configure, /no-shared no-tests no-apps no-module no-autoload-config/);
    assert.match(patch, /set\(OPENSSL_VERSION 3\.5\.8\)/);
    assert.match(patch, /"-ffile-prefix-map=\$\{CRYPTEX_PACKAGE_ROOT\}=\/src\/react-native-quick-crypto"/);
    assert.doesNotMatch(configure, /\bno-(?:ec|rsa|aes|chacha|poly1305|hash|sha)\b/);
});

test("native Ninja pools preserve existing pools and reproduce ELF bytes/build IDs across checkout paths", { skip: process.platform !== "linux" }, () => {
    const temporary = mkdtempSync(join(tmpdir(), "cryptex-native-map-test-"));
    const run = (command, args) => execFileSync(command, args, { encoding: "utf8", env: { PATH: process.env.PATH, SOURCE_DATE_EPOCH: "315532800" } });
    const outputs = [];
    try {
        for (const name of ["first", "second-longer-checkout-path"]) {
            const workspace = join(temporary, name);
            const packageRoot = join(workspace, "node_modules/.pnpm/fixture@1.0.0/node_modules/fixture");
            const source = join(workspace, "mobile/node_modules/fixture/android");
            const build = join(source, ".cxx/RelWithDebInfo", `${name}-hash`, "x86_64");
            const gradle = join(temporary, `${name}-gradle`);
            const sdk = join(temporary, `${name}-sdk`);
            mkdirSync(join(workspace, "mobile/fdroid"), { recursive: true });
            mkdirSync(join(workspace, "mobile/node_modules"), { recursive: true });
            mkdirSync(join(packageRoot, "android"), { recursive: true });
            symlinkSync("../../node_modules/.pnpm/fixture@1.0.0/node_modules/fixture", join(workspace, "mobile/node_modules/fixture"), "dir");
            for (const directory of [gradle, sdk]) mkdirSync(join(directory, "include"), { recursive: true });
            copyFileSync(new URL("../fdroid/reproducible-native.cmake", import.meta.url), join(workspace, "mobile/fdroid/reproducible-native.cmake"));
            writeFileSync(join(gradle, "include/gradle-fixture.hpp"), 'inline const char *gradleFile() { return __FILE__; }\n');
            writeFileSync(join(sdk, "include/sdk-fixture.hpp"), 'inline const char *sdkFile() { return __FILE__; }\n');
            writeFileSync(join(source, "fixture.cpp"), '#include "gradle-fixture.hpp"\n#include "sdk-fixture.hpp"\nextern "C" const char *sourceFile() { return __FILE__; }\nextern "C" const char *gradlePath() { return gradleFile(); }\nextern "C" const char *sdkPath() { return sdkFile(); }\n');
            const existingPool = name === "first" ? "set(CMAKE_JOB_POOLS existing_pool=3)" : "set_property(GLOBAL PROPERTY JOB_POOLS existing_pool=3)";
            writeFileSync(join(source, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.22)
${existingPool}
project(CryptexNativeMapFixture LANGUAGES CXX)
file(WRITE "\${CMAKE_BINARY_DIR}/generated.cpp" "extern \\"C\\" const char *binaryFile() { return __FILE__; }\\n")
add_library(fixture SHARED fixture.cpp "\${CMAKE_BINARY_DIR}/generated.cpp")
target_include_directories(fixture PRIVATE "\${CRYPTEX_GRADLE_USER_HOME}/include" "\${CRYPTEX_ANDROID_SDK_ROOT}/include")
target_link_options(fixture PRIVATE -Wl,--build-id=sha1)
# Reproduce Quick Crypto's later target maps overriding the directory maps.
get_filename_component(PACKAGE_ROOT "\${CMAKE_CURRENT_SOURCE_DIR}/.." REALPATH)
target_compile_options(fixture PRIVATE
  "-ffile-prefix-map=\${PACKAGE_ROOT}=/src/fixture"
  "-fdebug-prefix-map=\${PACKAGE_ROOT}=/src/fixture"
  "-ffile-prefix-map=\${CMAKE_CURRENT_BINARY_DIR}=/build/CryptexNativeMapFixture"
  "-fdebug-prefix-map=\${CMAKE_CURRENT_BINARY_DIR}=/build/CryptexNativeMapFixture"
)
`);
            run("cmake", ["-G", "Ninja", "-S", source, "-B", build, "-DCMAKE_CXX_COMPILER=clang++", "-DCMAKE_BUILD_TYPE=RelWithDebInfo",
                `-DCMAKE_PROJECT_INCLUDE=${join(workspace, "mobile/fdroid/reproducible-native.cmake")}`,
                `-DCRYPTEX_GRADLE_USER_HOME=${gradle}`, `-DCRYPTEX_ANDROID_SDK_ROOT=${sdk}`]);
            const rules = readFileSync(join(build, "CMakeFiles/rules.ninja"), "utf8");
            for (const [pool, depth] of [["existing_pool", 3], ["cryptex_compile", 2], ["cryptex_link", 1]]) {
                assert.match(rules, new RegExp(`pool ${pool}\\n[ \\t]+depth = ${depth}\\b`));
                assert.equal((rules.match(new RegExp(`^pool ${pool}$`, "gm")) || []).length, 1);
            }
            const ninja = readFileSync(join(build, "build.ninja"), "utf8");
            const compile = ninja.split("build CMakeFiles/fixture.dir/fixture.cpp.o:")[1]?.split(/^build /m)[0];
            const link = ninja.split("build libfixture.so:")[1]?.split(/^build /m)[0];
            assert.match(compile || "", /pool = cryptex_compile/);
            assert.match(link || "", /pool = cryptex_link/);
            run("cmake", ["--build", build]);
            const library = join(build, "libfixture.so");
            for (const object of ["fixture.cpp.o", "generated.cpp.o"]) {
                const compilationDirectories = run("readelf", ["--debug-dump=info", join(build, "CMakeFiles/fixture.dir", object)]).split("\n").filter(line => line.includes("DW_AT_comp_dir"));
                assert.ok(compilationDirectories.length > 0, "Fixture objects must retain real DWARF before link");
                for (const line of compilationDirectories) assert.ok(line.endsWith("/build/CryptexNativeMapFixture"), "A later package map reintroduced the canonical build path: " + line);
            }
            const bytes = readFileSync(library);
            assert.ok(!bytes.includes(Buffer.from(temporary)), "A build path survived in the stripped library");
            assert.ok(bytes.includes(Buffer.from("/build/CryptexNativeMapFixture/generated.cpp")), "Specific binary-directory map did not override workspace mapping");
            outputs.push({ bytes, notes: run("readelf", ["--notes", library]) });
        }
        assert.deepEqual(outputs[0].bytes, outputs[1].bytes);
        assert.equal(outputs[0].notes, outputs[1].notes);
        assert.match(outputs[0].notes, /Build ID:/);
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
});

test("pinned Android two-TU ThinLTO reproduces hash drift and fixes ELF bytes without changing dynamic symbols", { skip: process.platform !== "linux" }, t => {
    const sdk = process.env.CRYPTEX_NATIVE_TEST_SDK;
    if (!sdk) return t.skip("Set CRYPTEX_NATIVE_TEST_SDK to run the pinned Android toolchain fixture");
    const toolchain = JSON.parse(readFileSync(new URL("../fdroid/toolchain.json", import.meta.url), "utf8"));
    const ndk = join(sdk, "ndk", toolchain.ndk);
    const cmake = join(sdk, "cmake", toolchain.cmake, "bin/cmake");
    const llvm = join(ndk, "toolchains/llvm/prebuilt/linux-x86_64/bin");
    assert.match(readFileSync(join(ndk, "source.properties"), "utf8"), new RegExp(`^Pkg\\.Revision = ${toolchain.ndk.replaceAll(".", "\\.")}$`, "m"));
    const run = (command, args) => execFileSync(command, args, { encoding: "utf8", env: { PATH: process.env.PATH, SOURCE_DATE_EPOCH: "315532800" } });
    assert.match(run(cmake, ["--version"]), new RegExp(`^cmake version ${toolchain.cmake.replaceAll(".", "\\.")}\\b`));
    const temporary = mkdtempSync(join(tmpdir(), "cryptex-android-pch-map-test-"));
    const outputs = [];
    const productionMaps = readFileSync(new URL("../fdroid/reproducible-native.cmake", import.meta.url), "utf8");
    const baselineMaps = productionMaps.replace('add_link_options("-Wl,--strip-all")', "");
    assert.notEqual(baselineMaps, productionMaps, "Baseline must omit only production link-time stripping");
    try {
        for (const name of ["first", "second-longer-checkout-path"]) {
            const workspace = join(temporary, name);
            const packageRoot = join(workspace, "node_modules/.pnpm/fixture@1.0.0/node_modules/fixture");
            const source = join(workspace, "mobile/node_modules/fixture/android");
            mkdirSync(join(workspace, "mobile/fdroid"), { recursive: true });
            mkdirSync(join(workspace, "mobile/node_modules"), { recursive: true });
            mkdirSync(join(packageRoot, "android"), { recursive: true });
            symlinkSync("../../node_modules/.pnpm/fixture@1.0.0/node_modules/fixture", join(workspace, "mobile/node_modules/fixture"), "dir");
            copyFileSync(new URL("../fdroid/reproducible-native.cmake", import.meta.url), join(workspace, "mobile/fdroid/reproducible-native.cmake"));
            writeFileSync(join(workspace, "mobile/fdroid/baseline.cmake"), baselineMaps);
            writeFileSync(join(source, "fixture.hpp"), "#pragma once\nint hiddenRead();\nconst char *hiddenText();\n");
            writeFileSync(join(source, "first.cpp"), '#include "fixture.hpp"\nstatic volatile int internalValue = 42;\nstatic const char internalText[] = "retained runtime payload";\nint hiddenRead() { return internalValue; }\nconst char *hiddenText() { return internalText; }\n');
            writeFileSync(join(source, "second.cpp"), '#include "fixture.hpp"\nextern "C" __attribute__((visibility("default"))) int fixtureValue() { return hiddenRead() + hiddenText()[0]; }\nextern "C" __attribute__((visibility("default"))) const char *fixtureText() { return hiddenText(); }\n');
            writeFileSync(join(source, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.22)
project(CryptexPchMapFixture LANGUAGES CXX)
add_library(fixture SHARED first.cpp second.cpp)
target_precompile_headers(fixture PRIVATE "\${CMAKE_CURRENT_SOURCE_DIR}/fixture.hpp")
target_compile_options(fixture PRIVATE -flto=thin -Xclang -fno-pch-timestamp
  -fvisibility=hidden -fstack-protector-all -fno-omit-frame-pointer -D_FORTIFY_SOURCE=2)
target_link_options(fixture PRIVATE -flto=thin -Wl,--build-id=sha1 -Wl,--gc-sections -Wl,--icf=safe)
`);
            const variants = {};
            for (const variant of ["baseline", "production"]) {
                const build = join(source, ".cxx/RelWithDebInfo", `${name}-hash`, variant);
                run(cmake, ["-G", "Ninja", "-S", source, "-B", build,
                    `-DCMAKE_TOOLCHAIN_FILE=${join(ndk, "build/cmake/android.toolchain.cmake")}`,
                    "-DANDROID_ABI=x86_64", "-DANDROID_PLATFORM=android-24", "-DANDROID_STL=none", "-DCMAKE_BUILD_TYPE=RelWithDebInfo",
                    `-DCMAKE_PROJECT_INCLUDE=${join(workspace, "mobile/fdroid", variant === "baseline" ? "baseline.cmake" : "reproducible-native.cmake")}`,
                    `-DCRYPTEX_GRADLE_USER_HOME=${join(workspace, "gradle")}`, `-DCRYPTEX_ANDROID_SDK_ROOT=${sdk}`]);
                const ninja = readFileSync(join(build, "build.ninja"), "utf8");
                for (const flag of ["-flto=thin", "-fno-pch-timestamp", "-fvisibility=hidden", "-fstack-protector-all", "-fno-omit-frame-pointer", "-D_FORTIFY_SOURCE=2", "-fdebug-compilation-dir=/build/CryptexPchMapFixture", "pool = cryptex_compile", "pool = cryptex_link"]) assert.ok(ninja.includes(flag), flag);
                assert.equal(ninja.includes("-Wl,--strip-all"), variant === "production");
                assert.ok(ninja.includes("cmake_pch.hxx.pch"), "Fixture must really build a precompiled header");
                run(cmake, ["--build", build]);
                const library = join(build, "libfixture.so");
                const symbols = run(join(llvm, "llvm-readelf"), ["--symbols", library]);
                const dwarf = run(join(llvm, "llvm-dwarfdump"), ["--debug-info", library]);
                if (variant === "baseline") {
                    assert.match(symbols, /LOCAL\s+HIDDEN.*\.llvm\.\d+/, "Fixture must really promote a local across translation units");
                    const directories = dwarf.split("\n").filter(line => line.includes("DW_AT_comp_dir"));
                    assert.ok(directories.length > 0, "Baseline must retain real DWARF before stripping");
                    for (const line of directories) assert.ok(line.includes("/build/CryptexPchMapFixture"), line);
                } else {
                    assert.doesNotMatch(symbols, /\.llvm\.\d+/);
                    assert.doesNotMatch(dwarf, /DW_TAG_compile_unit/);
                }
                const dynamicSymbols = run(join(llvm, "llvm-readelf"), ["--dyn-syms", library]);
                for (const symbol of ["fixtureValue", "fixtureText"]) assert.match(dynamicSymbols, new RegExp(`GLOBAL\\s+DEFAULT.*\\b${symbol}\\b`));
                assert.doesNotMatch(dynamicSymbols, /hiddenRead|hiddenText|internalValue|internalText/);
                const sectionNames = [".text", ".rodata", ".data", ".eh_frame", ".dynsym", ".dynstr"];
                run(join(llvm, "llvm-objcopy"), [...sectionNames.map(section => `--dump-section=${section}=${join(build, section.slice(1) + ".bin")}`), library, join(build, "inspection.so")]);
                variants[variant] = { bytes: readFileSync(library), dynamicSymbols,
                    runtimeSections: sectionNames.map(section => readFileSync(join(build, section.slice(1) + ".bin"))),
                    notes: run(join(llvm, "llvm-readelf"), ["--notes", library]) };
                assert.match(variants[variant].notes, /Build ID: [a-f0-9]{40}/);
            }
            assert.equal(variants.baseline.dynamicSymbols, variants.production.dynamicSymbols);
            assert.deepEqual(variants.baseline.runtimeSections, variants.production.runtimeSections, "Link-time stripping must not change runtime, unwind, or dynamic symbol bytes");
            outputs.push(variants);
        }
        assert.notDeepEqual(outputs[0].baseline.bytes, outputs[1].baseline.bytes, "Absolute ThinLTO source filenames must reproduce the old failure");
        assert.notEqual(outputs[0].baseline.notes, outputs[1].baseline.notes);
        assert.deepEqual(outputs[0].production.bytes, outputs[1].production.bytes);
        assert.equal(outputs[0].production.notes, outputs[1].production.notes);
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
});

test("reproduction fails on unequal unsigned bytes before invoking external tools", () => {
    const temporary = mkdtempSync(join(tmpdir(), "cryptex-reproduction-test-"));
    try {
        const first = join(temporary, "first.apk");
        const second = join(temporary, "second.apk");
        writeFileSync(first, "first unsigned bytes");
        writeFileSync(second, "different unsigned bytes");
        assert.equal(apkSha256(first).length, 64);
        assert.notEqual(apkSha256(first), apkSha256(second));
        assert.throws(() => verifyReproducibility("missing-signed.apk", first, second), /Independent unsigned APKs differ byte-for-byte/);
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
});

test("reproduction routes profile, custom config and distribution while rejecting ambiguous arguments", () => {
    const selected = reproductionOptions(["reference.apk", "first.apk", "second.apk", "--profile", "preprod", "--config", "public.json", "--offline-services"], "/tmp/caller");
    assert.equal(selected.profile, "preprod");
    assert.equal(selected.configPath, "/tmp/caller/public.json");
    assert.equal(selected.offlineServices, true);
    assert.equal(selected.signed, "/tmp/caller/reference.apk");
    assert.equal(reproductionOptions(["a", "b", "c", "--distribution", "fdroid"]).distribution, "fdroid");
    assert.match(reproductionOptions(["a", "b", "c", "--profile", "preprod"]).configPath, /prerelease-config\.json$/);
    for (const suffix of [["--unsigned"], ["--unknown"], ["--profile"], ["--config", "--offline-services"], ["--config", "a", "--config", "b"], ["--profile", "preprod", "--distribution", "fdroid"]]) {
        assert.throws(() => reproductionOptions(["a", "b", "c", ...suffix]));
    }
    assert.throws(() => reproductionOptions(["a", "b"]), /three|Specify signed/);
});

test("reproduction rejects aliases and the wrong Python before invoking the copier", { skip: process.platform === "win32" }, () => {
    const temporary = mkdtempSync(join(tmpdir(), "cryptex-reproduction-alias-"));
    try {
        const [signed, first, second] = ["signed.apk", "first.apk", "second.apk"].map(name => join(temporary, name));
        writeFileSync(signed, "synthetic bytes");
        copyFileSync(signed, first);
        symlinkSync(first, second);
        assert.throws(() => verifyReproducibility(signed, first, second), /symlink aliases/);
        rmSync(second);
        linkSync(first, second);
        assert.throws(() => verifyReproducibility(signed, first, second), /hard-link aliases/);
        rmSync(second);
        copyFileSync(first, second);
        const python = join(temporary, "python");
        writeFileSync(python, '#!/usr/bin/env node\nif (process.argv[2] !== "--version") throw new Error("Copier must not execute");\nprocess.stdout.write("Python 3.14.7");\n');
        chmodSync(python, 0o700);
        assert.throws(() => verifyReproducibility(signed, first, second, { env: { ...process.env, CRYPTEX_REPRODUCTION_PYTHON: python } }), /Use Python 3\.12\.13/);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("failed build staging survives for inspection, successful staging is removed", () => {
    const staging = mkdtempSync(join(tmpdir(), "cryptex-production-cleanup-test-"));
    const report = join(staging, "verification-report.txt");
    writeFileSync(report, "build failure details");
    try {
        finishStaging(staging, false);
        assert.equal(readFileSync(report, "utf8"), "build failure details");
        finishStaging(staging, true);
        assert.equal(existsSync(staging), false);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
});

test("staged dependencies preserve relative pnpm links and JS build source, not native output", () => {
    const temporary = mkdtempSync(join(tmpdir(), "cryptex-dependency-copy-test-"));
    const original = join(temporary, "original");
    const staging = join(temporary, "staging");
    const packagePath = "node_modules/.pnpm/fixture@1.0.0/node_modules/fixture";
    try {
        for (const directory of ["build", "android/build/intermediates", "android/src/main", ".cxx"]) {
            mkdirSync(join(original, packagePath, directory), { recursive: true });
        }
        writeFileSync(join(original, packagePath, "build/entry.js"), "export const fixture = true;");
        writeFileSync(join(original, packagePath, "android/src/main/source.kt"), "native source");
        writeFileSync(join(original, packagePath, "android/build/intermediates/output.bin"), "stale output");
        writeFileSync(join(original, packagePath, ".cxx/cache.bin"), "stale native cache");
        const plugins = ["node_modules/.pnpm/expo-updates@fixture/node_modules/expo-updates/expo-updates-gradle-plugin", "node_modules/.pnpm/@react-native+gradle-plugin@fixture/node_modules/@react-native/gradle-plugin/react-native-gradle-plugin", "node_modules/.pnpm/@react-native+gradle-plugin@fixture/node_modules/@react-native/gradle-plugin/shared"];
        for (const plugin of plugins) {
            mkdirSync(join(original, plugin, "build/classes"), { recursive: true });
            mkdirSync(join(original, plugin, "src/main"), { recursive: true });
            writeFileSync(join(original, plugin, "build/classes/Compiled.class"), "stale Gradle output");
            writeFileSync(join(original, plugin, "src/main/Plugin.kt"), "plugin source");
        }
        mkdirSync(join(original, "mobile/node_modules"), { recursive: true });
        const target = "../../node_modules/.pnpm/fixture@1.0.0/node_modules/fixture";
        symlinkSync(target, join(original, "mobile/node_modules/fixture"), "dir");
        copyInstalledDependencies(staging, original);
        assert.equal(lstatSync(join(staging, "node_modules")).isSymbolicLink(), false);
        assert.equal(readlinkSync(join(staging, "mobile/node_modules/fixture")), target);
        assert.equal(readFileSync(join(staging, "mobile/node_modules/fixture/build/entry.js"), "utf8"), "export const fixture = true;");
        assert.equal(existsSync(join(staging, packagePath, "android/src/main/source.kt")), true);
        assert.equal(existsSync(join(staging, packagePath, "android/build")), false);
        assert.equal(existsSync(join(staging, packagePath, ".cxx")), false);
        for (const plugin of plugins) {
            assert.equal(existsSync(join(staging, plugin, "build")), false);
            assert.equal(readFileSync(join(staging, plugin, "src/main/Plugin.kt"), "utf8"), "plugin source");
        }
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
});
