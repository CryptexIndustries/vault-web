import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { openBuildWorkspace, sourceFiles, synchronizeSources, writeIfChanged } from "./build-cache.mjs";
import resources from "./build-resources.cjs";
import { finalizeNativeSources, productionBuildOptions } from "./build-android.mjs";
import { makeArguments } from "./local-build-make.mjs";
import { artifactName, parseReleaseOptions, selectedArchitectures } from "./release-config.mjs";

test("local builds keep the same profiles and accept architecture and resource overrides", () => {
    const defaults = productionBuildOptions([]);
    assert.equal(defaults.profile, "production");
    assert.equal(defaults.clean, undefined);
    assert.equal(defaults.jobs, undefined);
    assert.equal(selectedArchitectures(defaults.arch).length, 4);
    const options = productionBuildOptions(["--profile", "preprod", "--arch", "arm64-v8a", "--jobs", "7", "--heap", "8192"]);
    assert.deepEqual(selectedArchitectures(options.arch), ["arm64-v8a"]);
    assert.equal(artifactName(options), "cryptex-vault-preprod-arm64-v8a.apk");
    assert.equal(artifactName({ ...options, unsigned: true }), "cryptex-vault-preprod-arm64-v8a-unsigned.apk");
    assert.equal(artifactName(defaults), "cryptex-vault.apk");
    const install = parseReleaseOptions(["--profile", "preprod", "--arch", "arm64-v8a"], { allowApk: true });
    assert.ok(install.apk.endsWith("/mobile/dist/cryptex-vault-preprod-arm64-v8a.apk"));
    for (const args of [["--arch", "arm64"], ["--jobs", "0"], ["--jobs", "1.5"], ["--heap", "-1"], ["--jobs"], ["--clean", "--clean"]]) {
        assert.throws(() => productionBuildOptions(args));
    }
    for (const args of [["--reproduce-from", "release.apk", "--arch", "x86"], ["--reproduce-from", "release.apk", "--jobs", "auto"], ["--distribution", "fdroid", "--heap", "8192"]]) {
        assert.throws(() => productionBuildOptions(args), /Reproduction|pinned resource/);
    }
});

test("all available CPUs are the local default while reproduction settings stay pinned", () => {
    const automatic = resources.buildResources(productionBuildOptions(["--profile", "preprod"]));
    assert.equal(automatic.jobs, availableParallelism());
    assert.equal(automatic.fresh, false);
    assert.doesNotMatch(automatic.jvmArguments, /Xmx|MaxMetaspaceSize/);
    assert.deepEqual(resources.buildResources(productionBuildOptions(["--clean"])), { fresh: true, accelerated: false, jobs: 2, jvmArguments: undefined });
    assert.equal(resources.buildResources(productionBuildOptions(["--reproduce-from", "release.apk"])).accelerated, false);
    const limited = resources.buildResources(productionBuildOptions(["--jobs", "3", "--heap", "4096"]));
    assert.equal(limited.jobs, 3);
    assert.match(limited.jvmArguments, /-Xmx4096m/);
    assert.equal(resources.buildResources(productionBuildOptions(["--clean", "--jobs", "auto"])).jobs, availableParallelism());
});

test("the OpenSSL launcher changes only the compiler job argument", () => {
    assert.deepEqual(makeArguments(["-j2", "build_libs", "CC=clang", "CFLAGS=-O3"], 9), ["-j9", "build_libs", "CC=clang", "CFLAGS=-O3"]);
    assert.deepEqual(makeArguments(["install_sw", "DESTDIR=/tmp/example"], 9), ["install_sw", "DESTDIR=/tmp/example"]);
    assert.throws(() => makeArguments(["-j2"], 0));
});

test("source synchronization preserves native outputs and invalidates the right inputs", () => {
    const temporary = mkdtempSync(join(tmpdir(), "cryptex-local-build-test-"));
    const checkout = join(temporary, "checkout"), staging = join(checkout, ".mobile-build/test/source");
    const put = (file, contents) => { mkdirSync(dirname(join(checkout, file)), { recursive: true }); writeFileSync(join(checkout, file), contents); };
    try {
        mkdirSync(checkout);
        execFileSync("git", ["init", "--quiet"], { cwd: checkout });
        put(".gitignore", ".mobile-build/\nnode_modules/\nmobile/android/\n.env*\n");
        put("package.json", '{"private":true}');
        put("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
        put("mobile/App.tsx", "first app");
        put("packages/vault-core/src/shared.ts", "first shared import");
        put("mobile/plugins/plugin.js", "first plugin");
        put("mobile/android/app/build/cached.so", "original native output");
        put(".env.production", "private");
        put("signing.jks", "private");
        const files = sourceFiles(checkout);
        assert.ok(!files.some(file => /\.env|signing.jks|mobile\/android/.test(file)));
        const first = synchronizeSources(checkout, staging);
        const stagedApp = join(staging, "mobile/App.tsx");
        utimesSync(stagedApp, 100, 100);
        const originalMtime = statSync(stagedApp).mtimeMs;
        const nativeOutput = join(staging, "mobile/android/app/build/cached.so");
        mkdirSync(dirname(nativeOutput), { recursive: true });
        writeFileSync(nativeOutput, "cached compilation");
        const unchanged = synchronizeSources(checkout, staging, first.files);
        assert.equal(unchanged.changed, 0);
        assert.equal(statSync(stagedApp).mtimeMs, originalMtime);
        assert.equal(unchanged.sourceHash, first.sourceHash);
        assert.ok(!sourceFiles(checkout).some(file => file.startsWith(".mobile-build/")));
        put("packages/vault-core/src/shared.ts", "changed shared import");
        const javascript = synchronizeSources(checkout, staging, unchanged.files);
        assert.notEqual(javascript.sourceHash, first.sourceHash);
        assert.equal(javascript.nativeHash, first.nativeHash);
        assert.equal(javascript.dependencyHash, first.dependencyHash);
        assert.equal(readFileSync(nativeOutput, "utf8"), "cached compilation");
        put("mobile/plugins/plugin.js", "changed plugin");
        const native = synchronizeSources(checkout, staging, javascript.files);
        assert.notEqual(native.nativeHash, javascript.nativeHash);
        assert.equal(native.dependencyHash, javascript.dependencyHash);
        put("mobile/eas-project.json", '{"projectId":"changed-native-update-url"}');
        const updateIdentity = synchronizeSources(checkout, staging, native.files);
        assert.notEqual(updateIdentity.nativeHash, native.nativeHash);
        assert.equal(updateIdentity.dependencyHash, native.dependencyHash);
        put("patches/dependency.patch", "reviewed dependency patch");
        const patched = synchronizeSources(checkout, staging, updateIdentity.files);
        assert.notEqual(patched.dependencyHash, updateIdentity.dependencyHash);
        rmSync(join(checkout, "mobile/App.tsx"));
        const removed = synchronizeSources(checkout, staging, patched.files);
        assert.equal(removed.removed, 1);
        assert.equal(existsSync(stagedApp), false);
        assert.equal(readFileSync(join(checkout, "mobile/android/app/build/cached.so"), "utf8"), "original native output");
        assert.throws(() => synchronizeSources(checkout, staging, ["../outside"]), /Invalid cached source path/);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("workspace locks refuse concurrent builds and release on initialization failures", () => {
    const checkout = mkdtempSync(join(tmpdir(), "cryptex-build-lock-test-"));
    const options = productionBuildOptions(["--profile", "preprod"]);
    let workspace;
    try {
        workspace = openBuildWorkspace(checkout, options);
        workspace.save({ dependencyHash: "saved" });
        assert.throws(() => openBuildWorkspace(checkout, options), /already in use/);
        workspace.close();
        workspace = openBuildWorkspace(checkout, options);
        assert.equal(workspace.state.dependencyHash, "saved");
        workspace.close();
        const directory = dirname(workspace.staging);
        writeFileSync(join(directory, "state.json"), "invalid JSON");
        assert.throws(() => openBuildWorkspace(checkout, options), SyntaxError);
        assert.equal(existsSync(join(directory, ".lock")), false);
    } finally { workspace?.close(); rmSync(checkout, { recursive: true, force: true }); }
});

test("repeated native finalization preserves wrapper bytes and modification times", () => {
    const mobile = mkdtempSync(join(tmpdir(), "cryptex-native-finalize-test-"));
    try {
        const wrapper = join(mobile, "android/gradle/wrapper/gradle-wrapper.properties");
        mkdirSync(dirname(wrapper), { recursive: true });
        writeFileSync(wrapper, "distributionUrl=stock\nvalidateDistributionUrl=true\n");
        const options = { toolchain: { gradle: "9.3.1", gradleDistributionSha256: "fixture-checksum" }, metadata: { source: "unchanged" } };
        finalizeNativeSources(mobile, options);
        const first = readFileSync(wrapper);
        utimesSync(wrapper, 100, 100);
        const mtime = statSync(wrapper).mtimeMs;
        finalizeNativeSources(mobile, options);
        assert.deepEqual(readFileSync(wrapper), first);
        assert.equal(statSync(wrapper).mtimeMs, mtime);
        assert.equal(writeIfChanged(wrapper, first), false);
    } finally { rmSync(mobile, { recursive: true, force: true }); }
});

test("Gradle rebuilds shared JS inputs and always refreshes the embedded update", { skip: !process.env.CRYPTEX_LOCAL_GRADLE_TEST_COMMAND }, () => {
    const project = mkdtempSync(join(tmpdir(), "cryptex-gradle-inputs-test-"));
    try {
        copyFileSync(new URL("./local-build.gradle", import.meta.url), join(project, "local-build.gradle"));
        writeFileSync(join(project, "settings.gradle"), "rootProject.name = 'local-build-inputs'\n");
        writeFileSync(join(project, "build.gradle"), `
tasks.register('createBundleReleaseJsAndAssets') {
    outputs.file(layout.buildDirectory.file('bundle.txt'))
    doLast { outputs.files.singleFile.text = System.getenv('CRYPTEX_LOCAL_BUILD_SOURCE_HASH') }
}
tasks.register('createReleaseUpdatesResources') {
    outputs.file(layout.buildDirectory.file('manifest.txt'))
    doLast { outputs.files.singleFile.text = 'refreshed' }
}
`);
        const run = sourceHash => {
            const result = spawnSync(resolve(process.env.CRYPTEX_LOCAL_GRADLE_TEST_COMMAND), ["--no-daemon", "--console=plain", "--max-workers=2", "-Dorg.gradle.jvmargs=-Xmx256m", "--init-script", join(project, "local-build.gradle"), "-p", project, "createBundleReleaseJsAndAssets", "createReleaseUpdatesResources"], {
                encoding: "utf8", env: { ...process.env, CRYPTEX_LOCAL_BUILD_SOURCE_HASH: sourceHash, CRYPTEX_LOCAL_BUILD_CONFIG_HASH: "config", CRYPTEX_SOURCE_REVISION: "revision" },
            });
            assert.equal(result.status, 0, result.stderr || result.stdout);
            return result.stdout;
        };
        run("initial");
        const repeated = run("initial");
        assert.match(repeated, /> Task :createBundleReleaseJsAndAssets UP-TO-DATE/);
        assert.doesNotMatch(repeated, /> Task :createReleaseUpdatesResources UP-TO-DATE/);
        const changed = run("changed-shared-module");
        assert.doesNotMatch(changed, /> Task :createBundleReleaseJsAndAssets UP-TO-DATE/);
        assert.equal(readFileSync(join(project, "build/bundle.txt"), "utf8"), "changed-shared-module");
    } finally { rmSync(project, { recursive: true, force: true }); }
});
