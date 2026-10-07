const { copyFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const {
    withDangerousMod,
    withProjectBuildGradle,
} = require("@expo/config-plugins");

const POLICY = "apply from: new File(rootDir, '../fdroid/dependencies.gradle')";

function addDependencyPolicy(contents) {
    return contents.includes(POLICY)
        ? contents
        : `${contents.trimEnd()}\n\n${POLICY}\n`;
}

module.exports = (config) => {
    config = withProjectBuildGradle(config, (mod) => {
        mod.modResults.contents = addDependencyPolicy(mod.modResults.contents);
        return mod;
    });
    return withDangerousMod(config, [
        "android",
        async (mod) => {
            const destination = path.join(
                mod.modRequest.platformProjectRoot,
                "gradle",
            );
            mkdirSync(destination, { recursive: true });
            copyFileSync(
                path.join(
                    mod.modRequest.projectRoot,
                    "fdroid/verification-metadata.xml",
                ),
                path.join(destination, "verification-metadata.xml"),
            );
            const notices = path.join(
                mod.modRequest.platformProjectRoot,
                "app/src/main/assets/licenses",
            );
            mkdirSync(notices, { recursive: true });
            for (const name of [
                "webrtc-150.7871.01.txt",
                "oxanium-OFL.txt",
                "lucide-LICENSE.txt",
                "expo-google-fonts-LICENSE.txt",
                "openssl-3.5.8-LICENSE.txt",
                "skia-2.6.2.txt",
                "AGPL-3.0-only.txt",
                "cryptex-assets.txt",
            ]) {
                copyFileSync(
                    path.join(
                        mod.modRequest.projectRoot,
                        "fdroid/notices",
                        name,
                    ),
                    path.join(notices, name),
                );
            }
            return mod;
        },
    ]);
};

module.exports.addDependencyPolicy = addDependencyPolicy;
