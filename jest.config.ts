import type { JestConfigWithTsJest } from "ts-jest";

const jestConfig: JestConfigWithTsJest = {
    testEnvironment: "jsdom",
    // testEnvironment: "node",
    transformIgnorePatterns: [
        "/node_modules/(?!dexie|kjsdfgkjshdgl|jksdhfgkdjhf)",
    ],
    transform: {
        // Process js/ts/mjs/mts with `ts-jest`
        "^.+\\.m?[tj]sx?$": [
            "ts-jest",
            {
                // ts-jest configuration goes here
                babelConfig: true,
            },
        ],
    },
};

export default jestConfig;
