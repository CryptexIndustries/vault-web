/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
    type: "credentials-provider",
    name: "autofill",
    displayName: config.name,
    // Info.plist derives the App Group from this: group.<app id>.autofill.
    bundleIdentifier: ".autofill",
    deploymentTarget: "16.4",
    entitlements: {
        "com.apple.developer.authentication-services.autofill-credential-provider": true,
        // The vault store and, as a keychain access group, the Face ID items.
        "com.apple.security.application-groups":
            config.ios.entitlements["com.apple.security.application-groups"],
    },
});
