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
            const resources = path.join(
                mod.modRequest.platformProjectRoot,
                "app/src/main/res",
            );
            const profile = process.env.CRYPTEX_BUILD_PROFILE;
            await fs.mkdir(path.join(resources, "xml"), { recursive: true });
            await fs.copyFile(
                path.join(
                    __dirname,
                    profile === "production"
                        ? "network_security_config_release.xml"
                        : profile === "e2e"
                          ? "network_security_config_e2e.xml"
                          : "network_security_config.xml",
                ),
                path.join(resources, "xml/network_security_config.xml"),
            );
            // Only E2E builds trust the test CA of the e2e Garage.
            const testCA = path.join(resources, "raw/cryptex_e2e_ca.pem");
            if (profile === "e2e") {
                await fs.mkdir(path.dirname(testCA), { recursive: true });
                await fs.copyFile(
                    path.join(__dirname, "../../e2e/garage/tls/ca.pem"),
                    testCA,
                );
            } else {
                await fs.rm(testCA, { force: true });
            }
            return mod;
        },
    ]);
};
