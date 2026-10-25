const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { loadReleaseConfig } = require("./release-config.cjs");

const playConfigKeys = Object.freeze([
    "EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY",
    "EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_PRODUCT_ID",
    "EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID",
    "EXPO_PUBLIC_GOOGLE_PLAY_YEARLY_PRODUCT_ID",
    "EXPO_PUBLIC_GOOGLE_PLAY_YEARLY_BASE_PLAN_ID",
]);

function validatePlayConfig(config) {
    assert.match(
        config.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY || "",
        /^goog_[A-Za-z0-9]+$/,
        "Set EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY to the public Google SDK key from RevenueCat. See mobile/docs/GOOGLE_PLAY.md.",
    );
    for (const name of playConfigKeys.slice(1)) {
        const pattern = name.endsWith("_BASE_PLAN_ID")
            ? /^[a-z0-9][a-z0-9-]*$/
            : /^[a-z0-9][a-z0-9._]*$/;
        assert.match(
            config[name] || "",
            pattern,
            `Set ${name} to its Google Play Console ID. See mobile/docs/GOOGLE_PLAY.md.`,
        );
    }
    assert.notEqual(
        `${config[playConfigKeys[1]]}:${config[playConfigKeys[2]]}`,
        `${config[playConfigKeys[3]]}:${config[playConfigKeys[4]]}`,
        "Monthly and yearly Google Play subscription options must differ.",
    );
    return config;
}

function distributionConfig(config, distribution = "standard") {
    assert.ok(
        ["standard", "fdroid", "play"].includes(distribution),
        "Distribution must be standard, fdroid or play.",
    );
    if (distribution === "play") return validatePlayConfig(config);
    return Object.fromEntries(
        Object.entries(config).filter(
            ([name]) => !playConfigKeys.includes(name),
        ),
    );
}

function loadDistributionConfig(file, distribution = "standard") {
    if (distribution === "play")
        assert.ok(
            existsSync(file),
            `Missing release configuration at ${file}. Add the RevenueCat public Google SDK key and Play IDs to the selected profile JSON. See mobile/docs/GOOGLE_PLAY.md.`,
        );
    return distributionConfig(loadReleaseConfig(file), distribution);
}

const permission = (name) =>
    new RegExp(`:name\\([^)]*\\)="${name.replaceAll(".", "\\.")}"`);
// Play dependencies must never add tracking or location access to any APK.
const forbiddenPermissions = [
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "com.google.android.gms.permission.AD_ID",
];

function assertDistributionPermissions(manifest, distribution) {
    const billing = permission("com.android.vending.BILLING");
    if (distribution === "play")
        assert.match(
            manifest,
            billing,
            "Google Play APK is missing the Google Play Billing permission.",
        );
    else
        assert.doesNotMatch(
            manifest,
            billing,
            "Google Play Billing permission leaked into a non-Play APK.",
        );
    for (const name of forbiddenPermissions)
        assert.doesNotMatch(
            manifest,
            permission(name),
            `APK declares forbidden permission ${name}.`,
        );
}

module.exports = {
    playConfigKeys,
    validatePlayConfig,
    distributionConfig,
    loadDistributionConfig,
    assertDistributionPermissions,
};
