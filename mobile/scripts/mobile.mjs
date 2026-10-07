import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getProfile, parseReleaseOptions } from "./release-config.mjs";

const mobile = fileURLToPath(new URL("../", import.meta.url));
const android = join(mobile, "android");
const gradle = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export const flows = {
    smoke: "smoke.yaml",
    credentials: "credential-features.yaml",
    autofill: "autofill-fill.yaml",
    "autofill-app-association": "autofill-app-association.yaml",
    "autofill-coverage": "autofill-coverage.yaml",
    "autofill-live-registration": "autofill-live-registration.yaml",
    "autofill-provider-password": "autofill-provider-password.yaml",
    passkeys: "passkeys.yaml",
    security: "security.yaml",
    cloud: "cloud.yaml",
    devices: "devices.yaml",
    "sync-sender": "sync-link-sender.yaml",
    "sync-receiver": "sync-link-receiver.yaml",
    "import-export": "import-export.yaml",
};

export const help = `Mobile commands, from the repository root:
  pnpm mobile:dev [-- <Expo start options>]
  pnpm mobile:build [-- --unsigned] [--distribution standard|fdroid] [--offline-services] [--profile production|preprod] [--config <path>] [--clean] [--arch <abi>|all] [--jobs <count>|auto] [--heap <MiB>]
  pnpm mobile:build -- --reproduce-from <signed-reference.apk> [--profile <name>] [--config <path>]
  pnpm mobile:build -- --dev [--profile <name>] [--regenerate-native]
  pnpm mobile:build -- --e2e [--profile <name>] [--regenerate-native]
  pnpm mobile:check [-- lint | types | unit | cli | export]
  pnpm mobile:e2e -- <suite> [--device <serial>] [Maestro options]
  pnpm mobile:doctor [-- --profile production|preprod] [--config <path>]
  pnpm mobile:install [-- --profile production|preprod] [--arch <abi>] --device <serial> [apk]
  pnpm mobile:logs [-- --profile production|preprod] --device <serial>
  pnpm mobile:signing -- setup --profile preprod
  pnpm mobile:ota -- <setup|preflight|export|publish|rollout|rollback> --profile <name>
  pnpm mobile:update -- --profile <name> --message <description> [--config <path>]

Build defaults to a signed production APK. --unsigned builds without private APK signing material.
Local release builds reuse .mobile-build/ in the current checkout and use all available CPU parallelism.
--clean uses a fresh build without compilation caches; --reproduce-from always does this.
--arch selects one ABI; omission or all selects all four. Targeted APKs include the ABI in their filename.
--jobs overrides automatic parallelism; --heap overrides the local Gradle heap in MiB.
--distribution fdroid disables Expo OTA; standard builds keep OTA enabled.
--reproduce-from rebuilds and restores the reference's public signature without private keys; exact APK bytes must match.
--config selects public release JSON; relative paths use the caller's working directory.
--dev builds a secure debug APK; --e2e builds the test-only Maestro APK.
--regenerate-native backs up the existing Android tree before a fresh dev/E2E prebuild.
Check defaults to lint, types, unit tests, CLI tests, and a temporary JS export.
Device suites require --device, MAESTRO_DEVICE, or ANDROID_SERIAL.
Suites: ${Object.keys(flows).join(", ")}, autofill-accessibility, provider-auto-lock,
        sync, fixture, cloud-fixture, target, qr, crypto, crypto-audit, native
Sync requires E2E_SYNC_SENDER, E2E_SYNC_RECEIVER and E2E_SYNC_CONFIG.
CRYPTEX_E2E_PROTECTED_DEVICE forbids any device suite on that serial.
`;

export function requireAndroid(project = android) {
    if (!existsSync(join(project, gradle))) {
        throw new Error("Android project is missing. Run pnpm mobile:build -- --dev or --e2e first.");
    }
}

export function requireNativeIdentity(profile, project = android) {
    const file = join(project, "app/build.gradle");
    if (!existsSync(file)) return;
    const source = readFileSync(file, "utf8");
    const values = ["applicationId", "namespace"].map(name => source.match(new RegExp(`\\b${name}\\s*(?:=\\s*)?["']([^"']+)["']`))?.[1]);
    if (values.some(value => value !== profile.applicationId)) throw new Error(
        `Existing Android project identity (${values.join(", ")}) differs from ${profile.applicationId}. Rerun pnpm mobile:build -- --e2e --profile ${profile.name} --regenerate-native to back up the existing tree outside the checkout before generating fresh native sources. --no-clean cannot safely migrate application identity.`);
}

export function regenerateNativeProject(profile, project = android, backupRoot = join(homedir(), ".cache/cryptex-development/native-backups")) {
    if (!existsSync(project)) return;
    mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
    const backup = mkdtempSync(join(backupRoot, `${profile.name}-`));
    renameSync(project, join(backup, "android"));
    console.log(`Existing native project preserved at ${join(backup, "android")}.`);
    return join(backup, "android");
}

export function runMobile(argv, { run = spawnSync, env = process.env, checkAndroid = requireAndroid, checkNativeIdentity = requireNativeIdentity, regenerateNative = regenerateNativeProject } = {}) {
    const args = [...argv];
    if (args[0] === "--") args.shift();
    const command = args.shift();
    if (args[0] === "--") args.shift();
    if (!command || command === "--help" || command === "help" || args[0] === "--help") {
        console.log(help);
        return;
    }
    const execute = (binary, parameters, overrides = {}, cwd = mobile) => {
        const result = run(binary, parameters, {
            cwd,
            env: { ...env, ...overrides },
            stdio: "inherit",
        });
        if (result.error) throw result.error;
        if (result.status !== 0) {
            const error = new Error(`${binary} failed${result.signal ? ` (${result.signal})` : ""}.`);
            error.exitCode = result.status || 1;
            throw error;
        }
    };
    const exec = (parameters, overrides) => execute(pnpm, ["exec", ...parameters], overrides);
    const developmentEnvironment = (profile, e2e = false) => ({
        ...Object.fromEntries(Object.keys(env).filter(name => name.startsWith("CRYPTEX_EMBEDDED_UPDATE_")).map(name => [name, undefined])),
        NODE_ENV: e2e ? "production" : "development",
        EXPO_PUBLIC_CRYPTEX_E2E: e2e ? "1" : "0",
        CRYPTEX_APP_PROFILE: profile.name,
        CRYPTEX_BUILD_PROFILE: e2e ? "e2e" : "development",
        CRYPTEX_DISTRIBUTION: "standard",
        CRYPTEX_RELEASE_CONFIG: undefined,
        CRYPTEX_OFFLINE_SERVICES: undefined,
        CRYPTEX_SOURCE_REVISION: undefined,
    });
    const rejectArguments = () => {
        if (args.length) throw new Error(`Unexpected arguments: ${args.join(" ")}`);
    };
    const takeProfile = () => {
        const index = args.indexOf("--profile");
        let name = env.CRYPTEX_APP_PROFILE || "production";
        if (index >= 0) {
            if (args.lastIndexOf("--profile") !== index || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Specify --profile production or preprod once.");
            name = args[index + 1];
            args.splice(index, 2);
        }
        return getProfile(name);
    };

    if (["install", "logs"].includes(command)) {
        execute(process.execPath, [join(mobile, "scripts/device.mjs"), command, ...args], {}, env.INIT_CWD || process.cwd());
        return;
    }
    if (command === "doctor") {
        const options = parseReleaseOptions(args, { cwd: env.INIT_CWD || process.cwd() });
        const index = args.indexOf("--config");
        if (index >= 0) args[index + 1] = options.configPath;
        execute(process.execPath, ["scripts/doctor.mjs", ...args]);
        return;
    }
    if (command === "signing") {
        if (args.shift() !== "setup") throw new Error("Choose signing setup.");
        execute(process.execPath, [join(mobile, "scripts/create-signing-identity.mjs"), "--write-public", ...args], {}, env.INIT_CWD || process.cwd());
        return;
    }
    if (command === "ota" || command === "update") {
        execute(process.execPath, [join(mobile, "scripts/ota.mjs"), ...(command === "update" ? ["publish"] : []), ...args], {}, env.INIT_CWD || process.cwd());
        return;
    }

    if (command === "dev") {
        const profile = takeProfile();
        exec(["expo", "start", "--dev-client", "--scheme", profile.scheme, ...args], developmentEnvironment(profile));
        return;
    }
    if (command === "build") {
        const development = args.includes("--dev");
        const e2e = args.includes("--e2e");
        if (development || e2e) {
            const profile = takeProfile();
            const regenerate = args.includes("--regenerate-native");
            if (regenerate) args.splice(args.indexOf("--regenerate-native"), 1);
            if (args.length !== 1) throw new Error("Choose only --dev or --e2e for a test build.");
            if (regenerate) regenerateNative(profile);
            checkNativeIdentity(profile);
            const buildEnv = developmentEnvironment(profile, e2e);
            // Expo 57 recreates native projects unless --no-clean is explicit.
            exec(["expo", "prebuild", "--platform", "android", "--no-install", "--no-clean"], buildEnv);
            execute(gradle, [`:app:assemble${e2e ? "E2e" : "Debug"}`, "--console=plain"], buildEnv, android);
        } else {
            const options = parseReleaseOptions(args, { cwd: env.INIT_CWD || process.cwd(), allowReproduction: true, allowBuild: true });
            const configIndex = args.indexOf("--config");
            if (configIndex >= 0) args[configIndex + 1] = options.configPath;
            const referenceIndex = args.indexOf("--reproduce-from");
            if (referenceIndex >= 0) args[referenceIndex + 1] = options.reproduceFrom;
            execute(process.execPath, ["scripts/build-android.mjs", ...args]);
        }
        return;
    }
    if (command === "check") {
        const selection = args.shift();
        const checks = ["lint", "types", "unit", "cli", "export"];
        if (selection && !checks.includes(selection)) throw new Error(`Unknown check: ${selection}`);
        if (selection !== "unit") rejectArguments();
        for (const check of selection ? [selection] : checks) {
            if (check === "lint") exec(["oxlint"]);
            if (check === "types") exec(["tsgo", "--noEmit", "--strict"]);
            if (check === "unit") exec(["jest", "--config", "./jest.config.ts", ...args]);
            if (check === "cli") {
                const tests = ["scripts", "fdroid", "e2e/fixtures"].flatMap(directory =>
                    readdirSync(join(mobile, directory))
                        .filter(name => name.endsWith(".test.mjs"))
                        .sort().map(name => `${directory}/${name}`));
                execute(process.execPath, ["--test", ...tests]);
            }
            if (check === "export") {
                const output = mkdtempSync(join(tmpdir(), "cryptex-mobile-export-"));
                try {
                    exec(["expo", "export", "--platform", "android", "--output-dir", output], {
                        NODE_ENV: "production",
                        EXPO_PUBLIC_CRYPTEX_E2E: "0",
                    });
                } finally {
                    rmSync(output, { recursive: true, force: true });
                }
            }
        }
        return;
    }
    if (command !== "e2e") throw new Error(`Unknown mobile command: ${command}`);
    const suite = args.shift();
    if (!suite) throw new Error("Choose a suite; use pnpm mobile:e2e --help to list them.");
    const profile = takeProfile();
    const identityEnv = { CRYPTEX_APP_PROFILE: profile.name, CRYPTEX_APP_ID: profile.applicationId, CRYPTEX_APP_SCHEME: profile.scheme, CRYPTEX_APP_NAME: profile.displayName };
    let serial = env.MAESTRO_DEVICE || env.ANDROID_SERIAL;
    const deviceIndex = args.indexOf("--device");
    if (deviceIndex >= 0) {
        const value = args[deviceIndex + 1];
        if (!value || value.startsWith("-") || args.indexOf("--device", deviceIndex + 1) >= 0) {
            throw new Error("--device requires one Android device serial.");
        }
        serial = value;
        args.splice(deviceIndex, 2);
    }
    const deviceEnv = { ...developmentEnvironment(profile, true), ...identityEnv, ...(serial ? { MAESTRO_DEVICE: serial, ANDROID_SERIAL: serial } : {}) };
    const requireDevice = () => {
        if (!serial || serial.trim() !== serial || !serial.trim()) {
            throw new Error("Select a device with --device <serial>, MAESTRO_DEVICE, or ANDROID_SERIAL.");
        }
        if (env.CRYPTEX_E2E_PROTECTED_DEVICE === serial) {
            throw new Error(`Refusing to touch protected device ${serial}.`);
        }
    };
    if (suite === "sync") {
        rejectArguments();
        const sender = deviceIndex >= 0 ? serial : env.E2E_SYNC_SENDER || serial;
        const { E2E_SYNC_RECEIVER: receiver, E2E_SYNC_CONFIG: config } = env;
        if (!sender || !receiver || !config || sender === receiver) {
            throw new Error("Set distinct E2E_SYNC_SENDER and E2E_SYNC_RECEIVER and E2E_SYNC_CONFIG.");
        }
        if ([sender, receiver].includes(env.CRYPTEX_E2E_PROTECTED_DEVICE)) {
            throw new Error("Refusing to touch the protected device in the sync pair.");
        }
        execute(process.execPath, ["e2e/run-sync-link.mjs"], { ...developmentEnvironment(profile, true), ...identityEnv, E2E_SYNC_SENDER: sender });
    } else if (["fixture", "cloud-fixture"].includes(suite)) {
        rejectArguments();
        execute(process.execPath, [`e2e/fixtures/${suite === "fixture" ? "server" : "online-services"}.mjs`]);
    } else if (suite === "target") {
        rejectArguments();
        checkAndroid();
        execute(join(android, gradle), ["-p", "e2e/fixtures/autofill-target", "assembleDebug", "--console=plain"]);
    } else if (["qr", "crypto", "crypto-audit"].includes(suite)) {
        if (suite === "crypto-audit") {
            if (args.length && (args.length !== 2 || args[0] !== "--apk" || args[1].startsWith("-"))) {
                throw new Error("crypto-audit accepts only --apk <path>.");
            }
            if (args.length) args[1] = resolve(args[1]);
        } else rejectArguments();
        if (suite === "crypto") requireDevice();
        checkAndroid();
        if (suite === "crypto") checkNativeIdentity(profile);
        const script = { qr: "test-qr-scanner", crypto: "test-native-crypto", "crypto-audit": "verify-native-crypto" }[suite];
        execute(process.execPath, [`scripts/${script}.mjs`, ...args], deviceEnv);
    } else if (suite === "native") {
        rejectArguments();
        requireDevice();
        checkAndroid();
        checkNativeIdentity(profile);
        execute(gradle, [":cryptex-android-credentials:testDebugUnitTest", ":cryptex-android-credentials:connectedDebugAndroidTest", "--console=plain"], deviceEnv, android);
    } else if (["autofill-accessibility", "provider-auto-lock"].includes(suite)) {
        rejectArguments();
        requireDevice();
        execute("bash", [suite === "autofill-accessibility" ? "e2e/run-accessibility-fallback.sh" : "e2e/run-provider-auto-lock.sh"], deviceEnv);
    } else if (["cloud", "devices"].includes(suite)) {
        requireDevice();
        mkdirSync(join(mobile, "e2e/results"), { recursive: true });
        execute(process.execPath, ["e2e/run-cloud.mjs", "--format", "junit", "--output", `e2e/results/${suite}.xml`, ...args, `e2e/flows/${flows[suite]}`], { ...deviceEnv, CRYPTEX_E2E_DEVICE_SCENARIO: suite === "devices" ? "1" : "0" });
    } else if (["security", "passkeys"].includes(suite)) {
        requireDevice();
        mkdirSync(join(mobile, "e2e/results"), { recursive: true });
        execute("bash", ["e2e/run-biometric-flow.sh", "--format", "junit", "--output", `e2e/results/${suite}.xml`, ...args, `e2e/flows/${flows[suite]}`], deviceEnv);
    } else if (Object.hasOwn(flows, suite)) {
        requireDevice();
        mkdirSync(join(mobile, "e2e/results"), { recursive: true });
        execute("maestro", ["test", "--device", serial, ...Object.entries(identityEnv).filter(([name]) => name !== "CRYPTEX_APP_PROFILE").flatMap(([name, value]) => ["-e", `${name}=${value}`]), "--format", "junit", "--output", `e2e/results/${suite}.xml`, ...args, `e2e/flows/${flows[suite]}`], deviceEnv);
    } else {
        throw new Error(`Unknown suite: ${suite}`);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    try {
        runMobile(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = error.exitCode || 1;
    }
}
