module.exports = function (api) {
    api.cache(true);
    return {
        presets: [
            ["babel-preset-expo", { jsxImportSource: "nativewind" }],
            "nativewind/babel",
        ],
        plugins: [
            [
                "module-resolver",
                {
                    root: ["."],
                    extensions: [
                        ".ios.js",
                        ".android.js",
                        ".js",
                        ".ts",
                        ".tsx",
                        ".json",
                    ],
                    alias: {
                        "@": "./src",
                        "@ui": "../packages/shared-ui/src",
                        crypto: "react-native-quick-crypto",
                    },
                },
            ],
            "react-native-reanimated/plugin",
        ],
    };
};
