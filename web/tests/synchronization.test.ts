import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
    afterEach,
    beforeAll,
} from "@jest/globals";
import { err, ok } from "neverthrow";
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "util";

import * as VaultUtilTypes from "../src/app_lib/proto/vault";

if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", {
        value: webcrypto,
        writable: true,
    });
}

Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    writable: true,
});

Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
});

jest.mock("../src/env/client.mjs", () => ({
    env: {
        NEXT_PUBLIC_PUSHER_APP_KEY: "test-key",
        NEXT_PUBLIC_PUSHER_APP_HOST: "localhost",
        NEXT_PUBLIC_PUSHER_APP_PORT: "6001",
        NEXT_PUBLIC_PUSHER_APP_TLS: false,
    },
}));

jest.mock("../src/utils/trpc", () => ({
    createAuthHeader: () => ({}),
    trpc: {
        v1: {
            device: {
                signalingAuthChannel: {
                    query: jest.fn(async () => ({ auth: "stub-auth" })),
                },
                turnCredentials: {
                    mutate: jest.fn(async () => ({
                        iceServers: [
                            {
                                urls: "turn:test.example.com:5349",
                                username: "test-user",
                                credential: "test-cred",
                            },
                        ],
                        expiresAt: Date.now() + 300_000,
                    })),
                },
            },
        },
    },
}));

import { SyncConnectionController } from "../src/app_lib/synchronization";
import { SynchronizationEnvelope } from "../src/app_lib/synchronization-utils";
import { ensureSyncSigningKeypair } from "../src/app_lib/vault-utils/sync-signing";
import { LinkedDevices } from "../src/app_lib/vault-utils/vault";

type VaultOpsMock = {
    getItemVersionVectors: jest.MockedFunction<() => Promise<VaultUtilTypes.VersionVector[]>>;
    getItemCredentials: jest.MockedFunction<(itemIDs: string[]) => Promise<VaultUtilTypes.Credential[]>>;
    updateCredentials: jest.MockedFunction<(credentials: VaultUtilTypes.Credential[]) => Promise<void>>;
    getSynchronizationConfig: jest.MockedFunction<() => Promise<VaultUtilTypes.LinkedDevices>>;
    getSyncSigningPrivateKey: jest.MockedFunction<() => Promise<string | null>>;
    getRemoteSyncPublicKey: jest.MockedFunction<(linkedDeviceId: string) => Promise<string | null>>;
};

type TestSyncKeys = {
    localPrivateKey: string;
    remotePrivateKey: string;
    remotePublicKey: string;
};

let testSyncKeys: TestSyncKeys;

beforeAll(async () => {
    const localKeys = new LinkedDevices();
    const remoteKeys = new LinkedDevices();
    await ensureSyncSigningKeypair(localKeys);
    await ensureSyncSigningKeypair(remoteKeys);
    testSyncKeys = {
        localPrivateKey: localKeys.SyncSigningPrivateKey,
        remotePrivateKey: remoteKeys.SyncSigningPrivateKey,
        remotePublicKey: remoteKeys.SyncSigningPublicKey,
    };
});

type VaultItemSynchronizationHandle = {
    transmitSyncHello(deviceID: string, dataChannel: RTCDataChannel): Promise<void>;
    onDataChannelMessage(
        remoteDeviceID: string,
        dataChannel: RTCDataChannel,
        event: MessageEvent,
    ): Promise<void>;
};

const asArrayBuffer = (bytes: Uint8Array | ArrayBuffer): ArrayBuffer =>
    bytes instanceof ArrayBuffer
        ? bytes
        : bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;

const createMessageEvent = (bytes: Uint8Array): MessageEvent =>
    ({ data: asArrayBuffer(bytes) }) as MessageEvent;

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

const setup = () => {
    const vaultOps: VaultOpsMock = {
        getItemVersionVectors: jest.fn(async () => []),
        getItemCredentials: jest.fn(async () => []),
        updateCredentials: jest.fn(async () => undefined),
        getSynchronizationConfig: jest.fn(
            async () =>
                ({
                    ID: "our-device",
                }) as VaultUtilTypes.LinkedDevices,
        ),
        getSyncSigningPrivateKey: jest.fn(
            async () => testSyncKeys.localPrivateKey,
        ),
        getRemoteSyncPublicKey: jest.fn(
            async () => testSyncKeys.remotePublicKey,
        ),
    };

    const controller = new SyncConnectionController(vaultOps);
    const sync = (
        controller as unknown as { _vaultItemSynchronization: VaultItemSynchronizationHandle }
    )._vaultItemSynchronization;

    const dataChannel = {
        send: jest.fn(),
    } as unknown as RTCDataChannel;
    const sendMock = dataChannel.send as unknown as jest.Mock;

    return {
        vaultOps,
        controller,
        sync,
        dataChannel,
        sendMock,
    };
};

describe("VaultItemSynchronization", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("transmitSyncHello sends local version vectors", async () => {
        const { vaultOps, sync, dataChannel, sendMock } = setup();
        vaultOps.getItemVersionVectors.mockResolvedValueOnce([
            versionVector("item-1", 1, "h1", 100),
        ]);

        await sync.transmitSyncHello("remote-device", dataChannel);

        expect(vaultOps.getItemVersionVectors).toHaveBeenCalledTimes(1);
        expect(sendMock).toHaveBeenCalledTimes(1);

        const serializedEnvelope = sendMock.mock.calls[0]?.[0] as Uint8Array;
        const decoded = await SynchronizationEnvelope.deserialize(asArrayBuffer(serializedEnvelope));

        expect(decoded.isOk()).toBe(true);
        if (decoded.isOk()) {
            expect(decoded.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHello,
            );
            expect((decoded.value.data as VaultUtilTypes.SyncHelloMessage).VersionVectors).toEqual([
                versionVector("item-1", 1, "h1", 100),
            ]);
        }
    });

    it("broadcasts sync error when envelope deserialization fails", async () => {
        const { controller, sync, dataChannel } = setup();
        const syncErrorSpy = jest
            .spyOn(controller, "broadcastWebRTCSyncErrorEvent")
            .mockImplementation(() => undefined);
        jest.spyOn(SynchronizationEnvelope, "deserialize").mockResolvedValueOnce(
            err("SYNC_ENVELOPE_DESERIALIZATION_FAILED"),
        );

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            ({ data: new ArrayBuffer(8) }) as MessageEvent,
        );

        expect(syncErrorSpy).toHaveBeenCalledWith("remote-device");
    });

    it("on SyncHello sends echo and requests missing or newer items", async () => {
        const { controller, vaultOps, sync, dataChannel, sendMock } = setup();
        const synchronizedSpy = jest
            .spyOn(controller, "broadcastWebRTCSynchronizedEvent")
            .mockImplementation(() => undefined);

        vaultOps.getItemVersionVectors.mockResolvedValueOnce([
            versionVector("item-a", 1, "local-a", 100),
            versionVector("item-b", 2, "local-b", 100),
        ]);
        vaultOps.getItemVersionVectors.mockResolvedValueOnce([
            versionVector("item-a", 1, "local-a", 100),
            versionVector("item-b", 2, "local-b", 100),
        ]);

        const remoteHello = await SynchronizationEnvelope.createSyncHelloMessage(
            [
                versionVector("item-a", 2, "remote-a", 110),
                versionVector("item-c", 1, "remote-c", 90),
            ],
            testSyncKeys.remotePrivateKey,
        );

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(remoteHello.data),
        );

        expect(sendMock).toHaveBeenCalledTimes(2);
        expect(synchronizedSpy).not.toHaveBeenCalled();

        const echoMessage = await SynchronizationEnvelope.deserialize(
            asArrayBuffer(sendMock.mock.calls[0]![0] as Uint8Array),
        );
        expect(echoMessage.isOk()).toBe(true);
        if (echoMessage.isOk()) {
            expect(echoMessage.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho,
            );
        }

        const requestMessage = await SynchronizationEnvelope.deserialize(
            asArrayBuffer(sendMock.mock.calls[1]![0] as Uint8Array),
        );
        expect(requestMessage.isOk()).toBe(true);
        if (requestMessage.isOk()) {
            expect(requestMessage.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest,
            );
            expect((requestMessage.value.data as VaultUtilTypes.SyncDataRequestMessage).ItemIDs.sort()).toEqual(["item-a", "item-c"]);
        }
    });

    it("on SyncHello does not request newer local hash and marks sync complete", async () => {
        const { controller, vaultOps, sync, dataChannel, sendMock } = setup();
        const synchronizedSpy = jest
            .spyOn(controller, "broadcastWebRTCSynchronizedEvent")
            .mockImplementation(() => undefined);

        const localVector = versionVector("item-a", 2, "local-hash", 200);
        const remoteVector = versionVector("item-a", 2, "remote-hash", 100);

        vaultOps.getItemVersionVectors.mockResolvedValueOnce([localVector]);
        vaultOps.getItemVersionVectors.mockResolvedValueOnce([localVector]);

        const remoteHello = await SynchronizationEnvelope.createSyncHelloMessage(
            [remoteVector],
            testSyncKeys.remotePrivateKey,
        );
        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(remoteHello.data),
        );

        expect(sendMock).toHaveBeenCalledTimes(1);
        const onlySent = await SynchronizationEnvelope.deserialize(
            asArrayBuffer(sendMock.mock.calls[0]![0] as Uint8Array),
        );
        expect(onlySent.isOk()).toBe(true);
        if (onlySent.isOk()) {
            expect(onlySent.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho,
            );
        }

        expect(synchronizedSpy).toHaveBeenCalledWith("remote-device");
    });

    it("on SyncHello requests same-version hash conflict when remote hash wins tie-break", async () => {
        const { controller, vaultOps, sync, dataChannel, sendMock } = setup();
        const synchronizedSpy = jest
            .spyOn(controller, "broadcastWebRTCSynchronizedEvent")
            .mockImplementation(() => undefined);

        // Remote hash < local hash → remote wins tie-break, we request the item
        const localVector = versionVector("item-a", 2, "z-local-hash", 150);
        const remoteVector = versionVector("item-a", 2, "a-remote-hash", 150);

        vaultOps.getItemVersionVectors.mockResolvedValueOnce([localVector]);
        vaultOps.getItemVersionVectors.mockResolvedValueOnce([localVector]);

        const remoteHello = await SynchronizationEnvelope.createSyncHelloMessage(
            [remoteVector],
            testSyncKeys.remotePrivateKey,
        );
        await sync.onDataChannelMessage(
            "a-device",
            dataChannel,
            createMessageEvent(remoteHello.data),
        );

        expect(sendMock).toHaveBeenCalledTimes(2);
        expect(synchronizedSpy).not.toHaveBeenCalled();

        const requestMessage = await SynchronizationEnvelope.deserialize(
            asArrayBuffer(sendMock.mock.calls[1]![0] as Uint8Array),
        );
        expect(requestMessage.isOk()).toBe(true);
        if (requestMessage.isOk()) {
            expect(requestMessage.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest,
            );
            expect((requestMessage.value.data as VaultUtilTypes.SyncDataRequestMessage).ItemIDs).toEqual(["item-a"]);
        }
    });

    it("on SyncHelloEcho behaves like SyncHello without sending echo", async () => {
        const { controller, vaultOps, sync, dataChannel, sendMock } = setup();
        const synchronizedSpy = jest
            .spyOn(controller, "broadcastWebRTCSynchronizedEvent")
            .mockImplementation(() => undefined);

        const localVectors = [versionVector("item-a", 1, "local-a", 100)];
        vaultOps.getItemVersionVectors.mockResolvedValueOnce(localVectors);

        const remoteEcho = await SynchronizationEnvelope.createSyncHelloEchoMessage(
            [versionVector("item-a", 2, "remote-a", 200)],
            testSyncKeys.remotePrivateKey,
        );

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(remoteEcho.data),
        );

        expect(sendMock).toHaveBeenCalledTimes(1);
        expect(synchronizedSpy).not.toHaveBeenCalled();

        const requestMessage = await SynchronizationEnvelope.deserialize(
            asArrayBuffer(sendMock.mock.calls[0]![0] as Uint8Array),
        );
        expect(requestMessage.isOk()).toBe(true);
        if (requestMessage.isOk()) {
            expect(requestMessage.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest,
            );
            expect((requestMessage.value.data as VaultUtilTypes.SyncDataRequestMessage).ItemIDs).toEqual(["item-a"]);
        }
    });

    it("on SyncDataRequest sends requested credentials as SyncDataResponse", async () => {
        const { vaultOps, sync, dataChannel, sendMock } = setup();
        const requestedCredentials = [credential("item-a"), credential("item-b")];
        vaultOps.getItemCredentials.mockResolvedValueOnce(requestedCredentials);

        const syncDataRequestEnvelope =
            await SynchronizationEnvelope.createSyncDataRequestMessage(
                ["item-a", "item-b"],
                testSyncKeys.remotePrivateKey,
            );

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(syncDataRequestEnvelope.data),
        );

        expect(vaultOps.getItemCredentials).toHaveBeenCalledWith(["item-a", "item-b"]);
        expect(sendMock).toHaveBeenCalledTimes(1);

        const responseMessage = await SynchronizationEnvelope.deserialize(
            asArrayBuffer(sendMock.mock.calls[0]![0] as Uint8Array),
        );
        expect(responseMessage.isOk()).toBe(true);
        if (responseMessage.isOk()) {
            expect(responseMessage.value.id).toBe(syncDataRequestEnvelope.envelopeID);
            expect(responseMessage.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataResponse,
            );
            expect((responseMessage.value.data as VaultUtilTypes.SyncDataResponseMessage).Credentials).toEqual(
                requestedCredentials,
            );
        }
    });

    it("on SyncDataResponse updates local credentials and marks sync complete", async () => {
        const { controller, vaultOps, sync, dataChannel, sendMock } = setup();
        const synchronizedSpy = jest
            .spyOn(controller, "broadcastWebRTCSynchronizedEvent")
            .mockImplementation(() => undefined);
        const incomingCredentials = [credential("item-a")];

        const remoteHello = await SynchronizationEnvelope.createSyncHelloMessage(
            [versionVector("item-a", 2, "remote-a", 200)],
            testSyncKeys.remotePrivateKey,
        );
        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(remoteHello.data),
        );

        const requestMessage = await SynchronizationEnvelope.deserialize(
            asArrayBuffer(sendMock.mock.calls[1]![0] as Uint8Array),
        );
        expect(requestMessage.isOk()).toBe(true);
        if (!requestMessage.isOk()) return;

        const syncDataResponseEnvelope =
            await SynchronizationEnvelope.createSyncDataResponseMessage(
                requestMessage.value.id,
                incomingCredentials,
                testSyncKeys.remotePrivateKey,
            );

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(syncDataResponseEnvelope),
        );

        expect(vaultOps.updateCredentials).toHaveBeenCalledWith(incomingCredentials);
        expect(synchronizedSpy).toHaveBeenCalledWith("remote-device");
    });

    it("drops unsolicited SyncDataResponse messages", async () => {
        const { controller, vaultOps, sync, dataChannel } = setup();
        const synchronizedSpy = jest
            .spyOn(controller, "broadcastWebRTCSynchronizedEvent")
            .mockImplementation(() => undefined);
        const incomingCredentials = [credential("item-a")];

        const syncDataResponseEnvelope =
            await SynchronizationEnvelope.createSyncDataResponseMessage(
                "unsolicited-response-id",
                incomingCredentials,
                testSyncKeys.remotePrivateKey,
            );

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(syncDataResponseEnvelope),
        );

        expect(vaultOps.updateCredentials).not.toHaveBeenCalled();
        expect(synchronizedSpy).not.toHaveBeenCalled();
    });

    it("drops sync messages with invalid signatures", async () => {
        const { controller, vaultOps, sync, dataChannel } = setup();
        const synchronizedSpy = jest
            .spyOn(controller, "broadcastWebRTCSynchronizedEvent")
            .mockImplementation(() => undefined);

        const unsignedHello = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: "unsigned-hello",
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHello,
            Payload: VaultUtilTypes.SyncHelloMessage.encode({
                VersionVectors: [versionVector("item-a", 1, "hash", 100)],
            }).finish(),
            Signature: new Uint8Array(),
        }).finish();

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(unsignedHello),
        );

        expect(vaultOps.updateCredentials).not.toHaveBeenCalled();
        expect(synchronizedSpy).not.toHaveBeenCalled();
    });

    it("handles malformed runtime payload types without mutating vault state", async () => {
        const { vaultOps, sync, dataChannel } = setup();

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            ({ data: "not-an-array-buffer" }) as MessageEvent,
        );

        expect(vaultOps.updateCredentials).not.toHaveBeenCalled();
    });

    it("on SyncHello tie-break does not request when our local hash wins", async () => {
        const { controller, vaultOps, sync, dataChannel, sendMock } = setup();
        const synchronizedSpy = jest
            .spyOn(controller, "broadcastWebRTCSynchronizedEvent")
            .mockImplementation(() => undefined);

        // Local hash < remote hash → local wins tie-break, no data request
        const localVector = versionVector("item-a", 2, "a-local-hash", 150);
        const remoteVector = versionVector("item-a", 2, "z-remote-hash", 150);

        vaultOps.getItemVersionVectors.mockResolvedValueOnce([localVector]);
        vaultOps.getItemVersionVectors.mockResolvedValueOnce([localVector]);

        const remoteHello = await SynchronizationEnvelope.createSyncHelloMessage(
            [remoteVector],
            testSyncKeys.remotePrivateKey,
        );
        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(remoteHello.data),
        );

        expect(sendMock).toHaveBeenCalledTimes(1);
        expect(synchronizedSpy).toHaveBeenCalledWith("remote-device");
    });

    it("propagates SyncDataRequest vault read failures without sending a response", async () => {
        const { vaultOps, sync, dataChannel, sendMock } = setup();
        vaultOps.getItemCredentials.mockRejectedValueOnce(new Error("vault read failed"));

        const syncDataRequestEnvelope =
            await SynchronizationEnvelope.createSyncDataRequestMessage(
                ["item-a"],
                testSyncKeys.remotePrivateKey,
            );

        await expect(
            sync.onDataChannelMessage(
                "remote-device",
                dataChannel,
                createMessageEvent(syncDataRequestEnvelope.data),
            ),
        ).rejects.toThrow("vault read failed");

        expect(sendMock).not.toHaveBeenCalled();
    });

    it("propagates SyncDataResponse vault write failures and does not mark sync complete", async () => {
        const { controller, vaultOps, sync, dataChannel, sendMock } = setup();
        const synchronizedSpy = jest
            .spyOn(controller, "broadcastWebRTCSynchronizedEvent")
            .mockImplementation(() => undefined);
        vaultOps.updateCredentials.mockRejectedValueOnce(
            new Error("vault write failed"),
        );
        const incomingCredentials = [credential("item-a")];

        const remoteHello = await SynchronizationEnvelope.createSyncHelloMessage(
            [versionVector("item-a", 2, "remote-a", 200)],
            testSyncKeys.remotePrivateKey,
        );
        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(remoteHello.data),
        );

        const requestMessage = await SynchronizationEnvelope.deserialize(
            asArrayBuffer(sendMock.mock.calls[1]![0] as Uint8Array),
        );
        expect(requestMessage.isOk()).toBe(true);
        if (!requestMessage.isOk()) return;

        const syncDataResponseEnvelope =
            await SynchronizationEnvelope.createSyncDataResponseMessage(
                requestMessage.value.id,
                incomingCredentials,
                testSyncKeys.remotePrivateKey,
            );

        await expect(
            sync.onDataChannelMessage(
                "remote-device",
                dataChannel,
                createMessageEvent(syncDataResponseEnvelope),
            ),
        ).rejects.toThrow("vault write failed");

        expect(synchronizedSpy).not.toHaveBeenCalled();
    });

    // Intentional: the handler does not dedupe by envelope id; duplicate hellos can repeat echo+request.
    it("duplicate SyncHello messages trigger duplicate outbound actions", async () => {
        const { vaultOps, sync, dataChannel, sendMock } = setup();
        vaultOps.getItemVersionVectors.mockResolvedValue([
            versionVector("item-a", 1, "local-a", 100),
        ]);

        const remoteHello = await SynchronizationEnvelope.createSyncHelloMessage(
            [versionVector("item-a", 2, "remote-a", 200)],
            testSyncKeys.remotePrivateKey,
        );

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(remoteHello.data),
        );
        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(remoteHello.data),
        );

        expect(sendMock).toHaveBeenCalledTimes(4);
        const outboundCommands = await Promise.all(
            sendMock.mock.calls.map(async (call: unknown[]) => {
                const decoded = await SynchronizationEnvelope.deserialize(
                    asArrayBuffer(call[0] as Uint8Array),
                );
                return decoded.isOk() ? decoded.value.command : null;
            }),
        );

        expect(outboundCommands).toEqual([
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho,
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest,
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho,
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest,
        ]);
    });

    it("does not track pending data requests when data channel send fails", async () => {
        const { vaultOps, sync, dataChannel, sendMock } = setup();
        vaultOps.getItemVersionVectors.mockResolvedValue([
            versionVector("item-a", 1, "local-a", 100),
        ]);
        sendMock.mockImplementation((() => {
            let calls = 0;
            return () => {
                calls++;
                if (calls === 2) {
                    throw new Error("send failed");
                }
            };
        })());

        const remoteHello = await SynchronizationEnvelope.createSyncHelloMessage(
            [versionVector("item-a", 2, "remote-a", 200)],
            testSyncKeys.remotePrivateKey,
        );

        await expect(
            sync.onDataChannelMessage(
                "remote-device",
                dataChannel,
                createMessageEvent(remoteHello.data),
            ),
        ).rejects.toThrow("send failed");

        const failedRequest = await SynchronizationEnvelope.deserialize(
            asArrayBuffer(sendMock.mock.calls[1]![0] as Uint8Array),
        );
        expect(failedRequest.isOk()).toBe(true);
        if (!failedRequest.isOk()) return;

        const response = await SynchronizationEnvelope.createSyncDataResponseMessage(
            failedRequest.value.id,
            [credential("item-a")],
            testSyncKeys.remotePrivateKey,
        );

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(response),
        );

        expect(vaultOps.updateCredentials).not.toHaveBeenCalled();
    });

    it("caps pending data requests per device and drops responses for evicted requests", async () => {
        const { vaultOps, sync, dataChannel, sendMock } = setup();
        vaultOps.getItemVersionVectors.mockResolvedValue([]);
        const remoteHello = await SynchronizationEnvelope.createSyncHelloMessage(
            [versionVector("item-a", 2, "remote-a", 200)],
            testSyncKeys.remotePrivateKey,
        );

        for (let i = 0; i < 33; i++) {
            await sync.onDataChannelMessage(
                "remote-device",
                dataChannel,
                createMessageEvent(remoteHello.data),
            );
        }

        const requestIds: string[] = [];
        for (const call of sendMock.mock.calls) {
            const decoded = await SynchronizationEnvelope.deserialize(
                asArrayBuffer(call[0] as Uint8Array),
            );
            if (
                decoded.isOk() &&
                decoded.value.command ===
                    VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest
            ) {
                requestIds.push(decoded.value.id);
            }
        }

        expect(requestIds).toHaveLength(33);
        const staleResponse =
            await SynchronizationEnvelope.createSyncDataResponseMessage(
                requestIds[0]!,
                [credential("stale")],
                testSyncKeys.remotePrivateKey,
            );
        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(staleResponse),
        );
        expect(vaultOps.updateCredentials).not.toHaveBeenCalled();

        const latestResponse =
            await SynchronizationEnvelope.createSyncDataResponseMessage(
                requestIds.at(-1)!,
                [credential("latest")],
                testSyncKeys.remotePrivateKey,
            );
        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(latestResponse),
        );
        expect(vaultOps.updateCredentials).toHaveBeenCalledTimes(1);
        expect(vaultOps.updateCredentials).toHaveBeenCalledWith([
            credential("latest"),
        ]);
    });

    it("ignores unsupported command values from deserializer fallback", async () => {
        const { controller, vaultOps, sync, dataChannel, sendMock } = setup();
        const syncErrorSpy = jest
            .spyOn(controller, "broadcastWebRTCSyncErrorEvent")
            .mockImplementation(() => undefined);
        const synchronizedSpy = jest
            .spyOn(controller, "broadcastWebRTCSynchronizedEvent")
            .mockImplementation(() => undefined);

        jest.spyOn(SynchronizationEnvelope, "deserialize").mockResolvedValueOnce(
            ok({
                id: "unknown-command-id",
                command: 999 as VaultUtilTypes.VaultItemSynchronizationMessageCommand,
                data: {} as VaultUtilTypes.SyncHelloMessage,
            }),
        );

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            ({ data: new ArrayBuffer(2) }) as MessageEvent,
        );

        expect(sendMock).not.toHaveBeenCalled();
        expect(vaultOps.updateCredentials).not.toHaveBeenCalled();
        expect(syncErrorSpy).not.toHaveBeenCalled();
        expect(synchronizedSpy).not.toHaveBeenCalled();
    });
});
