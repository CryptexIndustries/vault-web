import * as jest from "@jest/globals";

import crypto from "crypto";

import { Credential, Vault, Import } from "../src/app_lib/vault_utils";
import {
    TOTPAlgorithm,
    ItemType,
    Group,
    Diff,
    DiffType,
    PartialCredential,
} from "../src/app_lib/proto/vault";

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

// Mock the TextEncoder
Object.defineProperty(window, "TextEncoder", {
    value: class TextEncoder {
        encode(text: string) {
            return new Uint8Array(Buffer.from(text, "utf-8"));
        }
    },
});

// Make sure to silent console.time and console.timeEnd output
Object.defineProperty(window, "console", {
    value: {
        time: () => {},
        timeLog: () => {},
        timeEnd: () => {},
        debug: () => {},
        // Polyfill the log function to add a timestamp
        // log: (...args: any[]) => {
        //     const date = new Date();
        //     const timestamp = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
        //     console.log(`[${timestamp}]`, ...args);
        // },
    },
});

// FIXME: Don't know why I can't use this
// jest.useFakeTimers();
// jest.spyOn(global, 'setTimeout');

jest.describe("Credentials - General", () => {
    /**
     * This test is used to make sure that the vault credentials can be consistently sorted.
     */
    jest.it(
        "Ordering consistency (ULID validation)",
        async () => {
            const numberOfCredentials = 1000;
            const vaultsInParallel = 10;

            // Generate n credentials then call the sortOrdered method 100 times
            // and check if the order is consistent
            // Do this with n vaults in parallel
            // We end up generating numberOfCredentials * vaultsInParallel credentials
            const promises = [];
            for (let i = 0; i < vaultsInParallel; i++) {
                const promise = new Promise<void>(async (resolve, reject) => {
                    const vault = new Vault();

                    // Make sure we don't generate a diff or hash, in order to save resources
                    vault.Configuration.InhibitDiffGeneration = true;
                    vault.Configuration.SaveOnlyLatestDiffWhenNoLinked = true;

                    for (let i = 0; i < numberOfCredentials; i++) {
                        await vault.createCredential({
                            ID: null,
                            Type: ItemType.Credentials,
                            GroupID: "",
                            Name: `Credential ${i}`,
                            Username: `Username ${i}`,
                            Password: `Password ${i}`,
                            TOTP: undefined,
                            Tags: "",
                            URL: "",
                            Notes: "",
                            DateCreated: undefined,
                            DateModified: undefined,
                            DatePasswordChanged: undefined,
                            CustomFields: [],
                        } as Credential.CredentialFormSchemaType);
                    }

                    // Check that there are n credentials
                    jest.expect(vault.Credentials.length).toBe(
                        numberOfCredentials,
                    );

                    const sortedLists = [];
                    // Sort n times
                    for (let i = 0; i < 100; i++) {
                        sortedLists.push(vault.getSortedCredentials());
                    }

                    // Check that the lists are identical
                    for (let i = 0; i < sortedLists.length - 1; i++) {
                        jest.expect(sortedLists[i]).toEqual(sortedLists[i + 1]);
                    }

                    resolve();
                });
                promises.push(promise);
            }
            await Promise.all(promises);
        },
        1500,
    );
});

/**
 * This test is used to make sure that the vault groups can be created, updated and deleted.
 */
jest.describe("Groups - CRUD", () => {
    const vault = new Vault();

    jest.it(
        "Create",
        async () => {
            vault.upsertGroup({
                ID: null,
                Name: "Test group",
                Color: "#000000",
                Icon: "lock",
            });

            // Check that the group is in the vault
            jest.expect(vault.Groups.length).toBe(1);

            if (vault.Groups[0] == null)
                throw new Error(
                    "Group was not created properly. Tests should have failed before this.",
                );

            // Check that the group has an ID
            jest.expect(vault.Groups[0].ID).not.toBeNull();

            // Check that the group has the expected values
            jest.expect(Object.assign({}, vault.Groups[0])).toStrictEqual({
                ID: vault.Groups[0].ID,
                Name: "Test group",
                Color: "#000000",
                Icon: "lock",
            } as Group);
        },
        100,
    );

    jest.it(
        "Update",
        async () => {
            if (vault.Groups[0] == null)
                throw new Error(
                    "No group to update. Tests should have failed before this.",
                );

            // Update the group
            vault.upsertGroup({
                ID: vault.Groups[0].ID,
                Name: "Updated group",
                Color: "#100000",
                Icon: "unlock",
            });

            // Check that the group has the expected values
            jest.expect(Object.assign({}, vault.Groups[0])).toStrictEqual({
                ID: vault.Groups[0].ID,
                Name: "Updated group",
                Color: "#100000",
                Icon: "unlock",
            } as Group);
        },
        100,
    );

    jest.it(
        "Delete",
        async () => {
            if (vault.Groups[0] == null)
                throw new Error(
                    "No group to delete. Tests should have failed before this.",
                );

            // Delete the group
            vault.deleteGroup(vault.Groups[0].ID);

            // Check that the group is deleted
            jest.expect(vault.Groups.length).toBe(0);
        },
        100,
    );
});

/**
 * This test is used to make sure that the vault groups can be synchronized.
 * @todo Implement this test once we can synchronize groups
 */
jest.describe("Synchronization - Groups", () => {});

/**
 * The main goal of these tests is to make sure that the expected fields are
 * present in the vault and that they are properly updated when the credential
 * is updated.
 */
jest.describe("Credentials - CRUD", () => {
    // This is to make sure that timestamps are different between tests
    const timeBetweenTests = 1;

    // Instantiate a vault and inhibit diff generation
    const vault = new Vault();

    // Make sure to not generate hashes and diffs
    vault.Configuration.InhibitDiffGeneration = false;
    vault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

    let initialCredential: Credential.CredentialFormSchemaType | null = null;

    jest.it(
        "Create",
        async () => {
            // Create a credential
            const credential: Credential.CredentialFormSchemaType = {
                ID: null,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: "Test credential",
                Username: "",
                Password: "",
                TOTP: undefined,
                Tags: "",
                URL: "",
                Notes: "",
                DateCreated: undefined,
                DateModified: undefined,
                DatePasswordChanged: undefined,
                CustomFields: [],
            };

            const createdCredential = await vault.createCredential(credential);

            // Intentionally strip the methods from the credential instance
            initialCredential = Object.assign({}, createdCredential);

            jest.expect(createdCredential).not.toBeNull();

            if (!createdCredential)
                throw new Error(
                    "Credential was not created properly. Tests should have failed before this.",
                );

            // Check that the credential has an ID
            jest.expect(createdCredential.ID).not.toBeNull();

            // Check that the credential is in the vault
            jest.expect(vault.Credentials.length).toBe(1);

            const createdCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // The hash should be present - whatever the value
            jest.expect(createdCredentialRaw.Hash).not.toBeNull();

            jest.expect(createdCredentialRaw).toStrictEqual({
                ID: createdCredential.ID,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: credential.Name,
                Username: "",
                Password: "",
                URL: "",
                Notes: "",
                Tags: "",
                TOTP: undefined,
                CustomFields: [],
                DateCreated: createdCredential.DateCreated,
                DateModified: undefined,
                DatePasswordChanged: undefined,
                Hash: createdCredentialRaw.Hash, // This value has been asserted before
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - Name",
        async () => {
            if (vault.Credentials[0] == null || initialCredential == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // Wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredential;
            updatedCredentialForm.Name = "Updated credential";

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // Check that the credential is updated
            // NOTE: This is not likely to fail, because we're comparing references
            jest.expect(vault.Credentials[0]).toEqual(updatedCredential);

            // Check if the hash has changed
            jest.expect(updatedCredential.Hash).not.toBeNull();
            jest.expect(updatedCredential.Hash).not.toEqual(
                initialCredentialRaw.Hash,
            );

            // Only the name and the DateModified field should have changed, the rest should be the same
            // Make sure to convert the current credential to a raw object, otherwise the comparison
            // will fail as it could contain some methods
            jest.expect(Object.assign({}, vault.Credentials[0])).toStrictEqual({
                ...initialCredentialRaw,
                Name: updatedCredentialForm.Name,
                DateModified: updatedCredential.DateModified,
                Hash: updatedCredential.Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - Username",
        async () => {
            if (vault.Credentials[0] == null || initialCredential == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredential;
            updatedCredentialForm.Username = "Updated username";

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // Check that the credential is updated
            // NOTE: This is not likely to fail, because we're comparing references
            jest.expect(vault.Credentials[0]).toEqual(updatedCredential);

            // Check if the hash has changed
            jest.expect(updatedCredential.Hash).not.toBeNull();
            jest.expect(updatedCredential.Hash).not.toEqual(
                initialCredentialRaw.Hash,
            );

            // Only the username and the DateModified field should have changed, the rest should be the same
            // Make sure to convert the current credential to a raw object, otherwise the comparison
            // will fail as it could contain some methods
            jest.expect(Object.assign({}, vault.Credentials[0])).toStrictEqual({
                ...initialCredentialRaw,
                Username: updatedCredentialForm.Username,
                DateModified: updatedCredential.DateModified,
                Hash: updatedCredential.Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - Password",
        async () => {
            if (vault.Credentials[0] == null || initialCredential == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredential;
            updatedCredentialForm.Password = "Updated password";

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // Check that the credential is updated
            // NOTE: This is not likely to fail, because we're comparing references
            jest.expect(vault.Credentials[0]).toEqual(updatedCredential);

            // Check if the hash has changed
            jest.expect(updatedCredential.Hash).not.toBeNull();
            jest.expect(updatedCredential.Hash).not.toEqual(
                initialCredentialRaw.Hash,
            );

            // Only the password and the DateModified field should have changed, the rest should be the same
            // Make sure to convert the current credential to a raw object, otherwise the comparison
            // will fail as it could contain some methods
            jest.expect(Object.assign({}, vault.Credentials[0])).toStrictEqual({
                ...initialCredentialRaw,
                Password: updatedCredentialForm.Password,
                DateModified: updatedCredential.DateModified,
                DatePasswordChanged: updatedCredential.DatePasswordChanged,
                Hash: updatedCredential.Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - URL",
        async () => {
            if (vault.Credentials[0] == null || initialCredential == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredential;
            updatedCredentialForm.URL = "Updated url";

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // Check that the credential is updated
            // NOTE: This is not likely to fail, because we're comparing references
            jest.expect(vault.Credentials[0]).toEqual(updatedCredential);

            // Check if the hash has changed
            jest.expect(updatedCredential.Hash).not.toBeNull();
            jest.expect(updatedCredential.Hash).not.toEqual(
                initialCredentialRaw.Hash,
            );

            // Only the url and the DateModified field should have changed, the rest should be the same
            // Make sure to convert the current credential to a raw object, otherwise the comparison
            // will fail as it could contain some methods
            jest.expect(Object.assign({}, vault.Credentials[0])).toStrictEqual({
                ...initialCredentialRaw,
                URL: updatedCredentialForm.URL,
                DateModified: updatedCredential.DateModified,
                Hash: updatedCredential.Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - Notes",
        async () => {
            if (vault.Credentials[0] == null || initialCredential == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredential;
            updatedCredentialForm.Notes = "Updated note";

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // Check that the credential is updated
            // NOTE: This is not likely to fail, because we're comparing references
            jest.expect(vault.Credentials[0]).toEqual(updatedCredential);

            // Check if the hash has changed
            jest.expect(updatedCredential.Hash).not.toBeNull();
            jest.expect(updatedCredential.Hash).not.toEqual(
                initialCredentialRaw.Hash,
            );

            // Only the note and the DateModified field should have changed, the rest should be the same
            // Make sure to convert the current credential to a raw object, otherwise the comparison
            // will fail as it could contain some methods
            jest.expect(Object.assign({}, vault.Credentials[0])).toStrictEqual({
                ...initialCredentialRaw,
                Notes: updatedCredentialForm.Notes,
                DateModified: updatedCredential.DateModified,
                Hash: updatedCredential.Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - Tags",
        async () => {
            if (vault.Credentials[0] == null || initialCredential == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredential;
            updatedCredentialForm.Tags = ["Tag1", "Tag2", "Tag3"].join(
                Credential.TAG_SEPARATOR,
            );

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // Check that the credential is updated
            // NOTE: This is not likely to fail, because we're comparing references
            jest.expect(vault.Credentials[0]).toEqual(updatedCredential);

            // Check if the hash has changed
            jest.expect(updatedCredential.Hash).not.toBeNull();
            jest.expect(updatedCredential.Hash).not.toEqual(
                initialCredentialRaw.Hash,
            );

            // Only the tags and the DateModified field should have changed, the rest should be the same
            // Make sure to convert the current credential to a raw object, otherwise the comparison
            // will fail as it could contain some methods
            jest.expect(Object.assign({}, vault.Credentials[0])).toStrictEqual({
                ...initialCredentialRaw,
                Tags: updatedCredentialForm.Tags,
                DateModified: updatedCredential.DateModified,
                Hash: updatedCredential.Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - TOTP - Create",
        async () => {
            if (vault.Credentials[0] == null || initialCredential == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredential;
            updatedCredentialForm.TOTP = {
                Label: "TOTP label",
                Secret: "TOTP secret",
                Period: 30,
                Digits: 6,
                Algorithm: TOTPAlgorithm.SHA1,
            };

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // Check that the credential is updated
            // NOTE: This is not likely to fail, because we're comparing references
            jest.expect(vault.Credentials[0]).toEqual(updatedCredential);

            // Check if the hash has changed
            jest.expect(updatedCredential.Hash).not.toBeNull();
            jest.expect(updatedCredential.Hash).not.toEqual(
                initialCredentialRaw.Hash,
            );

            // Only the TOTP and the DateModified field should have changed, the rest should be the same
            // Make sure to convert the current credential to a raw object, otherwise the comparison
            // will fail as it could contain some methods
            jest.expect(Object.assign({}, vault.Credentials[0])).toStrictEqual({
                ...initialCredentialRaw,
                TOTP: Object.assign(
                    new Credential.TOTP(),
                    updatedCredentialForm.TOTP,
                ),
                DateModified: updatedCredential.DateModified,
                Hash: updatedCredential.Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - TOTP - Remove",
        async () => {
            if (vault.Credentials[0] == null || initialCredential == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredential;
            updatedCredentialForm.TOTP = undefined;

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // Check that the credential is updated
            // NOTE: This is not likely to fail, because we're comparing references
            jest.expect(vault.Credentials[0]).toEqual(updatedCredential);

            // Check if the hash has changed
            jest.expect(updatedCredential.Hash).not.toBeNull();
            jest.expect(updatedCredential.Hash).not.toEqual(
                initialCredentialRaw.Hash,
            );

            // Only the TOTP and the DateModified field should have changed, the rest should be the same
            // Make sure to convert the current credential to a raw object, otherwise the comparison
            // will fail as it could contain some methods
            jest.expect(Object.assign({}, vault.Credentials[0])).toStrictEqual({
                ...initialCredentialRaw,
                TOTP: undefined,
                DateModified: updatedCredential.DateModified,
                Hash: updatedCredential.Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Delete",
        async () => {
            if (vault.Credentials[0] == null)
                throw new Error(
                    "No credential to delete. Tests should have failed before this.",
                );

            // Delete the credential
            await vault.deleteCredential(vault.Credentials[0].ID);

            // Check that the credential is deleted
            jest.expect(vault.Credentials.length).toBe(0);
        },
        100,
    );
});

/**
 * This test is used for the diff generation. It makes sure that the diff
 * contains the expected fields and that they are properly set when the
 * credential is created/updated.
 */
jest.describe("Credentials - Diff", () => {
    // This is to make sure that timestamps are different between tests
    const timeBetweenTests = 1;

    // Instantiate a vault and inhibit diff generation
    const vault = new Vault();

    // Make sure to generate hashes and diffs
    vault.Configuration.InhibitDiffGeneration = false;
    vault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

    jest.it(
        "Create credential",
        async () => {
            // Create a credential
            const credential: Credential.CredentialFormSchemaType = {
                ID: null,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: "Test credential",
                Username: "",
                Password: "",
                TOTP: {
                    Label: "Bla",
                    Algorithm: TOTPAlgorithm.SHA1,
                    Digits: 6,
                    Period: 30,
                    Secret: "ASKJHDSKJHDKJ",
                },
                Tags: "",
                URL: "",
                Notes: "",
                DateCreated: undefined,
                DateModified: undefined,
                DatePasswordChanged: undefined,
                CustomFields: [],
            };

            const createdCredential = await vault.createCredential(credential);

            jest.expect(createdCredential).not.toBeNull();

            if (!createdCredential)
                throw new Error(
                    "Credential was not created properly. Tests should have failed before this.",
                );

            // Check that the credential has an ID
            jest.expect(createdCredential.ID).not.toBeNull();

            // Check that the credential is in the vault
            jest.expect(vault.Credentials.length).toBe(1);

            // The diff should be present, since we've just created a credential
            jest.expect(vault.Diffs.length).toBe(1);

            const createdCredentialDiffRaw = Object.assign({}, vault.Diffs[0]);

            jest.expect(createdCredentialDiffRaw).not.toBeNull();

            jest.expect(createdCredentialDiffRaw.Changes).not.toBeNull();
            if (!createdCredentialDiffRaw.Changes)
                throw new Error(
                    "Diff was not created properly. Tests should have failed before this.",
                );

            // The ID should be present - whatever the value
            jest.expect(createdCredentialDiffRaw.Changes.ID).not.toBeNull();

            createdCredentialDiffRaw.Changes.Props = Object.assign(
                {},
                createdCredentialDiffRaw.Changes.Props,
            );

            // The hash should be present - whatever the value
            // NOTE: We can't compare the hash because the Diff hash is actually a hash of all of the credential hashes
            // jest.expect(createdCredentialDiffRaw.Hash).toBe(createdCredential.Hash);
            // We can only check if the hash is present
            jest.expect(createdCredentialDiffRaw.Hash).not.toBeNull();

            const expectedTOTP = new Credential.TOTP();
            expectedTOTP.Label = "Bla";
            expectedTOTP.Algorithm = TOTPAlgorithm.SHA1;
            expectedTOTP.Digits = 6;
            expectedTOTP.Period = 30;
            expectedTOTP.Secret = "ASKJHDSKJHDKJ";

            jest.expect(createdCredentialDiffRaw).toStrictEqual({
                Hash: createdCredentialDiffRaw.Hash,
                Changes: {
                    ID: createdCredential.ID, // This ID property value is actually the value of the credential ID
                    Type: DiffType.Add,
                    Props: {
                        ID: createdCredential.ID,
                        Type: ItemType.Credentials,
                        GroupID: "",
                        Name: credential.Name,
                        Username: "",
                        Password: "",
                        URL: "",
                        Notes: "",
                        Tags: "",
                        TOTP: expectedTOTP,
                        CustomFields: [],
                        DateCreated: createdCredential.DateCreated, // NOTE: We don't have to check for the correct value here, just that it is the same as the credential (since that has been tested before)
                        DateModified: undefined,
                        DatePasswordChanged: undefined,
                    } as PartialCredential,
                },
            } as Diff);
        },
        100,
    );

    jest.it(
        "Apply diff - (Create)",
        async () => {
            // Take the diffs from the vault and apply them to a new vault
            // Then check that the new vault has the same credentials as the original vault
            // NOTE: We don't apply the delete diff before checking the credentials, to make sure that everything is working properly

            const newVault = new Vault();

            // Make sure to generate hashes and diffs
            newVault.Configuration.InhibitDiffGeneration = false;
            newVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

            const diffs = vault.Diffs;

            jest.expect(diffs.length).toBe(1);

            // Apply the diffs
            await newVault.applyDiffs(diffs);

            // Check that the credentials are in the vault
            jest.expect(newVault.Credentials.length).toBe(1);
            if (newVault.Credentials[0] == null || vault.Credentials[0] == null)
                throw new Error(
                    "Credential was not created properly. Tests should have failed before this.",
                );

            // Compare the hashes of the vaults
            jest.expect(await newVault.getLatestHash()).toBe(
                await vault.getLatestHash(),
            );

            const expectedTOTP = new Credential.TOTP();
            expectedTOTP.Label = "Bla";
            expectedTOTP.Algorithm = TOTPAlgorithm.SHA1;
            expectedTOTP.Digits = 6;
            expectedTOTP.Period = 30;
            expectedTOTP.Secret = "ASKJHDSKJHDKJ";

            // Check that the credentials have the expected values
            jest.expect(
                Object.assign({}, newVault.Credentials[0]),
            ).toStrictEqual({
                ID: vault.Credentials[0].ID,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: "Test credential",
                Username: "",
                Password: "",
                TOTP: expectedTOTP,
                Tags: "",
                URL: "",
                Notes: "",
                DateCreated: vault.Credentials[0].DateCreated,
                DateModified: undefined,
                DatePasswordChanged: undefined,
                CustomFields: [],
                Hash: vault.Credentials[0].Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - Name",
        async () => {
            if (vault.Credentials[0] == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // Wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredentialRaw;
            updatedCredentialForm.Name = "Updated credential";

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // The diff should be present, since we've just updated a credential
            jest.expect(vault.Diffs.length).toBe(2);

            const updatedCredentialDiffRaw = Object.assign({}, vault.Diffs[1]);

            jest.expect(updatedCredentialDiffRaw).not.toBeNull();

            jest.expect(updatedCredentialDiffRaw.Changes).not.toBeNull();
            if (!updatedCredentialDiffRaw.Changes)
                throw new Error(
                    "Diff was not created properly. Tests should have failed before this.",
                );

            // The ID should be present - whatever the value
            jest.expect(updatedCredentialDiffRaw.Changes.ID).toEqual(
                updatedCredential.ID,
            );

            updatedCredentialDiffRaw.Changes.Props = Object.assign(
                {},
                updatedCredentialDiffRaw.Changes.Props,
            );

            jest.expect(updatedCredentialDiffRaw).toStrictEqual({
                Hash: updatedCredentialDiffRaw.Hash,
                Changes: {
                    ID: updatedCredential.ID, // This ID property value is actually the value of the credential ID
                    Type: DiffType.Update,
                    Props: {
                        Name: "Updated credential",
                        CustomFields: [], // This is always present, even if it's empty
                        DateModified: updatedCredential.DateModified,
                        ChangeFlags: {
                            TypeHasChanged: false,
                            GroupIDHasChanged: false,
                            NameHasChanged: true,
                            UsernameHasChanged: false,
                            PasswordHasChanged: false,
                            TOTPHasChanged: false,
                            TagsHasChanged: false,
                            URLHasChanged: false,
                            NotesHasChanged: false,
                            DateCreatedHasChanged: false,
                            DateModifiedHasChanged: true,
                            DatePasswordChangedHasChanged: false,
                            CustomFieldsHasChanged: false,
                        },
                    } as PartialCredential,
                },
            } as Diff);
        },
        100,
    );

    jest.it(
        "Apply diff - (Update - Name)",
        async () => {
            // Take the diffs from the vault and apply them to a new vault
            // Then check that the new vault has the same credentials as the original vault
            // NOTE: We don't apply the delete diff before checking the credentials, to make sure that everything is working properly

            const newVault = new Vault();

            // Make sure to generate hashes and diffs
            newVault.Configuration.InhibitDiffGeneration = false;
            newVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

            // Copy the diffs
            const diffs = vault.Diffs.slice();

            jest.expect(diffs.length).toBe(2);

            // Apply the diffs
            await newVault.applyDiffs(diffs);

            // Check that the credentials are in the vault
            jest.expect(newVault.Credentials.length).toBe(1);
            if (newVault.Credentials[0] == null || vault.Credentials[0] == null)
                throw new Error(
                    "Credential was not created properly. Tests should have failed before this.",
                );

            // Compare the hashes of the vaults
            jest.expect(await newVault.getLatestHash()).toBe(
                await vault.getLatestHash(),
            );

            const expectedTOTP = new Credential.TOTP();
            expectedTOTP.Label = "Bla";
            expectedTOTP.Algorithm = TOTPAlgorithm.SHA1;
            expectedTOTP.Digits = 6;
            expectedTOTP.Period = 30;
            expectedTOTP.Secret = "ASKJHDSKJHDKJ";

            // Check that the credentials have the expected values
            jest.expect(
                Object.assign({}, newVault.Credentials[0]),
            ).toStrictEqual({
                ID: vault.Credentials[0].ID,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: "Updated credential",
                Username: "",
                Password: "",
                TOTP: expectedTOTP,
                Tags: "",
                URL: "",
                Notes: "",
                DateCreated: vault.Credentials[0].DateCreated,
                DateModified: vault.Credentials[0].DateModified,
                DatePasswordChanged: undefined,
                CustomFields: [],
                Hash: vault.Credentials[0].Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - Username",
        async () => {
            if (vault.Credentials[0] == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // Wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredentialRaw;
            updatedCredentialForm.Username = "Updated Username";

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // The diff should be present, since we've just updated a credential
            jest.expect(vault.Diffs.length).toBe(3);

            const updatedCredentialDiffRaw = Object.assign({}, vault.Diffs[2]);

            jest.expect(updatedCredentialDiffRaw).not.toBeNull();

            jest.expect(updatedCredentialDiffRaw.Changes).not.toBeNull();
            if (!updatedCredentialDiffRaw.Changes)
                throw new Error(
                    "Diff was not created properly. Tests should have failed before this.",
                );

            // The ID should be present - whatever the value
            jest.expect(updatedCredentialDiffRaw.Changes.ID).toEqual(
                updatedCredential.ID,
            );

            updatedCredentialDiffRaw.Changes.Props = Object.assign(
                {},
                updatedCredentialDiffRaw.Changes.Props,
            );

            jest.expect(updatedCredentialDiffRaw).toStrictEqual({
                Hash: updatedCredentialDiffRaw.Hash,
                Changes: {
                    ID: updatedCredential.ID, // This ID property value is actually the value of the credential ID
                    Type: DiffType.Update,
                    Props: {
                        Username: "Updated Username",
                        CustomFields: [], // This is always present, even if it's empty
                        DateModified: updatedCredential.DateModified,
                        ChangeFlags: {
                            TypeHasChanged: false,
                            GroupIDHasChanged: false,
                            NameHasChanged: false,
                            UsernameHasChanged: true,
                            PasswordHasChanged: false,
                            TOTPHasChanged: false,
                            TagsHasChanged: false,
                            URLHasChanged: false,
                            NotesHasChanged: false,
                            DateCreatedHasChanged: false,
                            DateModifiedHasChanged: true,
                            DatePasswordChangedHasChanged: false,
                            CustomFieldsHasChanged: false,
                        },
                    } as PartialCredential,
                },
            } as Diff);
        },
        100,
    );

    jest.it(
        "Apply diff - (Update - Username)",
        async () => {
            // Take the diffs from the vault and apply them to a new vault
            // Then check that the new vault has the same credentials as the original vault
            // NOTE: We don't apply the delete diff before checking the credentials, to make sure that everything is working properly

            const newVault = new Vault();

            // Make sure to generate hashes and diffs
            newVault.Configuration.InhibitDiffGeneration = false;
            newVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

            const diffs = vault.Diffs;

            jest.expect(diffs.length).toBe(3);

            // Apply the diffs
            await newVault.applyDiffs(diffs);

            // Check that the credentials are in the vault
            jest.expect(newVault.Credentials.length).toBe(1);
            if (newVault.Credentials[0] == null || vault.Credentials[0] == null)
                throw new Error(
                    "Credential was not created properly. Tests should have failed before this.",
                );

            // Compare the hashes of the vaults
            jest.expect(await newVault.getLatestHash()).toBe(
                await vault.getLatestHash(),
            );

            const expectedTOTP = new Credential.TOTP();
            expectedTOTP.Label = "Bla";
            expectedTOTP.Algorithm = TOTPAlgorithm.SHA1;
            expectedTOTP.Digits = 6;
            expectedTOTP.Period = 30;
            expectedTOTP.Secret = "ASKJHDSKJHDKJ";

            // Check that the credentials have the expected values
            jest.expect(
                Object.assign({}, newVault.Credentials[0]),
            ).toStrictEqual({
                ID: vault.Credentials[0].ID,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: "Updated credential",
                Username: "Updated Username",
                Password: "",
                TOTP: expectedTOTP,
                Tags: "",
                URL: "",
                Notes: "",
                DateCreated: vault.Credentials[0].DateCreated,
                DateModified: vault.Credentials[0].DateModified,
                DatePasswordChanged: undefined,
                CustomFields: [],
                Hash: vault.Credentials[0].Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - Password",
        async () => {
            if (vault.Credentials[0] == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // Wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredentialRaw;
            updatedCredentialForm.Password = "Updated Password";

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // The diff should be present, since we've just updated a credential
            jest.expect(vault.Diffs.length).toBe(4);

            const updatedCredentialDiffRaw = Object.assign({}, vault.Diffs[3]);

            jest.expect(updatedCredentialDiffRaw).not.toBeNull();

            jest.expect(updatedCredentialDiffRaw.Changes).not.toBeNull();
            if (!updatedCredentialDiffRaw.Changes)
                throw new Error(
                    "Diff was not created properly. Tests should have failed before this.",
                );

            // The ID should be present - whatever the value
            jest.expect(updatedCredentialDiffRaw.Changes.ID).toEqual(
                updatedCredential.ID,
            );

            updatedCredentialDiffRaw.Changes.Props = Object.assign(
                {},
                updatedCredentialDiffRaw.Changes.Props,
            );

            jest.expect(updatedCredentialDiffRaw).toStrictEqual({
                Hash: updatedCredentialDiffRaw.Hash,
                Changes: {
                    ID: updatedCredential.ID, // This ID property value is actually the value of the credential ID
                    Type: DiffType.Update,
                    Props: {
                        Password: "Updated Password",
                        CustomFields: [], // This is always present, even if it's empty
                        DateModified: updatedCredential.DateModified,
                        DatePasswordChanged:
                            updatedCredential.DatePasswordChanged,
                        ChangeFlags: {
                            TypeHasChanged: false,
                            GroupIDHasChanged: false,
                            NameHasChanged: false,
                            UsernameHasChanged: false,
                            PasswordHasChanged: true,
                            TOTPHasChanged: false,
                            TagsHasChanged: false,
                            URLHasChanged: false,
                            NotesHasChanged: false,
                            DateCreatedHasChanged: false,
                            DateModifiedHasChanged: true,
                            DatePasswordChangedHasChanged: true,
                            CustomFieldsHasChanged: false,
                        },
                    } as PartialCredential,
                },
            } as Diff);
        },
        100,
    );

    jest.it(
        "Apply diff - (Update - Password)",
        async () => {
            // Take the diffs from the vault and apply them to a new vault
            // Then check that the new vault has the same credentials as the original vault
            // NOTE: We don't apply the delete diff before checking the credentials, to make sure that everything is working properly

            const newVault = new Vault();

            // Make sure to generate hashes and diffs
            newVault.Configuration.InhibitDiffGeneration = false;
            newVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

            const diffs = vault.Diffs;

            jest.expect(diffs.length).toBe(4);

            // Apply the diffs
            await newVault.applyDiffs(diffs);

            // Check that the credentials are in the vault
            jest.expect(newVault.Credentials.length).toBe(1);
            if (newVault.Credentials[0] == null || vault.Credentials[0] == null)
                throw new Error(
                    "Credential was not created properly. Tests should have failed before this.",
                );

            // Compare the hashes of the vaults
            jest.expect(await newVault.getLatestHash()).toBe(
                await vault.getLatestHash(),
            );

            const expectedTOTP = new Credential.TOTP();
            expectedTOTP.Label = "Bla";
            expectedTOTP.Algorithm = TOTPAlgorithm.SHA1;
            expectedTOTP.Digits = 6;
            expectedTOTP.Period = 30;
            expectedTOTP.Secret = "ASKJHDSKJHDKJ";

            // Check that the credentials have the expected values
            jest.expect(
                Object.assign({}, newVault.Credentials[0]),
            ).toStrictEqual({
                ID: vault.Credentials[0].ID,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: "Updated credential",
                Username: "Updated Username",
                Password: "Updated Password",
                TOTP: expectedTOTP,
                Tags: "",
                URL: "",
                Notes: "",
                DateCreated: vault.Credentials[0].DateCreated,
                DateModified: vault.Credentials[0].DateModified,
                DatePasswordChanged: vault.Credentials[0].DatePasswordChanged,
                CustomFields: [],
                Hash: vault.Credentials[0].Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - URL",
        async () => {
            if (vault.Credentials[0] == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // Wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredentialRaw;
            updatedCredentialForm.URL = "Updated URL";

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // The diff should be present, since we've just updated a credential
            jest.expect(vault.Diffs.length).toBe(5);

            const updatedCredentialDiffRaw = Object.assign({}, vault.Diffs[4]);

            jest.expect(updatedCredentialDiffRaw).not.toBeNull();

            jest.expect(updatedCredentialDiffRaw.Changes).not.toBeNull();
            if (!updatedCredentialDiffRaw.Changes)
                throw new Error(
                    "Diff was not created properly. Tests should have failed before this.",
                );

            // The ID should be present - whatever the value
            jest.expect(updatedCredentialDiffRaw.Changes.ID).toEqual(
                updatedCredential.ID,
            );

            updatedCredentialDiffRaw.Changes.Props = Object.assign(
                {},
                updatedCredentialDiffRaw.Changes.Props,
            );

            jest.expect(updatedCredentialDiffRaw).toStrictEqual({
                Hash: updatedCredentialDiffRaw.Hash,
                Changes: {
                    ID: updatedCredential.ID, // This ID property value is actually the value of the credential ID
                    Type: DiffType.Update,
                    Props: {
                        URL: "Updated URL",
                        CustomFields: [], // This is always present, even if it's empty
                        DateModified: updatedCredential.DateModified,
                        ChangeFlags: {
                            TypeHasChanged: false,
                            GroupIDHasChanged: false,
                            NameHasChanged: false,
                            UsernameHasChanged: false,
                            PasswordHasChanged: false,
                            TOTPHasChanged: false,
                            TagsHasChanged: false,
                            URLHasChanged: true,
                            NotesHasChanged: false,
                            DateCreatedHasChanged: false,
                            DateModifiedHasChanged: true,
                            DatePasswordChangedHasChanged: false,
                            CustomFieldsHasChanged: false,
                        },
                    } as PartialCredential,
                },
            } as Diff);
        },
        100,
    );

    jest.it(
        "Apply diff - (Update - URL)",
        async () => {
            // Take the diffs from the vault and apply them to a new vault
            // Then check that the new vault has the same credentials as the original vault
            // NOTE: We don't apply the delete diff before checking the credentials, to make sure that everything is working properly

            const newVault = new Vault();

            // Make sure to generate hashes and diffs
            newVault.Configuration.InhibitDiffGeneration = false;
            newVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

            const diffs = vault.Diffs;

            jest.expect(diffs.length).toBe(5);

            // Apply the diffs
            await newVault.applyDiffs(diffs);

            // Check that the credentials are in the vault
            jest.expect(newVault.Credentials.length).toBe(1);
            if (newVault.Credentials[0] == null || vault.Credentials[0] == null)
                throw new Error(
                    "Credential was not created properly. Tests should have failed before this.",
                );

            // Compare the hashes of the vaults
            jest.expect(await newVault.getLatestHash()).toBe(
                await vault.getLatestHash(),
            );

            const expectedTOTP = new Credential.TOTP();
            expectedTOTP.Label = "Bla";
            expectedTOTP.Algorithm = TOTPAlgorithm.SHA1;
            expectedTOTP.Digits = 6;
            expectedTOTP.Period = 30;
            expectedTOTP.Secret = "ASKJHDSKJHDKJ";

            // Check that the credentials have the expected values
            jest.expect(
                Object.assign({}, newVault.Credentials[0]),
            ).toStrictEqual({
                ID: vault.Credentials[0].ID,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: "Updated credential",
                Username: "Updated Username",
                Password: "Updated Password",
                TOTP: expectedTOTP,
                Tags: "",
                URL: "Updated URL",
                Notes: "",
                DateCreated: vault.Credentials[0].DateCreated,
                DateModified: vault.Credentials[0].DateModified,
                DatePasswordChanged: vault.Credentials[0].DatePasswordChanged,
                CustomFields: [],
                Hash: vault.Credentials[0].Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - Notes",
        async () => {
            if (vault.Credentials[0] == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // Wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredentialRaw;
            updatedCredentialForm.Notes = "Updated Notes";

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // The diff should be present, since we've just updated a credential
            jest.expect(vault.Diffs.length).toBe(6);

            const updatedCredentialDiffRaw = Object.assign({}, vault.Diffs[5]);

            jest.expect(updatedCredentialDiffRaw).not.toBeNull();

            jest.expect(updatedCredentialDiffRaw.Changes).not.toBeNull();
            if (!updatedCredentialDiffRaw.Changes)
                throw new Error(
                    "Diff was not created properly. Tests should have failed before this.",
                );

            // The ID should be present - whatever the value
            jest.expect(updatedCredentialDiffRaw.Changes.ID).toEqual(
                updatedCredential.ID,
            );

            updatedCredentialDiffRaw.Changes.Props = Object.assign(
                {},
                updatedCredentialDiffRaw.Changes.Props,
            );

            jest.expect(updatedCredentialDiffRaw).toStrictEqual({
                Hash: updatedCredentialDiffRaw.Hash,
                Changes: {
                    ID: updatedCredential.ID, // This ID property value is actually the value of the credential ID
                    Type: DiffType.Update,
                    Props: {
                        Notes: "Updated Notes",
                        CustomFields: [], // This is always present, even if it's empty
                        DateModified: updatedCredential.DateModified,
                        ChangeFlags: {
                            TypeHasChanged: false,
                            GroupIDHasChanged: false,
                            NameHasChanged: false,
                            UsernameHasChanged: false,
                            PasswordHasChanged: false,
                            TOTPHasChanged: false,
                            TagsHasChanged: false,
                            URLHasChanged: false,
                            NotesHasChanged: true,
                            DateCreatedHasChanged: false,
                            DateModifiedHasChanged: true,
                            DatePasswordChangedHasChanged: false,
                            CustomFieldsHasChanged: false,
                        },
                    } as PartialCredential,
                },
            } as Diff);
        },
        100,
    );

    jest.it(
        "Apply diff - (Update - Notes)",
        async () => {
            // Take the diffs from the vault and apply them to a new vault
            // Then check that the new vault has the same credentials as the original vault
            // NOTE: We don't apply the delete diff before checking the credentials, to make sure that everything is working properly

            const newVault = new Vault();

            // Make sure to generate hashes and diffs
            newVault.Configuration.InhibitDiffGeneration = false;
            newVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

            const diffs = vault.Diffs;

            jest.expect(diffs.length).toBe(6);

            // Apply the diffs
            await newVault.applyDiffs(diffs);

            // Check that the credentials are in the vault
            jest.expect(newVault.Credentials.length).toBe(1);
            if (newVault.Credentials[0] == null || vault.Credentials[0] == null)
                throw new Error(
                    "Credential was not created properly. Tests should have failed before this.",
                );

            // Compare the hashes of the vaults
            jest.expect(await newVault.getLatestHash()).toBe(
                await vault.getLatestHash(),
            );

            const expectedTOTP = new Credential.TOTP();
            expectedTOTP.Label = "Bla";
            expectedTOTP.Algorithm = TOTPAlgorithm.SHA1;
            expectedTOTP.Digits = 6;
            expectedTOTP.Period = 30;
            expectedTOTP.Secret = "ASKJHDSKJHDKJ";

            // Check that the credentials have the expected values
            jest.expect(
                Object.assign({}, newVault.Credentials[0]),
            ).toStrictEqual({
                ID: vault.Credentials[0].ID,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: "Updated credential",
                Username: "Updated Username",
                Password: "Updated Password",
                TOTP: expectedTOTP,
                Tags: "",
                URL: "Updated URL",
                Notes: "Updated Notes",
                DateCreated: vault.Credentials[0].DateCreated,
                DateModified: vault.Credentials[0].DateModified,
                DatePasswordChanged: vault.Credentials[0].DatePasswordChanged,
                CustomFields: [],
                Hash: vault.Credentials[0].Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - Tags",
        async () => {
            if (vault.Credentials[0] == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // Wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredentialRaw;
            updatedCredentialForm.Tags = ["Tag1", "Tag2", "Tag3"].join(
                Credential.TAG_SEPARATOR,
            );

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // The diff should be present, since we've just updated a credential
            jest.expect(vault.Diffs.length).toBe(7);

            const updatedCredentialDiffRaw = Object.assign({}, vault.Diffs[6]);

            jest.expect(updatedCredentialDiffRaw).not.toBeNull();

            jest.expect(updatedCredentialDiffRaw.Changes).not.toBeNull();
            if (!updatedCredentialDiffRaw.Changes)
                throw new Error(
                    "Diff was not created properly. Tests should have failed before this.",
                );

            // The ID should be present - whatever the value
            jest.expect(updatedCredentialDiffRaw.Changes.ID).toEqual(
                updatedCredential.ID,
            );

            updatedCredentialDiffRaw.Changes.Props = Object.assign(
                {},
                updatedCredentialDiffRaw.Changes.Props,
            );

            jest.expect(updatedCredentialDiffRaw).toStrictEqual({
                Hash: updatedCredentialDiffRaw.Hash,
                Changes: {
                    ID: updatedCredential.ID, // This ID property value is actually the value of the credential ID
                    Type: DiffType.Update,
                    Props: {
                        Tags: ["Tag1", "Tag2", "Tag3"].join(
                            Credential.TAG_SEPARATOR,
                        ),
                        CustomFields: [], // This is always present, even if it's empty
                        DateModified: updatedCredential.DateModified,
                        ChangeFlags: {
                            TypeHasChanged: false,
                            GroupIDHasChanged: false,
                            NameHasChanged: false,
                            UsernameHasChanged: false,
                            PasswordHasChanged: false,
                            TOTPHasChanged: false,
                            TagsHasChanged: true,
                            URLHasChanged: false,
                            NotesHasChanged: false,
                            DateCreatedHasChanged: false,
                            DateModifiedHasChanged: true,
                            DatePasswordChangedHasChanged: false,
                            CustomFieldsHasChanged: false,
                        },
                    } as PartialCredential,
                },
            } as Diff);
        },
        100,
    );

    jest.it(
        "Apply diff - (Update - Tags)",
        async () => {
            // Take the diffs from the vault and apply them to a new vault
            // Then check that the new vault has the same credentials as the original vault
            // NOTE: We don't apply the delete diff before checking the credentials, to make sure that everything is working properly

            const newVault = new Vault();

            // Make sure to generate hashes and diffs
            newVault.Configuration.InhibitDiffGeneration = false;
            newVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

            const diffs = vault.Diffs;

            jest.expect(diffs.length).toBe(7);

            // Apply the diffs
            await newVault.applyDiffs(diffs);

            // Check that the credentials are in the vault
            jest.expect(newVault.Credentials.length).toBe(1);
            if (newVault.Credentials[0] == null || vault.Credentials[0] == null)
                throw new Error(
                    "Credential was not created properly. Tests should have failed before this.",
                );

            // Compare the hashes of the vaults
            jest.expect(await newVault.getLatestHash()).toBe(
                await vault.getLatestHash(),
            );

            const expectedTOTP = new Credential.TOTP();
            expectedTOTP.Label = "Bla";
            expectedTOTP.Algorithm = TOTPAlgorithm.SHA1;
            expectedTOTP.Digits = 6;
            expectedTOTP.Period = 30;
            expectedTOTP.Secret = "ASKJHDSKJHDKJ";

            // Check that the credentials have the expected values
            jest.expect(
                Object.assign({}, newVault.Credentials[0]),
            ).toStrictEqual({
                ID: vault.Credentials[0].ID,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: "Updated credential",
                Username: "Updated Username",
                Password: "Updated Password",
                TOTP: expectedTOTP,
                Tags: ["Tag1", "Tag2", "Tag3"].join(Credential.TAG_SEPARATOR),
                URL: "Updated URL",
                Notes: "Updated Notes",
                DateCreated: vault.Credentials[0].DateCreated,
                DateModified: vault.Credentials[0].DateModified,
                DatePasswordChanged: vault.Credentials[0].DatePasswordChanged,
                CustomFields: [],
                Hash: vault.Credentials[0].Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - TOTP Create",
        async () => {
            if (vault.Credentials[0] == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // Wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredentialRaw;
            updatedCredentialForm.TOTP = {
                Algorithm: TOTPAlgorithm.SHA1,
                Label: "TOTP Label",
                Digits: 6,
                Period: 30,
                Secret: "TOTP Secret",
            };

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // The diff should be present, since we've just updated a credential
            jest.expect(vault.Diffs.length).toBe(8);

            const updatedCredentialDiffRaw = Object.assign({}, vault.Diffs[7]);

            jest.expect(updatedCredentialDiffRaw).not.toBeNull();

            jest.expect(updatedCredentialDiffRaw.Changes).not.toBeNull();
            if (!updatedCredentialDiffRaw.Changes)
                throw new Error(
                    "Diff was not created properly. Tests should have failed before this.",
                );

            // The ID should be present - whatever the value
            jest.expect(updatedCredentialDiffRaw.Changes.ID).toEqual(
                updatedCredential.ID,
            );

            updatedCredentialDiffRaw.Changes.Props = Object.assign(
                {},
                updatedCredentialDiffRaw.Changes.Props,
            );

            jest.expect(updatedCredentialDiffRaw).toStrictEqual({
                Hash: updatedCredentialDiffRaw.Hash,
                Changes: {
                    ID: updatedCredential.ID, // This ID property value is actually the value of the credential ID
                    Type: DiffType.Update,
                    Props: {
                        TOTP: {
                            Algorithm: TOTPAlgorithm.SHA1,
                            Label: "TOTP Label",
                            Digits: 6,
                            Period: 30,
                            Secret: "TOTP Secret",
                        },
                        CustomFields: [], // This is always present, even if it's empty
                        DateModified: updatedCredential.DateModified,
                        ChangeFlags: {
                            TypeHasChanged: false,
                            GroupIDHasChanged: false,
                            NameHasChanged: false,
                            UsernameHasChanged: false,
                            PasswordHasChanged: false,
                            TOTPHasChanged: true,
                            TagsHasChanged: false,
                            URLHasChanged: false,
                            NotesHasChanged: false,
                            DateCreatedHasChanged: false,
                            DateModifiedHasChanged: true,
                            DatePasswordChangedHasChanged: false,
                            CustomFieldsHasChanged: false,
                        },
                    } as PartialCredential,
                },
            } as Diff);
        },
        100,
    );

    jest.it(
        "Apply diff - (Update - TOTP Create)",
        async () => {
            // Take the diffs from the vault and apply them to a new vault
            // Then check that the new vault has the same credentials as the original vault
            // NOTE: We don't apply the delete diff before checking the credentials, to make sure that everything is working properly

            const newVault = new Vault();

            // Make sure to generate hashes and diffs
            newVault.Configuration.InhibitDiffGeneration = false;
            newVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

            const diffs = vault.Diffs;

            jest.expect(diffs.length).toBe(8);

            // Apply the diffs
            await newVault.applyDiffs(diffs);

            // Check that the credentials are in the vault
            jest.expect(newVault.Credentials.length).toBe(1);
            if (newVault.Credentials[0] == null || vault.Credentials[0] == null)
                throw new Error(
                    "Credential was not created properly. Tests should have failed before this.",
                );

            // Compare the hashes of the vaults
            jest.expect(await newVault.getLatestHash()).toBe(
                await vault.getLatestHash(),
            );

            const expectedTOTP = new Credential.TOTP();
            expectedTOTP.Algorithm = TOTPAlgorithm.SHA1;
            expectedTOTP.Label = "TOTP Label";
            expectedTOTP.Digits = 6;
            expectedTOTP.Period = 30;
            expectedTOTP.Secret = "TOTP Secret";

            // Check that the credentials have the expected values
            jest.expect(
                Object.assign({}, newVault.Credentials[0]),
            ).toStrictEqual({
                ID: vault.Credentials[0].ID,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: "Updated credential",
                Username: "Updated Username",
                Password: "Updated Password",
                TOTP: expectedTOTP,
                Tags: ["Tag1", "Tag2", "Tag3"].join(Credential.TAG_SEPARATOR),
                URL: "Updated URL",
                Notes: "Updated Notes",
                DateCreated: vault.Credentials[0].DateCreated,
                DateModified: vault.Credentials[0].DateModified,
                DatePasswordChanged: vault.Credentials[0].DatePasswordChanged,
                CustomFields: [],
                Hash: vault.Credentials[0].Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - TOTP Update",
        async () => {
            if (vault.Credentials[0] == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // Wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredentialRaw;
            updatedCredentialForm.TOTP = {
                Algorithm: TOTPAlgorithm.SHA1,
                Label: "TOTP Label",
                Digits: 10,
                Period: 45,
                Secret: "TOTP_Secret_Changed",
            };

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // The diff should be present, since we've just updated a credential
            jest.expect(vault.Diffs.length).toBe(9);

            const updatedCredentialDiffRaw = Object.assign({}, vault.Diffs[8]);

            jest.expect(updatedCredentialDiffRaw).not.toBeNull();

            jest.expect(updatedCredentialDiffRaw.Changes).not.toBeNull();
            if (!updatedCredentialDiffRaw.Changes)
                throw new Error(
                    "Diff was not created properly. Tests should have failed before this.",
                );

            // The ID should be present - whatever the value
            jest.expect(updatedCredentialDiffRaw.Changes.ID).toEqual(
                updatedCredential.ID,
            );

            updatedCredentialDiffRaw.Changes.Props = Object.assign(
                {},
                updatedCredentialDiffRaw.Changes.Props,
            );

            jest.expect(updatedCredentialDiffRaw).toStrictEqual({
                Hash: updatedCredentialDiffRaw.Hash,
                Changes: {
                    ID: updatedCredential.ID, // This ID property value is actually the value of the credential ID
                    Type: DiffType.Update,
                    Props: {
                        TOTP: {
                            Algorithm: TOTPAlgorithm.SHA1,
                            Label: "TOTP Label",
                            Digits: 10,
                            Period: 45,
                            Secret: "TOTP_Secret_Changed",
                        },
                        CustomFields: [], // This is always present, even if it's empty
                        DateModified: updatedCredential.DateModified,
                        ChangeFlags: {
                            TypeHasChanged: false,
                            GroupIDHasChanged: false,
                            NameHasChanged: false,
                            UsernameHasChanged: false,
                            PasswordHasChanged: false,
                            TOTPHasChanged: true,
                            TagsHasChanged: false,
                            URLHasChanged: false,
                            NotesHasChanged: false,
                            DateCreatedHasChanged: false,
                            DateModifiedHasChanged: true,
                            DatePasswordChangedHasChanged: false,
                            CustomFieldsHasChanged: false,
                        },
                    } as PartialCredential,
                },
            } as Diff);
        },
        100,
    );

    jest.it(
        "Apply diff - (Update - TOTP Update)",
        async () => {
            // Take the diffs from the vault and apply them to a new vault
            // Then check that the new vault has the same credentials as the original vault
            // NOTE: We don't apply the delete diff before checking the credentials, to make sure that everything is working properly

            const newVault = new Vault();

            // Make sure to generate hashes and diffs
            newVault.Configuration.InhibitDiffGeneration = false;
            newVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

            const diffs = vault.Diffs;

            jest.expect(diffs.length).toBe(9);

            // Apply the diffs
            await newVault.applyDiffs(diffs);

            // Check that the credentials are in the vault
            jest.expect(newVault.Credentials.length).toBe(1);
            if (newVault.Credentials[0] == null || vault.Credentials[0] == null)
                throw new Error(
                    "Credential was not created properly. Tests should have failed before this.",
                );

            // Compare the hashes of the vaults
            jest.expect(await newVault.getLatestHash()).toBe(
                await vault.getLatestHash(),
            );

            const expectedTOTP = new Credential.TOTP();
            expectedTOTP.Algorithm = TOTPAlgorithm.SHA1;
            expectedTOTP.Label = "TOTP Label";
            expectedTOTP.Digits = 10;
            expectedTOTP.Period = 45;
            expectedTOTP.Secret = "TOTP_Secret_Changed";

            // Check that the credentials have the expected values
            jest.expect(
                Object.assign({}, newVault.Credentials[0]),
            ).toStrictEqual({
                ID: vault.Credentials[0].ID,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: "Updated credential",
                Username: "Updated Username",
                Password: "Updated Password",
                TOTP: expectedTOTP,
                Tags: ["Tag1", "Tag2", "Tag3"].join(Credential.TAG_SEPARATOR),
                URL: "Updated URL",
                Notes: "Updated Notes",
                DateCreated: vault.Credentials[0].DateCreated,
                DateModified: vault.Credentials[0].DateModified,
                DatePasswordChanged: vault.Credentials[0].DatePasswordChanged,
                CustomFields: [],
                Hash: vault.Credentials[0].Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Update - TOTP Delete",
        async () => {
            if (vault.Credentials[0] == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // Wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Update the credential
            const updatedCredentialForm: Credential.CredentialFormSchemaType =
                initialCredentialRaw;
            // updatedCredentialForm.TOTP = undefined;
            updatedCredentialForm.TOTP = null;

            const updatedCredential = await vault.updateCredential(
                updatedCredentialForm,
            );

            jest.expect(updatedCredential).not.toBeNull();

            if (!updatedCredential)
                throw new Error(
                    "Credential was not updated properly. Tests should have failed before this.",
                );

            // The diff should be present, since we've just updated a credential
            jest.expect(vault.Diffs.length).toBe(10);

            const updatedCredentialDiffRaw = Object.assign({}, vault.Diffs[9]);

            jest.expect(updatedCredentialDiffRaw).not.toBeNull();

            jest.expect(updatedCredentialDiffRaw.Changes).not.toBeNull();
            if (!updatedCredentialDiffRaw.Changes)
                throw new Error(
                    "Diff was not created properly. Tests should have failed before this.",
                );

            // The ID should be present - whatever the value
            jest.expect(updatedCredentialDiffRaw.Changes.ID).toEqual(
                updatedCredential.ID,
            );

            updatedCredentialDiffRaw.Changes.Props = Object.assign(
                {},
                updatedCredentialDiffRaw.Changes.Props,
            );

            jest.expect(updatedCredentialDiffRaw).toStrictEqual({
                Hash: updatedCredentialDiffRaw.Hash,
                Changes: {
                    ID: updatedCredential.ID, // This ID property value is actually the value of the credential ID
                    Type: DiffType.Update,
                    Props: {
                        TOTP: undefined,
                        CustomFields: [], // This is always present, even if it's empty
                        DateModified: updatedCredential.DateModified,
                        ChangeFlags: {
                            TypeHasChanged: false,
                            GroupIDHasChanged: false,
                            NameHasChanged: false,
                            UsernameHasChanged: false,
                            PasswordHasChanged: false,
                            TOTPHasChanged: true,
                            TagsHasChanged: false,
                            URLHasChanged: false,
                            NotesHasChanged: false,
                            DateCreatedHasChanged: false,
                            DateModifiedHasChanged: true,
                            DatePasswordChangedHasChanged: false,
                            CustomFieldsHasChanged: false,
                        },
                    } as PartialCredential,
                },
            } as Diff);
        },
        100,
    );

    jest.it(
        "Apply diff - (Update - TOTP Delete)",
        async () => {
            // Take the diffs from the vault and apply them to a new vault
            // Then check that the new vault has the same credentials as the original vault
            // NOTE: We don't apply the delete diff before checking the credentials, to make sure that everything is working properly

            const newVault = new Vault();

            // Make sure to generate hashes and diffs
            newVault.Configuration.InhibitDiffGeneration = false;
            newVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

            const diffs = vault.Diffs;

            jest.expect(diffs.length).toBe(10);

            // Apply the diffs
            await newVault.applyDiffs(diffs);

            // Check that the credentials are in the vault
            jest.expect(newVault.Credentials.length).toBe(1);
            if (newVault.Credentials[0] == null || vault.Credentials[0] == null)
                throw new Error(
                    "Credential was not created properly. Tests should have failed before this.",
                );

            // Compare the hashes of the vaults
            jest.expect(await newVault.getLatestHash()).toBe(
                await vault.getLatestHash(),
            );

            // Check that the credentials have the expected values
            jest.expect(
                Object.assign({}, newVault.Credentials[0]),
            ).toStrictEqual({
                ID: vault.Credentials[0].ID,
                Type: ItemType.Credentials,
                GroupID: "",
                Name: "Updated credential",
                Username: "Updated Username",
                Password: "Updated Password",
                TOTP: undefined,
                Tags: ["Tag1", "Tag2", "Tag3"].join(Credential.TAG_SEPARATOR),
                URL: "Updated URL",
                Notes: "Updated Notes",
                DateCreated: vault.Credentials[0].DateCreated,
                DateModified: vault.Credentials[0].DateModified,
                DatePasswordChanged: vault.Credentials[0].DatePasswordChanged,
                CustomFields: [],
                Hash: vault.Credentials[0].Hash,
            } as Credential.CredentialFormSchemaType);
        },
        100,
    );

    jest.it(
        "Get diffs since hash - null hash - (should return all credentials as Add diffs)",
        async () => {
            const diffs = await vault.getDiffsSinceHash(null);

            // Expect a single diff (credential which has been created as an "Add" diff)
            jest.expect(diffs.length).toBe(1);

            // All diffs should be of type "Add"
            for (const diff of diffs) {
                jest.expect(diff.Changes?.Type).toBe(DiffType.Add);
            }
        },
        100,
    );

    jest.it(
        "Delete credential",
        async () => {
            if (vault.Credentials[0] == null)
                throw new Error(
                    "No credential to update. Tests should have failed before this.",
                );

            const initialCredentialRaw = Object.assign(
                {},
                vault.Credentials[0],
            );

            // Wait a bit to make sure the DateModified field is different
            await new Promise((resolve) =>
                setTimeout(resolve, timeBetweenTests),
            );

            // Delete the credential
            await vault.deleteCredential(initialCredentialRaw.ID);

            // The diff should be present, since we've just updated a credential
            jest.expect(vault.Diffs.length).toBe(11);

            const updatedCredentialDiffRaw = Object.assign({}, vault.Diffs[10]);

            jest.expect(updatedCredentialDiffRaw).not.toBeNull();

            jest.expect(updatedCredentialDiffRaw.Changes).not.toBeNull();
            if (!updatedCredentialDiffRaw.Changes)
                throw new Error(
                    "Diff was not created properly. Tests should have failed before this.",
                );

            // The ID should be present - whatever the value
            jest.expect(updatedCredentialDiffRaw.Changes.ID).toEqual(
                initialCredentialRaw.ID,
            );

            updatedCredentialDiffRaw.Changes.Props = Object.assign(
                {},
                updatedCredentialDiffRaw.Changes.Props,
            );

            jest.expect(updatedCredentialDiffRaw).toStrictEqual({
                Hash: updatedCredentialDiffRaw.Hash,
                Changes: {
                    ID: initialCredentialRaw.ID, // This ID property value is actually the value of the credential ID
                    Type: DiffType.Delete,
                    Props: {} as PartialCredential,
                },
            } as Diff);
        },
        100,
    );

    jest.it(
        "Apply diff - (Delete)",
        async () => {
            // Take the diffs from the vault and apply them to a new vault
            // Then check that the new vault has the same credentials as the original vault
            // NOTE: We don't apply the delete diff before checking the credentials, to make sure that everything is working properly

            const newVault = new Vault();

            // Make sure to generate hashes and diffs
            newVault.Configuration.InhibitDiffGeneration = false;
            newVault.Configuration.SaveOnlyLatestDiffWhenNoLinked = false;

            const diffs = vault.Diffs;

            jest.expect(diffs.length).toBe(11);

            // Apply the diffs
            await newVault.applyDiffs(diffs);

            // Compare the hashes of the vaults
            jest.expect(await newVault.getLatestHash()).toBe(
                await vault.getLatestHash(),
            );

            // Check that the credentials are in the vault
            jest.expect(newVault.Credentials.length).toBe(0);
        },
        100,
    );

    jest.it(
        "Get all hashes",
        async () => {
            const hashes = vault.getAllHashes();

            jest.expect(hashes.length).toBe(11);

            for (const hash of hashes) {
                jest.expect(hash).not.toBeNull();
                jest.expect(hash).not.toBeUndefined();
                jest.expect(hash).not.toBe("");
            }

            // Check that the hashes are in reverse order - compare agains the vault.Diffs array
            const diffs = vault.Diffs;

            jest.expect(diffs.length).toBe(11);

            // The first diff is actually the oldest change
            // Iterating through the diffs we're comparing the hash of each to the hash in the hashes array (in reverse order)
            for (let i = 0; i < diffs.length; i++) {
                const diff = diffs[i];

                jest.expect(diff).not.toBeNull();
                jest.expect(diff).not.toBeUndefined();

                if (diff == null) continue;

                jest.expect(diff.Hash).toBe(hashes[10 - i]);
            }
        },
        100,
    );

    jest.it(
        "Get diffs since hash - valid hash",
        async () => {
            // This returns all of the hashes in the vault - in reverse order
            const hashes = vault.getAllHashes();

            jest.expect(hashes.length).toBe(11);

            // Iterate over the hashes from latest to oldest
            for (let i = 0; i < hashes.length; i++) {
                const hash = hashes[i];

                jest.expect(hash).not.toBeNull();

                if (hash == null) continue;

                // NOTE: Since the first hash is the latest, we expect to get 0 diffs for that hash
                // This increases by 1 for each hash, until we get 10 diffs for the oldest hash
                const diffs = await vault.getDiffsSinceHash(hash);

                jest.expect(diffs.length).toBe(i);
            }
        },
        100,
    );

    jest.it(
        "Get diffs since hash - invalid hash",
        async () => {
            const diffs = await vault.getDiffsSinceHash("invalid hash");

            jest.expect(diffs.length).toBe(0);
        },
        100,
    );

    jest.it(
        "Get diffs since hash - null hash - (should not return any diffs)",
        async () => {
            const diffs = await vault.getDiffsSinceHash(null);

            // Expect a single diff (credential which has been created as an "Add" diff)
            jest.expect(diffs.length).toBe(0);
        },
        100,
    );

    jest.it(
        "Clear diff list",
        async () => {
            // Clear the diff list
            vault.purgeDiffList();

            // Only the latest diff should be present
            // This is to ensure smooth operation of new device synchronization (not required, but recommended)
            jest.expect(vault.Diffs.length).toBe(1);
        },
        100,
    );

    jest.it("Empty vault with credentials", async () => {
        // Instantiate a vault and inhibit diff generation
        const vault = new Vault();

        // Ease the computation by disabling the diff generation (which then skipps the hashing)
        vault.Configuration.InhibitDiffGeneration = true;
        vault.Configuration.SaveOnlyLatestDiffWhenNoLinked = true;

        // Create a credential
        const credential = new Credential.VaultCredential();
        credential.Name = "Credential";
        credential.Username = "Username";
        credential.Password = "Password";
        credential.URL = "URL";
        credential.Notes = "Notes";
        credential.Tags = ["Tag1", "Tag2", "Tag3"].join(
            Credential.TAG_SEPARATOR,
        );
        credential.TOTP = undefined;
        credential.CustomFields = [];

        // When the vault is empty, we expect a certain hash
        jest.expect(await vault.getLatestHash()).toEqual(
            "da39a3ee5e6b4b0d3255bfef95601890afd80709",
        );

        // await vault.createCredential(credential);
        vault.Credentials.push(credential);

        // Check that the credentials are in the vault
        jest.expect(vault.Credentials.length).toBe(1);

        // Check that the credentials are in the vault
        jest.expect(vault.Diffs.length).toBe(0);

        // Check that the hash is not empty
        const latestHash = await vault.getLatestHash();
        jest.expect(latestHash).not.toBeNull();
        jest.expect(latestHash).not.toEqual(
            "da39a3ee5e6b4b0d3255bfef95601890afd80709",
        );

        // Try to get diffs since hash
        const diffs = await vault.getDiffsSinceHash(latestHash);

        // Since we manually added a credential, we expect no diffs
        jest.expect(diffs.length).toBe(0);
    });
});

/**
 * This test is used to test the synchronization functionality.
 * At the moment, we only test the functions/methods, not the actual synchronization logic.
 */
jest.describe("Synchronization", () => {
    // TODO: Test the Synchronization namespace
});

/**
 * This test is used to test the data import functionality of the vault.
 */
jest.describe("Import", () => {
    jest.it(
        "Import from CSV",
        async () => {
            // Instantiate a vault and inhibit diff generation
            const vault = new Vault();

            // Ease the computation by disabling the diff generation (which then skipps the hashing)
            vault.Configuration.InhibitDiffGeneration = true;
            vault.Configuration.SaveOnlyLatestDiffWhenNoLinked = true;

            // Import a CSV
            const csv = `Title,User,Passwd,Web,Comment,Tag
        Credential 1,Username 1,Password 1,URL 1,Notes 1,"Tag1,Tag2"
        Credential 2,Username 2,Password 2,URL 2,Notes 2,"Tag1,Tag3"
        Credential 3,Username 3,Password 3,URL 3,Notes 3,"Tag2,Tag3"`;

            const fakeCSVFile = new File([csv], "fake.csv", {
                type: "text/csv",
            });

            const onSuccess = () => {
                // Check that the credentials are in the vault
                jest.expect(vault.Credentials.length).toBe(3);

                // Check that the credentials have the expected values
                jest.expect(
                    Object.assign({}, vault.Credentials[0]),
                ).toStrictEqual({
                    ID: vault.Credentials[0]?.ID ?? "",
                    Type: ItemType.Credentials,
                    GroupID: "",
                    Name: "Credential 1",
                    Username: "Username 1",
                    Password: "Password 1",
                    URL: "URL 1",
                    Notes: "Notes 1",
                    Tags: ["Tag1", "Tag2"].join(Credential.TAG_SEPARATOR),
                    TOTP: undefined,
                    CustomFields: [],
                    DateCreated: vault.Credentials[0]?.DateCreated ?? undefined,
                    DateModified: undefined,
                    DatePasswordChanged: undefined,
                } as Credential.CredentialFormSchemaType);

                jest.expect(
                    Object.assign({}, vault.Credentials[1]),
                ).toStrictEqual({
                    ID: vault.Credentials[1]?.ID ?? "",
                    Type: ItemType.Credentials,
                    GroupID: "",
                    Name: "Credential 2",
                    Username: "Username 2",
                    Password: "Password 2",
                    URL: "URL 2",
                    Notes: "Notes 2",
                    Tags: ["Tag1", "Tag3"].join(Credential.TAG_SEPARATOR),
                    TOTP: undefined,
                    CustomFields: [],
                    DateCreated: vault.Credentials[1]?.DateCreated ?? undefined,
                    DateModified: undefined,
                    DatePasswordChanged: undefined,
                } as Credential.CredentialFormSchemaType);

                jest.expect(
                    Object.assign({}, vault.Credentials[2]),
                ).toStrictEqual({
                    ID: vault.Credentials[2]?.ID ?? "",
                    Type: ItemType.Credentials,
                    GroupID: "",
                    Name: "Credential 3",
                    Username: "Username 3",
                    Password: "Password 3",
                    URL: "URL 3",
                    Notes: "Notes 3",
                    Tags: ["Tag2", "Tag3"].join(Credential.TAG_SEPARATOR),
                    TOTP: undefined,
                    CustomFields: [],
                    DateCreated: vault.Credentials[2]?.DateCreated ?? undefined,
                    DateModified: undefined,
                    DatePasswordChanged: undefined,
                } as Credential.CredentialFormSchemaType);
            };

            await Import.CSV(
                fakeCSVFile,
                {
                    Name: "Title",
                    Username: "User",
                    Password: "Passwd",
                    URL: "Web",
                    Notes: "Comment",
                    Tags: "Tag",
                    TagDelimiter: ",",
                    DateCreated: null,
                    DateModified: null,
                    DatePasswordChanged: null,
                    TOTP: null,
                },
                async (creds) => {
                    for (const cred of creds) {
                        await vault.createCredential(cred);
                    }

                    onSuccess();
                },
                (err) => {
                    throw err;
                },
            );
        },
        100,
    );

    jest.it(
        "Import from Bitwarden JSON",
        async () => {
            // Instantiate a vault and inhibit diff generation
            const vault = new Vault();

            // Ease the computation by disabling the diff generation (which then skipps the hashing)
            vault.Configuration.InhibitDiffGeneration = true;
            vault.Configuration.SaveOnlyLatestDiffWhenNoLinked = true;

            const json = `{
                "folders": [
                    {
                        "id": "00000000-0000-0000-0000-000000000000",
                        "name": "Folder 1",
                        "revisionDate": "2021-01-01T00:00:00.000Z"
                    },
                    {
                        "id": "00000000-0000-0000-0000-000000000001",
                        "name": "Folder 2",
                        "revisionDate": "2021-01-01T00:00:00.000Z"
                    },
                    {
                        "id": "00000000-0000-0000-0000-000000000002",
                        "name": "Folder 3",
                        "revisionDate": "2021-01-01T00:00:00.000Z"
                    }
                ],
                "items": [
                    {
                        "id": "00000000-0000-0000-0000-000000000000",
                        "folderId": "00000000-0000-0000-0000-000000000000",
                        "organizationId": null,
                        "type": 1,
                        "name": "Credential 1",
                        "notes": "Notes 1",
                        "favorite": false,
                        "login": {
                            "uris": [
                                {
                                    "match": null,
                                    "uri": "URL 1"
                                }
                            ],
                            "username": "Username 1",
                            "password": "Password 1",
                            "totp": null
                        },
                        "collectionIds": [],
                        "revisionDate": "2021-01-01T00:00:00.100Z",
                        "attachments": [],
                        "organizationUseTotp": false
                    },
                    {
                        "id": "00000000-0000-0000-0000-000000000001",
                        "folderId": "00000000-0000-0000-0000-000000000001",
                        "organizationId": null,
                        "type": 1,
                        "name": "Credential 2",
                        "notes": "Notes 2",
                        "favorite": false,
                        "login": {
                            "uris": [
                                {
                                    "match": null,
                                    "uri": "URL 2"
                                }
                            ],
                            "username": "Username 2",
                            "password": "Password 2",
                            "totp": null
                        },
                        "collectionIds": [],
                        "revisionDate": "2021-01-01T00:00:00.020Z",
                        "attachments": [],
                        "organizationUseTotp": false
                    },
                    {
                        "id": "00000000-0000-0000-0000-000000000002",
                        "folderId": "00000000-0000-0000-0000-000000000002",
                        "organizationId": null,
                        "type": 1,
                        "name": "Credential 3",
                        "notes": "Notes 3",
                        "favorite": false,
                        "login": {
                            "uris": [
                                {
                                    "match": null,
                                    "uri": "URL 3"
                                }
                            ],
                            "username": "Username 3",
                            "password": "Password 3",
                            "totp": null
                        },
                        "collectionIds": [],
                        "revisionDate": "2021-01-01T00:00:00.003Z",
                        "attachments": [],
                        "organizationUseTotp": false
                    }
                ]
            }`;

            const fakeJSONFile = new File([json], "fake.json", {
                type: "application/json",
            });

            const { credentials, groups } =
                await Import.BitwardenJSON(fakeJSONFile);

            // Create the groups
            for (const group of groups) {
                vault.upsertGroup(group);
            }

            for (const cred of credentials) {
                await vault.createCredential(cred);
            }

            // Check that the credentials are in the vault
            jest.expect(vault.Credentials.length).toBe(3);

            if (
                vault.Credentials[0]?.ID == null ||
                vault.Credentials[1]?.ID == null ||
                vault.Credentials[2]?.ID == null
            ) {
                throw new Error("Credential IDs are null");
            }

            // Check that the credentials have the expected values
            jest.expect(Object.assign({}, vault.Credentials[0])).toStrictEqual({
                ID: vault.Credentials[0].ID,
                Type: ItemType.Credentials,
                GroupID: "00000000-0000-0000-0000-000000000000",
                Name: "Credential 1",
                Username: "Username 1",
                Password: "Password 1",
                URL: "URL 1",
                Notes: "Notes 1",
                Tags: "",
                TOTP: undefined,
                CustomFields: [],
                DateCreated: "2021-01-01T00:00:00.100Z",
                DateModified: undefined,
                DatePasswordChanged: undefined,
            } as Credential.CredentialFormSchemaType);

            jest.expect(Object.assign({}, vault.Credentials[1])).toStrictEqual({
                ID: vault.Credentials[1].ID,
                Type: ItemType.Credentials,
                GroupID: "00000000-0000-0000-0000-000000000001",
                Name: "Credential 2",
                Username: "Username 2",
                Password: "Password 2",
                URL: "URL 2",
                Notes: "Notes 2",
                Tags: "",
                TOTP: undefined,
                CustomFields: [],
                DateCreated: "2021-01-01T00:00:00.020Z",
                DateModified: undefined,
                DatePasswordChanged: undefined,
            } as Credential.CredentialFormSchemaType);

            jest.expect(Object.assign({}, vault.Credentials[2])).toStrictEqual({
                ID: vault.Credentials[2].ID,
                Type: ItemType.Credentials,
                GroupID: "00000000-0000-0000-0000-000000000002",
                Name: "Credential 3",
                Username: "Username 3",
                Password: "Password 3",
                URL: "URL 3",
                Notes: "Notes 3",
                Tags: "",
                TOTP: undefined,
                CustomFields: [],
                DateCreated: "2021-01-01T00:00:00.003Z",
                DateModified: undefined,
                DatePasswordChanged: undefined,
            } as Credential.CredentialFormSchemaType);

            // Check that the groups are in the vault
            jest.expect(vault.Groups.length).toBe(3);

            // Check that the groups have the expected values
            jest.expect(Object.assign({}, vault.Groups[0])).toStrictEqual({
                ID: "00000000-0000-0000-0000-000000000000",
                Name: "Folder 1",
                Color: "",
                Icon: "",
            } as Group);

            jest.expect(Object.assign({}, vault.Groups[1])).toStrictEqual({
                ID: "00000000-0000-0000-0000-000000000001",
                Name: "Folder 2",
                Color: "",
                Icon: "",
            } as Group);

            jest.expect(Object.assign({}, vault.Groups[2])).toStrictEqual({
                ID: "00000000-0000-0000-0000-000000000002",
                Name: "Folder 3",
                Color: "",
                Icon: "",
            } as Group);
        },
        100,
    );
});
