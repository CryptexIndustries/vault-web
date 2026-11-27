const {
    IOSConfig,
    withAppDelegate,
    withInfoPlist,
    withXcodeProject,
} = require("@expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");

// The iOS 27 SDK stops apps at launch unless they use the scene life cycle.
// Expo 58 generates all of this itself, so delete this plugin with that upgrade.
module.exports = (config) => {
    config = withInfoPlist(config, (mod) => {
        mod.modResults.UIApplicationSceneManifest = {
            UIApplicationSupportsMultipleScenes: false,
            UISceneConfigurations: {
                UIWindowSceneSessionRoleApplication: [
                    {
                        UISceneConfigurationName: "Default Configuration",
                        UISceneDelegateClassName:
                            "$(PRODUCT_MODULE_NAME).SceneDelegate",
                    },
                ],
            },
        };
        return mod;
    });
    config = withAppDelegate(config, (mod) => {
        // SceneDelegate creates the window and starts React Native instead.
        mod.modResults.contents = mod.modResults.contents.replace(
            /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow[\s\S]*?#endif\n\n/,
            "",
        );
        return mod;
    });
    return withXcodeProject(config, async (mod) => {
        const { platformProjectRoot, projectName } = mod.modRequest;
        const filepath = `${projectName}/SceneDelegate.swift`;
        await fs.copyFile(
            path.join(__dirname, "SceneDelegate.swift"),
            path.join(platformProjectRoot, filepath),
        );
        if (!mod.modResults.hasFile(filepath)) {
            IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
                filepath,
                groupName: projectName,
                project: mod.modResults,
            });
        }
        return mod;
    });
};
