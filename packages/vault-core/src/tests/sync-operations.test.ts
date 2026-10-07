/** @jest-environment node */
import { expect, it } from "@jest/globals";
import { SyncItemType } from "../proto/vault";
import {
    applyReceivedSyncDirectories,
    getSyncVersionVectors,
    selectSyncItems,
} from "../sync-operations";
import { Directory, Vault, VaultCredential } from "../vault-utils/vault";

it("selects requested types in vault order and includes tombstones without credential secrets in vectors", () => {
    const vault = new Vault();
    const first = Object.assign(new VaultCredential(), { ID: "first" });
    const deleted = Object.assign(new VaultCredential(), {
        ID: "deleted",
        Password: "secret",
        Deleted: true,
    });
    const directory = Object.assign(new Directory("Work"), { ID: "first" });
    vault.Credentials = [first, deleted];
    vault.Directories = [directory, { ...directory, ID: "deleted" }];

    const selected = selectSyncItems(vault, [
        { Type: SyncItemType.CredentialItem, ID: "deleted" },
        { Type: SyncItemType.DirectoryItem, ID: "first" },
        { Type: SyncItemType.CredentialItem, ID: "first" },
        { Type: SyncItemType.CredentialItem, ID: "deleted" },
        { Type: SyncItemType.CredentialItem, ID: "missing" },
    ]);
    expect(selected.Credentials).toEqual([first, deleted]);
    expect(selected.Credentials[1]).toBe(deleted);
    expect(selected.Directories).toEqual([directory]);
    expect(getSyncVersionVectors([deleted])).toEqual([
        {
            ID: deleted.ID,
            Hash: deleted.Hash,
            Version: deleted.Version,
            DateModifiedTimestamp: deleted.DateModifiedTimestamp,
            Deleted: true,
        },
    ]);
});

it("applies version ties and tombstones before resolving collisions without changing either input", async () => {
    const current = Object.freeze(
        Object.assign(new Directory("Work"), {
            ID: "b",
            Version: 4,
            DateModifiedTimestamp: 10,
            Hash: "z",
        }),
    );
    const accepted = Object.freeze({ ...current, Name: "Shared", Hash: "a" });
    const appended = Object.freeze(
        Object.assign(new Directory("Shared"), {
            ID: "a",
            Version: 1,
        }),
    );
    const deleted = Object.freeze(
        Object.assign(new Directory("Work"), {
            ID: "deleted",
            Deleted: true,
            Version: 2,
        }),
    );
    const updated = await applyReceivedSyncDirectories(
        [current],
        [
            { ...current, Name: "Stale", Version: 3 },
            accepted,
            appended,
            deleted,
            { ...deleted, Deleted: false, Version: 1 },
        ],
        (directory) => Object.assign(new Directory(), directory),
    );

    expect(updated.map((directory) => directory.ID)).toEqual([
        "b",
        "a",
        "deleted",
    ]);
    expect(updated[0]).toMatchObject({ Name: "Shared (2)", Version: 5 });
    expect(updated[0]?.Hash).not.toBe("a");
    expect(updated[1]).toMatchObject({ Name: "Shared", Version: 1 });
    expect(updated[2]?.Deleted).toBe(true);
    expect(updated.every((directory) => directory instanceof Directory)).toBe(
        true,
    );
    expect(current.Name).toBe("Work");
    expect(accepted.Hash).toBe("a");
    expect(appended.Name).toBe("Shared");
});
