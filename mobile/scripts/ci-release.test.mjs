import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeCheckConfigs, writeCiConfig } from "./ci-release.mjs";

const config = {
    EXPO_PUBLIC_CLOUD_ENABLED: "true",
    EXPO_PUBLIC_OTA_SIGNING_ENABLED: "false",
    EXPO_PUBLIC_APP_URL: "https://app.example.invalid",
    EXPO_PUBLIC_ONLINE_SERVICES_API_URL: "https://api.example.invalid",
    EXPO_PUBLIC_PUSHER_APP_HOST: "signaling.example.invalid",
};
const temporary = run => {
    const directory = mkdtempSync(join(tmpdir(), "cryptex-ci-config-test-"));
    try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
};

test("CI config includes public client variables without unrelated credentials", () => temporary(directory => {
    const path = join(directory, "release-config.json");
    writeCiConfig(path, { ...config, CRYPTEX_KEY_PASSWORD: "must-not-leak", VITE_PUSHER_APP_KEY: "other-application" });
    const content = readFileSync(path, "utf8");
    assert.deepEqual(JSON.parse(content), config);
    assert.ok(!content.includes("must-not-leak"));
    assert.ok(!content.includes("other-application"));
}));

test("configuration snapshots have stable bytes regardless of GitHub variable order", () => temporary(directory => {
    const first = join(directory, "first.json");
    const second = join(directory, "second.json");
    writeCiConfig(first, config);
    writeCiConfig(second, Object.fromEntries(Object.entries(config).reverse()));
    assert.deepEqual(readFileSync(first), readFileSync(second));
}));

test("missing or invalid CI configuration fails before creating an output file", () => temporary(directory => {
    const path = join(directory, "release-config.json");
    for (const variables of [{}, { ...config, EXPO_PUBLIC_CLOUD_ENABLED: "false" }, { ...config, EXPO_PUBLIC_APP_URL: "http://localhost" }, { ...config, EXPO_PUBLIC_PUSHER_APP_HOST: "" }]) {
        assert.throws(() => writeCiConfig(path, variables));
        assert.equal(existsSync(path), false);
    }
}));

test("check fixtures require no GitHub environment and never overwrite local config", () => temporary(directory => {
    writeCheckConfigs(directory);
    const path = join(directory, "release-config.json");
    const original = readFileSync(path);
    assert.equal(JSON.parse(original).EXPO_PUBLIC_OTA_SIGNING_ENABLED, "false");
    assert.ok(existsSync(join(directory, "prerelease-config.json")));
    assert.throws(() => writeCheckConfigs(directory), /must not overwrite/);
    assert.deepEqual(readFileSync(path), original);
    assert.throws(() => writeCiConfig(path, config), /EEXIST/);
    assert.deepEqual(readFileSync(path), original);
}));

test("an existing preproduction config blocks both fixture writes", () => temporary(directory => {
    writeFileSync(join(directory, "prerelease-config.json"), "local configuration");
    assert.throws(() => writeCheckConfigs(directory), /must not overwrite/);
    assert.equal(existsSync(join(directory, "release-config.json")), false);
    assert.equal(readFileSync(join(directory, "prerelease-config.json"), "utf8"), "local configuration");
}));
