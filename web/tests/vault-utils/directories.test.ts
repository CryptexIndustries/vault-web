import * as Proto from "@cryptex-industries/vault-core/proto";
import { webcrypto } from "crypto";
import { TextDecoder, TextEncoder } from "util";
import { describe, expect, it } from "@jest/globals";
import {
    createCredential,
    createDirectory,
    deleteDirectory,
    hashCredential,
    moveCredentialsToDirectory,
    resolveDirectoryNameCollisions,
    shouldAcceptVersionedRecord,
    updateDirectory,
    Vault,
} from "@cryptex-industries/vault-core/vault-utils/vault";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
});
Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});
Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

const form = (name: string, directoryID = "") => ({
    ID: null,
    Type: Proto.ItemType.Credentials,
    DirectoryID: directoryID,
    Name: name,
    Username: "user",
    Password: "password",
    TOTP: null,
    Tags: "",
    URL: "https://example.com",
    URLMatchMode: Proto.CredentialURLMatchMode.ExactHost,
    AdditionalURLs: [],
    Notes: "",
    CustomFields: [],
});

describe("flat directories", () => {
    it("round-trips directories and assignments through protobuf", async () => {
        const vault = new Vault();
        const directory = await createDirectory(vault.Directories, {
            ID: null,
            Name: "Work",
        });
        vault.Credentials.push(
            await createCredential(form("Example", directory.ID)),
        );

        const decoded = Proto.Vault.decode(Proto.Vault.encode(vault).finish());
        expect(decoded.Directories).toEqual([directory]);
        expect(decoded.Credentials[0]?.DirectoryID).toBe(directory.ID);
    });

    it("upgrades legacy credentials into Root and recalculates hashes", async () => {
        const vault = new Vault();
        vault.Version = 3;
        vault.CurrentVersion = 3;
        const credential = await createCredential(form("Legacy", "old"));
        const previousHash = credential.Hash;
        vault.Credentials = [credential];

        await vault.upgrade();

        expect(vault.CurrentVersion).toBe(4);
        expect(vault.Directories).toEqual([]);
        expect(credential.DirectoryID).toBe("");
        expect(credential.Hash).not.toBe(previousHash);
        expect(credential.Hash).toBe(await hashCredential(credential));
    });

    it("validates names case-insensitively and updates versioned metadata", async () => {
        const vault = new Vault();
        const directory = await createDirectory(vault.Directories, {
            ID: null,
            Name: "  Work  ",
        });
        await expect(
            createDirectory(vault.Directories, {
                ID: null,
                Name: "work",
            }),
        ).rejects.toThrow("already exists");

        const oldHash = directory.Hash;
        await updateDirectory(vault.Directories, directory.ID, {
            Name: "Personal",
        });
        expect(directory.Version).toBe(1);
        expect(directory.Hash).not.toBe(oldHash);
    });

    it("returns user-facing directory name validation errors", async () => {
        await expect(
            createDirectory([], {
                ID: null,
                Name: "   ",
            }),
        ).rejects.toThrow("Directory name is required");
        await expect(
            createDirectory([], {
                ID: null,
                Name: "a".repeat(101),
            }),
        ).rejects.toThrow("Directory name cannot exceed 100 characters");
    });

    it("moves credentials and tombstones directory contents on delete", async () => {
        const vault = new Vault();
        const directory = await createDirectory(vault.Directories, {
            ID: null,
            Name: "Work",
        });
        const credential = await createCredential(form("Example"));
        vault.Credentials.push(credential);
        const initialHash = credential.Hash;

        await moveCredentialsToDirectory(
            vault.Credentials,
            [credential.ID],
            directory.ID,
            vault.Directories,
        );
        expect(credential.DirectoryID).toBe(directory.ID);
        expect(credential.Version).toBe(1);
        expect(credential.Hash).not.toBe(initialHash);

        const result = await deleteDirectory(
            vault.Directories,
            vault.Credentials,
            directory.ID,
        );
        expect(result.deletedCredentialCount).toBe(1);
        expect(directory.Deleted).toBe(true);
        const deletedCredential = vault.Credentials.find(
            (entry) => entry.ID === credential.ID,
        );
        expect(deletedCredential).toMatchObject({
            Deleted: true,
            DirectoryID: "",
            Name: "Unnamed item",
            Password: "",
            Version: 2,
        });
        await expect(
            deleteDirectory(vault.Directories, vault.Credentials, ""),
        ).rejects.toThrow("Root cannot be deleted");
    });

    it("resolves synchronized name collisions deterministically", async () => {
        const first = await createDirectory([], {
            ID: "a",
            Name: "Work",
        });
        const second = await createDirectory([], {
            ID: "b",
            Name: "work",
        });
        const directories = [second, first];

        await resolveDirectoryNameCollisions(directories);

        expect(first.Name).toBe("Work");
        expect(second.Name).toBe("work (2)");
    });

    it("orders concurrent records by version, timestamp, then hash", () => {
        const local = {
            Version: 2,
            DateModifiedTimestamp: 10,
            Hash: "bbb",
        };
        expect(
            shouldAcceptVersionedRecord(local, {
                ...local,
                Version: 3,
            }),
        ).toBe(true);
        expect(
            shouldAcceptVersionedRecord(local, {
                ...local,
                DateModifiedTimestamp: 11,
            }),
        ).toBe(true);
        expect(
            shouldAcceptVersionedRecord(local, { ...local, Hash: "aaa" }),
        ).toBe(true);
        expect(
            shouldAcceptVersionedRecord(local, { ...local, Hash: "ccc" }),
        ).toBe(false);
    });
});
