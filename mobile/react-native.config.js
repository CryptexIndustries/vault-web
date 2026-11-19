// Store billing native code belongs only in iOS and the Android Play distribution.
module.exports = {
    dependencies: {
        "react-native-purchases": {
            platforms:
                process.env.CRYPTEX_DISTRIBUTION === "play"
                    ? {}
                    : { android: null },
        },
    },
};
