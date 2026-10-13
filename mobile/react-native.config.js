// Google billing native code belongs only in the Android Play distribution.
module.exports = {
    dependencies: {
        'react-native-purchases': { platforms: {
            ios: null,
            ...(process.env.CRYPTEX_DISTRIBUTION === 'play' ? {} : { android: null }),
        } },
    },
};
