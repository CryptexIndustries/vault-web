import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
    CredentialURLMatchMode,
    ItemType,
} from "@cryptex-industries/vault-core/proto";
import {
    TOTP,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";

const mockEnrolled = new Set<number>();
const mockNative = {
    appGroup: "group.test.autofill",
    replaceVaultIdentities: jest.fn(async () => {}),
    clearVaultIdentities: jest.fn(async () => {}),
};
jest.mock("@/utils/ios-credentials", () => ({ iosCredentials: mockNative }));
jest.mock("@/lib/secure-dek", () => ({
    isSecureDekEnrolled: async (index: number) => mockEnrolled.has(index),
}));
jest.mock("@/utils/logging", () => ({ vaultLog: { warn: jest.fn() } }));
const mockStorage = new Map<string, string>();
jest.mock("@react-native-async-storage/async-storage", () => ({
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: async (key: string, value: string) =>
        void mockStorage.set(key, value),
}));

import {
    iosIdentityLogins,
    clearIosCredentialIdentities,
    retryIosCredentialIdentityClears,
    syncIosCredentialIdentities,
} from "@/utils/ios-credential-identities";

const login = (fields: Partial<VaultCredential>) =>
    Object.assign(new VaultCredential(), {
        ID: "login",
        Username: "alice",
        Password: "password-secret",
        ...fields,
    });

beforeEach(() => {
    mockEnrolled.clear();
    mockStorage.clear();
    jest.resetAllMocks();
});

const failOnce = () =>
    mockNative.clearVaultIdentities.mockImplementationOnce(async () => {
        throw new Error("store timed out");
    });

describe("iOS credential identities", () => {
    it("sends the module each login's fields, never its secrets", () => {
        expect(
            iosIdentityLogins([
                login({
                    ID: "a",
                    Name: "Example",
                    URL: "example.com",
                    URLMatchMode: CredentialURLMatchMode.Domain,
                    AdditionalURLs: [
                        {
                            URL: "*.example.net",
                            MatchMode: CredentialURLMatchMode.Wildcard,
                        },
                    ],
                    TOTP: Object.assign(new TOTP(), { Secret: "totp-secret" }),
                }),
                login({ ID: "deleted", Deleted: true }),
                login({ ID: "ssh", Type: ItemType.SSHKey }),
                login({ ID: "empty", Username: "", Password: "" }),
            ]),
        ).toEqual([
            {
                id: "a",
                name: "Example",
                username: "alice",
                hasPassword: true,
                hasTotp: true,
                urls: [
                    { url: "example.com", matchMode: 1 },
                    { url: "*.example.net", matchMode: 2 },
                ],
            },
            {
                id: "empty",
                name: "Unnamed item",
                username: "",
                hasPassword: false,
                hasTotp: false,
                urls: [{ url: "", matchMode: 0 }],
            },
        ]);
    });

    it("replaces a Face ID vault's identities and clears the others'", async () => {
        mockEnrolled.add(2);
        const credentials = [login({ URL: "example.com" })];
        await syncIosCredentialIdentities(2, credentials);
        await syncIosCredentialIdentities(3, credentials);
        expect(mockNative.replaceVaultIdentities).toHaveBeenCalledWith(
            2,
            iosIdentityLogins(credentials),
        );
        expect(mockNative.clearVaultIdentities).toHaveBeenCalledWith(3);
        expect(mockNative.replaceVaultIdentities).toHaveBeenCalledTimes(1);
    });

    it("applies updates in call order and keeps going after a failure", async () => {
        mockEnrolled.add(5);
        const calls: string[] = [];
        mockNative.replaceVaultIdentities.mockImplementationOnce(async () => {
            calls.push("replace");
            throw new Error("store busy");
        });
        mockNative.clearVaultIdentities.mockImplementationOnce(async () => {
            calls.push("clear");
        });
        const sync = syncIosCredentialIdentities(5, [
            login({ URL: "example.com" }),
        ]);
        const clear = clearIosCredentialIdentities(5);
        await Promise.all([sync, clear]);
        expect(calls).toEqual(["replace", "clear"]);
    });

    it("retries a clear until iOS confirms it", async () => {
        failOnce();
        await clearIosCredentialIdentities(4);
        await retryIosCredentialIdentityClears();
        await retryIosCredentialIdentityClears();
        expect(mockNative.clearVaultIdentities.mock.calls).toEqual([[4], [4]]);
    });

    it("clears before it registers a vault turned back on for Face ID", async () => {
        const calls: string[] = [];
        mockNative.clearVaultIdentities.mockImplementation(async () => {
            calls.push("clear");
        });
        mockNative.replaceVaultIdentities.mockImplementation(async () => {
            calls.push("replace");
        });
        failOnce();
        await clearIosCredentialIdentities(6);
        mockEnrolled.add(6);
        await syncIosCredentialIdentities(6, [login({ URL: "example.com" })]);
        await retryIosCredentialIdentityClears();
        // The failed clear isn't in calls, only its retry.
        expect(calls).toEqual(["clear", "replace"]);
        expect(mockNative.clearVaultIdentities).toHaveBeenCalledTimes(2);
    });
});
