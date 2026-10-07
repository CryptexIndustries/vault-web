import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import yaml from "js-yaml";

const workflow = yaml.load(readFileSync(new URL("../../.github/workflows/mobile.yml", import.meta.url), "utf8"));
const fdroid = yaml.load(readFileSync(new URL("../../.github/workflows/mobile-fdroid.yml", import.meta.url), "utf8"));
const toolchain = JSON.parse(readFileSync(new URL("../fdroid/toolchain.json", import.meta.url), "utf8"));

test("mobile CI uses full action commit hashes and read-only credentials", () => {
    for (const definition of [workflow, fdroid]) {
        assert.deepEqual(definition.permissions, { contents: "read" });
        for (const job of Object.values(definition.jobs)) {
            if (job.uses) {
                assert.equal(job.uses, "./.github/workflows/mobile-fdroid.yml");
                continue;
            }
            if (job === fdroid.jobs.build || job === fdroid.jobs.check_worker) {
                assert.deepEqual(job["runs-on"], ["self-hosted", "Linux", "X64"]);
            } else {
                assert.equal(job["runs-on"], "ubuntu-24.04");
            }
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

test("validation and Android CI install the exact checked-in Adoptium JDK before mobile commands", () => {
    assert.equal(toolchain.javaVendor, "Eclipse Adoptium");
    for (const name of ["check", "smoke"]) {
        const steps = workflow.jobs[name].steps;
        const java = steps.filter(step => step.uses?.startsWith("actions/setup-java@"));
        assert.equal(java.length, 1, name);
        assert.equal(java[0].uses, "actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3");
        assert.equal(java[0].with.distribution, "temurin", name);
        assert.equal(java[0].with["java-version"], toolchain.java, name);
        const firstMobile = steps.findIndex(step => step.run?.startsWith("pnpm mobile:"));
        assert.ok(firstMobile >= 0 && steps.indexOf(java[0]) < firstMobile, name);
    }
});

test("Maestro installation pins its tested release and checks the archive before extraction", () => {
    const install = workflow.jobs.smoke.steps.find(step => step.name === "Install verified Maestro 2.9.0");
    assert.ok(install);
    assert.match(install.run, /https:\/\/github\.com\/mobile-dev-inc\/Maestro\/releases\/download\/cli-2\.9\.0\/maestro\.zip/);
    assert.match(install.run, /855bb2ce1399d82f4f4a73d84a4d945f70b0d43eb86127e027af82809f63f0bd/);
    assert.match(install.run, /--proto '=https' --proto-redir '=https'/);
    assert.doesNotMatch(install.run, /get\.maestro|\|\s*bash|latest/);
    assert.ok(install.run.indexOf("sha256sum --check --strict") < install.run.indexOf("unzip"));
    assert.ok(install.run.indexOf("unzip") < install.run.indexOf("--version"));
});

test("Android CI runs the pinned native fixtures after SDK installation and before builds", () => {
    const steps = workflow.jobs.smoke.steps;
    const fixture = steps.findIndex(step => step.name === "Verify pinned native build reproducibility fixtures");
    const sdk = steps.findIndex(step => step.name === "Install pinned Android build tools");
    const build = steps.findIndex(step => step.run === "pnpm mobile:build -- --e2e");
    assert.ok(sdk >= 0 && fixture > sdk && build > fixture);
    assert.equal(steps[fixture].run, 'CRYPTEX_NATIVE_TEST_SDK="$ANDROID_SDK_ROOT" pnpm mobile:check -- cli');
    assert.match(steps[sdk].run, /ANDROID_SDK_ROOT=.*GITHUB_ENV/);
});

test("CI shell scripts parse without executing tools or device commands", () => {
    for (const job of [...Object.values(workflow.jobs), ...Object.values(fdroid.jobs)]) {
        for (const step of job.steps || []) {
            const script = step.run ?? step.with?.script;
            if (!script) continue;
            const result = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
            assert.equal(result.status, 0, `${step.name}: ${result.stderr}`);
        }
    }
});

test("native audit output remains unsigned and Online Services overrides stay test-only", () => {
    const steps = workflow.jobs.smoke.steps;
    const production = steps.find(step => step.run === "pnpm mobile:build -- --unsigned --clean");
    assert.ok(production);
    assert.equal(production.env, undefined);
    for (const step of steps) {
        if (step.env?.EXPO_PUBLIC_CLOUD_ENABLED === "false") {
            assert.equal(step.run, "pnpm mobile:build -- --e2e");
        }
    }
});

test("release triggers select preproduction manually and production only for tags or explicit dispatch", () => {
    assert.deepEqual(workflow.on.workflow_dispatch.inputs.profile.options, ["preprod", "production"]);
    assert.equal(workflow.on.workflow_dispatch.inputs.profile.default, "preprod");
    assert.deepEqual(workflow.on.push.tags, ["mobile-v*"]);
    assert.deepEqual(Object.keys(fdroid.on), ["workflow_call", "push"]);
    assert.deepEqual(fdroid.on.push, { branches: ["development"], paths: [".github/workflows/mobile-fdroid.yml"] });
    const cases = [
        ["pull_request", "refs/pull/1/merge", {}, [false, false, false]],
        ["push", "refs/heads/development", {}, [false, false, false]],
        ["push", "refs/heads/master", {}, [false, false, false]],
        ["push", "refs/tags/mobile-v0.1.0", {}, [true, false, true]],
        ["workflow_dispatch", "refs/heads/development", { profile: "preprod" }, [true, true, false]],
        ["workflow_dispatch", "refs/tags/mobile-v0.1.0", { profile: "production" }, [true, false, true]],
    ];
    for (const [event_name, ref, inputs, expected] of cases) {
        const context = { github: { event_name, ref, ref_type: ref.startsWith("refs/tags/") ? "tag" : "branch" }, inputs, startsWith: (value, prefix) => value.startsWith(prefix) };
        const actual = ["smoke", "preprod_build", "fdroid"].map(name => Boolean(runInNewContext(workflow.jobs[name].if, context)));
        assert.deepEqual(actual, expected, `${event_name} ${ref} ${JSON.stringify(inputs)}`);
        assert.equal(Boolean(runInNewContext(fdroid.jobs.build.if, context)), context.github.ref_type === "tag");
        assert.equal(Boolean(runInNewContext(fdroid.jobs.check_worker.if, context)), event_name === "push" && ref === "refs/heads/development");
    }
    assert.deepEqual(workflow.jobs.preprod_build.needs, ["check", "smoke"]);
    assert.deepEqual(workflow.jobs.fdroid.needs, ["check", "smoke"]);
});

test("production dispatch rejects branches and version mismatches before building", () => {
    const script = workflow.jobs.check.steps.find(step => step.name === "Validate release selection").run;
    const run = (profile, refType, refName) => spawnSync("bash", ["-e", "-c", script], {
        cwd: new URL("../../", import.meta.url), encoding: "utf8",
        env: { ...process.env, RELEASE_PROFILE: profile, GITHUB_REF_TYPE: refType, GITHUB_REF_NAME: refName },
    });
    const version = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo.version;
    assert.equal(run("preprod", "branch", "development").status, 0);
    assert.equal(run("production", "tag", `mobile-v${version}`).status, 0);
    assert.notEqual(run("production", "branch", "development").status, 0);
    assert.notEqual(run("production", "tag", "mobile-v999.0.0").status, 0);
    assert.notEqual(run("other", "tag", `mobile-v${version}`).status, 0);
});

test("signing credentials are scoped to separate signing steps and the matching environment", () => {
    for (const [jobs, signer, builder, environment, profile] of [
        [workflow.jobs, "preprod_sign", "preprod_build", "Mobile - Preproduction", "preprod"],
        [fdroid.jobs, "sign", "build", "Mobile - Production", "production"],
    ]) {
        assert.equal(jobs[signer].needs, builder);
        assert.equal(jobs[signer].environment, environment);
        assert.equal(jobs[builder].environment, environment);
        const secretSteps = Object.values(jobs).flatMap(job => job.steps || []).filter(step => JSON.stringify(step).includes("secrets.CRYPTEX_"));
        assert.equal(secretSteps.length, 1);
        assert.match(secretSteps[0].run, new RegExp(`ci-release.mjs sign ${profile}`));
        assert.deepEqual(Object.keys(secretSteps[0].env).sort(), ["CRYPTEX_KEYSTORE_BASE64", "CRYPTEX_KEYSTORE_PASSWORD", "CRYPTEX_KEY_PASSWORD"].sort());
        assert.ok(!jobs[signer].steps.some(step => /pnpm install|mobile:build|gradle/.test(step.run || "")), "Signing must not install app dependencies or rebuild the APK");
        const download = jobs[signer].steps.find(step => step.uses?.startsWith("actions/download-artifact@"));
        const upload = jobs[builder].steps.find(step => step.with?.name === download.with.name);
        assert.ok(upload, "Signing must consume the artifact uploaded by its build job");
    }
    for (const name of ["check", "smoke"]) {
        assert.equal(workflow.jobs[name].environment, undefined);
        assert.ok(workflow.jobs[name].steps.some(step => step.run === "node mobile/scripts/ci-release.mjs fixtures mobile"));
    }
});
