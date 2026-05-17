import { describe, it, expect } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});

Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

import * as VaultUtilTypes from "../../src/app_lib/proto/vault";
import {
    SynchronizationEnvelope,
    isRTCSessionDescriptionInit,
} from "../../src/app_lib/synchronization-utils";

const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

const versionVector = (
    id: string,
    version: number,
    hash: string,
    dateModifiedTimestamp: number,
): VaultUtilTypes.VersionVector => ({
    ID: id,
    Version: version,
    Hash: hash,
    DateModifiedTimestamp: dateModifiedTimestamp,
    Deleted: false,
});

const credential = (id: string): VaultUtilTypes.Credential => ({
    ID: id,
    Type: VaultUtilTypes.ItemType.Credentials,
    GroupID: "group-1",
    Name: `Credential ${id}`,
    Username: `user-${id}`,
    Password: "secret",
    URL: "https://example.com",
    Notes: "",
    DateCreated: "2026-01-01T00:00:00.000Z",
    DateModified: undefined,
    DatePasswordChanged: undefined,
    CustomFields: [],
    Hash: `hash-${id}`,
    Version: 1,
    DateCreatedTimestamp: 1,
    DateModifiedTimestamp: 1,
    DatePasswordChangedTimestamp: 1,
    Deleted: false,
});

describe("SynchronizationEnvelope.serialize", () => {
    it("round-trips a SyncHello message", () => {
        const { data, envelopeID } = SynchronizationEnvelope.createSyncHelloMessage([
            versionVector("item-a", 1, "hash-a", 100),
        ]);

        const decoded = SynchronizationEnvelope.deserialize(asArrayBuffer(data));
        expect(decoded.isOk()).toBe(true);
        if (decoded.isOk()) {
            expect(decoded.value.id).toBe(envelopeID);
            expect(decoded.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHello,
            );
            expect(
                (decoded.value.data as VaultUtilTypes.SyncHelloMessage).VersionVectors,
            ).toEqual([versionVector("item-a", 1, "hash-a", 100)]);
        }
    });

    it("serialize produces bytes matching proto encode", () => {
        const envelope = VaultUtilTypes.SynchronizationEnvelope.fromPartial({
            ID: "fixed-id",
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHello,
            Payload: new Uint8Array([1, 2, 3]),
        });

        const serialized = SynchronizationEnvelope.serialize(
            envelope as unknown as InstanceType<typeof SynchronizationEnvelope>,
        );
        const expected = VaultUtilTypes.SynchronizationEnvelope.encode(envelope).finish();
        expect(Array.from(serialized)).toEqual(Array.from(expected));
    });

    it("serialize bubbles encoder errors when Command is undefined", () => {
        // Source semantics: `SynchronizationEnvelope.serialize` delegates straight
        // to `VaultUtilTypes.SynchronizationEnvelope.encode(...)` with no
        // try/catch. The underlying protobuf encoder rejects non-int Command
        // values with "invalid int32". This test pins that surface so any future
        // "swallow encode errors" regression is caught.
        const malformed = {
            ID: "x",
            Command: undefined as unknown as VaultUtilTypes.VaultItemSynchronizationMessageCommand,
            Payload: new Uint8Array(),
        };

        expect(() =>
            SynchronizationEnvelope.serialize(
                malformed as unknown as InstanceType<typeof SynchronizationEnvelope>,
            ),
        ).toThrow(/invalid int32/);
    });

    it("serialize throws when Payload is null (encoder reads .length)", () => {
        // Proto encoder reads `payload.length`. Passing null bypasses ts-proto's
        // typing and triggers a TypeError, which the source surfaces uncaught.
        const broken = {
            ID: "y",
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHello,
            Payload: null as unknown as Uint8Array,
        };
        expect(() =>
            SynchronizationEnvelope.serialize(
                broken as unknown as InstanceType<typeof SynchronizationEnvelope>,
            ),
        ).toThrow();
    });
});

describe("SynchronizationEnvelope.deserialize", () => {
    it("returns SYNC_ENVELOPE_DESERIALIZATION_FAILED on garbage outer bytes", () => {
        const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]);
        const result = SynchronizationEnvelope.deserialize(asArrayBuffer(garbage));
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            expect(result.error).toBe("SYNC_ENVELOPE_DESERIALIZATION_FAILED");
        }
    });

    it("returns SYNC_HELLO_DESERIALIZATION_FAILED when SyncHello payload is malformed", () => {
        const envelope = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: "bad-hello",
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHello,
            Payload: new Uint8Array([0xff, 0xff, 0xff]),
        }).finish();

        const result = SynchronizationEnvelope.deserialize(asArrayBuffer(envelope));
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            expect(result.error).toBe("SYNC_HELLO_DESERIALIZATION_FAILED");
        }
    });

    it("returns SYNC_HELLO_ECHO_DESERIALIZATION_FAILED when SyncHelloEcho payload is malformed", () => {
        const envelope = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: "bad-echo",
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho,
            Payload: new Uint8Array([0xff, 0xff, 0xff]),
        }).finish();

        const result = SynchronizationEnvelope.deserialize(asArrayBuffer(envelope));
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            expect(result.error).toBe("SYNC_HELLO_ECHO_DESERIALIZATION_FAILED");
        }
    });

    it("returns SYNC_DATA_REQUEST_DESERIALIZATION_FAILED when SyncDataRequest payload is malformed", () => {
        const envelope = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: "bad-data-req",
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest,
            Payload: new Uint8Array([0xff, 0xff, 0xff]),
        }).finish();

        const result = SynchronizationEnvelope.deserialize(asArrayBuffer(envelope));
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            expect(result.error).toBe("SYNC_DATA_REQUEST_DESERIALIZATION_FAILED");
        }
    });

    it("returns SYNC_DATA_RESPONSE_DESERIALIZATION_FAILED when SyncDataResponse payload is malformed", () => {
        const envelope = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: "bad-data-res",
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataResponse,
            Payload: new Uint8Array([0xff, 0xff, 0xff]),
        }).finish();

        const result = SynchronizationEnvelope.deserialize(asArrayBuffer(envelope));
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            expect(result.error).toBe("SYNC_DATA_RESPONSE_DESERIALIZATION_FAILED");
        }
    });

    it("returns SYNC_INVALID_COMMAND for an unknown command value", () => {
        const envelope = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: "unknown-cmd",
            Command: 999 as VaultUtilTypes.VaultItemSynchronizationMessageCommand,
            Payload: new Uint8Array(),
        }).finish();

        const result = SynchronizationEnvelope.deserialize(asArrayBuffer(envelope));
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            expect(result.error).toBe("SYNC_INVALID_COMMAND");
        }
    });

    it("decodes a SyncHelloEcho envelope", () => {
        const { data } = SynchronizationEnvelope.createSyncHelloEchoMessage([
            versionVector("item-e", 5, "echo-hash", 500),
        ]);
        const result = SynchronizationEnvelope.deserialize(asArrayBuffer(data));
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho,
            );
            expect(
                (result.value.data as VaultUtilTypes.SyncHelloEchoMessage).VersionVectors,
            ).toEqual([versionVector("item-e", 5, "echo-hash", 500)]);
        }
    });

    it("decodes a SyncDataRequest envelope", () => {
        const { data } = SynchronizationEnvelope.createSyncDataRequestMessage([
            "item-x",
            "item-y",
        ]);
        const result = SynchronizationEnvelope.deserialize(asArrayBuffer(data));
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest,
            );
            expect(
                (result.value.data as VaultUtilTypes.SyncDataRequestMessage).ItemIDs,
            ).toEqual(["item-x", "item-y"]);
        }
    });

    it("decodes a SyncDataResponse envelope", () => {
        const credentials = [credential("item-a"), credential("item-b")];
        const data = SynchronizationEnvelope.createSyncDataResponseMessage(
            "response-envelope",
            credentials,
        );
        const result = SynchronizationEnvelope.deserialize(asArrayBuffer(data));
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.id).toBe("response-envelope");
            expect(result.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataResponse,
            );
            expect(
                (result.value.data as VaultUtilTypes.SyncDataResponseMessage).Credentials,
            ).toEqual(credentials);
        }
    });
});

describe("isRTCSessionDescriptionInit", () => {
    it("returns true for an RTCSessionDescriptionInit (has 'type')", () => {
        const desc: RTCSessionDescriptionInit = { type: "offer", sdp: "v=0" };
        expect(isRTCSessionDescriptionInit(desc)).toBe(true);
    });

    it("returns false for an RTCIceCandidateInit-like object (no 'type')", () => {
        const cand: RTCIceCandidateInit = {
            candidate: "candidate:1 1 UDP 2122252543 192.168.1.1 5000 typ host",
        };
        expect(isRTCSessionDescriptionInit(cand)).toBe(false);
    });
});
