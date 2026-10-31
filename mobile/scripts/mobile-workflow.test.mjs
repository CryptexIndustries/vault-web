import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import yaml from "js-yaml";

const workflow = yaml.load(
    readFileSync(
        new URL("../../.github/workflows/mobile.yml", import.meta.url),
        "utf8",
    ),
);
const fdroid = yaml.load(
    readFileSync(
        new URL("../../.github/workflows/mobile-fdroid.yml", import.meta.url),
        "utf8",
    ),
);
const play = yaml.load(
    readFileSync(
        new URL(
            "../../.github/workflows/mobile-google-play.yml",
            import.meta.url,
        ),
        "utf8",
    ),
);
const expression = (value, context) =>
    runInNewContext(value.replace(/^\$\{\{\s*|\s*\}\}$/g, ""), context);

test("mobile CI uses full action commit hashes and read-only credentials", () => {
    for (const definition of [workflow, fdroid, play]) {
        assert.deepEqual(definition.permissions, { contents: "read" });
        for (const job of Object.values(definition.jobs)) {
            if (job.uses) {
                assert.ok(
                    [
                        "./.github/workflows/mobile-fdroid.yml",
                        "./.github/workflows/mobile-google-play.yml",
                    ].includes(job.uses),
                );
                continue;
            }
            assert.equal(job["runs-on"], "ubuntu-24.04");
            for (const step of job.steps) {
                if (!step.uses) continue;
                assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
                if (step.uses.startsWith("actions/checkout@")) {
                    assert.equal(step.with["persist-credentials"], false);
                }
            }
        }
    }
});

test("Maestro installation pins its tested release and checks the archive before extraction", () => {
    const install = workflow.jobs.smoke.steps.find(
        (step) => step.name === "Install verified Maestro 2.9.0",
    );
    assert.ok(install);
    assert.match(
        install.run,
        /https:\/\/github\.com\/mobile-dev-inc\/Maestro\/releases\/download\/cli-2\.9\.0\/maestro\.zip/,
    );
    assert.match(
        install.run,
        /855bb2ce1399d82f4f4a73d84a4d945f70b0d43eb86127e027af82809f63f0bd/,
    );
    assert.match(install.run, /--proto '=https' --proto-redir '=https'/);
    assert.doesNotMatch(install.run, /get\.maestro|\|\s*bash|latest/);
    assert.ok(
        install.run.indexOf("sha256sum --check --strict") <
            install.run.indexOf("unzip"),
    );
    assert.ok(install.run.indexOf("unzip") < install.run.indexOf("--version"));
});

test("CI shell scripts parse without executing tools or device commands", () => {
    for (const job of [
        ...Object.values(workflow.jobs),
        ...Object.values(fdroid.jobs),
        ...Object.values(play.jobs),
    ]) {
        for (const step of job.steps || []) {
            const script = step.run ?? step.with?.script;
            if (!script) continue;
            const result = spawnSync("bash", ["-n"], {
                input: script,
                encoding: "utf8",
            });
            assert.equal(result.status, 0, `${step.name}: ${result.stderr}`);
        }
    }
});

test("smoke builds only its test APK and Online Services overrides stay test-only", () => {
    const steps = workflow.jobs.smoke.steps;
    const builds = steps.filter((step) =>
        step.run?.startsWith("pnpm mobile:build"),
    );
    assert.equal(builds.length, 1);
    assert.equal(builds[0].run, "pnpm mobile:build -- --e2e");
    for (const step of steps) {
        if (step.env?.EXPO_PUBLIC_CLOUD_ENABLED === "false") {
            assert.equal(step.run, "pnpm mobile:build -- --e2e");
        }
    }
});

const environments = {
    production: "Mobile - Production",
    preprod: "Mobile - Preproduction",
};
const assertSigningProfile = (name, context, profile) => {
    const job = workflow.jobs[name];
    assert.equal(expression(job.env.RELEASE_PROFILE, context), profile);
    assert.equal(expression(job.environment, context), environments[profile]);
};

test("release triggers select preproduction manually and production only for tags or explicit dispatch", () => {
    assert.deepEqual(workflow.on.workflow_dispatch.inputs.profile.options, [
        "preprod",
        "production",
    ]);
    assert.equal(
        workflow.on.workflow_dispatch.inputs.profile.default,
        "preprod",
    );
    assert.deepEqual(
        workflow.on.workflow_dispatch.inputs.distribution.options,
        ["fdroid", "play"],
    );
    assert.equal(
        workflow.on.workflow_dispatch.inputs.distribution.default,
        "fdroid",
    );
    assert.deepEqual(workflow.on.push.tags, ["mobile-v*"]);
    assert.deepEqual(Object.keys(fdroid.on), ["workflow_call"]);
    assert.deepEqual(Object.keys(play.on), ["workflow_call"]);
    const all = ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"];
    // [fdroid, fdroid_sign, google_play, google_play_sign],
    // then the F-Droid profile and ABIs, then the Play profile.
    const cases = [
        ["pull_request", "refs/pull/1/merge", {}, [false, false, false, false]],
        ["push", "refs/heads/development", {}, [false, false, false, false]],
        ["push", "refs/heads/master", {}, [false, false, false, false]],
        [
            "push",
            "refs/tags/mobile-v0.1.0",
            {},
            [true, true, true, true],
            "production",
            all,
            "production",
        ],
        [
            "workflow_dispatch",
            "refs/heads/development",
            { profile: "preprod", distribution: "fdroid" },
            [true, true, false, false],
            "preprod",
            ["arm64-v8a", "x86_64"],
        ],
        [
            "workflow_dispatch",
            "refs/heads/development",
            { profile: "preprod", distribution: "play" },
            [false, false, true, true],
            undefined,
            undefined,
            "preprod",
        ],
        [
            "workflow_dispatch",
            "refs/tags/mobile-v0.1.0",
            { profile: "production", distribution: "fdroid" },
            [true, true, false, false],
            "production",
            all,
        ],
        [
            "workflow_dispatch",
            "refs/tags/mobile-v0.1.0",
            { profile: "production", distribution: "play" },
            [false, false, true, true],
            undefined,
            undefined,
            "production",
        ],
    ];
    for (const [
        event_name,
        ref,
        inputs,
        expected,
        profile,
        abis,
        playProfile,
    ] of cases) {
        const context = {
            github: { event_name, ref },
            inputs,
            startsWith: (value, prefix) => value.startsWith(prefix),
        };
        const actual = [
            "fdroid",
            "fdroid_sign",
            "google_play",
            "google_play_sign",
        ].map((name) =>
            Boolean(runInNewContext(workflow.jobs[name].if, context)),
        );
        assert.deepEqual(
            actual,
            expected,
            `${event_name} ${ref} ${JSON.stringify(inputs)}`,
        );
        if (playProfile) {
            assert.equal(
                expression(workflow.jobs.google_play.with.profile, context),
                playProfile,
            );
            assertSigningProfile("google_play_sign", context, playProfile);
        }
        if (!profile) continue;
        assert.equal(
            expression(workflow.jobs.fdroid.with.profile, context),
            profile,
        );
        assert.deepEqual(
            JSON.parse(expression(workflow.jobs.fdroid.with.abis, context)),
            abis,
        );
        assertSigningProfile("fdroid_sign", context, profile);
    }
    assert.equal(workflow.jobs.smoke.if, undefined);
    assert.equal(workflow.jobs.smoke.needs, "check");
    assert.equal(workflow.jobs.fdroid.needs, "check");
    assert.deepEqual(workflow.jobs.fdroid_sign.needs, ["fdroid", "smoke"]);
    assert.equal(workflow.jobs.google_play.needs, "check");
    assert.deepEqual(workflow.jobs.google_play_sign.needs, [
        "google_play",
        "smoke",
    ]);
    assert.deepEqual(workflow.jobs.fdroid_release.needs, [
        "fdroid_sign",
        "google_play_sign",
    ]);
});

test("production dispatch rejects branches and version mismatches before building", () => {
    const script = workflow.jobs.check.steps.find(
        (step) => step.name === "Validate release selection",
    ).run;
    const run = (profile, refType, refName) =>
        spawnSync("bash", ["-e", "-c", script], {
            cwd: new URL("../../", import.meta.url),
            encoding: "utf8",
            env: {
                ...process.env,
                RELEASE_PROFILE: profile,
                GITHUB_REF_TYPE: refType,
                GITHUB_REF_NAME: refName,
            },
        });
    const version = JSON.parse(
        readFileSync(new URL("../app.json", import.meta.url), "utf8"),
    ).expo.version;
    assert.equal(run("preprod", "branch", "development").status, 0);
    assert.equal(run("production", "tag", `mobile-v${version}`).status, 0);
    assert.notEqual(run("production", "branch", "development").status, 0);
    assert.notEqual(run("production", "tag", "mobile-v999.0.0").status, 0);
    assert.notEqual(run("other", "tag", `mobile-v${version}`).status, 0);
});

test("signing credentials are scoped to separate signing steps and the matching environment", () => {
    for (const [signer, build, distribution] of [
        ["fdroid_sign", fdroid.jobs.build, "fdroid"],
        ["google_play_sign", play.jobs.build, "play"],
    ]) {
        const job = workflow.jobs[signer];
        const secretSteps = job.steps.filter((step) =>
            JSON.stringify(step).includes("secrets.CRYPTEX_"),
        );
        assert.equal(secretSteps.length, 1);
        assert.equal(
            secretSteps[0].run,
            `node mobile/scripts/ci-release.mjs sign "$RELEASE_PROFILE" "$RUNNER_TEMP/mobile-release" ${distribution}`,
        );
        assert.deepEqual(
            Object.keys(secretSteps[0].env).sort(),
            [
                "CRYPTEX_KEYSTORE_BASE64",
                "CRYPTEX_KEYSTORE_PASSWORD",
                "CRYPTEX_KEY_PASSWORD",
            ].sort(),
        );
        assert.ok(
            !job.steps.some((step) =>
                /pnpm install|mobile:build|gradle/.test(step.run || ""),
            ),
            "Signing must not install app dependencies or rebuild the APK",
        );
        assert.ok(!JSON.stringify(build).includes("secrets."));
        const download = job.steps.find((step) =>
            step.uses?.startsWith("actions/download-artifact@"),
        );
        const artifact =
            download.with.name ??
            download.with.pattern.replace("*", "${{ matrix.abi }}");
        assert.ok(
            build.steps.some((step) => step.with?.name === artifact),
            "Signing must consume the artifact uploaded by its build job",
        );
    }
    for (const [profile, environment] of Object.entries(environments)) {
        assert.equal(
            expression(fdroid.jobs.build.environment, { inputs: { profile } }),
            environment,
        );
    }
    for (const job of [
        play.jobs.build,
        workflow.jobs.check,
        workflow.jobs.smoke,
    ]) {
        assert.equal(job.environment, undefined);
    }
});
