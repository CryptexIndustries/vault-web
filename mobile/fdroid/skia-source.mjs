import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const skiaSource = JSON.parse(
    readFileSync(new URL("skia-source.json", import.meta.url), "utf8"),
);
const toolchain = JSON.parse(
    readFileSync(new URL("toolchain.json", import.meta.url), "utf8"),
);
export const skiaTargets = {
    arm: "armeabi-v7a",
    arm64: "arm64-v8a",
    x86: "x86",
    x64: "x86_64",
};
export const skiaArchives = [
    "libskia.a",
    "libskshaper.a",
    "libsvg.a",
    "libskottie.a",
    "libsksg.a",
    "libjsonreader.a",
    "libskparagraph.a",
    "libskunicode_core.a",
    "libskunicode_icu.a",
];

const run = (command, args, cwd, env = process.env) =>
    execFileSync(command, args, { cwd, env, stdio: "inherit" });
const capture = (command, args, cwd) =>
    execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
const digest = (path) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");

function verifyTrackedSource(directory, source) {
    assert.equal(
        capture("git", ["rev-parse", "HEAD"], directory),
        source.commit,
        `Wrong source commit: ${directory}`,
    );
    const changes = execFileSync(
        "git",
        ["status", "--porcelain", "-z", "--untracked-files=no"],
        { cwd: directory, encoding: "utf8" },
    );
    for (const entry of changes.split("\0").filter(Boolean)) {
        const path = entry.slice(3);
        assert.ok(
            entry.slice(0, 2).trim() === "D" &&
                (source.cleanup ?? []).some(
                    (item) => path === item || path.startsWith(`${item}/`),
                ),
            `Unreviewed source change: ${directory}/${path}`,
        );
    }
}

function sourceDirectory(path) {
    assert.ok(isAbsolute(path), "Use an absolute source checkout path.");
    assert.ok(
        !lstatSync(path).isSymbolicLink(),
        "Source checkout must not be a symlink.",
    );
    return realpathSync(path);
}

export function verifySkiaSources(skiaDirectory, gnDirectory) {
    const skia = sourceDirectory(skiaDirectory);
    const gn = sourceDirectory(gnDirectory);
    verifyTrackedSource(skia, skiaSource.skia);
    verifyTrackedSource(gn, skiaSource.gn);
    assert.equal(
        digest(join(skia, "DEPS")),
        skiaSource.skia.depsSha256,
        "Skia dependency pins changed.",
    );
    const deps = readFileSync(join(skia, "DEPS"), "utf8");
    for (const item of skiaSource.dependencies) {
        assert.ok(
            deps.includes(`${item.repo}@${item.commit}`),
            `Dependency is absent from pinned Skia DEPS: ${item.path}`,
        );
    }
    assert.ok(
        readFileSync(join(skia, "bin/fetch-gn"), "utf8").includes(
            skiaSource.gn.commit,
        ),
        "GN pin differs from Skia's tool pin.",
    );
    return { skia, gn };
}

function removeUnused(directory, paths = []) {
    for (const path of paths) {
        const target = join(directory, path);
        assert.ok(
            target.startsWith(`${directory}/`) &&
                !path.split("/").includes(".."),
            "Unsafe source cleanup path.",
        );
        if (existsSync(target)) {
            assert.ok(
                !lstatSync(target).isSymbolicLink(),
                `Refusing linked source cleanup target: ${target}`,
            );
            rmSync(target, { recursive: true });
        }
    }
}

// This phase fetches source only, before F-Droid scanning. Do not invoke gclient,
// depot_tools, fetch-gn or git-sync-deps: those can download prebuilt host tools.
export function fetchSkiaDependencies(skiaDirectory, gnDirectory) {
    const { skia, gn } = verifySkiaSources(skiaDirectory, gnDirectory);
    for (const item of skiaSource.dependencies) {
        const destination = join(skia, item.path);
        if (!existsSync(destination)) {
            mkdirSync(destination, { recursive: true });
            run("git", ["init", "--quiet"], destination);
            run("git", ["remote", "add", "origin", item.repo], destination);
            run(
                "git",
                ["fetch", "--depth=1", "origin", item.commit],
                destination,
            );
            run(
                "git",
                ["checkout", "--quiet", "--detach", "FETCH_HEAD"],
                destination,
            );
        }
        verifyTrackedSource(sourceDirectory(destination), item);
        removeUnused(destination, item.cleanup);
    }
    removeUnused(skia, skiaSource.skia.cleanup);
    removeUnused(gn, skiaSource.gn.cleanup);
}

// These are the standard Ganesh Android arguments from RN Skia v2.6.2's
// scripts/skia-configuration.ts. Runtime ICU uses Android's ICU, not icudtl.dat.
export function skiaArguments(cpu, ndk, paths = []) {
    assert.ok(Object.hasOwn(skiaTargets, cpu), `Unsupported Skia CPU: ${cpu}`);
    const args = {
        target_os: "android",
        target_cpu: cpu,
        ndk,
        skia_use_piex: true,
        skia_use_system_expat: false,
        skia_use_system_libjpeg_turbo: false,
        skia_use_system_libpng: false,
        skia_use_system_libwebp: false,
        skia_use_system_zlib: false,
        skia_enable_tools: false,
        is_official_build: true,
        skia_enable_skottie: true,
        is_debug: false,
        skia_enable_pdf: false,
        paragraph_tests_enabled: false,
        is_component_build: false,
        skia_enable_graphite: false,
        skia_use_dawn: false,
        skia_use_system_freetype2: false,
        skia_use_gl: true,
        cc: "clang",
        cxx: "clang++",
        extra_cflags: [
            "-DSKIA_C_DLL",
            "-DHAVE_SYSCALL_GETRANDOM",
            "-DXML_DEV_URANDOM",
            ...paths.flatMap(([source, replacement]) => [
                `-ffile-prefix-map=${source}=${replacement}`,
                `-fdebug-prefix-map=${source}=${replacement}`,
            ]),
        ],
        skia_enable_skparagraph: true,
        skia_use_system_icu: false,
        skia_use_harfbuzz: true,
        skia_use_system_harfbuzz: false,
        skia_use_icu: true,
        skia_use_runtime_icu: true,
    };
    return Object.entries(args)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join(" ");
}

// Invoke only after scanning. No source or binary downloads occur in this phase.
export function buildSkiaLibraries({
    skiaDirectory,
    gnDirectory,
    packageDirectory,
    outputDirectory,
    ndkDirectory,
    cpus = Object.keys(skiaTargets),
    env = process.env,
}) {
    const { skia, gn } = verifySkiaSources(skiaDirectory, gnDirectory);
    const pkg = sourceDirectory(packageDirectory);
    const manifest = JSON.parse(
        readFileSync(join(pkg, "package.json"), "utf8"),
    );
    assert.equal(manifest.name, "@shopify/react-native-skia");
    assert.equal(
        manifest.version,
        skiaSource.reactNativeSkiaVersion,
        "Wrong React Native Skia package version.",
    );
    assert.equal(
        digest(join(pkg, "android/CMakeLists.txt")),
        skiaSource.packageCmakeSha256,
        "Skia bridge CMake source changed.",
    );
    assert.ok(
        isAbsolute(outputDirectory) && isAbsolute(ndkDirectory),
        "Use absolute build and NDK paths.",
    );
    assert.match(
        readFileSync(join(ndkDirectory, "source.properties"), "utf8"),
        new RegExp(
            `Pkg\\.Revision = ${toolchain.ndk.replaceAll(".", "\\.")}(?:\\s|$)`,
        ),
        "Use the pinned Android NDK.",
    );
    assert.ok(
        cpus.length &&
            new Set(cpus).size === cpus.length &&
            cpus.every((cpu) => Object.hasOwn(skiaTargets, cpu)),
        "Invalid Skia CPU list.",
    );
    assert.ok(
        !env.SK_GRAPHITE,
        "The F-Droid source recipe supports the standard Ganesh build.",
    );
    for (const item of skiaSource.dependencies) {
        verifyTrackedSource(sourceDirectory(join(skia, item.path)), item);
    }
    // Refuse copied npm archives instead of silently overwriting them.
    for (const abi of Object.values(skiaTargets)) {
        assert.ok(
            !existsSync(join(pkg, "libs/android", abi)),
            `Remove prebuilt Skia libraries before scanning: ${abi}`,
        );
    }
    mkdirSync(outputDirectory, { recursive: true });
    const gnOut = join(outputDirectory, "gn");
    run(
        "python3",
        ["build/gen.py", `--out-path=${gnOut}`, "--no-last-commit-position"],
        gn,
        { ...env, CXX: "g++" },
    );
    // The shallow checkout has no commit-count history. Embed the verified full
    // source pin in the tool's version instead of fetching mutable history.
    writeFileSync(
        join(gnOut, "last_commit_position.h"),
        `#define LAST_COMMIT_POSITION_NUM 0\n#define LAST_COMMIT_POSITION "source ${skiaSource.gn.commit}"\n`,
    );
    run("ninja", ["-C", gnOut, "-j2", "gn"], gn, env);
    const gnBinary = join(gnOut, "gn");
    const built = [];
    for (const cpu of cpus) {
        const out = join(outputDirectory, cpu);
        const paths = [
            [skia, "/cryptex/skia-source"],
            [relative(out, skia), "/cryptex/skia-source"],
            [outputDirectory, "/cryptex/skia-build"],
            [ndkDirectory, "/cryptex/android-ndk"],
        ];
        run(
            gnBinary,
            [
                "gen",
                out,
                "--script-executable=python3",
                `--args=${skiaArguments(cpu, ndkDirectory, paths)}`,
            ],
            skia,
            env,
        );
        run("ninja", ["-C", out, "-j2", ...skiaArchives], skia, {
            ...env,
            ZERO_AR_DATE: "1",
        });
        const destination = join(pkg, "libs/android", skiaTargets[cpu]);
        mkdirSync(destination, { recursive: true });
        for (const name of skiaArchives) {
            const source = join(out, name);
            assert.equal(
                readFileSync(source).subarray(0, 8).toString(),
                "!<arch>\n",
                `Missing static archive: ${source}`,
            );
            copyFileSync(source, join(destination, name));
            built.push({ abi: skiaTargets[cpu], name, sha256: digest(source) });
        }
    }
    const provenance = {
        ...skiaSource,
        ndk: toolchain.ndk,
        tools: {
            gn: capture(gnBinary, ["--version"], gn),
            cxx: capture("g++", ["--version"], gn).split("\n")[0],
            ninja: capture("ninja", ["--version"], skia),
            python: capture("python3", ["--version"], gn),
            clang: capture(
                join(
                    ndkDirectory,
                    "toolchains/llvm/prebuilt/linux-x86_64/bin/clang",
                ),
                ["--version"],
                skia,
            ).split("\n")[0],
        },
        libraries: built,
    };
    writeFileSync(
        join(outputDirectory, "skia-source-build.json"),
        JSON.stringify(provenance, null, 2) + "\n",
    );
    return provenance;
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    const [
        phase,
        skiaDirectory,
        gnDirectory,
        packageDirectory,
        outputDirectory,
        cpu,
    ] = process.argv.slice(2);
    assert.ok(
        ["fetch", "build"].includes(phase),
        "Use fetch <Skia source> <GN source>, or build <Skia source> <GN source> <npm package> <output> [CPU].",
    );
    assert.equal(
        process.argv.length,
        phase === "fetch" ? 5 : cpu ? 8 : 7,
        "Unexpected Skia build arguments.",
    );
    if (phase === "fetch") fetchSkiaDependencies(skiaDirectory, gnDirectory);
    else
        buildSkiaLibraries({
            skiaDirectory,
            gnDirectory,
            packageDirectory,
            outputDirectory,
            ndkDirectory: process.env.ANDROID_NDK,
            ...(cpu ? { cpus: [cpu] } : {}),
        });
}
