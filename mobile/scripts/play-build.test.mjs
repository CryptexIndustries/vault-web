import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import play from "../config/play.cjs";
import ota from "../config/ota.cjs";
import {
    architectures,
    parseReleaseOptions,
    artifactName,
    loadReleaseConfig,
    releaseVersion,
} from "./release-config.mjs";
import { productionEnvironment } from "./build-android.mjs";
import { runMobile } from "./mobile.mjs";
import { buildPlayBundle } from "./play-bundle.mjs";
const config = {
    ...loadReleaseConfig(),
    EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: "goog_testpublickey",
    EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_PRODUCT_ID: "premium",
    EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID: "monthly",
    EXPO_PUBLIC_GOOGLE_PLAY_YEARLY_PRODUCT_ID: "premium",
    EXPO_PUBLIC_GOOGLE_PLAY_YEARLY_BASE_PLAN_ID: "yearly",
};

test("Play configuration fails before tooling when setup is missing and accepts shared products with distinct base plans", () => {
    assert.equal(play.validatePlayConfig(config), config);
    assert.throws(
        () =>
            play.loadDistributionConfig(
                "/nonexistent/release-config.json",
                "play",
            ),
        /Missing release configuration.*GOOGLE_PLAY/,
    );
    for (const name of play.playConfigKeys)
        assert.throws(
            () => play.validatePlayConfig({ ...config, [name]: undefined }),
            new RegExp(name),
        );
    for (const key of ["sk_secret", "test_store", "appl_apple"])
        assert.throws(
            () =>
                play.validatePlayConfig({
                    ...config,
                    EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: key,
                }),
            /public Google SDK key/,
        );
    assert.throws(
        () =>
            play.validatePlayConfig({
                ...config,
                EXPO_PUBLIC_GOOGLE_PLAY_YEARLY_BASE_PLAN_ID: "monthly",
            }),
        /must differ/,
    );
});

test("Play CLI shares profile config with standard and F-Droid, keeps separate artifacts and refuses incompatible options", () => {
    const options = parseReleaseOptions(["--distribution", "play"]);
    assert.equal(options.configPath, parseReleaseOptions([]).configPath);
    assert.equal(
        options.configPath,
        parseReleaseOptions(["--distribution", "fdroid"]).configPath,
    );
    assert.equal(artifactName(options), "cryptex-vault-play.apk");
    assert.equal(
        parseReleaseOptions(["--distribution", "play", "--profile", "preprod"])
            .configPath,
        parseReleaseOptions(["--profile", "preprod"]).configPath,
    );
    assert.equal(
        artifactName({ ...options, unsigned: true }),
        "cryptex-vault-play-unsigned.apk",
    );
    for (const args of [
        ["--offline-services"],
        ["--arch", "arm64-v8a"],
        ["--reproduce-from", "reference.apk"],
    ])
        assert.throws(() =>
            parseReleaseOptions(["--distribution", "play", ...args], {
                allowBuild: true,
                allowReproduction: true,
            }),
        );
    const calls = [];
    runMobile(["build-play", "--unsigned"], {
        run: (binary, args, options) => {
            calls.push({ binary, args, options });
            return { status: 0 };
        },
    });
    assert.deepEqual(calls[0].args, [
        "scripts/build-android.mjs",
        "--unsigned",
        "--distribution",
        "play",
    ]);
    assert.throws(
        () => runMobile(["build-play", "--distribution", "standard"]),
        /selects the Play distribution/,
    );
});

test("Play version codes take slot 0 of the F-Droid block of ten and grow with every release", () => {
    const app = { version: "1.0.0", android: { versionCode: 3 } };
    assert.equal(releaseVersion(app, { distribution: "play" }).code, 30);
    assert.equal(releaseVersion(app).code, 3);
    for (const arch of architectures)
        assert.notEqual(
            releaseVersion(app, { distribution: "fdroid", arch }).code,
            30,
        );
    assert.ok(
        releaseVersion(
            { ...app, android: { versionCode: 4 } },
            { distribution: "play" },
        ).code >
            releaseVersion(app, { distribution: "fdroid", arch: "x86_64" })
                .code,
    );
});

test("standard and F-Droid never receive Play public config while Play retains it and all release environments ignore ambient values", () => {
    for (const distribution of ["standard", "fdroid", "play"]) {
        const env = productionEnvironment(
            {
                EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: "sk_secret",
                EXPO_PUBLIC_CRYPTEX_E2E: "1",
            },
            config,
            { distribution },
        );
        assert.equal(env.EXPO_PUBLIC_CRYPTEX_E2E, "0");
        for (const name of play.playConfigKeys)
            assert.equal(
                env[name],
                distribution === "play" ? config[name] : undefined,
            );
        if (distribution !== "standard") {
            const native = ota.getOtaConfig({
                profile: "production",
                distribution,
                signingEnabled: true,
            });
            assert.equal(native.updates.enabled, false);
            assert.equal(native.updates.url, undefined);
            assert.equal(native.updates.codeSigningCertificate, undefined);
        }
    }
    const pendingSetup = {
        ...config,
        ...Object.fromEntries(play.playConfigKeys.map((name) => [name, ""])),
    };
    for (const distribution of ["standard", "fdroid"]) {
        const env = productionEnvironment({}, pendingSetup, { distribution });
        for (const name of play.playConfigKeys)
            assert.equal(env[name], undefined);
    }
    assert.throws(
        () => productionEnvironment({}, pendingSetup, { distribution: "play" }),
        /public Google SDK key/,
    );
});

test("only Play APKs declare billing and no APK declares location or advertising ID access", () => {
    const declare = (name) =>
        `E: uses-permission\nA: android:name(0x01010003)="${name}" (Raw: "${name}")\n`;
    const billing = declare("com.android.vending.BILLING");
    play.assertDistributionPermissions(billing, "play");
    play.assertDistributionPermissions("", "standard");
    assert.throws(
        () => play.assertDistributionPermissions("", "play"),
        /missing the Google Play Billing/,
    );
    assert.throws(
        () => play.assertDistributionPermissions(billing, "fdroid"),
        /leaked into a non-Play APK/,
    );
    for (const name of [
        "android.permission.ACCESS_FINE_LOCATION",
        "com.google.android.gms.permission.AD_ID",
    ])
        assert.throws(
            () =>
                play.assertDistributionPermissions(
                    billing + declare(name),
                    "play",
                ),
            new RegExp(name),
        );
});

const javaHome = process.env.JAVA_HOME || "/usr/lib/jvm/java-21-openjdk";
test(
    "standard JAR tools sign the AAB with the pinned upload certificate",
    { skip: !existsSync(join(javaHome, "bin/java")) },
    () => {
        const directory = mkdtempSync(join(tmpdir(), "cryptex-play-signing-"));
        const env = {
            ...process.env,
            JAVA_HOME: javaHome,
            CRYPTEX_KEYSTORE: join(directory, "test.p12"),
            CRYPTEX_KEY_ALIAS: "upload",
            CRYPTEX_KEYSTORE_PASSWORD: "fixture-password",
            CRYPTEX_KEY_PASSWORD: "fixture-password",
        };
        const run = (command, args, options = {}) =>
            execFileSync(command, args, { env, stdio: "pipe", ...options });
        try {
            run(join(javaHome, "bin/keytool"), [
                "-genkeypair",
                "-keystore",
                env.CRYPTEX_KEYSTORE,
                "-storepass:env",
                "CRYPTEX_KEYSTORE_PASSWORD",
                "-keypass:env",
                "CRYPTEX_KEY_PASSWORD",
                "-alias",
                "upload",
                "-keyalg",
                "RSA",
                "-validity",
                "365",
                "-dname",
                "CN=Play fixture",
            ]);
            const certificate = new X509Certificate(
                run(join(javaHome, "bin/keytool"), [
                    "-exportcert",
                    "-keystore",
                    env.CRYPTEX_KEYSTORE,
                    "-storepass:env",
                    "CRYPTEX_KEYSTORE_PASSWORD",
                    "-alias",
                    "upload",
                ]),
            );
            const pin = createHash("sha256")
                .update(certificate.raw)
                .digest("hex");
            const unsignedBundle = join(directory, "unsigned.aab"),
                output = join(directory, "signed.aab");
            writeFileSync(join(directory, "BundleConfig.pb"), "fixture");
            run("zip", ["-q", unsignedBundle, "BundleConfig.pb"], {
                cwd: directory,
            });
            buildPlayBundle({
                unsignedBundle,
                output,
                env,
                metadata: { signer: { certificateSha256: pin } },
            });
            assert.throws(
                () =>
                    buildPlayBundle({
                        unsignedBundle,
                        output,
                        env,
                        metadata: {
                            signer: { certificateSha256: "0".repeat(64) },
                        },
                    }),
                /Unapproved AAB signer/,
            );
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    },
);
