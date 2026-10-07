import type { JestConfigWithTsJest } from "ts-jest";

const jestConfig: JestConfigWithTsJest = {
    testEnvironment: "jsdom",
    // Mobile has its own Jest configuration, aliases, and native mocks.
    testPathIgnorePatterns: ["/node_modules/", "/extension/e2e/", "/web/e2e/", "<rootDir>/mobile/"],
    modulePathIgnorePatterns: ["<rootDir>/\\.mobile-build/"],
    // testEnvironment: "node",
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/web/src/$1",
        "^@ui/(.*)$": "<rootDir>/packages/shared-ui/src/$1",
        "^@cryptex-industries/shared-ui/(.*)$":
            "<rootDir>/packages/shared-ui/$1",
        "^@cryptex-industries/vault-core$":
            "<rootDir>/packages/vault-core/src/index.ts",
        "^@cryptex-industries/vault-core/proto$":
            "<rootDir>/packages/vault-core/src/proto/vault.ts",
        "^@cryptex-industries/vault-core/(.*)$":
            "<rootDir>/packages/vault-core/src/$1",
    },
    transformIgnorePatterns: ["node_modules/(?!@ngrx|(?!deck.gl)|ng-dynamic)"],
    transform: {
        // Process js/ts/mjs/mts with `ts-jest`
        "^.+\\.m?[tj]sx?$": [
            "ts-jest",
            {
                tsconfig: {
                    jsx: "react-jsx",
                },
            },
        ],
    },
};

export default jestConfig;
