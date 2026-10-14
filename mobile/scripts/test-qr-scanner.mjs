import "./qr-scanner-fixtures.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const android = fileURLToPath(new URL("../android/", import.meta.url));
const gradle = process.env.CRYPTEX_GRADLE_COMMAND || (process.platform === "win32" ? "gradlew.bat" : "./gradlew");
if (process.env.CRYPTEX_GRADLE_COMMAND) {
    const toolchain = JSON.parse(readFileSync(new URL("../fdroid/toolchain.json", import.meta.url), "utf8"));
    assert.match(execFileSync(gradle, ["--version"], { encoding: "utf8" }),
        new RegExp(`^Gradle ${toolchain.gradle.replaceAll(".", "\\.")}$`, "m"), "Use the pinned Gradle version");
}
const run = args => {
    const result = spawnSync(gradle, [...args, "--console=plain"], {
        cwd: android, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "QR verification Gradle task failed");
    return result.stdout;
};

run([
    ":expo-camera:testReleaseUnitTest", ":app:processReleaseMainManifest",
    `-PcryptexQrFixtures=${resolve(android, "build/qr-scanner-fixtures.bin")}`,
]);
const tests = readFileSync(resolve(android,
    "../node_modules/expo-camera/android/build/test-results/testReleaseUnitTest/TEST-expo.modules.camera.analyzers.BarcodeAnalyzerTest.xml"), "utf8");
assert.match(tests, /tests="5"/, "Expected all five native QR tests to run");
for (const attribute of ["skipped", "failures", "errors"]) {
    assert.match(tests, new RegExp(`${attribute}="0"`), `Native QR tests reported ${attribute}`);
}
// Gradle's dependency report may exit successfully even with unresolved dependencies.
const forbidden = /com\.google\.mlkit:|com\.google\.android\.gms:play-services-(?:code-scanner|mlkit[^:\s]*)|androidx\.camera:camera-mlkit-vision|host\.exp\.exponent:expo\.modules\.camera/;
for (const [project, configuration] of [
    [":app", "releaseRuntimeClasspath"],
    [":app", "releaseCompileClasspath"],
    [":expo-camera", "releaseCompileClasspath"],
]) {
    const report = run([`${project}:dependencies`, "--configuration", configuration]);
    assert.doesNotMatch(report, /\bFAILED\b/, "Unresolved dependencies invalidate this audit");
    assert.doesNotMatch(report, forbidden, "Proprietary or unpatched camera dependency returned");
    if (project === ":app") {
        assert.match(report, /project :expo-camera\b/, "Camera must compile from patched source");
    }
    if (configuration === "releaseRuntimeClasspath" || project === ":expo-camera") {
        assert.match(report, /com\.google\.zxing:core:3\.5\.3(?:\s|$)/, "Pinned ZXing dependency missing");
        assert.doesNotMatch(report, /com\.google\.zxing:core:3\.5\.3 ->/, "ZXing version was overridden");
    }
}
const manifest = readFileSync(resolve(android,
    "app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml"), "utf8");
assert.doesNotMatch(manifest, /com\.google\.mlkit|com\.google\.android\.gms\.(?:mlkit|vision|codescanner)/);
console.log("QR native tests, source linkage, dependency audit and merged manifest passed.");
