import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadReleaseConfig, parseReleaseOptions, validateReleaseConfig, getProfile, configHash, selectedArchitectures } from "./release-config.mjs";
import ota from "../config/ota.cjs";

const mobile = fileURLToPath(new URL("../", import.meta.url));

export { loadReleaseConfig } from "./release-config.mjs";

export function releaseVerificationOptions(args, cwd = process.cwd()) {
    return parseReleaseOptions(args, { cwd, allowApk: true });
}

export function assertEmbeddedUpdate(manifest) {
    assert.match(manifest?.id ?? "", /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/, "Embedded update UUID must be canonical.");
    assert.ok(Number.isSafeInteger(manifest.commitTime) && manifest.commitTime >= 0 && manifest.commitTime <= 8640000000000000, "Embedded update commitTime must be an exact Date-range millisecond integer.");
    return { id: manifest.id, commitTime: manifest.commitTime };
}

export function xmlResourcePath(resources, name) {
    assert.match(name, /^[a-z0-9_]+$/, "Invalid reviewed XML resource name");
    const headers = [...resources.matchAll(new RegExp(`^[ \\t]*resource 0x[0-9a-f]+ xml/${name}(?:[ \\t]|$)`, "gm"))];
    assert.equal(headers.length, 1, `Missing or ambiguous reviewed XML resource: ${name}`);
    const block = resources.slice(headers[0].index + headers[0][0].length).split(/^[ \t]*resource\b/m)[0];
    const paths = [...block.matchAll(/^[ \t]*\([^\r\n)]*\) \(file\) ([^\r\n]+?) type=XML[ \t]*$/gm)];
    assert.equal(paths.length, 1, `Missing or ambiguous compiled XML file: ${name}`);
    const path = paths[0][1];
    assert.match(path, /^res\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.xml$/, `Unsafe compiled XML file path: ${name}`);
    return path;
}

export function assertProductionManifest(manifest, { profile = "production", version = (() => {
    const app = JSON.parse(readFileSync(join(mobile, "app.json"), "utf8")).expo;
    return { name: app.version, code: app.android.versionCode };
})() } = {}) {
    assert.match(manifest, new RegExp(`A: package="${getProfile(profile).applicationId.replaceAll(".", "\\.")}"`), "Wrong application profile ID");
    const versionName = manifest.match(/:versionName\([^)]*\)="([^"\n]+)"/)?.[1];
    const versionCode = manifest.match(/:versionCode\([^)]*\)=((?:0x)?[a-f0-9]+)\b/i)?.[1];
    assert.equal(versionName, version.name, "Wrong production version or E2E suffix");
    assert.equal(Number(versionCode), version.code, "Wrong production version code");
    assert.doesNotMatch(manifest, /:(?:debuggable|testOnly)\([^)]*\)=(?:true|0xffffffff|0x1)\b/i, "Debuggable/test-only APK cannot be published");
    assert.doesNotMatch(manifest, /cryptotest|ClipboardTestActivity|AutofillTestActivity|com\.cryptex\.autofillfixture/, "Test component in production manifest");
    const application = manifest.split(/^[ \t]*E: application\b/m)[1]?.split(/^[ \t]*E:/m)[0];
    assert.ok(application, "Application manifest section missing");
    assert.match(application, /:allowBackup\([^)]*\)=false\b/, "Operating-system backup must be disabled");
    // A child metadata/intent-filter attribute cannot satisfy component policy.
    const components = manifest.split(/(?=^[ \t]*E: (?:activity|service|receiver|provider)\b)/m)
        .slice(1).map(block => block.split("\n").slice(1).join("\n").split(/^[ \t]*E:/m)[0]);
    const namedComponent = name => {
        const nameAttribute = new RegExp(`^[ \\t]*A: [^\\s"=]*:name\\(0x01010003\\)="${name.replaceAll(".", "\\.")}"(?:[ \\t]|$)`, "m");
        const component = components.find(block => nameAttribute.test(block));
        assert.ok(component, `Missing security-sensitive component: ${name}`);
        return component;
    };
    const relay = namedComponent("com.cryptex.vault.credentials.CredentialRequestActivity");
    assert.match(relay, /:exported\([^)]*\)=false\b/, "Credential relay must not be exported");
    assert.match(relay, /:excludeFromRecents\([^)]*\)=true\b/, "Credential relay must not appear in recents");
    for (const [name, permission] of [
        ["CryptexAutofillService", "BIND_AUTOFILL_SERVICE"],
        ["CryptexAccessibilityService", "BIND_ACCESSIBILITY_SERVICE"],
        ["CryptexCredentialProviderService", "BIND_CREDENTIAL_PROVIDER_SERVICE"],
    ]) {
        const component = namedComponent(`com.cryptex.vault.credentials.${name}`);
        assert.match(component, /:exported\([^)]*\)=true\b/, `${name} must remain available to Android`);
        assert.match(component, new RegExp(`^[ \\t]*A: [^\\s"=]*:permission\\(0x01010006\\)="android\\.permission\\.${permission}"(?:[ \\t]|$)`, "m"), `${name} lost its framework binding permission`);
    }
}

export function assertUpdatesPolicy(manifest, resources, expected, { fingerprintAsset } = {}) {
    const application = manifest.match(/^([ \t]*)E: application\b/m);
    assert.ok(application, "Missing application for OTA policy verification.");
    const applicationIndent = application[1].length;
    const metadata = new Map();
    const lines = manifest.slice(application.index).split("\n");
    const endOfApplication = lines.findIndex((line, index) => index > 0 && /^\s*E:/.test(line) && line.match(/^\s*/)[0].length <= applicationIndent);
    if (endOfApplication !== -1) lines.splice(endOfApplication);
    const childDepths = lines.slice(1).filter(line => /^\s*E:/.test(line)).map(line => line.match(/^\s*/)[0].length);
    const childIndent = " ".repeat(Math.min(...childDepths));
    for (let index = 1; index < lines.length; index++) {
        if (/^\s*E:/.test(lines[index]) && !lines[index].startsWith(childIndent)) break;
        if (!lines[index].startsWith(`${childIndent}E: meta-data`)) continue;
        let end = index + 1;
        while (end < lines.length && !(lines[end].startsWith(`${childIndent}E:`))) end++;
        const block = lines.slice(index, end).join("\n");
        const name = block.match(/:name\([^)]*\)="([^"\n]+)"/)?.[1];
        if (!name?.startsWith("expo.modules.updates.")) continue;
        assert.ok(!metadata.has(name), "Duplicate OTA manifest metadata.");
        metadata.set(name, block.match(/:value\([^)]*\)=([^\n]+)/)?.[1]?.trim());
    }
    const read = name => {
        const value = metadata.get(`expo.modules.updates.${name}`);
        if (!value) return undefined;
        if (value.startsWith("@0x")) {
            const id = value.slice(1).split(/\s/)[0];
            const header = resources.match(new RegExp(`^[ \\t]*resource ${id} string/[^\\n]+\\n`, "m"));
            assert.ok(header, `Missing OTA string resource ${name}`);
            const block = resources.slice(header.index + header[0].length).split(/^[ \t]*resource\b/m)[0];
            const strings = [...block.matchAll(/^[ \t]*\([^\r\n)]*\) ("[^\r\n]*")[ \t]*$/gm)].map(match => match[1]);
            assert.equal(new Set(strings).size, 1, `Ambiguous OTA resource ${name}`);
            return decodeString(strings[0]);
        }
        return value.startsWith('"') ? decodeString(value.split(" (Raw: ")[0]) : value;
    };
    const decodeString = value => {
        assert.ok(value?.startsWith('"') && value.endsWith('"'), "Malformed AAPT2 string value.");
        try { return JSON.parse(value); } catch { return value.slice(1, -1); }
    };
    assert.match(read("ENABLED") || "", expected.enabled ? /^(?:true|0xffffffff|0x1)$/ : /^(?:false|0x0)$/,
        "Compiled OTA enabled policy differs from the selected distribution.");
    const configuredRuntime = read("EXPO_RUNTIME_VERSION");
    // SDK 57 reads this exact sentinel from the packaged assets/fingerprint file.
    const runtimeVersion = configuredRuntime === "file:fingerprint" ? fingerprintAsset : configuredRuntime;
    assert.match(runtimeVersion || "", /^[a-f0-9]{40,64}$/, "Missing or malformed packaged fingerprint runtime version.");
    assert.ok(!/^(?:true|0xffffffff|0x1)$/.test(read("DISABLE_ANTI_BRICKING_MEASURES") || ""), "OTA anti-bricking measures must remain enabled.");
    if (!expected.enabled) {
        assert.equal(read("EXPO_UPDATES_CHECK_ON_LAUNCH"), "NEVER", "Disabled OTA must not check for updates.");
        for (const name of ["EXPO_UPDATE_URL", "UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY", "CODE_SIGNING_CERTIFICATE", "CODE_SIGNING_METADATA"])
            assert.equal(read(name), undefined, `Disabled OTA must not retain ${name}.`);
        return { runtimeVersion, otaSigned: false, otaChannel: null, otaUpdateUrl: null };
    }
    assert.equal(read("EXPO_UPDATE_URL"), expected.url, "Wrong hosted EAS update URL.");
    assert.deepEqual(JSON.parse(read("UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY")), expected.requestHeaders, "Wrong OTA channel.");
    if (expected.codeSigningCertificate) {
        assert.deepEqual(JSON.parse(read("CODE_SIGNING_METADATA")), expected.codeSigningMetadata, "Wrong OTA signing key metadata.");
        const actualCert = new X509Certificate(read("CODE_SIGNING_CERTIFICATE"));
        const approvedCert = new X509Certificate(readFileSync(expected.codeSigningCertificate));
        assert.deepEqual(actualCert.raw, approvedCert.raw, "Compiled OTA certificate differs from its approved profile pin.");
    } else {
        assert.equal(read("CODE_SIGNING_CERTIFICATE"), undefined, "Unsigned OTA policy must not retain a signing certificate.");
        assert.equal(read("CODE_SIGNING_METADATA"), undefined, "Unsigned OTA policy must not retain signing metadata.");
    }
    return { runtimeVersion, otaSigned: Boolean(expected.codeSigningCertificate),
        otaChannel: JSON.parse(read("UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY"))["expo-channel-name"],
        otaUpdateUrl: read("EXPO_UPDATE_URL") };
}

export function assertNetworkPolicy(manifest, resources, policy) {
    const id = resources.match(/resource (0x[0-9a-f]+) xml\/network_security_config\b/)?.[1];
    assert.ok(id, "Missing production network-security resource");
    const application = manifest.split(/^[ \t]*E: application\b/m)[1]?.split(/^[ \t]*E:/m)[0];
    assert.ok(application, "Application manifest section missing");
    assert.match(application, new RegExp(`:networkSecurityConfig\\([^)]*\\)=@${id}\\b`), "Application does not reference the reviewed network policy");
    assert.match(policy, /cleartextTrafficPermitted=false/, "Production network policy must prohibit cleartext");
    assert.doesNotMatch(policy, /cleartextTrafficPermitted=true|localhost|127\.0\.0\.1/, "Development cleartext exception in production APK");
}

export function assertBackupResources(manifest, resources, backup, extraction) {
    const application = manifest.split(/^[ \t]*E: application\b/m)[1]?.split(/^[ \t]*E:/m)[0];
    assert.ok(application, "Application manifest section missing");
    for (const [attribute, name] of [["fullBackupContent", "cryptex_no_backup_rules"], ["dataExtractionRules", "cryptex_no_data_extraction_rules"]]) {
        const id = resources.match(new RegExp(`resource (0x[0-9a-f]+) xml/${name}\\b`))?.[1];
        assert.ok(id, `Missing ${name} resource`);
        assert.match(application, new RegExp(`:${attribute}\\([^)]*\\)=@${id}\\b`), `${attribute} does not reference the reviewed backup exclusions`);
    }
    const domains = ["root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"];
    const excludesEveryDomain = dump => {
        assert.doesNotMatch(dump, /^\s*E: include\b/m, "Backup rules must not include application data");
        const exclusions = dump.split(/(?=^\s*E: exclude\b)/m);
        for (const domain of domains) {
            assert.ok(exclusions.some(block => block.includes(`domain="${domain}"`) && block.includes('path="."')), `Backup domain ${domain} is not fully excluded`);
        }
    };
    assert.match(backup, /E: full-backup-content\b/);
    excludesEveryDomain(backup);
    assert.match(extraction, /E: data-extraction-rules\b/);
    for (const section of ["cloud-backup", "device-transfer"]) {
        const block = extraction.split(new RegExp(`^\\s*E: ${section}\\b`, "m"))[1]?.split(/^\s*E: (?:cloud-backup|device-transfer)\b/m)[0];
        assert.ok(block, `Missing ${section} backup exclusions`);
        excludesEveryDomain(block);
    }
}

export function assertProductionSignature(report, identity) {
    const certificate = new X509Certificate(Buffer.from(identity.certificateDerBase64, "base64"));
    const fingerprint = createHash("sha256").update(certificate.raw).digest("hex");
    assert.equal(fingerprint, identity.certificateSha256, "Public signing certificate metadata is inconsistent");
    const signers = [...report.matchAll(/^Signer #(\d+) certificate SHA-256 digest: ([a-f0-9]+)$/gm)];
    assert.equal(signers.length, 1, "Publication APK must have one expected signer");
    assert.equal(signers[0][2], fingerprint, "APK is signed by an unapproved identity");
    assert.doesNotMatch(report, /CN=Android Debug/i, "Debug-signed APK cannot be published");
}

export function verifyRelease(apk, { unsigned = false, offlineServices = false, profile = "production", distribution = "standard", arch = "all", env = process.env,
    config = loadReleaseConfig(join(mobile, getProfile(profile).configFile)) } = {}) {
    validateReleaseConfig(config);
    const inspectionEnv = { ...env };
    for (const name of ["CRYPTEX_KEYSTORE", "CRYPTEX_KEYSTORE_PASSWORD", "CRYPTEX_KEY_ALIAS", "CRYPTEX_KEY_PASSWORD"]) delete inspectionEnv[name];
    const toolchain = JSON.parse(readFileSync(join(mobile, "fdroid/toolchain.json"), "utf8"));
    const identity = JSON.parse(readFileSync(join(mobile, getProfile(profile).signingIdentityFile), "utf8"));
    const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
    assert.ok(sdk, "Set ANDROID_HOME to verify the APK");
    const tools = join(sdk, "build-tools", toolchain.buildTools);
    const manifest = execFileSync(join(tools, "aapt2"), ["dump", "xmltree", apk, "--file", "AndroidManifest.xml"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: inspectionEnv });
    assertProductionManifest(manifest, { profile });
    const resources = execFileSync(join(tools, "aapt2"), ["dump", "resources", apk], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: inspectionEnv });
    const entries = execFileSync("unzip", ["-Z1", apk], { encoding: "utf8", env: inspectionEnv }).trim().split("\n");
    const asset = (entry, maxBuffer = 32 * 1024 * 1024) => execFileSync("unzip", ["-p", apk, entry], { maxBuffer, env: inspectionEnv });
    const fingerprints = entries.filter(entry => entry === "assets/fingerprint");
    assert.ok(fingerprints.length <= 1, "Duplicate packaged fingerprint asset.");
    const fingerprintAsset = fingerprints.length ? asset("assets/fingerprint", 1024).toString("utf8") : undefined;
    const updates = assertUpdatesPolicy(manifest, resources, ota.requireOtaConfiguration(profile, { distribution, signingEnabled: config.EXPO_PUBLIC_OTA_SIGNING_ENABLED ?? "false" }).updates, { fingerprintAsset });
    // Release resource shrinking can rename files, while their reviewed resource names/IDs remain.
    const dumpXml = name => execFileSync(join(tools, "aapt2"), ["dump", "xmltree", apk, "--file", xmlResourcePath(resources, name)], { encoding: "utf8", env: inspectionEnv });
    assertBackupResources(manifest, resources, dumpXml("cryptex_no_backup_rules"), dumpXml("cryptex_no_data_extraction_rules"));
    const networkPolicy = dumpXml("network_security_config");
    assertNetworkPolicy(manifest, resources, networkPolicy);
    const metadata = JSON.parse(asset("assets/cryptex-release.json").toString("utf8"));
    assert.equal(entries.filter(entry => entry === "assets/app.manifest").length, 1, "Missing or duplicate embedded update manifest.");
    const embeddedUpdate = assertEmbeddedUpdate(JSON.parse(asset("assets/app.manifest").toString("utf8")));
    const app = JSON.parse(readFileSync(join(mobile, "app.json"), "utf8")).expo;
    assert.deepEqual(metadata, { ...metadata, profile, buildProfile: "production", distribution, applicationId: getProfile(profile).applicationId,
        version: { name: app.version, code: app.android.versionCode }, configHash: configHash(config),
        signer: { alias: identity.alias, certificateSha256: identity.certificateSha256 },
        e2e: false, onlineServicesEnabled: !offlineServices, appUrl: config.EXPO_PUBLIC_APP_URL,
        apiUrl: config.EXPO_PUBLIC_ONLINE_SERVICES_API_URL, toolchain }, "Production build configuration mismatch");
    assert.match(metadata.sourceRevision?.commit || "", /^[a-f0-9]{40}$/i, "Missing build source revision.");
    assert.equal(typeof metadata.sourceRevision?.dirty, "boolean", "Missing source snapshot dirty marker.");
    const bundle = asset("assets/index.android.bundle");
    for (const marker of ["CRYPTEX_CRYPTO_RESULT", "CRYPTEX_CRYPTO_FAILURE", "CRYPTEX_WEBRTC_ROUND", "com.cryptex.vault.cryptotest", `${getProfile(profile).applicationId}.cryptotest`]) {
        assert.ok(!bundle.includes(Buffer.from(marker)), `Test entry point in production APK: ${marker}`);
    }
    if (!offlineServices) {
        for (const name of ["EXPO_PUBLIC_APP_URL", "EXPO_PUBLIC_ONLINE_SERVICES_API_URL", "EXPO_PUBLIC_PUSHER_APP_HOST"]) {
            assert.ok(bundle.includes(Buffer.from(config[name])), `${name} absent from production bundle`);
        }
    }
    for (const entry of entries.filter(entry => /^classes\d*\.dex$/.test(entry))) {
        const dex = asset(entry, 64 * 1024 * 1024);
        assert.ok(!dex.includes(Buffer.from("ClipboardTestActivity")), "Native test activity in production APK");
    }
    const abis = [...new Set(entries.filter(entry => /^lib\/[^/]+\/.*\.so$/.test(entry)).map(entry => entry.split("/")[1]))].sort();
    assert.deepEqual(abis, selectedArchitectures(arch).sort(), "APK architectures differ from the requested release target");
    const signature = spawnSync(join(tools, "apksigner"), ["verify", "--verbose", "--print-certs", apk], { encoding: "utf8", env: inspectionEnv });
    if (signature.error) throw signature.error;
    if (unsigned) {
        assert.equal(signature.status, 1, "Unsigned source APK must fail signature verification normally, not through a tool failure");
        assert.ok(!entries.some(entry => /^META-INF\/[^/]+\.(?:RSA|DSA|EC|SF)$/.test(entry)), "Unexpected v1 signature in unsigned APK");
        assert.ok(!readFileSync(apk).includes(Buffer.from("APK Sig Block 42")), "Unexpected APK signing block in unsigned APK");
    } else {
        assert.equal(signature.status, 0, `APK signature verification failed: ${signature.stderr}`);
        assertProductionSignature(signature.stdout, identity);
    }
    console.log(`Release policy passed: ${unsigned ? "unsigned source APK" : "approved release signer"}, Online Services ${offlineServices ? "disabled explicitly" : "enabled"}, no test entry points.`);
    return { ...updates, embeddedUpdate, sourceRevision: metadata.sourceRevision };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const { apk, configPath, ...options } = releaseVerificationOptions(process.argv.slice(2));
        verifyRelease(apk, { ...options, config: loadReleaseConfig(configPath) });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
