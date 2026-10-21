import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Key generation and import pull in elliptic-curve code; the popup and the
// service worker must only load it on demand.
describe("SSH key module loading", () => {
    it.each([
        "extension/src/vault-view.tsx",
        "extension/src/components/ssh-key-editor.tsx",
        "extension/src/background/autofill-router.ts",
        "extension/src/utils/credential-search.ts",
        "web/src/utils/ssh-key.ts",
        "web/src/components/vault-dashboard/ssh-key-editor.tsx",
    ])("%s does not import the key module statically", (file) => {
        const source = readFileSync(resolve(process.cwd(), file), "utf8");
        // Type-only imports are erased, so only value imports count.
        expect(source).not.toMatch(
            /import\s+(?!type\b)[^;]*from\s+["']@cryptex-industries\/vault-core\/vault-utils\/ssh-key(-task)?["']/,
        );
    });
});
