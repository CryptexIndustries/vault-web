const {
    withAndroidManifest,
    withAppBuildGradle,
    withMainActivity,
} = require("@expo/config-plugins");

const E2E_BUILD_TYPE = `
        // Test-only APK. Production release never disables FLAG_SECURE.
        e2e {
            initWith release
            signingConfig signingConfigs.debug
            matchingFallbacks = ['release']
            versionNameSuffix '-e2e'
            manifestPlaceholders.cryptexTestOnly = 'true'
        }
`;

const DEFAULT_CONFIG =
    "    defaultConfig {\n        manifestPlaceholders.cryptexTestOnly = 'false'";
const ON_CREATE = "override fun onCreate(savedInstanceState: Bundle?) {";
const SECURE_ON_CREATE = `${ON_CREATE}
    // Protect the launch frame before React renders. The E2E APK is debug-signed.
    if (BuildConfig.BUILD_TYPE != "e2e") {
      window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }`;
const WINDOW_MANAGER_IMPORT = "import android.view.WindowManager";

function addE2EBuildType(contents) {
    if (/\be2e\s*\{|cryptexTestOnly|versionNameSuffix '-e2e'/.test(contents)) {
        if (
            !contents.includes(E2E_BUILD_TYPE) ||
            !contents.includes(DEFAULT_CONFIG) ||
            (contents.match(/\be2e\s*\{/g) || []).length !== 1 ||
            (contents.match(/manifestPlaceholders\.cryptexTestOnly/g) || [])
                .length !== 2
        ) {
            throw new Error(
                "with-android-screen-privacy: generated E2E build policy was modified",
            );
        }
        return contents;
    }
    const anchor = "    }\n    packagingOptions {";
    if (
        !contents.includes(anchor) ||
        !contents.includes("    defaultConfig {")
    ) {
        throw new Error(
            "with-android-screen-privacy: app/build.gradle buildTypes block not found",
        );
    }
    return contents
        .replace("    defaultConfig {", DEFAULT_CONFIG)
        .replace(anchor, `${E2E_BUILD_TYPE}    }\n    packagingOptions {`);
}

function secureMainActivity(contents) {
    if (
        /FLAG_SECURE|BuildConfig\.BUILD_TYPE\s*!=\s*"e2e"|Protect the launch frame/.test(
            contents,
        )
    ) {
        if (
            !contents.includes(SECURE_ON_CREATE) ||
            !contents.includes(WINDOW_MANAGER_IMPORT) ||
            (contents.match(/FLAG_SECURE/g) || []).length !== 1
        ) {
            throw new Error(
                "with-android-screen-privacy: generated screen privacy policy was modified",
            );
        }
        return contents;
    }
    if (!contents.includes("import android.os.Bundle")) {
        throw new Error(
            "with-android-screen-privacy: MainActivity import not found",
        );
    }
    if (!contents.includes(ON_CREATE)) {
        throw new Error(
            "with-android-screen-privacy: MainActivity onCreate not found",
        );
    }
    if (!contents.includes(WINDOW_MANAGER_IMPORT)) {
        contents = contents.replace(
            "import android.os.Bundle",
            `import android.os.Bundle\n${WINDOW_MANAGER_IMPORT}`,
        );
    }
    return contents.replace(ON_CREATE, SECURE_ON_CREATE);
}

module.exports = (config) => {
    config = withAppBuildGradle(config, (mod) => {
        mod.modResults.contents = addE2EBuildType(mod.modResults.contents);
        return mod;
    });
    config = withAndroidManifest(config, (mod) => {
        mod.modResults.manifest.application[0].$["android:testOnly"] =
            "${cryptexTestOnly}";
        return mod;
    });
    return withMainActivity(config, (mod) => {
        mod.modResults.contents = secureMainActivity(mod.modResults.contents);
        return mod;
    });
};

module.exports.addE2EBuildType = addE2EBuildType;
module.exports.secureMainActivity = secureMainActivity;
