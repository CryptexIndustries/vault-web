// Offline Gradle regression. Run separately from the Node-only mobile checks.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const gradle = process.env.CRYPTEX_GRADLE_COMMAND;
assert.ok(gradle, "Set CRYPTEX_GRADLE_COMMAND to the pinned Gradle executable");
const version = JSON.parse(readFileSync(new URL("toolchain.json", import.meta.url), "utf8")).gradle;
assert.match(execFileSync(gradle, ["--version"], { encoding: "utf8" }),
    new RegExp(`^Gradle ${version.replaceAll(".", "\\.")}$`, "m"));
const fixture = mkdtempSync(join(tmpdir(), "cryptex-dependency-policy-"));

try {
    writeFileSync(join(fixture, "settings.gradle"), "rootProject.name = 'dependency-policy-test'\ninclude ':source'\n");
    mkdirSync(join(fixture, "source"));
    writeFileSync(join(fixture, "source/build.gradle"), "plugins { id 'java-library' }\ngroup = 'expo.modules.fixture'\nversion = '1.0'\n");
    writeFileSync(join(fixture, "dependencies.gradle"), readFileSync(new URL("dependencies.gradle", import.meta.url)));
    for (const [group, name, artifactVersion] of [
        ["expo.modules.fixture", "binary", "1.0"],
        ["org.example", "safe", "1.0"],
        ["com.facebook.react", "react-android", "0.86.0"],
    ]) {
        const repo = join(fixture, "repo", group.replaceAll(".", "/"), name, artifactVersion);
        mkdirSync(repo, { recursive: true });
        writeFileSync(join(repo, `${name}-${artifactVersion}.pom`),
            `<project><modelVersion>4.0.0</modelVersion><groupId>${group}</groupId><artifactId>${name}</artifactId><version>${artifactVersion}</version></project>`);
        writeFileSync(join(repo, `${name}-${artifactVersion}.jar`), "fixture, never packaged");
    }
    writeFileSync(join(fixture, "build.gradle"), `
apply from: 'dependencies.gradle'
repositories { maven { url = uri('repo') } }
configurations {
    sourceOnly { canBeResolved = true; canBeConsumed = false }
    cleanExternal { canBeResolved = true; canBeConsumed = false }
    badExternal { canBeResolved = true; canBeConsumed = false }
    dynamicExternal { canBeResolved = true; canBeConsumed = false }
    reactPlaceholder { canBeResolved = true; canBeConsumed = false }
}
configurations.sourceOnly.resolutionStrategy.dependencySubstitution {
    substitute module('expo.modules.fixture:binary') using project(':source')
}
dependencies {
    sourceOnly 'expo.modules.fixture:binary:1.0'
    cleanExternal 'org.example:safe:1.0'
    badExternal 'expo.modules.fixture:binary:1.0'
    dynamicExternal 'org.example:safe:1.+'
    reactPlaceholder 'com.facebook.react:react-android:+'
}
tasks.register('policyCheck') {
    doLast {
        ['sourceOnly', 'cleanExternal', 'reactPlaceholder'].each { name ->
            configurations[name].resolve()
        }
        [badExternal: 'Disallowed prebuilt Android dependency',
         dynamicExternal: 'Unpinned Android dependency'].each { name, reason ->
            try {
                configurations[name].resolve()
                throw new GradleException('Policy incorrectly accepted ' + name)
            } catch (Exception failure) {
                def causes = []
                for (def cause = failure; cause != null; cause = cause.cause) {
                    causes.add(cause.message)
                }
                if (!causes.any { it?.contains(reason) }) throw failure
            }
        }
        println 'Source substitution, external binary rejection, SDK pinning and dynamic-version checks passed.'
    }
}
`);
    const output = execFileSync(gradle, ["policyCheck", "--offline", "--no-daemon", "--console=plain"],
        { cwd: fixture, encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 });
    assert.match(output, /Source substitution, external binary rejection, SDK pinning and dynamic-version checks passed/);
    process.stdout.write(output);
} finally {
    rmSync(fixture, { recursive: true });
}
