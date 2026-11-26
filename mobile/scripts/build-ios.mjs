import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, sign } from "node:crypto";
import {
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
    currentSourceRevision,
    productionEnvironment,
    run,
} from "./build-android.mjs";
import { regenerateNativeProject } from "./mobile.mjs";
import { getProfile, loadReleaseConfig } from "./release-config.mjs";

const mobile = fileURLToPath(new URL("../", import.meta.url));
const ios = join(mobile, "ios");
const keyNames = [
    "CRYPTEX_ASC_API_KEY_ID",
    "CRYPTEX_ASC_API_ISSUER_ID",
    "CRYPTEX_ASC_API_KEY",
];

export function parseIosOptions(args) {
    const options = { upload: false };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--upload" && !options.upload) options.upload = true;
        else if (arg === "--build-number" && options.buildNumber === undefined)
            options.buildNumber = args[++index] ?? "";
        else throw new Error(`Invalid or repeated iOS release option: ${arg}`);
    }
    assert.match(
        options.buildNumber ?? "1",
        /^[1-9]\d*(\.\d+){0,2}$/,
        "--build-number takes up to three dot-separated integers.",
    );
    return options;
}

function token({ id, issuer, pem }) {
    const encode = (value) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const body = `${encode({ alg: "ES256", kid: id, typ: "JWT" })}.${encode({ iss: issuer, iat: now, exp: now + 600, aud: "appstoreconnect-v1" })}`;
    const signature = sign("sha256", Buffer.from(body), {
        key: pem,
        dsaEncoding: "ieee-p1363",
    });
    return `${body}.${signature.toString("base64url")}`;
}

// Rides out rate limits, outages and dropped connections, because by the time
// this runs the binary is uploaded or a certificate needs revoking.
async function api(key, path, method = "GET", retryDelay = 10_000) {
    for (let attempt = 1; ; attempt++) {
        // Parsed in the chain so a body cut off mid-read is retried too.
        const { status, body, data, error } = await fetch(
            `https://api.appstoreconnect.apple.com${path}`,
            { method, headers: { Authorization: `Bearer ${token(key)}` } },
        )
            .then(async (response) => {
                const body = await response.text();
                return {
                    status: response.status,
                    body,
                    data:
                        response.ok && response.status !== 204
                            ? JSON.parse(body)
                            : null,
                };
            })
            .catch((error) => ({ error }));
        if (status >= 200 && status < 300) return data;
        // An earlier attempt deleted it, but its response was lost.
        if (method === "DELETE" && status === 404 && attempt > 1) return null;
        const message = `App Store Connect ${method} ${path} ${error ? `failed: ${error.message}` : `failed with ${status}: ${body}`}`;
        if (attempt === 5 || (status && status !== 429 && status < 500))
            throw new Error(message);
        console.log(`${message} Retrying.`);
        await sleep(retryDelay);
    }
}

// Processing problems otherwise only reach the account holder by email.
export async function waitForBuild(
    key,
    { appId, version, buildNumber },
    { attempts = 120, delay = 30_000 } = {},
) {
    const query = new URLSearchParams({
        "filter[app]": appId,
        "filter[version]": buildNumber,
        "filter[preReleaseVersion.version]": version,
        "filter[preReleaseVersion.platform]": "IOS",
    });
    for (let attempt = 0; attempt < attempts; attempt++) {
        const [build] = (await api(key, `/v1/builds?${query}`, "GET", delay))
            .data;
        const state = build?.attributes.processingState;
        assert.ok(
            !["FAILED", "INVALID"].includes(state),
            `App Store Connect marked build ${version} (${buildNumber}) ${state}.`,
        );
        if (state === "VALID") {
            assert.equal(
                build.attributes.buildAudienceType,
                "APP_STORE_ELIGIBLE",
                `Build ${version} (${buildNumber}) can't be attached to an App Store version.`,
            );
            console.log(
                `App Store Connect processed ${version} (${buildNumber}).`,
            );
            return;
        }
        console.log(
            `Waiting for App Store Connect to process ${version} (${buildNumber}): ${state ?? "not listed yet"}.`,
        );
        await sleep(delay);
    }
    throw new Error(
        `App Store Connect didn't finish processing ${version} (${buildNumber}) in time.`,
    );
}

function appStoreKey(env) {
    const present = keyNames.filter((name) => env[name]);
    assert.ok(
        present.length === 0 || present.length === keyNames.length,
        `Set all of ${keyNames.join(", ")} or none.`,
    );
    return present.length
        ? {
              id: env.CRYPTEX_ASC_API_KEY_ID,
              issuer: env.CRYPTEX_ASC_API_ISSUER_ID,
              pem: env.CRYPTEX_ASC_API_KEY,
          }
        : null;
}

// Xcode creates a development certificate on each fresh runner for the
// archive. A separate workflow step runs this even after a failed or cancelled
// build, so the certificates don't pile up on the account.
export async function revokeRunnerCertificates(env = process.env) {
    assert.equal(
        env.RUNNER_ENVIRONMENT,
        "github-hosted",
        "Revoke certificates only on a GitHub-hosted runner, where every signing identity is from this run.",
    );
    const key = appStoreKey(env);
    assert.ok(key, `Revoking certificates needs ${keyNames.join(", ")}.`);
    const fingerprints = new Set(
        execFileSync(
            "/usr/bin/security",
            ["find-identity", "-v", "-p", "codesigning"],
            {
                encoding: "utf8",
                env: {},
            },
        ).match(/\b[0-9A-F]{40}\b/g),
    );
    if (!fingerprints.size) return;
    const { data } = await api(
        key,
        "/v1/certificates?filter[certificateType]=DEVELOPMENT&limit=200&fields[certificates]=certificateContent,name",
    );
    for (const certificate of data) {
        const fingerprint = createHash("sha1")
            .update(
                Buffer.from(
                    certificate.attributes.certificateContent,
                    "base64",
                ),
            )
            .digest("hex")
            .toUpperCase();
        if (!fingerprints.delete(fingerprint)) continue;
        await api(key, `/v1/certificates/${certificate.id}`, "DELETE");
        console.log(`Revoked ${certificate.attributes.name}.`);
    }
    assert.equal(
        fingerprints.size,
        0,
        `Couldn't find certificates ${[...fingerprints].join(", ")} to revoke.`,
    );
}

function exportOptions(teamId, upload) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key><string>app-store-connect</string>
    <key>destination</key><string>${upload ? "upload" : "export"}</string>
    <key>teamID</key><string>${teamId}</string>
    <key>signingStyle</key><string>automatic</string>
    <key>manageAppVersionAndBuildNumber</key><false/>
    <key>testFlightInternalTestingOnly</key><false/>
    <key>uploadSymbols</key><true/>
</dict>
</plist>
`;
}

function verifyArchive(archive, { applicationId, version, buildNumber }) {
    const applications = join(archive, "Products/Applications");
    const app = join(applications, readdirSync(applications)[0]);
    const plugins = join(app, "PlugIns");
    assert.deepEqual(
        readdirSync(plugins),
        ["autofill.appex"],
        "The app must contain exactly the AutoFill extension.",
    );
    for (const [bundle, identifier] of [
        [app, applicationId],
        [join(plugins, "autofill.appex"), `${applicationId}.autofill`],
    ]) {
        const value = (name) =>
            execFileSync(
                "/usr/bin/plutil",
                [
                    "-extract",
                    name,
                    "raw",
                    "-o",
                    "-",
                    join(bundle, "Info.plist"),
                ],
                { encoding: "utf8", env: {} },
            ).trim();
        assert.deepEqual(
            [
                value("CFBundleIdentifier"),
                value("CFBundleShortVersionString"),
                value("CFBundleVersion"),
            ],
            [identifier, version, buildNumber],
            `${bundle} has the wrong identity or version.`,
        );
    }
}

export async function buildIos(
    args = process.argv.slice(2),
    env = process.env,
) {
    const options = parseIosOptions(args);
    const profile = getProfile("production");
    const app = JSON.parse(readFileSync(join(mobile, "app.json"), "utf8")).expo;
    const buildNumber = options.buildNumber ?? app.ios.buildNumber;
    const key = appStoreKey(env);
    assert.ok(!options.upload || key, `--upload needs ${keyNames.join(", ")}.`);
    // Only xcodebuild gets the key, through a file written just before it runs.
    const keyless = { ...env };
    for (const name of keyNames) delete keyless[name];
    const sourceRevision = currentSourceRevision(keyless);
    assert.ok(
        !options.upload || !sourceRevision.dirty,
        "Upload only builds of a clean checkout.",
    );
    const configPath = join(mobile, profile.configFile);
    const buildEnv = {
        ...productionEnvironment(keyless, loadReleaseConfig(configPath), {
            profile: profile.name,
        }),
        // CocoaPods needs a UTF-8 locale that exists on macOS.
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
        CRYPTEX_RELEASE_CONFIG: configPath,
        CRYPTEX_SOURCE_REVISION: JSON.stringify(sourceRevision),
        CRYPTEX_IOS_BUILD_NUMBER: buildNumber,
    };
    const work = mkdtempSync(join(tmpdir(), "cryptex-ios-"));
    const keyPath = join(work, "AuthKey.p8");
    // Without a key, Xcode signs with the account signed in on this Mac.
    const signing = ["-allowProvisioningUpdates"];
    if (key) {
        signing.push(
            "-authenticationKeyPath",
            keyPath,
            "-authenticationKeyID",
            key.id,
            "-authenticationKeyIssuerID",
            key.issuer,
        );
    }
    try {
        regenerateNativeProject(profile, ios);
        // Also installs the pods.
        run("pnpm", ["exec", "expo", "prebuild", "--platform", "ios"], {
            cwd: mobile,
            env: buildEnv,
        });
        if (key) writeFileSync(keyPath, key.pem, { mode: 0o600 });
        const workspace = readdirSync(ios).find((name) =>
            name.endsWith(".xcworkspace"),
        );
        const archive = join(work, "CryptexVault.xcarchive");
        run(
            "xcodebuild",
            [
                "-workspace",
                workspace,
                "-scheme",
                workspace.replace(/\.xcworkspace$/, ""),
                "-configuration",
                "Release",
                "-destination",
                "generic/platform=iOS",
                "-archivePath",
                archive,
                "archive",
                ...signing,
            ],
            { cwd: ios, env: buildEnv },
        );
        verifyArchive(archive, {
            applicationId: profile.applicationId,
            version: app.version,
            buildNumber,
        });
        const plist = join(work, "ExportOptions.plist");
        writeFileSync(
            plist,
            exportOptions(app.ios.appleTeamId, options.upload),
        );
        const output = join(mobile, "dist/ios");
        rmSync(output, { recursive: true, force: true });
        run(
            "xcodebuild",
            [
                "-exportArchive",
                "-archivePath",
                archive,
                "-exportOptionsPlist",
                plist,
                "-exportPath",
                output,
                ...signing,
            ],
            { cwd: ios, env: buildEnv },
        );
        if (options.upload)
            await waitForBuild(key, {
                appId: profile.appStoreAppId,
                version: app.version,
                buildNumber,
            });
        else console.log(`Exported the signed App Store build to ${output}.`);
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    (process.argv[2] === "revoke-runner-certificates"
        ? revokeRunnerCertificates()
        : buildIos()
    ).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
