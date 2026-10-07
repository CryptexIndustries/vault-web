const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function validateReleaseConfig(config) {
    assert.ok(config && typeof config === "object" && !Array.isArray(config), "Release configuration must be a JSON object.");
    for (const [name, value] of Object.entries(config)) {
        assert.match(name, /^EXPO_PUBLIC_/, "Only public client values belong in release configuration");
        assert.equal(typeof value, "string", `${name} must be a string`);
    }
    assert.equal(config.EXPO_PUBLIC_CLOUD_ENABLED, "true", "Published configuration must enable Online Services by default");
    assert.ok(config.EXPO_PUBLIC_OTA_SIGNING_ENABLED === undefined || ["true", "false"].includes(config.EXPO_PUBLIC_OTA_SIGNING_ENABLED), "EXPO_PUBLIC_OTA_SIGNING_ENABLED must be true or false.");
    assert.ok(typeof config.EXPO_PUBLIC_PUSHER_APP_HOST === "string" && config.EXPO_PUBLIC_PUSHER_APP_HOST.trim(), "EXPO_PUBLIC_PUSHER_APP_HOST must be a non-empty string.");
    for (const name of ["EXPO_PUBLIC_APP_URL", "EXPO_PUBLIC_ONLINE_SERVICES_API_URL"]) {
        const url = new URL(config[name]);
        assert.equal(url.protocol, "https:", `${name} must use HTTPS`);
        assert.ok(!url.username && !url.password && !url.search && !url.hash, `${name} must be a public HTTPS URL`);
        const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
        assert.ok(hostname !== "localhost" && hostname !== "[::1]" && !hostname.startsWith("127."), `${name} cannot be loopback`);
    }
    return config;
}

function loadReleaseConfig(path = join(__dirname, "../release-config.json")) {
    return validateReleaseConfig(JSON.parse(readFileSync(path, "utf8")));
}

function configHash(config) {
    return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(config).sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
}

module.exports = { validateReleaseConfig, loadReleaseConfig, configHash };
