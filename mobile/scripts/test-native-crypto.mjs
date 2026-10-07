import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import profileRegistry from "../config/profiles.cjs";

const profile = profileRegistry.getProfile(process.env.CRYPTEX_APP_PROFILE || "production");

const android = fileURLToPath(new URL("../android/", import.meta.url));
const serial = process.env.ANDROID_SERIAL || process.env.MAESTRO_DEVICE;
if (!serial || !serial.trim() || serial.trim() !== serial ||
    serial === process.env.CRYPTEX_E2E_PROTECTED_DEVICE) {
    throw new Error("Select an explicit unprotected device with ANDROID_SERIAL or MAESTRO_DEVICE.");
}
const device = ["-s", serial];
const adb = (...args) =>
    execFileSync("adb", [...device, ...args], { encoding: "utf8" });
const abi = adb("shell", "getprop", "ro.product.cpu.abi").trim();
assert.ok(["x86_64", "arm64-v8a", "x86", "armeabi-v7a"].includes(abi));
const build = spawnSync(
    "./gradlew",
    [
        // Dependency patches can change Metro inputs without Gradle noticing.
        // Refresh only the test entry's JS bundle, not every native build task.
        ":app:createBundleE2eJsAndAssets",
        "--rerun",
        ":app:assembleE2e",
        `-PreactNativeArchitectures=${abi}`,
        "-I",
        "../tests/native-crypto.init.gradle",
        "--console=plain",
    ],
    {
        cwd: android,
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "production", EXPO_NO_DOTENV: "1" },
    },
);
assert.equal(build.status, 0, "Native crypto test APK build failed");
adb(
    "install",
    "-r",
    "-t",
    `${android}/app/build/outputs/apk/e2e/app-e2e.apk`,
);
const app = "com.cryptex.vault.cryptotest";
let executionFailure;
let cleanupFailure;
try {
    adb("shell", "am", "force-stop", app);
    // Logcat timestamps prevent a previous successful run from satisfying this run.
    const since = adb("shell", "date '+%m-%d %H:%M:%S.000'").trim();
    adb("shell", "am", "start", "-n", `${app}/${profile.applicationId}.MainActivity`);
    let result;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        const pidResult = spawnSync("adb", [...device, "shell", "pidof", app], {
            encoding: "utf8",
        });
        const pid = pidResult.stdout?.trim();
        if (!pid) {
            await setTimeout(1000);
            continue;
        }
        assert.match(pid, /^\d+$/);
        const log = adb(
            "logcat",
            "-d",
            "-T",
            since,
            `--pid=${pid}`,
            "ReactNativeJS:I",
            "AndroidRuntime:E",
            "*:S",
        );
        assert.ok(!log.includes("FATAL EXCEPTION"), log);
        assert.ok(!log.includes("CRYPTEX_CRYPTO_FAILURE"), log);
        const match = log.match(/CRYPTEX_CRYPTO_RESULT (\{[^\n]+\})/);
        if (match) {
            result = JSON.parse(match[1]);
            break;
        }
        await setTimeout(1000);
    }
    assert.ok(result, "Native crypto tests did not finish within 120 seconds");
    assert.deepEqual(result.webrtc, {
        rounds: 2, applicationOnly: true, immediateHellos: 2, textMessages: 18,
        binaryBytes: 4 * (128 * 1024 + 17 + 9), largeMessageBytes: 128 * 1024 + 17,
    }, "Native bidirectional WebRTC/reconnect regression did not finish");
    for (const coordinate of [result.publicJwk.x, result.publicJwk.y]) {
        assert.match(
            coordinate,
            /^[A-Za-z0-9_-]+$/,
            "Native JWK must use unpadded base64url",
        );
    }
    const key = await webcrypto.subtle.importKey(
        "jwk",
        result.publicJwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
    );
    assert.ok(
        await webcrypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            key,
            Buffer.from(result.signature, "hex"),
            new TextEncoder().encode("public signature fixture"),
        ),
        "Node rejected the native passkey signature",
    );
} catch (error) {
    executionFailure = error;
} finally {
    try {
        // Its inherited cryptex:// filter would otherwise pollute later app journeys.
        adb("uninstall", app);
    } catch (error) {
        cleanupFailure = error;
        if (executionFailure) {
            console.error("Isolated crypto test package cleanup also failed:", error.message);
        }
    }
}
if (executionFailure) throw executionFailure;
if (cleanupFailure) {
    throw new Error("Isolated crypto test package cleanup failed", { cause: cleanupFailure });
}
console.log(
    "Native crypto compatibility, vault/recovery/link, key restrictions, failure handling, Node signatures and bidirectional WebRTC text/binary/large-message/reconnect tests passed.",
);
