import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    architectures,
    artifactName,
    getProfile,
    loadReleaseConfig,
    releaseVersion,
} from "./release-config.mjs";
import { validateSigningIdentity } from "./signing.mjs";
import { verifyRelease } from "./verify-release.mjs";
import { buildPlayBundle } from "./play-bundle.mjs";

const mobile = fileURLToPath(new URL("../", import.meta.url));
const sha256 = (path) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");

export function signCiRelease(
    profile,
    directory,
    env = process.env,
    distribution = profile === "production" ? "fdroid" : "standard",
) {
    const selected = getProfile(profile);
    assert.ok(
        ["standard", "fdroid", "play"].includes(distribution),
        "Unknown release distribution.",
    );
    // Releases sign all four ABIs; preprod F-Droid runs sign the ABIs they built.
    const targets =
        distribution !== "fdroid"
            ? ["all"]
            : profile === "production"
              ? architectures
              : architectures.filter((arch) =>
                    existsSync(
                        join(
                            directory,
                            artifactName({
                                profile,
                                distribution,
                                arch,
                                unsigned: true,
                            }),
                        ),
                    ),
                );
    assert.ok(targets.length, "No unsigned APKs to sign.");
    const configPath = join(directory, "release-config.json");
    const config = loadReleaseConfig(configPath);
    const app = JSON.parse(readFileSync(join(mobile, "app.json"), "utf8")).expo;
    const identity = JSON.parse(
        readFileSync(join(mobile, selected.signingIdentityFile), "utf8"),
    );
    const toolchain = JSON.parse(
        readFileSync(join(mobile, "fdroid/toolchain.json"), "utf8"),
    );
    const inspectionEnv = { ...env };
    for (const name of Object.keys(inspectionEnv))
        if (name.startsWith("CRYPTEX_KEY")) delete inspectionEnv[name];
    const releases = targets.map((arch) => {
        const unsigned = join(
            directory,
            artifactName({ profile, distribution, arch, unsigned: true }),
        );
        const signed = join(
            directory,
            artifactName({ profile, distribution, arch }),
        );
        const verification = verifyRelease(unsigned, {
            unsigned: true,
            profile,
            distribution,
            arch,
            config,
            env: inspectionEnv,
        });
        if (env.GITHUB_ACTIONS === "true") {
            const commit = execFileSync("git", ["rev-parse", "HEAD"], {
                cwd: resolve(mobile, ".."),
                env: inspectionEnv,
                encoding: "utf8",
            }).trim();
            assert.deepEqual(
                verification.sourceRevision,
                { commit, dirty: false },
                "CI must sign the complete clean source revision for this run.",
            );
        }
        const unsignedHash = sha256(unsigned);
        const receipt = JSON.parse(readFileSync(`${unsigned}.json`, "utf8"));
        assert.deepEqual(
            receipt.version,
            releaseVersion(app, { distribution, arch }),
            "Unsigned receipt has the wrong ABI version code.",
        );
        assert.deepEqual(
            receipt.sourceRevision,
            verification.sourceRevision,
            "Unsigned receipt has the wrong source revision.",
        );
        if (receipt.apkSha256)
            assert.equal(
                receipt.apkSha256,
                unsignedHash,
                "Unsigned APK differs from its build receipt.",
            );
        return { arch, unsigned, signed, unsignedHash, receipt };
    });
    assert.ok(
        env.CRYPTEX_KEYSTORE_BASE64 &&
            env.CRYPTEX_KEYSTORE_PASSWORD &&
            env.CRYPTEX_KEY_PASSWORD,
        "Missing GitHub signing secrets.",
    );
    const keystore = Buffer.from(env.CRYPTEX_KEYSTORE_BASE64, "base64");
    assert.ok(
        keystore.toString("base64") === env.CRYPTEX_KEYSTORE_BASE64,
        "Invalid base64 keystore.",
    );
    const privateDirectory = mkdtempSync(
        join(env.RUNNER_TEMP || tmpdir(), "cryptex-ci-signing-"),
    );
    try {
        const path = join(privateDirectory, "release.p12");
        writeFileSync(path, keystore, { mode: 0o600, flag: "wx" });
        const signingEnv = {
            ...inspectionEnv,
            CRYPTEX_KEYSTORE: path,
            CRYPTEX_KEY_ALIAS: identity.alias,
            CRYPTEX_KEYSTORE_PASSWORD: env.CRYPTEX_KEYSTORE_PASSWORD,
            CRYPTEX_KEY_PASSWORD: env.CRYPTEX_KEY_PASSWORD,
        };
        validateSigningIdentity(signingEnv, identity);
        const apksigner = join(
            env.ANDROID_HOME || env.ANDROID_SDK_ROOT,
            "build-tools",
            toolchain.signingBuildTools,
            "apksigner",
        );
        for (const {
            arch,
            unsigned,
            signed,
            unsignedHash,
            receipt,
        } of releases) {
            execFileSync(
                apksigner,
                [
                    "sign",
                    "--ks",
                    path,
                    "--ks-key-alias",
                    identity.alias,
                    "--ks-pass",
                    "env:CRYPTEX_KEYSTORE_PASSWORD",
                    "--key-pass",
                    "env:CRYPTEX_KEY_PASSWORD",
                    "--v1-signing-enabled",
                    "true",
                    "--v2-signing-enabled",
                    "true",
                    "--v3-signing-enabled",
                    "true",
                    "--v4-signing-enabled",
                    "false",
                    "--out",
                    signed,
                    unsigned,
                ],
                { env: signingEnv, stdio: "pipe" },
            );
            const signedVerification = verifyRelease(signed, {
                profile,
                distribution,
                arch,
                config,
                env: inspectionEnv,
            });
            assert.equal(
                sha256(unsigned),
                unsignedHash,
                "Signing must preserve the unsigned APK.",
            );
            writeFileSync(
                `${signed}.json`,
                JSON.stringify(
                    {
                        ...receipt,
                        ...signedVerification,
                        signed: true,
                        apkSha256: sha256(signed),
                        unsignedApkSha256: unsignedHash,
                        configFileSha256: sha256(configPath),
                    },
                    null,
                    2,
                ) + "\n",
            );
        }
        const files = [
            configPath,
            ...releases.flatMap(({ unsigned, signed }) => [
                unsigned,
                `${unsigned}.json`,
                signed,
                `${signed}.json`,
            ]),
        ];
        if (distribution === "play") {
            const [{ unsigned, signed }] = releases;
            const aab = signed.replace(/\.apk$/, ".aab");
            buildPlayBundle({
                unsignedBundle: unsigned.replace(/\.apk$/, ".aab"),
                output: aab,
                unsigned: false,
                env: signingEnv,
                metadata: { signer: identity },
            });
            files.push(aab);
        }
        writeFileSync(
            join(directory, "SHA256SUMS"),
            files
                .map((path) => `${sha256(path)}  ${basename(path)}`)
                .join("\n") + "\n",
        );
        return releases.map(({ signed }) => signed);
    } finally {
        keystore.fill(0);
        rmSync(privateDirectory, { recursive: true, force: true });
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
    try {
        const [command, first, second, distribution, ...extra] =
            process.argv.slice(2);
        assert.equal(extra.length, 0, "Unexpected CI release arguments.");
        if (command === "sign" && first && second) {
            for (const apk of signCiRelease(
                first,
                resolve(second),
                process.env,
                distribution,
            ))
                console.log(`Verified signed APK: ${apk}`);
        } else
            throw new Error(
                "Use sign <production|preprod> <artifact directory> [fdroid|play].",
            );
    } catch (error) {
        // Child process failures must never print their environment or input.
        console.error(error.message);
        process.exitCode = 1;
    }
}
