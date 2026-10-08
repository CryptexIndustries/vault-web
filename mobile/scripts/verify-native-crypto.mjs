import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import profileRegistry from "../config/profiles.cjs";

for (const name of ["CRYPTEX_KEYSTORE", "CRYPTEX_KEYSTORE_PASSWORD", "CRYPTEX_KEY_ALIAS", "CRYPTEX_KEY_PASSWORD"]) delete process.env[name];

const mobile = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
assert.ok(!args.length || (args.length === 2 && args[0] === "--apk" && !args[1].startsWith("-")),
    "Usage: verify-native-crypto.mjs [--apk <path>]");
const profile = profileRegistry.getProfile(process.env.CRYPTEX_APP_PROFILE || "production");
const apk = args.length ? resolve(args[1]) : join(mobile, "dist", `${profile.artifactBase}.apk`);
const gradle = process.env.CRYPTEX_GRADLE_COMMAND || "./gradlew";
if (process.env.CRYPTEX_GRADLE_COMMAND) {
    const toolchain = JSON.parse(readFileSync(join(mobile, "fdroid/toolchain.json"), "utf8"));
    assert.match(execFileSync(gradle, ["--version"], { cwd: join(mobile, "android"), encoding: "utf8" }),
        new RegExp(`^Gradle ${toolchain.gradle.replaceAll(".", "\\.")}$`, "m"), "Use the pinned Gradle version");
}
for (const [name, version] of Object.entries({
    "react-native-quick-crypto": "1.1.7",
    "react-native-quick-base64": "3.0.1",
    "react-native-nitro-modules": "0.33.2",
})) {
    const manifest = JSON.parse(
        readFileSync(join(mobile, "node_modules", name, "package.json")),
    );
    assert.equal(
        manifest.version,
        version,
        `Review ${name} before changing its approved version`,
    );
}
const report = execFileSync(
    gradle,
    [
        ":app:dependencies",
        "--configuration",
        "releaseRuntimeClasspath",
        "--console=plain",
    ],
    {
        cwd: join(mobile, "android"),
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
    },
);
assert.doesNotMatch(
    report,
    /\bFAILED\b|[^\s:]+:openssl[^\s:]*:/i,
    "OpenSSL must compile from verified source",
);
assert.match(report, /project :react-native-quick-crypto\b/);
assert.doesNotMatch(
    report,
    /project :[\w-]*sodium\b|[\w.-]+:[\w.-]*sodium[\w.-]*:/i,
    "Native libsodium must not return",
);
const entries = execFileSync("unzip", ["-Z1", apk], { encoding: "utf8" })
    .trim()
    .split("\n");
// Direct Maven Central android-150.7871.01.aar, reviewed 2026-09-30.
// NDK 27.1 llvm-strip --strip-unneeded leaves these provider ELFs unchanged.
const webrtcHashes = {
    "arm64-v8a": "7b299113fcd743de7dc5559686b21fc2681b2c8598347d8dc0743d2e004995ca",
    "armeabi-v7a": "762f3d5e1c4c69c3f02f2383540f40e1142cb631e9d99e86bdb1602f4c277559",
    x86: "80e7b1b7e07bb5a53841a8cacabf942a6f3eb8ee9759a1731741dd912f367f19",
    x86_64: "0717afcc43da0c1aabd904f9ef0653efc8f3d37b5750f39a123697e7910b623a",
};
assert.deepEqual(
    entries.filter((entry) => /^lib\/[^/]+\/libjingle_peerconnection_so\.so$/.test(entry)).sort(),
    Object.keys(webrtcHashes).map((abi) => `lib/${abi}/libjingle_peerconnection_so.so`).sort(),
    "Publication APK must contain the reviewed WebRTC provider for all four ABIs",
);
for (const [abi, expected] of Object.entries(webrtcHashes)) {
    const entry = `lib/${abi}/libjingle_peerconnection_so.so`;
    const binary = execFileSync("unzip", ["-p", apk, entry], { maxBuffer: 32 * 1024 * 1024 });
    assert.equal(createHash("sha256").update(binary).digest("hex"), expected,
        `${entry}: expected WebRTC 150.7871.01 from the reviewed Maven artifact`);
    console.log(`${entry}: reviewed WebRTC 150.7871.01`);
}
const notices = execFileSync("unzip", ["-p", apk, "assets/licenses/webrtc-150.7871.01.txt"], {
    maxBuffer: 2 * 1024 * 1024,
});
assert.equal(createHash("sha256").update(notices).digest("hex"),
    "d1f9382c6878ac024155fd6d44a5977329108bb8b0a01cea40e4a2f1d7de252e",
    "Publication APK must include the reviewed upstream WebRTC redistribution notices");
assert.ok(
    !entries.some((p) => /^lib\/[^/]+\/[^/]*sodium[^/]*\.so$/i.test(p)),
    "Unexpected native libsodium in APK",
);
assert.ok(
    !entries.some((p) => /\/lib(?:crypto|ssl)\.so$/.test(p)),
    "Unexpected shared OpenSSL in APK",
);
const libraries = entries.filter((p) =>
    /^lib\/[^/]+\/libQuickCrypto\.so$/.test(p),
);
assert.deepEqual(
    libraries.map((p) => p.split("/")[1]).sort(),
    ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"].sort(),
    "Publication APK must include all four audited ABIs",
);
const bundle = execFileSync(
    "unzip",
    ["-p", apk, "assets/index.android.bundle"],
    {
        maxBuffer: 32 * 1024 * 1024,
    },
);
assert.ok(
    !bundle.includes(Buffer.from("CRYPTEX_CRYPTO_RESULT")),
    "Test entry point in publication APK",
);
const temporary = mkdtempSync(join(tmpdir(), "cryptex-crypto-audit-"));
try {
    for (const entry of libraries) {
        const binary = execFileSync("unzip", ["-p", apk, entry], {
            maxBuffer: 32 * 1024 * 1024,
        });
        assert.ok(
            binary.includes(Buffer.from("OpenSSL 3.5.8 ")),
            `${entry}: wrong OpenSSL version`,
        );
        const path = join(temporary, "libQuickCrypto.so");
        writeFileSync(path, binary);
        const dynamic = execFileSync("readelf", ["-dW", path], {
            encoding: "utf8",
        });
        assert.doesNotMatch(
            dynamic,
            /NEEDED.*lib(?:crypto|ssl)\.so/,
            "OpenSSL must be statically linked",
        );
        const symbols = execFileSync("readelf", ["--dyn-syms", "-W", path], {
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
        });
        assert.doesNotMatch(
            symbols,
            /\b(?:GLOBAL|WEAK)\s+DEFAULT\s+\S+\s+(?:OPENSSL_|OpenSSL_|OSSL_|EVP_|SSL_|CRYPTO_)/,
            "OpenSSL symbols must remain private to QuickCrypto",
        );
        console.log(`${entry}: OpenSSL 3.5.8, static linkage, private symbols`);
    }
} finally {
    rmSync(temporary, { recursive: true, force: true });
}
