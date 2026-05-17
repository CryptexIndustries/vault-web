import type { JestConfigWithTsJest } from "ts-jest";

const jestConfig: JestConfigWithTsJest = {
    testEnvironment: "jsdom",
    // testEnvironment: "node",
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/web/src/$1",
        "^@ui/(.*)$": "<rootDir>/packages/shared-ui/src/$1",
        "^@cryptex-industries/shared-ui/(.*)$": "<rootDir>/packages/shared-ui/$1",
    },
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
