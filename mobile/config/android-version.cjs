const assert = require("node:assert/strict");

const architectures = ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"];

function selectedArchitectures(arch = "all") {
    assert.ok(
        arch === "all" || architectures.includes(arch),
        "--arch must be all, armeabi-v7a, arm64-v8a, x86 or x86_64.",
    );
    return arch === "all" ? [...architectures] : [arch];
}

function releaseVersion(app, { distribution = "standard", arch = "all" } = {}) {
    selectedArchitectures(arch);
    // F-Droid ABI APKs use slots 1-4 of each block of ten; Play uses slot 0.
    const code =
        distribution === "fdroid" && arch !== "all"
            ? app.android.versionCode * 10 + architectures.indexOf(arch) + 1
            : distribution === "play"
              ? app.android.versionCode * 10
              : app.android.versionCode;
    assert.ok(
        Number.isSafeInteger(code) && code > 0 && code <= 2100000000,
        "Invalid Android version code.",
    );
    return { name: app.version, code };
}

module.exports = { architectures, selectedArchitectures, releaseVersion };
