import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { err, ok } from "neverthrow";
import { TextDecoder, TextEncoder } from "util";

import * as VaultUtilTypes from "../src/app_lib/proto/vault";

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
            },
        },
    },
}));

import { SyncConnectionController } from "../src/app_lib/synchronization";
import { SynchronizationEnvelope } from "../src/app_lib/synchronization-utils";

type VaultOpsMock = {
    getItemVersionVectors: jest.MockedFunction<() => Promise<VaultUtilTypes.VersionVector[]>>;
    getItemCredentials: jest.MockedFunction<(itemIDs: string[]) => Promise<VaultUtilTypes.Credential[]>>;
    updateCredentials: jest.MockedFunction<(credentials: VaultUtilTypes.Credential[]) => Promise<void>>;
    getSynchronizationConfig: jest.MockedFunction<() => Promise<VaultUtilTypes.LinkedDevices>>;
};

type VaultItemSynchronizationHandle = {
    transmitSyncHello(deviceID: string, dataChannel: RTCDataChannel): Promise<void>;
    onDataChannelMessage(
        remoteDeviceID: string,
        dataChannel: RTCDataChannel,
        event: MessageEvent,
    ): Promise<void>;
};

const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

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
        const decoded = SynchronizationEnvelope.deserialize(asArrayBuffer(serializedEnvelope));

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
        jest.spyOn(SynchronizationEnvelope, "deserialize").mockReturnValueOnce(
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

        const remoteHello = SynchronizationEnvelope.createSyncHelloMessage([
            versionVector("item-a", 2, "remote-a", 110),
            versionVector("item-c", 1, "remote-c", 90),
        ]);

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(remoteHello.data),
        );

        expect(sendMock).toHaveBeenCalledTimes(2);
        expect(synchronizedSpy).not.toHaveBeenCalled();

        const echoMessage = SynchronizationEnvelope.deserialize(
            asArrayBuffer(sendMock.mock.calls[0]![0] as Uint8Array),
        );
        expect(echoMessage.isOk()).toBe(true);
        if (echoMessage.isOk()) {
            expect(echoMessage.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho,
            );
        }

        const requestMessage = SynchronizationEnvelope.deserialize(
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

        const remoteHello = SynchronizationEnvelope.createSyncHelloMessage([remoteVector]);
        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(remoteHello.data),
        );

        expect(sendMock).toHaveBeenCalledTimes(1);
        const onlySent = SynchronizationEnvelope.deserialize(
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

        const remoteHello = SynchronizationEnvelope.createSyncHelloMessage([remoteVector]);
        await sync.onDataChannelMessage(
            "a-device",
            dataChannel,
            createMessageEvent(remoteHello.data),
        );

        expect(sendMock).toHaveBeenCalledTimes(2);
        expect(synchronizedSpy).not.toHaveBeenCalled();

        const requestMessage = SynchronizationEnvelope.deserialize(
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

        const remoteEcho = {
            envelopeID: "echo-id",
            data: VaultUtilTypes.SynchronizationEnvelope.encode({
                ID: "echo-id",
                Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho,
                Payload: VaultUtilTypes.SyncHelloEchoMessage.encode({
                    VersionVectors: [versionVector("item-a", 2, "remote-a", 200)],
                }).finish(),
            }).finish(),
        };

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(remoteEcho.data),
        );

        expect(sendMock).toHaveBeenCalledTimes(1);
        expect(synchronizedSpy).not.toHaveBeenCalled();

        const requestMessage = SynchronizationEnvelope.deserialize(
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

        const syncDataRequestEnvelope = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: "request-envelope-id",
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest,
            Payload: VaultUtilTypes.SyncDataRequestMessage.encode({
                ItemIDs: ["item-a", "item-b"],
            }).finish(),
        }).finish();

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(syncDataRequestEnvelope),
        );

        expect(vaultOps.getItemCredentials).toHaveBeenCalledWith(["item-a", "item-b"]);
        expect(sendMock).toHaveBeenCalledTimes(1);

        const responseMessage = SynchronizationEnvelope.deserialize(
            asArrayBuffer(sendMock.mock.calls[0]![0] as Uint8Array),
        );
        expect(responseMessage.isOk()).toBe(true);
        if (responseMessage.isOk()) {
            expect(responseMessage.value.id).toBe("request-envelope-id");
            expect(responseMessage.value.command).toBe(
                VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataResponse,
            );
            expect((responseMessage.value.data as VaultUtilTypes.SyncDataResponseMessage).Credentials).toEqual(
                requestedCredentials,
            );
        }
    });

    it("on SyncDataResponse updates local credentials and marks sync complete", async () => {
        const { controller, vaultOps, sync, dataChannel } = setup();
        const synchronizedSpy = jest
            .spyOn(controller, "broadcastWebRTCSynchronizedEvent")
            .mockImplementation(() => undefined);
        const incomingCredentials = [credential("item-a")];

        const syncDataResponseEnvelope = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: "response-envelope-id",
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataResponse,
            Payload: VaultUtilTypes.SyncDataResponseMessage.encode({
                Credentials: incomingCredentials,
            }).finish(),
        }).finish();

        await sync.onDataChannelMessage(
            "remote-device",
            dataChannel,
            createMessageEvent(syncDataResponseEnvelope),
        );

        expect(vaultOps.updateCredentials).toHaveBeenCalledWith(incomingCredentials);
        expect(synchronizedSpy).toHaveBeenCalledWith("remote-device");
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

        const remoteHello = SynchronizationEnvelope.createSyncHelloMessage([remoteVector]);
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

        const syncDataRequestEnvelope = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: "request-envelope-id",
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest,
            Payload: VaultUtilTypes.SyncDataRequestMessage.encode({
                ItemIDs: ["item-a"],
            }).finish(),
        }).finish();

        await expect(
            sync.onDataChannelMessage(
                "remote-device",
                dataChannel,
                createMessageEvent(syncDataRequestEnvelope),
            ),
        ).rejects.toThrow("vault read failed");

        expect(sendMock).not.toHaveBeenCalled();
    });

    it("propagates SyncDataResponse vault write failures and does not mark sync complete", async () => {
        const { controller, vaultOps, sync, dataChannel } = setup();
        const synchronizedSpy = jest
            .spyOn(controller, "broadcastWebRTCSynchronizedEvent")
            .mockImplementation(() => undefined);
        vaultOps.updateCredentials.mockRejectedValueOnce(
            new Error("vault write failed"),
        );
        const incomingCredentials = [credential("item-a")];

        const syncDataResponseEnvelope = VaultUtilTypes.SynchronizationEnvelope.encode({
            ID: "response-envelope-id",
            Command: VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataResponse,
            Payload: VaultUtilTypes.SyncDataResponseMessage.encode({
                Credentials: incomingCredentials,
            }).finish(),
        }).finish();

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

        const remoteHello = SynchronizationEnvelope.createSyncHelloMessage([
            versionVector("item-a", 2, "remote-a", 200),
        ]);

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
        const outboundCommands = sendMock.mock.calls.map((call: unknown[]) => {
            const decoded = SynchronizationEnvelope.deserialize(
                asArrayBuffer(call[0] as Uint8Array),
            );
            return decoded.isOk() ? decoded.value.command : null;
        });

        expect(outboundCommands).toEqual([
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho,
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest,
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncHelloEcho,
            VaultUtilTypes.VaultItemSynchronizationMessageCommand.SyncDataRequest,
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

        jest.spyOn(SynchronizationEnvelope, "deserialize").mockReturnValueOnce(
            ok({
                id: "unknown-command-id",
                command: 999 as VaultUtilTypes.VaultItemSynchronizationMessageCommand,
                data: {} as VaultUtilTypes.SyncHelloMessage,
            }) as ReturnType<typeof SynchronizationEnvelope.deserialize>,
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
