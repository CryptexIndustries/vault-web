import { expect, it, jest } from "@jest/globals";

// Node checks the adapter against independent libsodium fixtures; Android tests
// run the same assertions with the actual Quick Crypto native implementation.
jest.mock("react-native-quick-crypto", () => require("node:crypto"));

import { testSodiumCompatibility } from "./sodium-compatibility";

it("preserves Argon2id and secretstream compatibility", async () => {
    await expect(testSodiumCompatibility()).resolves.toBeUndefined();
});
