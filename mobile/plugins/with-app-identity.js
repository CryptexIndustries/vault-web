const { withDangerousMod } = require("@expo/config-plugins");
const { mkdir, writeFile, readFile } = require("node:fs/promises");
const path = require("node:path");
const { getProfile } = require("../config/profiles.cjs");

const xmlEscape = (value) =>
    value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
const resources = (strings) =>
    `<resources>\n` +
    strings
        .map(
            ([name, value, translatable = true]) =>
                `    <string name="${name}"${translatable ? "" : ' translatable="false"'}>${xmlEscape(value)}</string>`,
        )
        .join("\n") +
    "\n</resources>\n";
function identityResources(profile) {
    return resources([
        ["cryptex_app_scheme", profile.scheme, false],
        ["cryptex_provider_name", profile.displayName, false],
        [
            "cryptex_accessibility_service_name",
            `${profile.displayName} autofill fallback`,
        ],
    ]);
}
function croatianIdentityResources(profile) {
    return resources([
        [
            "cryptex_accessibility_service_name",
            `${profile.displayName}: zamjensko popunjavanje`,
        ],
    ]);
}
async function applyAndroidIdentity(
    mod,
    profile = getProfile(process.env.CRYPTEX_APP_PROFILE),
) {
    if (mod.android?.package !== profile.applicationId)
        throw new Error(
            "Expo package differs from the selected application profile.",
        );
    const resourceRoot = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/res",
    );
    for (const [directory, render] of [
        ["values", identityResources],
        ["values-hr", croatianIdentityResources],
    ]) {
        await mkdir(path.join(resourceRoot, directory), { recursive: true });
        await writeFile(
            path.join(resourceRoot, directory, "cryptex_identity.xml"),
            render(profile),
        );
    }
    await mkdir(path.join(resourceRoot, "xml"), { recursive: true });
    for (const name of [
        "cryptex_autofill_service",
        "cryptex_accessibility_service",
        "cryptex_credential_provider",
    ]) {
        const source = await readFile(
            path.join(
                __dirname,
                "../modules/cryptex-android-credentials/android/src/main/res/xml",
                `${name}.xml`,
            ),
            "utf8",
        );
        await writeFile(
            path.join(resourceRoot, "xml", `${name}.xml`),
            source.replace(
                /android:settingsActivity="[^"]+"/,
                `android:settingsActivity="${profile.applicationId}.MainActivity"`,
            ),
        );
    }
    return mod;
}
module.exports = (config) =>
    withDangerousMod(config, ["android", applyAndroidIdentity]);
module.exports.identityResources = identityResources;
module.exports.applyAndroidIdentity = applyAndroidIdentity;
