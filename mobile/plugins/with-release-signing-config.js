const { withAndroidManifest, withAppBuildGradle, withDangerousMod, withProjectBuildGradle } = require("@expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");
const toolchain = require("../fdroid/toolchain.json");
const { profiles } = require("../config/profiles.cjs");

const START = "// Cryptex release signing policy";
const CONFIG = `
        ${START}
        release {
            if (System.getenv("CRYPTEX_KEYSTORE")) {
                storeFile file(System.getenv("CRYPTEX_KEYSTORE"))
                storePassword System.getenv("CRYPTEX_KEYSTORE_PASSWORD")
                keyAlias System.getenv("CRYPTEX_KEY_ALIAS")
                keyPassword System.getenv("CRYPTEX_KEY_PASSWORD")
            }
        }`;

const GUARD = `
// Cryptex release artifact guard. Debug and E2E builds keep their own signing.
gradle.taskGraph.whenReady { graph ->
    def releaseArtifact = graph.allTasks.any {
        it.project == project && it.name in ['packageRelease', 'packageReleaseBundle', 'signReleaseBundle']
    }
    if (releaseArtifact) {
        if (System.getenv('CRYPTEX_BUILD_PROFILE') != 'production' || System.getenv('EXPO_NO_DOTENV') != '1') {
            throw new GradleException('Use pnpm mobile:build for a production artifact with public, reproducible configuration.')
        }
        if (System.getenv('EXPO_PUBLIC_CRYPTEX_E2E') == '1' || System.getenv('ENTRY_FILE')) {
            throw new GradleException('Test flags and alternate entry points are forbidden in production artifacts.')
        }
        def appProfile = System.getenv('CRYPTEX_APP_PROFILE') ?: 'production'
        def appIds = [${Object.values(profiles).map(profile => `'${profile.name}': '${profile.applicationId}'`).join(', ')}]
        if (!appIds.containsKey(appProfile) || android.defaultConfig.applicationId != appIds[appProfile]) {
            throw new GradleException('Application ID must match the selected production or preprod profile.')
        }
        if (!providers.gradleProperty('cryptexUnsignedRelease').map { it == 'true' }.getOrElse(false)) {
            ['CRYPTEX_KEYSTORE', 'CRYPTEX_KEYSTORE_PASSWORD', 'CRYPTEX_KEY_ALIAS', 'CRYPTEX_KEY_PASSWORD'].each { name ->
                if (!System.getenv(name)) throw new GradleException("Missing release signing environment variable: " + name)
            }
            if (!file(System.getenv('CRYPTEX_KEYSTORE')).isFile()) throw new GradleException('Release keystore does not exist.')
        }
    }
}
`;

const LEGACY_GUARD = GUARD.replace(/        def appProfile = [\s\S]*?        }\n(?=        if \(!providers)/, "        if (android.defaultConfig.applicationId != 'com.cryptex.vault') {\n            throw new GradleException('Production application ID must be com.cryptex.vault.')\n        }\n");

function configureReleaseSigning(contents) {
    if (contents.includes(LEGACY_GUARD.trim())) contents = contents.replace(LEGACY_GUARD.trim(), GUARD.trim());
    if (contents.includes(START)) {
        if (!contents.includes(GUARD.trim()) ||
            !contents.includes("? null : signingConfigs.release")) {
            throw new Error("with-release-signing-config: generated release policy was modified");
        }
        return contents;
    }
    if (!contents.includes("signingConfigs {")) {
        throw new Error("with-release-signing-config: signingConfigs block not found");
    }
    // Migrate the earlier policy, including its debug-signing fallback.
    contents = contents.replace(/\n\s*release \{\s*if \(System\.getenv\("CRYPTEX_KEYSTORE"\)\) \{[\s\S]*?\n\s*\}\s*\}/, "");
    const signing = /(?:\/\/ Caution! In production, you need to generate your own keystore file\.\s*\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\s*)?signingConfig (?:System\.getenv\("CRYPTEX_KEYSTORE"\) \? signingConfigs\.release : )?signingConfigs\.debug/;
    const release = /release \{\s*((?:\/\/[^\n]*\n\s*)*)signingConfig (?:System\.getenv\("CRYPTEX_KEYSTORE"\) \? signingConfigs\.release : )?signingConfigs\.debug/;
    if (!release.test(contents)) {
        throw new Error("with-release-signing-config: release signing reference not found");
    }
    contents = contents.replace(release, match => match.replace(signing,
        "signingConfig providers.gradleProperty('cryptexUnsignedRelease').map { it == 'true' }.getOrElse(false) ? null : signingConfigs.release"));
    return contents.replace("signingConfigs {", `signingConfigs {${CONFIG}`) + GUARD;
}

function configureToolchain(contents) {
    const marker = "// Cryptex reproducible archive settings";
    const policy = `${marker}
ext.ndkVersion = '${toolchain.ndk}'
allprojects {
    tasks.withType(AbstractArchiveTask).configureEach {
        preserveFileTimestamps = false
        reproducibleFileOrder = true
    }
    if (System.getenv('CRYPTEX_BUILD_PROFILE') == 'production') {
        ['com.android.application', 'com.android.library'].each { androidPlugin ->
            plugins.withId(androidPlugin) {
                androidComponents.finalizeDsl { android ->
                    // Project include adds maps without replacing module flags.
                    def arguments = android.defaultConfig.externalNativeBuild.cmake.arguments
                    if (arguments.any { it.startsWith('-DCMAKE_PROJECT_INCLUDE=') || it.startsWith('-DCMAKE_PROJECT_INCLUDE:') }) {
                        throw new GradleException('Review the existing CMake project include before applying production path maps.')
                    }
                    arguments.addAll([
                        '-DCMAKE_PROJECT_INCLUDE=' + rootProject.rootDir.parentFile.toPath().resolve('fdroid/reproducible-native.cmake'),
                        '-DCRYPTEX_GRADLE_USER_HOME=' + gradle.gradleUserHomeDir,
                        '-DCRYPTEX_ANDROID_SDK_ROOT=' + (System.getenv('ANDROID_HOME') ?: System.getenv('ANDROID_SDK_ROOT'))
                    ])
                }
            }
        }
    }
}
`;
    // React's root plugin eagerly evaluates :app via evaluationDependsOn.
    // Register the Android callbacks before either root plugin is applied.
    const rootPlugin = /^[ \t]*apply plugin: ["'](?:expo-root-project|com\.facebook\.react\.rootproject)["'][ \t]*$/m;
    let beforePlugin = contents.search(rootPlugin);
    if (beforePlugin < 0) {
        throw new Error("with-release-signing-config: root plugin application not found");
    }
    if (contents.includes(marker)) {
        if (contents.split(marker).length !== 2 || !contents.includes(policy)) {
            throw new Error("with-release-signing-config: generated toolchain policy was modified");
        }
        if (contents.indexOf(marker) < beforePlugin) return contents;
        // Relocate only our exact earlier appended policy, preserving other edits.
        contents = contents.replace(policy, "");
        beforePlugin = contents.search(rootPlugin);
    }
    return contents.slice(0, beforePlugin) + policy + "\n" + contents.slice(beforePlugin);
}

module.exports = config => {
    config = withAndroidManifest(config, mod => {
        const application = mod.modResults.manifest.application[0].$;
        application["android:allowBackup"] = "false";
        application["android:fullBackupContent"] = "@xml/cryptex_no_backup_rules";
        application["android:dataExtractionRules"] = "@xml/cryptex_no_data_extraction_rules";
        return mod;
    });
    config = withDangerousMod(config, ["android", async mod => {
        const directory = path.join(mod.modRequest.platformProjectRoot, "app/src/main/res/xml");
        await fs.mkdir(directory, { recursive: true });
        for (const name of ["cryptex_no_backup_rules.xml", "cryptex_no_data_extraction_rules.xml"]) {
            await fs.copyFile(path.join(__dirname, name), path.join(directory, name));
        }
        return mod;
    }]);
    config = withAppBuildGradle(config, mod => {
        mod.modResults.contents = configureReleaseSigning(mod.modResults.contents);
        return mod;
    });
    return withProjectBuildGradle(config, mod => {
        mod.modResults.contents = configureToolchain(mod.modResults.contents);
        return mod;
    });
};
module.exports.configureReleaseSigning = configureReleaseSigning;
module.exports.configureToolchain = configureToolchain;
