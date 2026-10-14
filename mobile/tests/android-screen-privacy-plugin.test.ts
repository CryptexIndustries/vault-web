import { describe, expect, it } from "@jest/globals";

const { addE2EBuildType, secureMainActivity } =
    require("../plugins/with-android-screen-privacy") as {
        addE2EBuildType(contents: string): string;
        secureMainActivity(contents: string): string;
    };

const gradle =
    "android {\n    defaultConfig {\n    }\n    buildTypes {\n        release { }\n    }\n    packagingOptions {\n    }\n}";
const activity = `import android.os.Bundle
class MainActivity {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }
}`;

describe("Android screen privacy prebuild plugin", () => {
    it("adds an explicit debug-signed E2E build type once", () => {
        const modified = addE2EBuildType(gradle);
        expect(modified).toContain("e2e {");
        expect(modified).toContain("initWith release");
        expect(modified).toContain("signingConfig signingConfigs.debug");
        expect(modified).toContain("versionNameSuffix '-e2e'");
        expect(modified).toContain(
            "manifestPlaceholders.cryptexTestOnly = 'false'",
        );
        expect(modified).toContain(
            "manifestPlaceholders.cryptexTestOnly = 'true'",
        );
        expect(addE2EBuildType(modified)).toBe(modified);
    });

    it("sets FLAG_SECURE before other activity creation work", () => {
        const modified = secureMainActivity(activity);
        expect(modified).toContain("import android.view.WindowManager");
        expect(modified).toContain('BuildConfig.BUILD_TYPE != "e2e"');
        expect(modified).toContain(
            "window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)",
        );
        expect(modified.indexOf("window.addFlags")).toBeLessThan(
            modified.indexOf("super.onCreate"),
        );
        expect(secureMainActivity(modified)).toBe(modified);
    });

    it.each([
        "initWith release",
        "signingConfig signingConfigs.debug",
        "matchingFallbacks = ['release']",
        "versionNameSuffix '-e2e'",
        "manifestPlaceholders.cryptexTestOnly = 'false'",
        "manifestPlaceholders.cryptexTestOnly = 'true'",
    ])("rejects an existing build policy missing %s", (setting) => {
        const modified = addE2EBuildType(gradle).replace(setting, "");
        expect(() => addE2EBuildType(modified)).toThrow(
            "generated E2E build policy was modified",
        );
    });

    it.each([
        "import android.view.WindowManager",
        'BuildConfig.BUILD_TYPE != "e2e"',
        "window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)",
    ])("rejects an existing privacy policy missing %s", (setting) => {
        const modified = secureMainActivity(activity).replace(setting, "");
        expect(() => secureMainActivity(modified)).toThrow(
            "generated screen privacy policy was modified",
        );
    });

    it("rejects screen protection moved after activity creation", () => {
        const modified = secureMainActivity(activity)
            .replace("    super.onCreate(null)\n", "")
            .replace(
                "    // Protect",
                "    super.onCreate(null)\n    // Protect",
            );
        expect(() => secureMainActivity(modified)).toThrow(
            "generated screen privacy policy was modified",
        );
    });

    it("rejects duplicate generated policies", () => {
        expect(() =>
            addE2EBuildType(addE2EBuildType(gradle) + "\ne2e {}"),
        ).toThrow("generated E2E build policy was modified");
        expect(() =>
            secureMainActivity(
                secureMainActivity(activity) +
                    "\nwindow.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)",
            ),
        ).toThrow("generated screen privacy policy was modified");
    });

    it("reuses an existing WindowManager import", () => {
        const modified = secureMainActivity(
            activity.replace(
                "import android.os.Bundle",
                "import android.os.Bundle\nimport android.view.WindowManager",
            ),
        );
        expect(
            modified.match(/import android.view.WindowManager/g),
        ).toHaveLength(1);
        expect(secureMainActivity(modified)).toBe(modified);
    });

    it("fails if the generated Android template no longer matches", () => {
        expect(() => addE2EBuildType("android { }")).toThrow(
            "app/build.gradle buildTypes block not found",
        );
        expect(() => secureMainActivity("class MainActivity {}")).toThrow(
            "MainActivity import not found",
        );
    });
});
