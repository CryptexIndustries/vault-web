/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { webcrypto } from "crypto";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});

import { Credential, CredentialURLMatchMode, ItemType } from "../proto/vault";
import {
    CredentialFormSchema,
    VaultCredential,
    hashCredential,
} from "../vault-utils/vault";

const passkey = {
    CredentialID: "credential-id",
    RPID: "example.com",
    RPName: "Example",
    UserHandle: "user-handle",
    UserName: "person@example.com",
    UserDisplayName: "Person",
    PublicKey: "public-jwk",
    PrivateKey: "private-jwk",
    Algorithm: -7,
    SignCount: 0,
    Discoverable: true,
};

const form = {
    ID: null,
    Type: ItemType.Passkey,
    DirectoryID: "",
    Name: "Example passkey",
    Username: "",
    Password: "",
    TOTP: null,
    Tags: "",
    URL: "https://example.com/",
    URLMatchMode: CredentialURLMatchMode.ExactHost,
    AdditionalURLs: [],
    Passkey: passkey,
    Notes: "",
    CustomFields: [],
};

describe("passkey credentials", () => {
    it("validates complete passkey material", () => {
        expect(CredentialFormSchema.safeParse(form).success).toBe(true);
        expect(
            CredentialFormSchema.safeParse({
                ...form,
                Passkey: { ...passkey, PrivateKey: "" },
            }).success,
        ).toBe(false);
    });

    it("round-trips passkeys through the vault protobuf", () => {
        const credential = new VaultCredential(form);
        const decoded = Credential.decode(
            Credential.encode(credential).finish(),
        );

        expect(decoded.Type).toBe(ItemType.Passkey);
        expect(decoded.Passkey).toEqual(passkey);
    });

    it("includes passkey material in the synchronization hash", async () => {
        const first = new VaultCredential(form);
        const second = Object.assign(new VaultCredential(form), {
            ID: first.ID,
            Passkey: { ...passkey, PrivateKey: "different-private-jwk" },
        });

        expect(await hashCredential(first)).not.toBe(
            await hashCredential(second),
        );
    });
});
