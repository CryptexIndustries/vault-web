import crypto from "crypto";
import * as test from "@jest/globals";
import { describe, it, expect } from "@jest/globals";

import * as Consts from "../../src/utils/consts";
import * as Vault from "../../src/app_lib/vault-utils/vault";
import * as VaultUtilTypes from "../../src/app_lib/proto/vault";

// We need to mock the crypto.subtle because we're not in a safe context
Object.defineProperty(window, "crypto", {
    value: {
        getRandomValues: (array: Uint8Array) => {
            return crypto.randomFillSync(array);
        },
        subtle: {
            digest: (algorithm: string, data: Uint8Array) => {
                return new Promise((resolve, reject) =>
                    resolve(
                        crypto
                            .createHash(
                                algorithm.toLowerCase().replace("-", ""),
                            )
                            .update(data)
                            .digest(),
                    ),
                );
            },
        },
    },
});

Object.defineProperty(window, "TextEncoder", {
    value: class TextEncoder {
        encode(text: string) {
            return new Uint8Array(Buffer.from(text, "utf-8"));
        }
    },
});

/*
    Credentials
        create
        update
        delete
        hash
        hashList
        changes
        TOTP
    Linking
        - LinkedDevices
            - static methods
        - packageForLinking
    Diffs
    Groups??
    Vault??
        - upgrading??
        - calculateMockedVaultHash
*/

describe("Credentials", () => {
    it("CreateFromForm", async () => {
        const form: Vault.CredentialFormSchemaType = {
            ID: null, // A new credential will not have an ID supplied in the form
            Type: VaultUtilTypes.ItemType.Credentials,
            GroupID: "2",
            Name: "Test CreateFromForm",
            Username: "test",
            Password: "test",
            TOTP: null, // NOTE: This field might be problematic. Possible null | undefined | object
            Tags: "tag1" + Consts.CredentialConstants.TAG_SEPARATOR + "tag2",
            URL: "https://cryptex-vault.com",
            Notes: "just a simple note",
            DateCreated: undefined,
            DateModified: undefined,
            DatePasswordChanged: undefined,
            CustomFields: [],
        };

        const credBasic = await Vault.createCredential(form);

        console.log(credBasic);

        /*
        {
            ID: '01JSMMXPZWB9RQE2KVCRA73BR8',
            Type: 1,
            GroupID: '2',
            Name: 'Test CreateFromForm',
            Username: 'test',
            Password: 'test',
            TOTP: undefined,
            Tags: 'tag1,|.|,tag2',
            URL: 'https://cryptex-vault.com',
            Notes: 'just a simple note',
            DateCreated: '2025-04-24T19:38:17.980Z',
            DateModified: undefined,
            DatePasswordChanged: undefined,
            CustomFields: [],
            Hash: '83b64eb2f038497280f6ea58c66fa7bf1e0e72dc'
        }
        */
        //#region Basic
        expect(credBasic.credential.ID).toBeDefined();
        expect(credBasic.credential.ID).not.toBe("");

        expect(credBasic.credential.Type).toBe(
            VaultUtilTypes.ItemType.Credentials,
        );
        expect(credBasic.credential.GroupID).toBe("2");
        expect(credBasic.credential.Name).toBe("Test CreateFromForm");
        expect(credBasic.credential.Username).toBe("test");
        expect(credBasic.credential.Password).toBe("test");
        expect(credBasic.credential.TOTP).toBe(undefined); // FIXME: This should be null
        expect(credBasic.credential.Tags).toBe(
            "tag1" + Consts.CredentialConstants.TAG_SEPARATOR + "tag2",
        );
        expect(credBasic.credential.URL).toBe("https://cryptex-vault.com");
        expect(credBasic.credential.Notes).toBe("just a simple note");

        expect(credBasic.credential.DateCreated).toBeDefined();
        expect(credBasic.credential.DateModified).toBe(undefined);
        expect(credBasic.credential.DatePasswordChanged).toBe(undefined);

        expect(credBasic.credential.CustomFields).toBeDefined();
        expect(credBasic.credential.CustomFields).toHaveLength(0);

        expect(credBasic.credential.Hash).toBeDefined();
        expect(credBasic.credential.Hash).toHaveLength(40); // SHA-1 160bits length = 160/4 -> 40
        expect(credBasic.credential.Hash).not.toBe("");
        //#endregion Basic

        // TODO: Test the changes

        //expect(credBasic.credential).toBe({
        //});
    });

    it("CreateFromDiff", () => {
        const form: VaultUtilTypes.PartialCredential = {
            CustomFields: [],
        };

        //const credential = new Vault.createCredential();
    });

    it("Update???", () => {
        //
    });

    it("Update???", () => {
        //
    });

    it("Delete", () => {
        //
    });

    it("Hash", () => {
        //
    });

    it("Hash", () => {
        //
    });
});
