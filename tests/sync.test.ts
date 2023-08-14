import * as jest from "@jest/globals";

import crypto from "crypto";

import { Credential, Vault } from "../src/app_lib/vault_utils";

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
                                algorithm.toLowerCase().replace("-", "")
                            )
                            .update(data)
                            .digest()
                    )
                );
            },
        },
    },
});

// Make sure to silent console.time and console.timeEnd output
Object.defineProperty(window, "console", {
    value: {
        time: () => {},
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

jest.describe("Credential", () => {
    jest.it("Validating ordering consistency", async () => {
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

                // Make sure we generate a diff, even if we don't have a linked vault
                vault.Configuration.GenerateDiffWhenNoLinked = false;

                for (let i = 0; i < numberOfCredentials; i++) {
                    // console.log(`Generating credential ${i}`);
                    await vault.upsertCredential({
                        ID: null,
                        Name: `Credential ${i}`,
                        Username: `Username ${i}`,
                        Password: `Password ${i}`,
                        URL: `Url ${i}`,
                    });
                }

                // Check that there are n credentials
                jest.expect(vault.Credentials.length).toBe(numberOfCredentials);

                const sortedLists = [];

                // Sort 10 times
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
    });
});
