import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
    CONFIG_KEYS,
    PROFILES,
    loadReleaseConfig,
    parseBuildOptions,
    validateReleaseConfig,
} from "./release-config.mjs";

const extension = new URL("../", import.meta.url).pathname;

test("both committed configurations set exactly the keys the build reads", () => {
    for (const file of Object.values(PROFILES)) {
        const config = loadReleaseConfig(join(extension, file));
        assert.deepEqual(Object.keys(config).sort(), [...CONFIG_KEYS].sort());
    }
});

test("configurations reject unknown keys, non-strings and gaps", () => {
    const complete = Object.fromEntries(CONFIG_KEYS.map((key) => [key, ""]));
    assert.throws(
        () => validateReleaseConfig({ ...complete, SECRET_KEY: "x" }),
        /SECRET_KEY, which the extension doesn't read/,
    );
    assert.throws(
        () => validateReleaseConfig({ ...complete, VITE_PUSHER_APP_PORT: 443 }),
        /must be a string/,
    );
    const { VITE_APP_URL: _, ...missing } = complete;
    assert.throws(() => validateReleaseConfig(missing), /missing VITE_APP_URL/);
    assert.throws(() => validateReleaseConfig([]), /must be a JSON object/);

    const dir = mkdtempSync(join(tmpdir(), "ext-config-"));
    writeFileSync(join(dir, "broken.json"), "{");
    assert.throws(
        () => loadReleaseConfig(join(dir, "broken.json")),
        /Can't read/,
    );
});

test("build options choose a profile or a configuration file", () => {
    assert.equal(
        parseBuildOptions([]).configPath,
        join(extension, "release-config.json"),
    );
    const preprod = parseBuildOptions(["--", "--profile", "preprod"]);
    assert.equal(preprod.profile, "preprod");
    assert.equal(preprod.configPath, join(extension, "prerelease-config.json"));
    assert.equal(
        parseBuildOptions(["--config", "custom.json"], "/work").configPath,
        "/work/custom.json",
    );
    assert.throws(
        () => parseBuildOptions(["--profile", "staging"]),
        /Unknown profile/,
    );
    assert.throws(() => parseBuildOptions(["--profile"]), /requires a value/);
    assert.throws(
        () =>
            parseBuildOptions([
                "--profile",
                "preprod",
                "--profile",
                "production",
            ]),
        /repeated option/,
    );
    assert.throws(
        () => parseBuildOptions(["--watch"]),
        /Invalid or repeated option/,
    );
});
