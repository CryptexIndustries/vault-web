/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import { CredentialURLMatchMode, ItemType } from "../proto/vault";
import { generateSSHKey } from "../vault-utils/ssh-key";
import {
    CredentialFormSchema,
    type CredentialFormSchemaType,
    hashCredential,
    updateCredentialFromForm,
    VaultCredential,
} from "../vault-utils/vault";

const form = (
    overrides: Partial<CredentialFormSchemaType> = {},
): CredentialFormSchemaType => ({
    ID: null,
    Type: ItemType.SSHKey,
    DirectoryID: "",
    Name: "Work laptop",
    Username: "",
    Password: "",
    URL: "",
    URLMatchMode: CredentialURLMatchMode.ExactHost,
    AdditionalURLs: [],
    Notes: "",
    CustomFields: [],
    SSHKey: generateSSHKey("work"),
    ...overrides,
});

describe("SSH key items", () => {
    it("accepts a generated key", () => {
        expect(CredentialFormSchema.safeParse(form()).success).toBe(true);
    });

    it("requires key data for SSH key items", () => {
        const result = CredentialFormSchema.safeParse(form({ SSHKey: null }));
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["SSHKey"]);
    });

    it("rejects damaged key data", () => {
        const key = generateSSHKey("x");
        const result = CredentialFormSchema.safeParse(
            form({ SSHKey: { ...key, PublicKey: "ssh-ed25519 broken" } }),
        );
        expect(result.success).toBe(false);
    });

    it("reads an unspecified type as an ordinary credential", () => {
        const credential = new VaultCredential(
            form({ Type: ItemType.Unspecified, SSHKey: generateSSHKey("x") }),
        );
        expect(credential.Type).toBe(ItemType.Credentials);
        expect(credential.SSHKey).toBeUndefined();
    });

    it("keeps the key when an edit doesn't carry it", async () => {
        const original = new VaultCredential(form());
        const updated = await updateCredentialFromForm(original, {
            ...form({ Name: "Renamed" }),
            SSHKey: undefined,
        });
        expect(updated.SSHKey).toEqual(original.SSHKey);
        expect(updated.Name).toBe("Renamed");
    });

    it("drops the key when the item stops being an SSH key", async () => {
        const original = new VaultCredential(form());
        const updated = await updateCredentialFromForm(
            original,
            form({ Type: ItemType.Credentials }),
        );
        expect(updated.SSHKey).toBeUndefined();
    });

    it("includes the key in the item hash", async () => {
        const credential = new VaultCredential(form());
        const before = await hashCredential(credential);
        credential.SSHKey = { ...credential.SSHKey!, Comment: "changed" };
        expect(await hashCredential(credential)).not.toBe(before);
    });
});
