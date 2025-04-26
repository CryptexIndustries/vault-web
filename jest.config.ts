import type { JestConfigWithTsJest } from "ts-jest";

const jestConfig: JestConfigWithTsJest = {
    testEnvironment: "jsdom",
    // testEnvironment: "node",
    transformIgnorePatterns: ["node_modules/(?!@ngrx|(?!deck.gl)|ng-dynamic)"],
    transform: {
        // Process js/ts/mjs/mts with `ts-jest`
        "^.+\\.m?[tj]sx?$": [
            "ts-jest",
            {
                // ts-jest configuration goes here
            },
        ],
    },
};

export default jestConfig;
