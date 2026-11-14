import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok } from "neverthrow";

import { base64ToUint8 } from "@cryptex-industries/vault-core/encoding";
import {
    CredentialURLMatchMode,
    CustomFieldType,
    TOTPAlgorithm,
} from "@cryptex-industries/vault-core/proto";
import {
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";

// Sealed by the extension's Swift (writesTheInboxFixture in
// targets/AutofillCoreTests/AutofillInboxTests.swift).
const fixture = JSON.parse(
    readFileSync(
        join(__dirname, "../targets/AutofillCoreTests/Fixtures/inbox.json"),
        "utf8",
    ),
) as {
    key: string;
    vaultIndex: number;
    entries: { id: string }[];
};

let mockDek: CryptoKey;
let mockVault: Vault;
let mockSaveFails = false;
let mockAfterSave: (() => void) | null = null;
jest.mock("@/utils/vault-session", () => ({
    captureVaultSession: () => ({ generation: 1, lockEpoch: 1 }),
    isVaultSessionCurrent: () => true,
    getVaultDEKFromSession: () => ok(mockDek),
}));
jest.mock("@/utils/vault-mutations", () => ({
    persistVaultMutation: async (
        _kind: string,
        mutate: (vault: Vault) => Promise<{ vault: Vault; result: unknown }>,
    ) => {
        const { vault, result } = await mutate(mockVault);
        if (mockSaveFails) return err("VAULT_SAVE_FAILED");
        mockVault = vault;
        mockAfterSave?.();
        return ok(result);
    },
}));
jest.mock("@/utils/logging", () => ({ vaultLog: { warn: jest.fn() } }));
// The test passes its own store.
jest.mock("react-native-mmkv", () => ({ MMKV: class {}, Mode: {} }));

import {
    clearIosAutofillInbox,
    type InboxStore,
    mergeIosAutofillInbox,
} from "@/utils/ios-autofill-inbox";

function inboxStore(): InboxStore & { keys(): string[] } {
    const entries = new Map(
        fixture.entries.map((entry) => [
            `entry:${entry.id}`,
            JSON.stringify(entry),
        ]),
    );
    return {
        getAllKeys: () => [...entries.keys()],
        getString: (key: string) => entries.get(key),
        delete: (key: string) => void entries.delete(key),
        keys: () => [...entries.keys()].sort(),
    };
}

const credential = (fields: Partial<VaultCredential>) =>
    Object.assign(new VaultCredential(), fields);

beforeEach(async () => {
    mockSaveFails = false;
    mockAfterSave = null;
    mockDek = await crypto.subtle.importKey(
        "raw",
        base64ToUint8(fixture.key) as Uint8Array<ArrayBuffer>,
        "AES-GCM",
        false,
        ["decrypt"],
    );
    mockVault = Object.assign(new Vault(), {
        Directories: [{ ID: "dir-1", Name: "Work", Deleted: false }],
        Credentials: [
            credential({
                ID: "existing",
                Name: "Bank",
                Username: "bob",
                Password: "old",
            }),
        ],
    });
});

describe("iOS AutoFill inbox merge", () => {
    it("adds new logins, updates and associations, then keeps only what failed or belongs elsewhere", async () => {
        const inbox = inboxStore();
        await expect(
            mergeIosAutofillInbox(fixture.vaultIndex, inbox),
        ).resolves.toEqual({
            added: 2,
            updated: 2,
            savedAsNew: 1,
            associated: 1,
            failed: 2,
        });
        expect(
            mockVault.Credentials.map(
                ({ ID, Name, Username, Password, URL }) => [
                    ID,
                    Name,
                    Username,
                    Password,
                    URL,
                ],
            ),
        ).toEqual([
            ["existing", "Bank", "bob", "new-password", ""],
            [
                "entry-new",
                "example.com",
                "alice",
                "changed",
                "https://example.com",
            ],
            // Its target is gone, so it is saved as a new login with its own ID.
            [
                "entry-missing-target",
                "example.com",
                "carol",
                "lost",
                "https://example.com",
            ],
            [
                "entry-full",
                "Example",
                "erin",
                "full-password",
                "https://example.com",
            ],
        ]);
        expect(
            mockVault.Credentials.find(({ ID }) => ID === "existing")
                ?.AdditionalURLs,
        ).toEqual([
            {
                URL: "https://bank.example.com",
                MatchMode: CredentialURLMatchMode.ExactHost,
            },
        ]);
        const full = mockVault.Credentials.find(
            ({ ID }) => ID === "entry-full",
        );
        expect(full).toMatchObject({
            URLMatchMode: CredentialURLMatchMode.Domain,
            AdditionalURLs: [
                {
                    URL: "https://login.example.org",
                    MatchMode: CredentialURLMatchMode.ExactHost,
                },
            ],
            DirectoryID: "dir-1",
            TOTP: {
                Label: "Example:erin",
                Secret: "JBSWY3DPEHPK3PXP",
                Period: 30,
                Digits: 6,
                Algorithm: TOTPAlgorithm.SHA256,
            },
            Tags: "work,|.|,personal",
            Notes: "A note",
            CustomFields: [
                {
                    ID: "field-1",
                    Name: "PIN",
                    Type: CustomFieldType.MaskedText,
                    Value: "1234",
                },
            ],
        });
        expect(inbox.keys()).toEqual([
            "entry:entry-invalid",
            "entry:entry-other-vault",
            "entry:entry-tampered",
        ]);
    });

    it("files a login under no directory when its directory was deleted", async () => {
        mockVault.Directories = [];
        await mergeIosAutofillInbox(fixture.vaultIndex, inboxStore());
        expect(
            mockVault.Credentials.find(({ ID }) => ID === "entry-full")
                ?.DirectoryID,
        ).toBe("");
    });

    it("adds nothing twice when entries survive a crash after saving", async () => {
        const inbox = { ...inboxStore(), delete: () => undefined };
        await mergeIosAutofillInbox(fixture.vaultIndex, inbox);
        const firstRun = mockVault.Credentials.map(({ ID, Version }) => [
            ID,
            Version,
        ]);
        await expect(
            mergeIosAutofillInbox(fixture.vaultIndex, inbox),
        ).resolves.toEqual({
            added: 0,
            updated: 0,
            savedAsNew: 0,
            associated: 0,
            failed: 2,
        });
        expect(
            mockVault.Credentials.map(({ ID, Version }) => [ID, Version]),
        ).toEqual(firstRun);
    });

    it("doesn't apply an update again when merges overlap", async () => {
        const inbox = inboxStore();
        // The user changes the password right after the first merge saves.
        mockAfterSave = () => {
            mockAfterSave = null;
            mockVault.Credentials = mockVault.Credentials.map((existing) =>
                existing.ID === "existing"
                    ? credential({ ...existing, Password: "edited" })
                    : existing,
            );
        };
        const [, second] = await Promise.all([
            mergeIosAutofillInbox(fixture.vaultIndex, inbox),
            mergeIosAutofillInbox(fixture.vaultIndex, inbox),
        ]);
        expect(second).toEqual({
            added: 0,
            updated: 0,
            savedAsNew: 0,
            associated: 0,
            failed: 2,
        });
        expect(
            mockVault.Credentials.find(({ ID }) => ID === "existing")?.Password,
        ).toBe("edited");
    });

    it("skips entries that left the inbox while it decrypted them", async () => {
        const inbox = inboxStore();
        const getString = inbox.getString;
        // Present while the merge lists and opens them, gone once it saves.
        let saving = false;
        inbox.getString = (key: string) =>
            saving ? undefined : getString(key);
        const persist = jest.requireMock("@/utils/vault-mutations") as {
            persistVaultMutation: (...args: unknown[]) => Promise<unknown>;
        };
        const original = persist.persistVaultMutation;
        persist.persistVaultMutation = (...args) => {
            saving = true;
            return original(...args);
        };
        try {
            await expect(
                mergeIosAutofillInbox(fixture.vaultIndex, inbox),
            ).resolves.toEqual({
                added: 0,
                updated: 0,
                savedAsNew: 0,
                associated: 0,
                failed: 2,
            });
        } finally {
            persist.persistVaultMutation = original;
        }
        expect(mockVault.Credentials).toHaveLength(1);
    });

    it("keeps every entry when the vault can't be saved", async () => {
        mockSaveFails = true;
        const inbox = inboxStore();
        await expect(
            mergeIosAutofillInbox(fixture.vaultIndex, inbox),
        ).rejects.toThrow("VAULT_SAVE_FAILED");
        expect(inbox.keys()).toHaveLength(fixture.entries.length);
        expect(mockVault.Credentials).toHaveLength(1);
    });

    it("clears only a deleted vault's entries", () => {
        const inbox = inboxStore();
        clearIosAutofillInbox(fixture.vaultIndex, inbox);
        expect(inbox.keys()).toEqual(["entry:entry-other-vault"]);
    });
});
