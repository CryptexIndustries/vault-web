// Include generated native sources, custom native plugins, and dependency patches.
// Build and update export must use the same checkout and prebuild inputs.
module.exports = {
    sourceSkips: ['PackageJsonAndroidAndIosScriptsIfNotContainRun', 'ExpoConfigExtraSection'],
    ignorePaths: ['android/app/src/main/assets/cryptex-release.json'],
    extraSources: [
        { type: 'file', filePath: './fdroid/toolchain.json', reasons: ['nativeBuildToolchain'] },
        { type: 'file', filePath: './fdroid/dependencies.gradle', reasons: ['nativeDependencyPolicy'] },
        { type: 'file', filePath: './fdroid/verification-metadata.xml', reasons: ['approvedNativeDependencies'] },
        { type: 'dir', filePath: './plugins', reasons: ['customNativePlugins'] },
        { type: 'dir', filePath: '../patches', reasons: ['patchedNativeDependencies'] },
        { type: 'dir', filePath: './modules/cryptex-android-credentials/android', reasons: ['customNativeSources'] },
        { type: 'dir', filePath: './modules/cryptex-agent-service/android', reasons: ['customNativeSources'] },
        ...(process.env.CRYPTEX_DISTRIBUTION === 'play' ? [
            { type: 'file', filePath: './config/play-dependencies.gradle', reasons: ['playNativeDependencyPolicy'] },
            { type: 'file', filePath: './config/play-verification-metadata.xml', reasons: ['playApprovedNativeDependencies'] },
        ] : []),
        { type: 'file', filePath: './react-native.config.js', reasons: ['distributionNativeDependencies'] },
        { type: 'file', filePath: './config/ota.cjs', reasons: ['updateNativePolicy'] },
        { type: 'file', filePath: './eas-project.json', reasons: ['pinnedUpdateIdentity'] },
    ],
};
