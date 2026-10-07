import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { flows, requireAndroid, runMobile } from "./mobile.mjs";

const mobile = fileURLToPath(new URL("../", import.meta.url));
function capture(args, env = {}) {
    const calls = [];
    runMobile(args, { env, checkAndroid: () => {}, checkNativeIdentity: () => {}, run: (...parameters) => {
        calls.push(parameters);
        return { status: 0 };
    } });
    return calls;
}

test("production build defaults to the signed production helper from mobile cwd", () => {
    const [[binary, args, options]] = capture(["build"], { EXPO_PUBLIC_CRYPTEX_E2E: "1" });
    assert.equal(binary, process.execPath);
    assert.deepEqual(args, ["scripts/build-android.mjs"]);
    assert.equal(options.cwd, mobile);
});

test("production flags forward exactly without accepting arbitrary build flags", () => {
    assert.deepEqual(capture(["build", "--", "--unsigned", "--offline-services"])[0][1],
        ["scripts/build-android.mjs", "--unsigned", "--offline-services"]);
    for (const args of [["--prod"], ["--unsigned", "--unsigned"], ["--dev", "--unsigned"], ["--e2e", "--offline-services"], ["--dev", "--e2e"],
        ["--config"], ["--config", " "], ["--config", "--unsigned"], ["--config", "first.json", "--config", "second.json"],
        ["--dev", "--config", "preprod.json"], ["--e2e", "--config", "preprod.json"]]) {
        assert.throws(() => capture(["build", ...args]));
    }
});

test("custom production JSON resolves before the child switches to mobile cwd", () => {
    for (const caller of [undefined, "/tmp/cryptex-build-caller"]) {
        const [[, args, options]] = capture(["build", "--config", "configs/preprod.json", "--unsigned"], caller ? { INIT_CWD: caller } : {});
        assert.deepEqual(args, ["scripts/build-android.mjs", "--config", resolve(caller || process.cwd(), "configs/preprod.json"), "--unsigned"]);
        assert.equal(options.cwd, mobile);
    }
});

test("reproduction resolves its reference in the caller directory and rejects ambiguous build modes", () => {
    const [[, args]] = capture(["build", "--reproduce-from", "releases/original.apk", "--profile", "preprod", "--config", "public.json"], { INIT_CWD: "/tmp/caller" });
    assert.deepEqual(args, ["scripts/build-android.mjs", "--reproduce-from", "/tmp/caller/releases/original.apk", "--profile", "preprod", "--config", "/tmp/caller/public.json"]);
    for (const extra of [["--reproduce-from"], ["--reproduce-from", " "], ["--reproduce-from", "a", "--reproduce-from", "b"], ["--reproduce-from", "a", "--unsigned"], ["--dev", "--reproduce-from", "a"], ["--e2e", "--reproduce-from", "a"]]) assert.throws(() => capture(["build", ...extra]));
    assert.throws(() => capture(["doctor", "--reproduce-from", "a"]));
});

for (const [flag, variant, nodeEnv, e2e] of [["--dev", "Debug", "development", "0"], ["--e2e", "E2e", "production", "1"]]) {
    test(`${flag} requests an in-place prebuild and only its explicit test variant`, () => {
        const calls = capture(["build", flag], { EXPO_PUBLIC_CRYPTEX_E2E: "1", KEEP: "value" });
        assert.deepEqual(calls[0][1], ["exec", "expo", "prebuild", "--platform", "android", "--no-install", "--no-clean"]);
        assert.deepEqual(calls[1][1], [`:app:assemble${variant}`, "--console=plain"]);
        assert.equal(calls[0][2].cwd, mobile);
        assert.equal(calls[1][2].cwd, join(mobile, "android"));
        for (const [, , options] of calls) {
            assert.equal(options.env.NODE_ENV, nodeEnv);
            assert.equal(options.env.EXPO_PUBLIC_CRYPTEX_E2E, e2e);
            assert.equal(options.env.KEEP, "value");
        }
    });
}

test("dev forwards Expo options and cannot inherit the E2E bridge", () => {
    const [[, args, options]] = capture(["dev", "--", "--port", "8082", "--android"], { EXPO_PUBLIC_CRYPTEX_E2E: "1" });
    assert.deepEqual(args, ["exec", "expo", "start", "--dev-client", "--scheme", "cryptex", "--port", "8082", "--android"]);
    assert.equal(options.env.NODE_ENV, "development");
    assert.equal(options.env.EXPO_PUBLIC_CRYPTEX_E2E, "0");
});

test("check runs lint, strict types, Jest, CLI tests, and a temporary export", () => {
    const calls = capture(["check"]);
    assert.deepEqual(calls.slice(0, 3).map(call => call[1]), [
        ["exec", "oxlint"], ["exec", "tsgo", "--noEmit", "--strict"], ["exec", "jest", "--config", "./jest.config.ts"],
    ]);
    assert.ok(calls[3][1].includes("scripts/mobile.test.mjs"));
    assert.ok(calls[3][1].includes("fdroid/prepare-source.test.mjs"));
    assert.ok(calls[3][1].includes("e2e/fixtures/online-services.test.mjs"));
    const [, args, options] = calls[4];
    assert.deepEqual(args.slice(0, -1), ["exec", "expo", "export", "--platform", "android", "--output-dir"]);
    assert.ok(!args.at(-1).startsWith(mobile));
    assert.equal(existsSync(args.at(-1)), false, "temporary export is removed");
    assert.equal(options.env.EXPO_PUBLIC_CRYPTEX_E2E, "0");
    assert.equal(options.env.NODE_ENV, "production");
    assert.ok(calls.every(call => call[2].cwd === mobile));
});

test("granular checks retain Jest argument forwarding", () => {
    assert.deepEqual(capture(["check", "unit", "--runInBand", "qr-scan-session"])[0][1],
        ["exec", "jest", "--config", "./jest.config.ts", "--runInBand", "qr-scan-session"]);
    assert.equal(capture(["check", "lint"]).length, 1);
    const cliTests = capture(["check", "cli"])[0][1];
    for (const oracle of ["scripts/passkey-verifier.test.mjs", "scripts/totp-verifier.test.mjs",
        "e2e/fixtures/online-services.test.mjs"]) {
        assert.ok(cliTests.includes(oracle), `CLI discovery must include ${oracle}`);
    }
    for (const args of [["missing"], ["lint", "extra"], ["types", "--noEmit"]]) {
        assert.throws(() => capture(["check", ...args]));
    }
});

test("export cleanup also happens on child-process failure", () => {
    let output;
    assert.throws(() => runMobile(["check", "export"], { env: {}, run: (_, args) => {
        output = args.at(-1);
        return { status: 7 };
    } }), error => error.exitCode === 7);
    assert.equal(existsSync(output), false);
});

test("all former Maestro flows retain their mapping and JUnit output", () => {
    assert.deepEqual(Object.keys(flows), ["smoke", "credentials", "autofill", "autofill-app-association", "autofill-coverage", "autofill-live-registration", "autofill-provider-password", "passkeys", "security", "cloud", "devices", "sync-sender", "sync-receiver", "import-export"]);
    for (const [suite, flow] of Object.entries(flows)) {
        assert.equal(existsSync(join(mobile, "e2e/flows", flow)), true, flow);
        const [[binary, args, options]] = capture(["e2e", suite, "--device", "emulator-5554", "--include-tags", "quick"]);
        const biometric = ["security", "passkeys"].includes(suite);
        const cloud = ["cloud", "devices"].includes(suite);
        assert.equal(binary, biometric ? "bash" : cloud ? process.execPath : "maestro");
        assert.deepEqual(args, [...(biometric ? ["e2e/run-biometric-flow.sh"] : cloud ? ["e2e/run-cloud.mjs"] : ["test", "--device", "emulator-5554", "-e", "CRYPTEX_APP_ID=com.cryptexindustries.vault", "-e", "CRYPTEX_APP_SCHEME=cryptex", "-e", "CRYPTEX_APP_NAME=Cryptex Vault"]), "--format", "junit", "--output", `e2e/results/${suite}.xml`, "--include-tags", "quick", `e2e/flows/${flow}`]);
        if (cloud) assert.equal(options.env.CRYPTEX_E2E_DEVICE_SCENARIO, suite === "devices" ? "1" : "0");
        assert.equal(options.env.MAESTRO_DEVICE, "emulator-5554");
        assert.equal(options.env.ANDROID_SERIAL, "emulator-5554");
    }
});

test("every device suite requires explicit selection before running anything", () => {
    for (const suite of [...Object.keys(flows), "crypto", "native", "autofill-accessibility", "provider-auto-lock"]) {
        assert.throws(() => capture(["e2e", suite]), /Select a device/);
    }
});

test("device selection accepts existing envs and explicit option overrides both", () => {
    assert.equal(capture(["e2e", "smoke"], { ANDROID_SERIAL: "first" })[0][2].env.MAESTRO_DEVICE, "first");
    assert.equal(capture(["e2e", "smoke"], { MAESTRO_DEVICE: "second", ANDROID_SERIAL: "first" })[0][2].env.ANDROID_SERIAL, "second");
    assert.equal(capture(["e2e", "smoke", "--device", "third"], { MAESTRO_DEVICE: "second" })[0][2].env.MAESTRO_DEVICE, "third");
    for (const args of [["--device"], ["--device", "--bad"], ["--device", "first", "--device", "second"], ["--device", " "]]) {
        assert.throws(() => capture(["e2e", "smoke", ...args]));
    }
});

test("fixture and target remain available without a device", () => {
    assert.deepEqual(capture(["e2e", "fixture"])[0][1], ["e2e/fixtures/server.mjs"]);
    assert.deepEqual(capture(["e2e", "cloud-fixture"])[0][1], ["e2e/fixtures/online-services.mjs"]);
    const [[binary, args, options]] = capture(["e2e", "target"]);
    assert.match(binary, /android\/gradlew(?:\.bat)?$/);
    assert.deepEqual(args, ["-p", "e2e/fixtures/autofill-target", "assembleDebug", "--console=plain"]);
    assert.equal(options.cwd, mobile);
});

test("protected devices fail before any device command, including either sync role", () => {
    const env = { ANDROID_SERIAL: "protected", CRYPTEX_E2E_PROTECTED_DEVICE: "protected" };
    for (const suite of [...Object.keys(flows), "crypto", "native", "autofill-accessibility", "provider-auto-lock"]) {
        assert.throws(() => capture(["e2e", suite], env), /protected device/);
    }
    for (const protectedRole of ["E2E_SYNC_SENDER", "E2E_SYNC_RECEIVER"]) {
        assert.throws(() => capture(["e2e", "sync"], {
            E2E_SYNC_SENDER: "sender", E2E_SYNC_RECEIVER: "receiver", E2E_SYNC_CONFIG: "/private/config.json",
            CRYPTEX_E2E_PROTECTED_DEVICE: "protected", [protectedRole]: "protected",
        }), /protected device/);
    }
});

test("sync requires distinct explicit devices and private fixture configuration", () => {
    for (const env of [{}, { E2E_SYNC_SENDER: "sender" }, {
        E2E_SYNC_SENDER: "same", E2E_SYNC_RECEIVER: "same", E2E_SYNC_CONFIG: "/private/config.json",
    }]) assert.throws(() => capture(["e2e", "sync"], env), /Set distinct/);
    const env = { E2E_SYNC_SENDER: "sender", E2E_SYNC_RECEIVER: "receiver", E2E_SYNC_CONFIG: "/private/config.json" };
    assert.deepEqual(capture(["e2e", "sync"], env)[0][1], ["e2e/run-sync-link.mjs"]);
    assert.equal(capture(["e2e", "sync"], { ...env, MAESTRO_DEVICE: "other" })[0][2].env.E2E_SYNC_SENDER, "sender");
    assert.equal(capture(["e2e", "sync", "--device", "override"], env)[0][2].env.E2E_SYNC_SENDER, "override");
});

test("missing generated Android project gives explicit setup guidance", () => {
    assert.throws(() => requireAndroid(join(mobile, "does-not-exist")), /pnpm mobile:build -- --dev or --e2e/);
});

test("QR, crypto, crypto artifact audit and native instrumentation checks remain reachable", () => {
    assert.deepEqual(capture(["e2e", "qr"])[0][1], ["scripts/test-qr-scanner.mjs"]);
    assert.deepEqual(capture(["e2e", "crypto"], { ANDROID_SERIAL: "emu" })[0][1], ["scripts/test-native-crypto.mjs"]);
    assert.deepEqual(capture(["e2e", "crypto-audit", "--apk", "/tmp/app.apk"])[0][1], ["scripts/verify-native-crypto.mjs", "--apk", "/tmp/app.apk"]);
    assert.throws(() => capture(["e2e", "crypto-audit", "--unknown"]), /accepts only/);
    assert.deepEqual(capture(["e2e", "native"], { ANDROID_SERIAL: "emu" })[0][1],
        [":cryptex-android-credentials:testDebugUnitTest", ":cryptex-android-credentials:connectedDebugAndroidTest", "--console=plain"]);
});

test("native build suites reject a different profile tree before launching Gradle or ADB", () => {
    for (const suite of ["crypto", "native"]) {
        let commands = 0;
        let selected;
        assert.throws(() => runMobile(["e2e", suite, "--profile", "preprod", "--device", "emulator-5564"], {
            env: {}, checkAndroid: () => {},
            checkNativeIdentity: profile => { selected = profile.applicationId; throw new Error("wrong native profile"); },
            run: () => { commands++; return { status: 0 }; },
        }), /wrong native profile/);
        assert.equal(selected, "com.cryptexindustries.vault.preprod");
        assert.equal(commands, 0);
    }
});

test("E2E runners clear inherited release controls without losing fixture endpoints", () => {
    const env = { CRYPTEX_BUILD_PROFILE: "production", CRYPTEX_RELEASE_CONFIG: "/other.json", CRYPTEX_OFFLINE_SERVICES: "1",
        CRYPTEX_SOURCE_REVISION: "invalid", CRYPTEX_EMBEDDED_UPDATE_COMMIT_TIME: "1", CRYPTEX_EMBEDDED_UPDATE_ID: "12345678-1234-4123-8123-123456789abc", CRYPTEX_EMBEDDED_UPDATE_UNKNOWN: "poison", EXPO_PUBLIC_ONLINE_SERVICES_API_URL: "http://127.0.0.1:43111" };
    for (const suite of ["native", "crypto", "smoke", "passkeys", "cloud"]) {
        const [[, , { env: actual }]] = capture(["e2e", suite, "--profile", "preprod", "--device", "emulator-5564"], env);
        assert.equal(actual.CRYPTEX_BUILD_PROFILE, "e2e");
        assert.equal(actual.EXPO_PUBLIC_CRYPTEX_E2E, "1");
        assert.equal(actual.CRYPTEX_APP_PROFILE, "preprod");
        assert.equal(actual.CRYPTEX_RELEASE_CONFIG, undefined);
        assert.equal(actual.CRYPTEX_OFFLINE_SERVICES, undefined);
        assert.equal(actual.CRYPTEX_SOURCE_REVISION, undefined);
        for (const name of Object.keys(env).filter(name => name.startsWith("CRYPTEX_EMBEDDED_UPDATE_"))) assert.equal(actual[name], undefined);
        assert.equal(actual.EXPO_PUBLIC_ONLINE_SERVICES_API_URL, env.EXPO_PUBLIC_ONLINE_SERVICES_API_URL);
    }
});

test("dev and E2E builds clear every inherited embedded-update control", () => {
    const env = { CRYPTEX_EMBEDDED_UPDATE_COMMIT_TIME: "1", CRYPTEX_EMBEDDED_UPDATE_ID: "12345678-1234-4123-8123-123456789abc", CRYPTEX_EMBEDDED_UPDATE_UNKNOWN: "poison" };
    for (const args of [["dev"], ["build", "--dev"], ["build", "--e2e"]]) {
        for (const [, , { env: actual }] of capture(args, env)) {
            for (const name of Object.keys(env)) assert.equal(actual[name], undefined);
        }
    }
});

test("accessibility keeps its phased runner and chosen device", () => {
    const [[binary, args, options]] = capture(["e2e", "autofill-accessibility", "--device", "emulator-5554"], { ACCESSIBILITY_E2E_START_PHASE: "3" });
    assert.equal(binary, "bash");
    assert.deepEqual(args, ["e2e/run-accessibility-fallback.sh"]);
    assert.equal(options.env.ANDROID_SERIAL, "emulator-5554");
    assert.equal(options.env.ACCESSIBILITY_E2E_START_PHASE, "3");
});

test("provider auto-lock is reachable and keeps explicit device selection", () => {
    const [[binary, args, options]] = capture(["e2e", "provider-auto-lock", "--device", "emulator-5560"]);
    assert.equal(binary, "bash");
    assert.deepEqual(args, ["e2e/run-provider-auto-lock.sh"]);
    assert.equal(options.env.ANDROID_SERIAL, "emulator-5560");
    assert.throws(() => capture(["e2e", "provider-auto-lock", "extra"], { ANDROID_SERIAL: "emulator-5560" }));
});

test("unknown commands, suites and unexpected non-Maestro arguments fail", () => {
    for (const args of [["bad"], ["e2e"], ["e2e", "bad"], ["e2e", "qr", "extra"], ["e2e", "fixture", "extra"], ["e2e", "autofill-accessibility", "extra"]]) {
        assert.throws(() => capture(args));
    }
});

test("child failures and spawn errors reach caller and stop subsequent checks", () => {
    let calls = 0;
    assert.throws(() => runMobile(["check"], { env: {}, run: () => {
        calls++;
        return { status: 9 };
    } }), error => error.exitCode === 9);
    assert.equal(calls, 1);
    const error = new Error("ENOENT");
    assert.throws(() => runMobile(["dev"], { env: {}, run: () => ({ error }) }), error);
});

test("root and mobile package scripts expose the same four commands", () => {
    const root = JSON.parse(readFileSync(join(mobile, "../package.json")));
    const app = JSON.parse(readFileSync(join(mobile, "package.json")));
    for (const command of ["dev", "build", "check", "e2e"]) {
        assert.equal(root.scripts[`mobile:${command}`], `node mobile/scripts/mobile.mjs ${command}`);
        assert.equal(app.scripts[command], `node scripts/mobile.mjs ${command}`);
    }
    assert.ok(!Object.keys(root.scripts).some(name => name.startsWith("e2e:mobile:") || name === "build:mobile:e2e"));
    assert.ok(!Object.keys(app.scripts).some(name => name.startsWith("e2e:")));
});
