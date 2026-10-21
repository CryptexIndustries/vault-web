import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { prepareSource } from "../fdroid/prepare-source.mjs";
import { finalizeNativeSources } from "./build-android.mjs";
import { preparePlayFreeSource } from "./play-source.mjs";

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
function evaluate(file, distribution, loader = require, projectRoot = mobile) {
    const fixtureModule = { exports: {} };
    vm.runInNewContext(readFileSync(join(projectRoot, file), "utf8"), {
        module: fixtureModule, exports: fixtureModule.exports, require: loader, __dirname: projectRoot,
        process: { env: { CRYPTEX_DISTRIBUTION: distribution } },
    }, { filename: file });
    return fixtureModule.exports;
}
async function metroConfig(distribution, defaultResolveRequest, projectRoot = mobile) {
    const loader = Object.assign(name => {
        if (name === "expo/metro-config") return { getDefaultConfig: () => ({
            resolver: { resolveRequest: defaultResolveRequest, assetExts: ["wasm"], sourceExts: ["js"] },
        }) };
        if (name === "nativewind/metro") return { withNativeWind: config => config };
        if (name === "./scripts/build-workers.cjs") return { buildWorkers: async () => {} };
        return require(name);
    }, { resolve: require.resolve });
    return evaluate("metro.config.js", distribution, loader, projectRoot);
}

test("only Play Android resolves the billing service or RevenueCat into its Metro graph", async () => {
    for (const distribution of [undefined, "standard", "fdroid", "play"]) {
        for (const platform of ["android", "ios", "web"]) {
            const calls = [];
            const resolveRequest = (_context, name) => { calls.push(name); return { type: "sourceFile", filePath: name }; };
            const config = await metroConfig(distribution, resolveRequest);
            const context = { originModulePath: join(mobile, "src/app_lib/online-services-billing.ts"), resolveRequest };
            for (const name of ["./google-play-billing", "react-native-purchases", "react-native-purchases/dist/purchases", "@revenuecat/purchases-typescript-internal"]) {
                const resolution = config.resolver.resolveRequest(context, name, platform);
                assert.equal(resolution.type, distribution === "play" && platform === "android" ? "sourceFile" : "empty");
            }
            assert.equal(calls.length, distribution === "play" && platform === "android" ? 4 : 0,
                "Excluded modules must resolve even when removed from the prepared checkout");
            assert.equal(config.resolver.resolveRequest(context, "./stripe-billing", platform).filePath, "./stripe-billing");
            assert.equal(config.resolver.resolveRequest(context, "react-native", platform).filePath, "react-native");
        }
    }
});

test("billing exclusion preserves Metro's fallback resolver and unrelated relative modules", async () => {
    const config = await metroConfig("fdroid");
    const context = {
        originModulePath: join(mobile, "src/unrelated.ts"),
        resolveRequest: (_context, name) => ({ type: "sourceFile", filePath: name }),
    };
    assert.equal(config.resolver.resolveRequest(context, "./google-play-billing", "android").filePath, "./google-play-billing");
    assert.equal(config.resolver.resolveRequest(context, "crypto", "android").filePath, "react-native-quick-crypto");
    assert.equal(config.resolver.resolveRequest(context, "libsodium-sumo", "android").filePath, join(mobile, "src/shims/libsodium-wrappers-sumo.ts"));
});

const expoRequire = createRequire(require.resolve("expo/package.json"));
const autolinkingRoot = dirname(expoRequire.resolve("expo-modules-autolinking/package.json"));
const { createReactNativeConfigAsync, resolveReactNativeModule } = require(join(autolinkingRoot, "build/reactNativeConfig/reactNativeConfig.js"));

const sdkPackages = [
    ["react-native-purchases", "10.11.0"],
    ["@revenuecat/purchases-js-hybrid-mappings", "19.5.0"],
    ["@revenuecat/purchases-typescript-internal", "19.5.0"],
    ["@revenuecat/purchases-js", "1.67.1"],
];
const excludedSources = ["mobile/config/play-dependencies.gradle", "mobile/config/play-verification-metadata.xml", "mobile/src/app_lib/google-play-billing.ts"];
const preservedSources = ["mobile/fdroid/dependencies.gradle", "mobile/fdroid/verification-metadata.xml", "mobile/src/app_lib/stripe-billing.ts"];
function write(root, file, contents = "fixture\n") {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), contents);
}
function sourceFixture(t) {
    const root = mkdtempSync(join(tmpdir(), "cryptex-play-source-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const project = join(root, "mobile");
    write(root, "mobile/android/app/build.gradle", 'proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"\n');
    write(root, "mobile/android/gradle.properties", "expo.useLegacyPackaging=false\n");
    write(root, "mobile/android/gradle/wrapper/gradle-wrapper.properties", "distributionUrl=old\ndistributionSha256Sum=old\n");
    write(root, "mobile/package.json", JSON.stringify({ name: "fixture", dependencies: { "react-native-purchases": "10.11.0" }, expo: { autolinking: { android: { buildFromSource: [".*"] } } } }));
    for (const file of ["react-native.config.js", "metro.config.js"]) write(root, `mobile/${file}`, readFileSync(join(mobile, file)));
    for (const file of [...excludedSources, ...preservedSources, "mobile/src/app_lib/online-services-billing.ts"]) write(root, file);
    const packages = sdkPackages.map(([name, version]) => {
        const path = `node_modules/.pnpm/${name.replace("/", "+")}@${version}/node_modules/${name}`;
        write(root, `${path}/package.json`, JSON.stringify({ name, version }));
        write(root, `${path}/source.txt`);
        return join(root, path);
    });
    mkdirSync(join(project, "node_modules"));
    symlinkSync(packages[0], join(project, "node_modules/react-native-purchases"));
    return { root, project, packages, sdk: packages[0] };
}
function finalize(project, distribution = "fdroid") {
    finalizeNativeSources(project, {
        toolchain: { gradle: "9.3.1", gradleDistributionSha256: "fixture-checksum" },
        metadata: { distribution },
    });
}

test("Play-owned source preparation plans all reviewed removals and is idempotent", t => {
    const { root, packages } = sourceFixture(t);
    const plan = preparePlayFreeSource(root);
    assert.deepEqual(new Set(plan.map(item => item.path)), new Set([
        ...excludedSources, ...packages.map(path => path.slice(root.length + 1)),
    ]));
    for (const path of [...packages, ...excludedSources.map(file => join(root, file))]) assert.ok(existsSync(path), "Dry run must preserve source");
    assert.deepEqual(preparePlayFreeSource(root, true), plan);
    for (const path of [...packages, ...excludedSources.map(file => join(root, file))]) assert.equal(existsSync(path), false);
    for (const file of preservedSources) assert.equal(readFileSync(join(root, file), "utf8"), "fixture\n");
    assert.deepEqual(preparePlayFreeSource(root, true), []);
});

test("an unknown SDK version requires review before any removal or native metadata change", t => {
    const { root, project, packages } = sourceFixture(t);
    writeFileSync(join(packages.at(-1), "package.json"), JSON.stringify({ name: sdkPackages.at(-1)[0], version: "99.0.0" }));
    const wrapper = join(project, "android/gradle/wrapper/gradle-wrapper.properties");
    const originalWrapper = readFileSync(wrapper, "utf8");
    assert.throws(() => finalize(project), /Unreviewed|reviewed|version/i);
    for (const path of [...packages, ...excludedSources.map(file => join(root, file))]) assert.ok(existsSync(path));
    assert.equal(readFileSync(wrapper, "utf8"), originalWrapper);
    assert.equal(existsSync(join(project, "android/app/src/main/assets/cryptex-release.json")), false);
});

for (const file of ["app/build.gradle", "gradle/wrapper/gradle-wrapper.properties"]) test(`missing native ${file} stops preparation before deleting the SDK`, t => {
    const { root, project, packages } = sourceFixture(t);
    rmSync(join(project, "android", file));
    assert.throws(() => preparePlayFreeSource(root, true), /prebuild|native/i);
    assert.throws(() => finalize(project), /ENOENT|prebuild|native/i);
    for (const path of [...packages, ...excludedSources.map(file => join(root, file))]) assert.ok(existsSync(path));
});

for (const distribution of [undefined, "standard", "play"]) test(`native preparation preserves billing source for ${distribution ?? "unspecified"} builds`, t => {
    const { root, project, packages } = sourceFixture(t);
    finalizeNativeSources(project, { toolchain: { gradle: "9.3.1", gradleDistributionSha256: "fixture-checksum" }, metadata: { distribution } });
    for (const path of [...packages, ...excludedSources.map(file => join(root, file))]) assert.ok(existsSync(path));
    assert.equal(JSON.parse(readFileSync(join(project, "android/app/src/main/assets/cryptex-release.json"))).distribution, distribution);
});

for (const kind of ["store", "package", "target", "parent"]) test(`source preparation refuses a linked ${kind} before deleting valid targets`, t => {
    const { root, packages } = sourceFixture(t);
    const outside = mkdtempSync(join(tmpdir(), "cryptex-outside-source-"));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    write(outside, "sentinel.txt", "outside\n");
    const target = kind === "store" ? join(root, "node_modules/.pnpm") : kind === "package" ? packages.at(-1)
        : kind === "parent" ? join(root, "mobile/config") : join(root, excludedSources[1]);
    rmSync(target, { recursive: true });
    if (kind === "parent") write(outside, "play-dependencies.gradle");
    symlinkSync(kind === "target" ? join(outside, "sentinel.txt") : outside, target);
    assert.throws(() => preparePlayFreeSource(root, true), /linked|symlink|escapes|checkout/i);
    assert.equal(readFileSync(join(outside, "sentinel.txt"), "utf8"), "outside\n");
    assert.ok(existsSync(join(root, "mobile/src/app_lib/google-play-billing.ts")), "A rejected plan must preserve earlier valid targets");
    if (kind !== "store") assert.ok(existsSync(packages[0]), "A rejected plan must preserve reviewed packages");
});

test("source preparation rejects relative checkouts and linked targets inside the checkout", t => {
    const { root } = sourceFixture(t);
    assert.throws(() => preparePlayFreeSource("."), /absolute/i);
    const target = join(root, excludedSources[0]);
    rmSync(target);
    symlinkSync(join(root, preservedSources[0]), target);
    assert.throws(() => preparePlayFreeSource(root, true), /linked|symlink/i);
    assert.equal(readFileSync(join(root, preservedSources[0]), "utf8"), "fixture\n");
});

test("an internal linked parent cannot redirect the removal plan within the checkout", t => {
    const { root, packages } = sourceFixture(t);
    const alternate = join(root, "alternate-config");
    for (const file of excludedSources.slice(0, 2)) write(alternate, file.split("/").at(-1), "alternate\n");
    const config = join(root, "mobile/config");
    rmSync(config, { recursive: true });
    symlinkSync(alternate, config);
    assert.throws(() => preparePlayFreeSource(root, true), /linked|symlink/i);
    for (const file of excludedSources.slice(0, 2)) assert.equal(readFileSync(join(root, file), "utf8"), "alternate\n");
    for (const path of packages) assert.ok(existsSync(path));
    assert.ok(existsSync(join(root, excludedSources[2])));
});

test("the actual autolinker excludes the installed SDK outside Play Android", async () => {
    const sdk = dirname(require.resolve("react-native-purchases/package.json"));
    for (const distribution of [undefined, "standard", "fdroid", "play"]) {
        const project = evaluate("react-native.config.js", distribution);
        for (const platform of ["android", "ios"]) {
            const result = await resolveReactNativeModule({ name: "react-native-purchases", path: sdk, originPath: sdk }, project, platform, new Set());
            assert.equal(Boolean(result), distribution === "play" && platform === "android");
        }
    }
});

test("the existing native hook prepares an SDK-free checkout for the unchanged F-Droid cleanup and autolinker", async t => {
    const { root, project, packages } = sourceFixture(t);
    const camera = "node_modules/.pnpm/expo-camera@57.0.4/node_modules/expo-camera";
    write(root, `${camera}/package.json`, JSON.stringify({ name: "expo-camera", version: "57.0.4" }));
    write(root, `${camera}/local-maven-repo/camera.aar`);
    write(root, `${camera}/android/src/Camera.kt`, "Android source\n");
    finalize(project);
    for (const path of [...packages, ...excludedSources.map(file => join(root, file))]) assert.equal(existsSync(path), false);
    assert.ok(existsSync(join(root, camera, "local-maven-repo/camera.aar")), "The Play helper must leave F-Droid's original cleanup to its owner");
    prepareSource(root, true);
    assert.equal(existsSync(join(root, camera, "local-maven-repo/camera.aar")), false);
    assert.equal(readFileSync(join(root, camera, "android/src/Camera.kt"), "utf8"), "Android source\n");
    for (const file of preservedSources) assert.equal(readFileSync(join(root, file), "utf8"), "fixture\n");
    const calls = [];
    const resolveRequest = (_context, name) => { calls.push(name); return { type: "sourceFile", filePath: name }; };
    const config = await metroConfig("fdroid", resolveRequest, project);
    const context = { originModulePath: join(project, "src/app_lib/online-services-billing.ts"), resolveRequest };
    assert.equal(config.resolver.resolveRequest(context, "./google-play-billing", "android").type, "empty");
    assert.equal(config.resolver.resolveRequest(context, "react-native-purchases", "android").type, "empty");
    assert.equal(calls.length, 0);
    assert.equal(config.resolver.resolveRequest(context, "./stripe-billing", "android").filePath, "./stripe-billing");
    const result = await createReactNativeConfigAsync({ appRoot: project, autolinkingOptions: {
        platform: "android", exclude: [], searchPaths: [], nativeModulesDir: undefined,
    } });
    assert.equal(result.dependencies["react-native-purchases"], undefined);
});
