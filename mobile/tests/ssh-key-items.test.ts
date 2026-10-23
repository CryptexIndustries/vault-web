import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    CredentialURLMatchMode,
    ItemType,
} from "@cryptex-industries/vault-core/proto";
import { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";
import { filterCredentials } from "@/utils/credential-search";
import {
    buildAutofillCredentialRows,
    isAutofillCandidate,
    matchingAutofillCredentials,
} from "@/utils/android-autofill";
import { buildAndroidProviderCredentials } from "@/utils/android-provider-credentials";
import { sshKeyInfo } from "@/utils/ssh-keys";

const fixtures = resolve(
    __dirname,
    "../../packages/vault-core/src/tests/fixtures/ssh",
);
const fixture = (name: string) => readFileSync(resolve(fixtures, name), "utf8");
const publicKey = (name: string) =>
    fixture(name).trim().split(" ").slice(0, 2).join(" ");

const sshItem = (overrides: Partial<VaultCredential> = {}) =>
    Object.assign(new VaultCredential(), {
        ID: "ssh",
        Type: ItemType.SSHKey,
        Name: "Work laptop",
        Username: "",
        Password: "",
        URL: "",
        Notes: "",
        Tags: "",
        Deleted: false,
        SSHKey: {
            PrivateKey: "private-key-secret",
            PublicKey: publicKey("ed25519.key.pub"),
            Comment: "ed25519@fixtures",
        },
        ...overrides,
    });

const login = Object.assign(new VaultCredential(), {
    ID: "login",
    Type: ItemType.Credentials,
    Name: "Example",
    Username: "user@example.test",
    Password: "secret",
    URL: "https://example.test",
    URLMatchMode: CredentialURLMatchMode.ExactHost,
    Notes: "",
    Tags: "",
    Deleted: false,
});

describe("SSH key items", () => {
    it("are found by name, comment and fingerprint but not by key material", () => {
        const item = sshItem();
        const fingerprint = sshKeyInfo(item)!.fingerprint;
        const items = [item, login];
        expect(filterCredentials(items, "laptop")).toEqual([item]);
        expect(filterCredentials(items, "ed25519@fix")).toEqual([item]);
        expect(filterCredentials(items, fingerprint)).toEqual([item]);
        expect(
            filterCredentials(items, fingerprint.slice(7, 20).toLowerCase()),
        ).toEqual([item]);
        expect(filterCredentials(items, "private-key-secret")).toEqual([]);
        expect(filterCredentials(items, "AAAAC3Nza")).toEqual([]);
    });

    it("are never offered by Android autofill or Credential Manager", () => {
        // Even a damaged SSH item carrying login fields must stay out.
        const item = sshItem({
            Username: "user@example.test",
            Password: "secret",
            URL: "https://example.test",
            URLMatchMode: CredentialURLMatchMode.ExactHost,
        });
        expect(isAutofillCandidate(item)).toBe(false);
        expect(isAutofillCandidate(login)).toBe(true);
        const target = {
            pageUrl: "https://example.test",
            appUri: null,
            displayName: "example.test",
            warningType: null,
        };
        expect(matchingAutofillCredentials([item, login], target)).toEqual([
            login,
        ]);
        const eligible = [item, login].filter(isAutofillCandidate);
        expect(
            buildAutofillCredentialRows(eligible, [], "", true).map(
                (row) => row.credential.ID,
            ),
        ).toEqual(["login"]);
        const provided = buildAndroidProviderCredentials([item, login]);
        expect(provided.map((entry) => entry.vaultId)).toEqual(["login"]);
        expect(JSON.stringify(provided)).not.toContain("private-key-secret");
    });
});
