import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    prepareProduction,
    finalizeNativeSources,
    embeddedManifestEnvironment,
} from "../scripts/build-android.mjs";
import { verifyRelease } from "../scripts/verify-release.mjs";
import { prepareSource } from "./prepare-source.mjs";
import { buildSkiaLibraries } from "./skia-source.mjs";

// F-Droid scans between these phases. Never prebuild again after that scan.
const mobile = dirname(dirname(fileURLToPath(import.meta.url)));
const checkout = dirname(mobile);
const android = join(mobile, "android");
const work = join(mobile, "dist/fdroid-build");
const [phase, esbuildSource, lightningcssSource, skiaSource, gnSource] =
    process.argv.slice(2).map((value, index) => index ? resolve(value) : value);
assert.ok(
    ["prebuild", "build"].includes(phase),
    "Use prebuild or build <esbuild source> <Lightning CSS source> <Skia source> <GN source>.",
);
assert.equal(
    process.argv.length,
    phase === "prebuild" ? 3 : 7,
    "Unexpected F-Droid build arguments.",
);
if (phase === "build") {
    assert.ok(process.env.CRYPTEX_GRADLE_COMMAND, "Set CRYPTEX_GRADLE_COMMAND to installed Gradle.");
    assert.ok(process.env.CRYPTEX_OPENSSL_SOURCE, "Provide the reviewed OpenSSL source library checkout.");
    process.env.CRYPTEX_OPENSSL_SOURCE = resolve(process.env.CRYPTEX_OPENSSL_SOURCE);
    // F-Droid's wrapper selects Gradle from this project's wrapper properties.
    process.chdir(android);
}
const { config, toolchain, env, metadata } = prepareProduction([
    "--unsigned",
    "--distribution",
    "fdroid",
    ...(process.env.CRYPTEX_RELEASE_CONFIG ? ["--config", process.env.CRYPTEX_RELEASE_CONFIG] : []),
]);
const run = (command, args, cwd) =>
    execFileSync(command, args, { cwd, env, stdio: "inherit" });

if (phase === "prebuild") {
    assert.ok(
        realpathSync(join(checkout, "node_modules/.pnpm")).startsWith(
            `${realpathSync(checkout)}/`,
        ),
        "Use an isolated dependency store inside this checkout.",
    );
    run(
        process.execPath,
        [
            "node_modules/expo/bin/cli",
            "prebuild",
            "--clean",
            "--platform",
            "android",
            "--no-install",
        ],
        mobile,
    );
    finalizeNativeSources(mobile, { toolchain, metadata });
    for (const item of prepareSource(checkout, true))
        console.log(`Prepared: ${item.path}`);
} else {
    assert.ok(
        esbuildSource,
        "Provide the reviewed esbuild source library checkout.",
    );
    assert.ok(
        existsSync(join(android, "app/src/main/assets/cryptex-release.json")),
        "Run prebuild and the F-Droid scanner first.",
    );
    assert.ok(
        env.CRYPTEX_OPENSSL_SOURCE && existsSync(join(env.CRYPTEX_OPENSSL_SOURCE, "Configure")),
        "Provide the reviewed OpenSSL source library checkout.",
    );
    mkdirSync(work, { recursive: true });
    const esbuild = join(work, "esbuild");
    env.GOPROXY = "off";
    env.GOSUMDB = "off";
    run(
        "go",
        [
            "build",
            "-trimpath",
            "-ldflags=-s -w",
            "-o",
            esbuild,
            "./cmd/esbuild",
        ],
        resolve(esbuildSource),
    );
    assert.equal(
        execFileSync(esbuild, ["--version"], {
            env,
            cwd: resolve(esbuildSource),
            encoding: "utf8",
        }).trim(),
        "0.25.12",
        "Wrong esbuild source version.",
    );
    env.ESBUILD_BINARY_PATH = esbuild;
    assert.equal(
        JSON.parse(
            readFileSync(join(lightningcssSource, "package.json"), "utf8"),
        ).version,
        "1.27.0",
        "Wrong Lightning CSS source version.",
    );
    assert.ok(
        !existsSync(
            join(
                checkout,
                "node_modules/.pnpm/lightningcss-linux-x64-gnu@1.27.0/node_modules/lightningcss-linux-x64-gnu/lightningcss.linux-x64-gnu.node",
            ),
        ),
        "Remove prebuilt Lightning CSS before source compilation.",
    );
    for (const compiler of ["cargo", "rustc"]) {
        assert.match(
            execFileSync(compiler, ["--version"], {
                env,
                cwd: lightningcssSource,
                encoding: "utf8",
            }),
            new RegExp(`^${compiler} 1\\.76\\.0 `),
            "Use the pinned Rust 1.76.0 toolchain.",
        );
    }
    run(
        "cargo",
        [
            "build",
            "--locked",
            "--offline",
            "--release",
            "--package",
            "lightningcss_node",
            "--jobs",
            "4",
            "--target-dir",
            join(work, "lightningcss"),
        ],
        resolve(lightningcssSource),
    );
    const cssPackage = join(
        checkout,
        "node_modules/.pnpm/lightningcss@1.27.0/node_modules/lightningcss",
    );
    assert.equal(
        JSON.parse(readFileSync(join(cssPackage, "package.json"), "utf8"))
            .version,
        "1.27.0",
    );
    copyFileSync(
        join(work, "lightningcss/release/liblightningcss_node.so"),
        join(cssPackage, "lightningcss.linux-x64-gnu.node"),
    );
    buildSkiaLibraries({
        skiaDirectory: resolve(skiaSource),
        gnDirectory: resolve(gnSource),
        packageDirectory: realpathSync(
            join(mobile, "node_modules/@shopify/react-native-skia"),
        ),
        outputDirectory: join(work, "skia"),
        ndkDirectory: join(env.ANDROID_HOME, "ndk", toolchain.ndk),
        env,
    });
    const embedded = JSON.parse(
        readFileSync(
            join(android, "app/src/main/assets/cryptex-release.json"),
            "utf8",
        ),
    );
    env.CRYPTEX_SOURCE_REVISION = JSON.stringify(embedded.sourceRevision);
    Object.assign(env, embeddedManifestEnvironment(embedded));
    run(
        env.CRYPTEX_GRADLE_COMMAND,
        [
            ":app:assembleRelease",
            "--no-daemon",
            "--no-build-cache",
            "--max-workers=4",
            "--no-parallel",
            "--console=plain",
            "-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=2048m -Dfile.encoding=UTF-8",
            "-PcryptexUnsignedRelease=true",
            "-PreactNativeDevServerIp=127.0.0.1",
            "-PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64",
            `-Pandroid.buildToolsVersion=${toolchain.buildTools}`,
            `-Pandroid.compileSdkVersion=${toolchain.compileSdk}`,
            `-Pandroid.targetSdkVersion=${toolchain.targetSdk}`,
            `-Pandroid.ndkVersion=${toolchain.ndk}`,
        ],
        android,
    );
    const apk = join(mobile, "dist/cryptex-vault-fdroid-unsigned.apk");
    run(
        join(env.ANDROID_HOME, "build-tools", toolchain.buildTools, "zipalign"),
        [
            "-P",
            "16",
            "-f",
            "4",
            join(
                android,
                "app/build/outputs/apk/release/app-release-unsigned.apk",
            ),
            apk,
        ],
    );
    const verification = verifyRelease(apk, {
        unsigned: true,
        distribution: "fdroid",
        env,
        config,
    });
    run(process.execPath, [join(mobile, "scripts/verify-native-crypto.mjs"), "--apk", apk], mobile);
    writeFileSync(
        `${apk}.json`,
        JSON.stringify(
            { ...embedded, ...verification, signed: false },
            null,
            2,
        ) + "\n",
    );
    console.log(`Verified F-Droid APK: ${apk}`);
}
