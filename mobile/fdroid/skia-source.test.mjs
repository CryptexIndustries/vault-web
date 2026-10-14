import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import {
    fetchSkiaDependencies,
    skiaArchives,
    skiaArguments,
    skiaTargets,
    verifySkiaSources,
} from "./skia-source.mjs";

test("source fetch rejects an unpinned checkout before deleting its resources", () => {
    const root = mkdtempSync(join(tmpdir(), "cryptex-skia-pin-test-"));
    try {
        const skia = join(root, "skia");
        const gn = join(root, "gn");
        mkdirSync(join(skia, "resources"), { recursive: true });
        mkdirSync(gn);
        writeFileSync(join(skia, "resources/keep.txt"), "unreviewed source");
        execFileSync("git", ["init", "--quiet"], { cwd: skia });
        execFileSync("git", ["add", "."], { cwd: skia });
        execFileSync(
            "git",
            [
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "fixture",
            ],
            { cwd: skia },
        );
        assert.throws(
            () => fetchSkiaDependencies(skia, gn),
            /Wrong source commit/,
        );
        assert.equal(
            readFileSync(join(skia, "resources/keep.txt"), "utf8"),
            "unreviewed source",
        );
    } finally {
        rmSync(root, { recursive: true });
    }
});

test("source verification refuses a linked checkout before invoking tools", () => {
    const root = mkdtempSync(join(tmpdir(), "cryptex-skia-link-test-"));
    try {
        mkdirSync(join(root, "source"));
        symlinkSync(join(root, "source"), join(root, "link"));
        assert.throws(
            () => verifySkiaSources(join(root, "link"), join(root, "source")),
            /must not be a symlink/,
        );
    } finally {
        rmSync(root, { recursive: true });
    }
});

test("Ganesh configuration retains runtime ICU and paragraph across every Android ABI", () => {
    for (const cpu of Object.keys(skiaTargets)) {
        const args = skiaArguments(cpu, "/android-ndk", [
            ["/checkout", "/cryptex/skia-source"],
        ]);
        assert.ok(args.includes(`target_cpu="${cpu}"`));
        for (const name of [
            "skia_enable_skparagraph",
            "skia_use_harfbuzz",
            "skia_use_runtime_icu",
            "skia_use_gl",
        ]) {
            assert.ok(args.includes(`${name}=true`), name);
        }
        for (const name of [
            "skia_enable_graphite",
            "skia_use_dawn",
            "skia_enable_tools",
            "skia_use_system_icu",
        ]) {
            assert.ok(args.includes(`${name}=false`), name);
        }
        assert.ok(
            args.includes("-ffile-prefix-map=/checkout=/cryptex/skia-source"),
        );
        assert.ok(
            args.includes("-fdebug-prefix-map=/checkout=/cryptex/skia-source"),
        );
    }
    assert.throws(
        () => skiaArguments("unsupported", "/android-ndk"),
        /Unsupported Skia CPU/,
    );
});

test("source outputs cover every static archive linked by the installed Ganesh bridge", () => {
    const cmake = readFileSync(
        new URL(
            "../node_modules/@shopify/react-native-skia/android/CMakeLists.txt",
            import.meta.url,
        ),
        "utf8",
    );
    const variables = new Map(
        [...cmake.matchAll(/set\s*\((SKIA_\w+)\s+"([^"]+)"\)/g)].map(
            (match) => [match[1], match[2]],
        ),
    );
    const imports = new Map(
        [
            ...cmake.matchAll(
                /set_property\(TARGET (\w+) PROPERTY IMPORTED_LOCATION "\$\{SKIA_LIBS_PATH\}\/([^"/]+)"\)/g,
            ),
        ].map((match) => [match[1], match[2]]),
    );
    const linked = new Set(
        [...cmake.matchAll(/set\(COMMON_LIBS([\s\S]*?)\)/g)].flatMap((match) =>
            [...match[1].matchAll(/\$\{(SKIA_\w+)\}/g)].map((variable) =>
                imports.get(variables.get(variable[1])),
            ),
        ),
    );
    assert.ok(
        !linked.has(undefined),
        "Every linked Skia variable must resolve to a known archive.",
    );
    assert.deepEqual(new Set(skiaArchives), linked);
    assert.equal(imports.get("pathops"), "libpathops.a");
    assert.ok(
        !linked.has("libpathops.a"),
        "The unused pathops import must not become a source-build input.",
    );
});

test("Android packaging copies the complete pinned Skia redistribution notices", async () => {
    const root = mkdtempSync(join(tmpdir(), "cryptex-skia-notices-test-"));
    try {
        const pluginModule = { exports: {} };
        const require = createRequire(import.meta.url);
        const plugin = new URL(
            "../plugins/with-android-dependency-verification.js",
            import.meta.url,
        );
        runInNewContext(readFileSync(plugin, "utf8"), {
            module: pluginModule,
            require: (name) =>
                name === "@expo/config-plugins"
                    ? {
                          withProjectBuildGradle: (config) => config,
                          withDangerousMod: (_config, [, copyNotices]) =>
                              copyNotices,
                      }
                    : require(name),
        });
        const copyNotices = pluginModule.exports({});
        await copyNotices({
            modRequest: {
                projectRoot: fileURLToPath(new URL("..", import.meta.url)),
                platformProjectRoot: root,
            },
        });
        const bundled = readFileSync(
            join(root, "app/src/main/assets/licenses/skia-2.6.2.txt"),
            "utf8",
        );
        assert.equal(
            bundled,
            readFileSync(
                new URL("notices/skia-2.6.2.txt", import.meta.url),
                "utf8",
            ),
        );
        assert.ok(bundled.includes("Copyright 2021-present, Shopify Inc."));
        assert.ok(bundled.includes("Copyright (c) 2011 Google Inc."));
        assert.ok(
            bundled.includes(
                "Portions of this software are copyright the FreeType Project.",
            ),
        );
        assert.ok(
            bundled.includes(
                "This software is based in part on the work of the Independent JPEG Group.",
            ),
        );
    } finally {
        rmSync(root, { recursive: true });
    }
});
