import { TextDecoder, TextEncoder } from "util";
import { describe, expect, it } from "@jest/globals";
import * as Proto from "@cryptex-industries/vault-core/proto";
import { SynchronizationEnvelope } from "@cryptex-industries/vault-core/synchronization-utils";
import {
    Directory,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";

Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});
Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

const vector = (id: string): Proto.VersionVector => ({
    ID: id,
    Hash: `${id}-hash`,
    Version: 1,
    DateModifiedTimestamp: 10,
    Deleted: false,
});

describe("directory synchronization messages", () => {
    it("round-trips separate credential and directory vectors", async () => {
        const created = await SynchronizationEnvelope.createSyncHelloMessage(
            [vector("credential")],
            [vector("directory")],
        );
        const decoded = await SynchronizationEnvelope.deserialize(
            created.data.buffer.slice(
                created.data.byteOffset,
                created.data.byteOffset + created.data.byteLength,
            ) as ArrayBuffer,
        );

        const message = decoded._unsafeUnwrap();
        expect(message.data).toMatchObject({
            CredentialVersionVectors: [vector("credential")],
            DirectoryVersionVectors: [vector("directory")],
        });
    });

    it("round-trips typed requests", async () => {
        const items: Proto.SyncItemReference[] = [
            { Type: Proto.SyncItemType.DirectoryItem, ID: "directory" },
            { Type: Proto.SyncItemType.CredentialItem, ID: "credential" },
        ];
        const created =
            await SynchronizationEnvelope.createSyncDataRequestMessage(items);
        const decoded = await SynchronizationEnvelope.deserialize(
            created.data.buffer.slice(
                created.data.byteOffset,
                created.data.byteOffset + created.data.byteLength,
            ) as ArrayBuffer,
        );

        expect(decoded._unsafeUnwrap().data).toEqual({ Items: items });
    });

    it("round-trips directories before credentials in data responses", async () => {
        const directory = Object.assign(new Directory("Work"), {
            ID: "directory",
            Hash: "directory-hash",
        });
        const credential = Object.assign(new VaultCredential(), {
            ID: "credential",
            DirectoryID: directory.ID,
            Hash: "credential-hash",
        });
        const data =
            await SynchronizationEnvelope.createSyncDataResponseMessage(
                "response",
                [credential],
                [directory],
            );
        const decoded = await SynchronizationEnvelope.deserialize(
            data.buffer.slice(
                data.byteOffset,
                data.byteOffset + data.byteLength,
            ) as ArrayBuffer,
        );

        expect(decoded._unsafeUnwrap().data).toMatchObject({
            Directories: [{ ID: directory.ID, Name: "Work" }],
            Credentials: [{ ID: credential.ID, DirectoryID: directory.ID }],
        });
    });
});
