import assert from "node:assert/strict";
import {
    linkSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
    existsSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { prepareSource } from "./prepare-source.mjs";

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "cryptex-fdroid-cleanup-test-"));
    mkdirSync(join(root, "mobile/android/app"), { recursive: true });
    writeFileSync(
        join(root, "mobile/android/app/build.gradle"),
        "android {}\n",
    );
    writeFileSync(
        join(root, "mobile/package.json"),
        JSON.stringify({
            expo: { autolinking: { android: { buildFromSource: [".*"] } } },
        }),
    );
    const pkg = join(
        root,
        "node_modules/.pnpm/expo-camera@57.0.4/node_modules/expo-camera",
    );
    mkdirSync(join(pkg, "local-maven-repo"), { recursive: true });
    mkdirSync(join(pkg, "android/src"), { recursive: true });
    writeFileSync(
        join(pkg, "package.json"),
        JSON.stringify({ name: "expo-camera", version: "57.0.4" }),
    );
    writeFileSync(join(pkg, "local-maven-repo/camera.aar"), "unused");
    writeFileSync(join(pkg, "android/src/Camera.kt"), "source");
    return { root, pkg };
}

test("dry run keeps files; apply removes only reviewed unused paths", () => {
    const { root, pkg } = fixture();
    try {
        assert.equal(prepareSource(root).length, 1);
        assert.equal(
            readFileSync(join(pkg, "local-maven-repo/camera.aar"), "utf8"),
            "unused",
        );
        assert.equal(prepareSource(root, true).length, 1);
        assert.ok(!existsSync(join(pkg, "local-maven-repo")));
        assert.equal(
            readFileSync(join(pkg, "android/src/Camera.kt"), "utf8"),
            "source",
        );
        assert.equal(prepareSource(root, true).length, 0);
    } finally {
        rmSync(root, { recursive: true });
    }
});

test("unknown versions are left for scanner review", () => {
    const { root, pkg } = fixture();
    try {
        writeFileSync(
            join(pkg, "package.json"),
            JSON.stringify({ name: "expo-camera", version: "99.0.0" }),
        );
        assert.equal(prepareSource(root, true).length, 0);
        assert.ok(existsSync(join(pkg, "local-maven-repo/camera.aar")));
    } finally {
        rmSync(root, { recursive: true });
    }
});

test("removes pinned Skia archives and CanvasKit while keeping Android source and licenses", () => {
    const { root } = fixture();
    try {
        const packages = [
            [
                "@shopify/react-native-skia",
                "2.6.2",
                "libs/android/x86_64/libskia.a",
            ],
            [
                "react-native-skia-android",
                "147.1.0",
                "libs/arm64-v8a/libskia.a",
            ],
            [
                "react-native-skia-apple-ios",
                "147.1.0",
                "libs/skia.xcframework/libskia.a",
            ],
            [
                "react-native-skia-apple-macos",
                "147.1.0",
                "libs/skia.xcframework/libskia.a",
            ],
            [
                "react-native-skia-apple-tvos",
                "147.1.0",
                "libs/skia.xcframework/libskia.a",
            ],
            ["canvaskit-wasm", "0.41.0", "bin/canvaskit.wasm"],
        ];
        for (const [name, version, binary] of packages) {
            const pkg = join(
                root,
                "node_modules/.pnpm",
                `${name.replace("/", "+")}@${version}`,
                "node_modules",
                name,
            );
            mkdirSync(dirname(join(pkg, binary)), { recursive: true });
            writeFileSync(
                join(pkg, "package.json"),
                JSON.stringify({ name, version }),
            );
            writeFileSync(join(pkg, binary), "unused prebuilt");
            writeFileSync(join(pkg, "LICENSE"), "upstream license");
            mkdirSync(join(pkg, "android/src"), { recursive: true });
            writeFileSync(join(pkg, "android/src/Skia.cpp"), "Android source");
        }
        assert.equal(prepareSource(root, true).length, 7);
        for (const [name, version, binary] of packages) {
            const pkg = join(
                root,
                "node_modules/.pnpm",
                `${name.replace("/", "+")}@${version}`,
                "node_modules",
                name,
            );
            assert.ok(!existsSync(join(pkg, binary)));
            assert.equal(
                readFileSync(join(pkg, "LICENSE"), "utf8"),
                "upstream license",
            );
            assert.equal(
                readFileSync(join(pkg, "android/src/Skia.cpp"), "utf8"),
                "Android source",
            );
        }
    } finally {
        rmSync(root, { recursive: true });
    }
});

test("unreviewed native Node addons stop cleanup before mutation", () => {
    const { root, pkg } = fixture();
    const addon = join(
        root,
        "node_modules/.pnpm/unreviewed@1.0.0/node_modules/unreviewed/addon.node",
    );
    try {
        mkdirSync(join(addon, ".."), { recursive: true });
        writeFileSync(addon, "unreviewed native compiler");
        assert.throws(
            () => prepareSource(root, true),
            /Unreviewed native Node addon/,
        );
        assert.ok(existsSync(join(pkg, "local-maven-repo/camera.aar")));
        assert.equal(readFileSync(addon, "utf8"), "unreviewed native compiler");
    } finally {
        rmSync(root, { recursive: true });
    }
});

test("removes reviewed web-only WASM without touching Android QR source", () => {
    const { root } = fixture();
    try {
        mkdirSync(join(root, "web/public/wasm-libs"), { recursive: true });
        writeFileSync(
            join(root, "web/public/wasm-libs/zxing_reader.wasm"),
            "web binary",
        );
        mkdirSync(
            join(root, "mobile/modules/credential-provider/android/src"),
            { recursive: true },
        );
        const android = join(
            root,
            "mobile/modules/credential-provider/android/src/QRCode.kt",
        );
        writeFileSync(android, "Android source");
        assert.equal(prepareSource(root, true).length, 2);
        assert.ok(
            !existsSync(join(root, "web/public/wasm-libs/zxing_reader.wasm")),
        );
        assert.equal(readFileSync(android, "utf8"), "Android source");
    } finally {
        rmSync(root, { recursive: true });
    }
});

test("refuses external pnpm store and linked removal targets before mutation", () => {
    const { root, pkg } = fixture();
    const outside = mkdtempSync(join(tmpdir(), "cryptex-fdroid-outside-test-"));
    try {
        rmSync(join(pkg, "local-maven-repo"), { recursive: true });
        symlinkSync(outside, join(pkg, "local-maven-repo"));
        assert.throws(
            () => prepareSource(root, true),
            /Refusing linked removal/,
        );
        rmSync(join(root, "node_modules/.pnpm"), { recursive: true });
        symlinkSync(outside, join(root, "node_modules/.pnpm"));
        assert.throws(
            () => prepareSource(root, true),
            /dependencies must belong/,
        );
    } finally {
        rmSync(root, { recursive: true });
        rmSync(outside, { recursive: true });
    }
});

test("refuses unprepared or non-source-building checkout", () => {
    const { root } = fixture();
    try {
        assert.throws(() => prepareSource("."), /absolute path/);
        rmSync(join(root, "mobile/android/app/build.gradle"));
        assert.throws(() => prepareSource(root, true), /Run Android prebuild/);
        writeFileSync(
            join(root, "mobile/package.json"),
            JSON.stringify({
                expo: { autolinking: { android: { buildFromSource: [] } } },
            }),
        );
        assert.throws(
            () => prepareSource(root, true),
            /Expo AAR removal requires/,
        );
    } finally {
        rmSync(root, { recursive: true });
    }
});

test("reviewed Gradle cleanup preserves a hardlinked dependency cache and rejects changed source", () => {
    const { root } = fixture();
    const outside = mkdtempSync(
        join(tmpdir(), "cryptex-fdroid-hardlink-test-"),
    );
    const require = createRequire(import.meta.url);
    const source = readFileSync(
        join(
            require.resolve("react-native-get-random-values/package.json"),
            "../android/build.gradle",
        ),
        "utf8",
    );
    const pkg = join(
        root,
        "node_modules/.pnpm/react-native-get-random-values@1.11.0/node_modules/react-native-get-random-values",
    );
    const target = join(pkg, "android/build.gradle");
    try {
        mkdirSync(join(pkg, "android"), { recursive: true });
        writeFileSync(
            join(pkg, "package.json"),
            JSON.stringify({
                name: "react-native-get-random-values",
                version: "1.11.0",
            }),
        );
        writeFileSync(target, source + "// unreviewed change\n");
        assert.throws(
            () => prepareSource(root, true),
            /Unreviewed source contents/,
        );
        assert.ok(
            existsSync(
                join(
                    root,
                    "node_modules/.pnpm/expo-camera@57.0.4/node_modules/expo-camera/local-maven-repo",
                ),
            ),
            "A source mismatch must stop the entire cleanup before mutation",
        );
        writeFileSync(target, source);
        linkSync(target, join(outside, "cached.gradle"));
        prepareSource(root, true);
        assert.equal(
            readFileSync(join(outside, "cached.gradle"), "utf8"),
            source,
        );
        assert.ok(
            !readFileSync(target, "utf8").includes(
                'url "$rootDir/../node_modules/react-native/android"',
            ),
        );
        assert.ok(readFileSync(target, "utf8").includes("mavenCentral()"));
        assert.equal(prepareSource(root, true).length, 0);
    } finally {
        rmSync(root, { recursive: true });
        rmSync(outside, { recursive: true });
    }
});
