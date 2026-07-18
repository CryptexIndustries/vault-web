import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("CredentialListIcon", () => {
    it("does not render or reference a remote image source", () => {
        const iconSource = readFileSync(
            resolve(
                process.cwd(),
                "extension/src/components/credential-list-icon.tsx",
            ),
            "utf8",
        );
        const vaultViewSource = readFileSync(
            resolve(process.cwd(), "extension/src/vault-view.tsx"),
            "utf8",
        );

        expect(iconSource).not.toContain("<img");
        expect(iconSource).not.toContain("AvatarImage");
        expect(iconSource).not.toContain("src=");
        expect(vaultViewSource).not.toContain("src={credential.url}");
    });
});
