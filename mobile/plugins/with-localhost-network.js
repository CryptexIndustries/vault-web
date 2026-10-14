const {
    withAndroidManifest,
    withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");

// adb reverse exposes local development services on loopback only.
module.exports = (config) => {
    config = withAndroidManifest(config, (mod) => {
        mod.modResults.manifest.application[0].$[
            "android:networkSecurityConfig"
        ] = "@xml/network_security_config";
        return mod;
    });
    return withDangerousMod(config, [
        "android",
        async (mod) => {
            const directory = path.join(
                mod.modRequest.platformProjectRoot,
                "app/src/main/res/xml",
            );
            await fs.mkdir(directory, { recursive: true });
            await fs.copyFile(
                path.join(__dirname, process.env.CRYPTEX_BUILD_PROFILE === "production"
                    ? "network_security_config_release.xml"
                    : "network_security_config.xml"),
                path.join(directory, "network_security_config.xml"),
            );
            return mod;
        },
    ]);
};
