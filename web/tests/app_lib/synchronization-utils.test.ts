import { describe, expect, it } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

import * as VaultUtilTypes from "../../src/app_lib/proto/vault";
import {
    SynchronizationEnvelope,
    isRTCSessionDescriptionInit,
} from "../../src/app_lib/synchronization-utils";
import { SYNC_PROTOCOL_VERSION } from "../../src/app_lib/vault-utils/sync-crypto";

Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});
Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

const versionVector = (id: string): VaultUtilTypes.VersionVector => ({
    ID: id,
    Hash: `hash-${id}`,
    Version: 1,
    DateModifiedTimestamp: 1,
    Deleted: false,
});

describe("SynchronizationEnvelope inner messages", () => {
    it("round-trips a SyncHello plaintext message", async () => {
        const { data, envelopeID } =
            await SynchronizationEnvelope.createSyncHelloMessage(
                [versionVector("a")],
                [versionVector("directory")],
            );

        const decoded = await SynchronizationEnvelope.deserialize(
            asArrayBuffer(data),
        );

        expect(decoded.isOk()).toBe(true);
        if (!decoded.isOk()) return;
        expect(decoded.value.id).toBe(envelopeID);
        expect(decoded.value.command).toBe(
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHello,
        );
        expect(
            (decoded.value.data as VaultUtilTypes.SyncHelloMessage)
                .CredentialVersionVectors,
        ).toEqual([versionVector("a")]);
        expect(
            (decoded.value.data as VaultUtilTypes.SyncHelloMessage)
                .DirectoryVersionVectors,
        ).toEqual([versionVector("directory")]);
    });

    it("rejects malformed inner payloads", async () => {
        const bad = VaultUtilTypes.SyncPlaintextMessage.encode({
            ID: "bad",
            Command:
                VaultUtilTypes.VaultItemSynchronizationMessageCommand
                    .SyncDataResponse,
            Payload: new Uint8Array([0xff, 0xff, 0xff]),
        }).finish();

        const decoded = await SynchronizationEnvelope.deserialize(
            asArrayBuffer(bad),
        );

        expect(decoded.isErr()).toBe(true);
        expect(decoded._unsafeUnwrapErr()).toBe(
            "SYNC_DATA_RESPONSE_DESERIALIZATION_FAILED",
        );
    });

    it("serializes encrypted outer envelopes via proto encoder", () => {
        const envelope = VaultUtilTypes.SynchronizationEnvelope.fromPartial({
            ID: "sync-id",
            Command: VaultUtilTypes.SyncWireMessageCommand.SyncEncryptedMessage,
            ProtocolVersion: SYNC_PROTOCOL_VERSION,
            SessionID: "session-id",
            Sequence: 1,
            Nonce: new Uint8Array([1, 2, 3]),
            Ciphertext: new Uint8Array([4, 5, 6]),
        });

        const serialized = SynchronizationEnvelope.serialize(
            envelope as unknown as Parameters<
                typeof SynchronizationEnvelope.serialize
            >[0],
        );

        expect(Array.from(serialized)).toEqual(
            Array.from(
                VaultUtilTypes.SynchronizationEnvelope.encode(
                    envelope,
                ).finish(),
            ),
        );
    });
});

describe("isRTCSessionDescriptionInit", () => {
    it("detects session descriptions by type field", () => {
        expect(isRTCSessionDescriptionInit({ type: "offer" })).toBe(true);
        expect(isRTCSessionDescriptionInit({ candidate: "candidate" })).toBe(
            false,
        );
    });
});
