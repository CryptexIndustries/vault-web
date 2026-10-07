import type { Config } from "jest";

const config: Config = {
    rootDir: ".",
    testEnvironment: "node",
    testMatch: ["<rootDir>/tests/**/*.test.ts"],
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
        "^@ui/(.*)$": "<rootDir>/../packages/shared-ui/src/$1",
        "^@cryptex-industries/vault-core$":
            "<rootDir>/../packages/vault-core/src/index.ts",
        "^@cryptex-industries/vault-core/proto$":
            "<rootDir>/../packages/vault-core/src/proto/vault.ts",
        "^@cryptex-industries/vault-core/(.*)$":
            "<rootDir>/../packages/vault-core/src/$1",
        "^expo-clipboard$": "<rootDir>/tests/mocks/expo-clipboard.ts",
    },
    transform: {
        "^.+\\.m?[tj]sx?$": [
            "ts-jest",
            {
                tsconfig: "<rootDir>/tsconfig.test.json",
                diagnostics: false,
            },
        ],
    },
    transformIgnorePatterns: [
        "<rootDir>/../node_modules/.pnpm/(?!(?:@noble\\+hashes|@scure\\+(?:base|bip39))@)",
        "node_modules/(?!.pnpm|@noble/hashes|@scure/(?:base|bip39))",
    ],
    setupFiles: ["<rootDir>/tests/setup.ts"],
    clearMocks: true,
};

export default config;
