const { getProfile } = require('./config/profiles.cjs');
const { getOtaConfig } = require('./config/ota.cjs');
const { loadReleaseConfig, configHash } = require('./config/release-config.cjs');
const path = require('node:path');

module.exports = ({ config }) => {
    const profile = getProfile(process.env.CRYPTEX_APP_PROFILE);
    const distribution = process.env.CRYPTEX_DISTRIBUTION || 'standard';
    const release = process.env.CRYPTEX_BUILD_PROFILE === 'production';
    const publicConfig = loadReleaseConfig(process.env.CRYPTEX_RELEASE_CONFIG || path.join(__dirname, profile.configFile));
    // Hosted builds must use the same reviewed public JSON as local releases.
    if (release) {
        for (const name of Object.keys(process.env)) {
            if (name.startsWith('EXPO_PUBLIC_') || name.startsWith('NEXT_PUBLIC_')) delete process.env[name];
        }
        Object.assign(process.env, publicConfig, {
            EXPO_PUBLIC_CRYPTEX_E2E: '0',
            EXPO_PUBLIC_CLOUD_ENABLED: process.env.CRYPTEX_OFFLINE_SERVICES === '1' ? 'false' : 'true',
        });
    }
    const ota = getOtaConfig({ profile, distribution,
        signingEnabled: publicConfig.EXPO_PUBLIC_OTA_SIGNING_ENABLED ?? 'false',
        mode: release ? 'release' : process.env.EXPO_PUBLIC_CRYPTEX_E2E === '1' ? 'e2e' : 'development',
    });
    const preprod = profile.name === 'preprod';
    return {
        ...config,
        ...ota,
        plugins: (config.plugins || []).map(plugin =>
            (typeof plugin === 'string' ? plugin : plugin[0]) === 'expo-dev-client'
                ? ['expo-dev-client', { ...(Array.isArray(plugin) ? plugin[1] : {}), addGeneratedScheme: !release }]
                : plugin),
        name: profile.displayName,
        scheme: profile.scheme,
        icon: preprod ? './assets/icon-preprod.png' : config.icon,
        android: {
            ...config.android,
            package: profile.applicationId,
            adaptiveIcon: {
                ...config.android?.adaptiveIcon,
                ...(preprod ? {
                    foregroundImage: './assets/android-icon-foreground-preprod.png',
                    monochromeImage: './assets/android-icon-monochrome-preprod.png',
                } : {}),
            },
        },
        ios: { ...config.ios, bundleIdentifier: profile.applicationId },
        extra: { ...config.extra, ...ota.extra, buildDetails: {
            ...config.extra?.buildDetails, ...ota.extra?.buildDetails,
            configHash: configHash(publicConfig),
            revision: process.env.CRYPTEX_SOURCE_REVISION ? JSON.parse(process.env.CRYPTEX_SOURCE_REVISION) : null,
            appUrl: release ? publicConfig.EXPO_PUBLIC_APP_URL : (process.env.EXPO_PUBLIC_APP_URL || publicConfig.EXPO_PUBLIC_APP_URL),
            apiUrl: release ? publicConfig.EXPO_PUBLIC_ONLINE_SERVICES_API_URL : (process.env.EXPO_PUBLIC_ONLINE_SERVICES_API_URL || publicConfig.EXPO_PUBLIC_ONLINE_SERVICES_API_URL),
        } },
    };
};
