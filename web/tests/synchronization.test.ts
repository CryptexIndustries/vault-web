import { describe, expect, it, jest, beforeAll } from "@jest/globals";
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "util";

import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { SyncConnectionController } from "@cryptex-industries/vault-core/synchronization";
import type { VaultOperations } from "@cryptex-industries/vault-core/synchronization";
import { SynchronizationEnvelope } from "@cryptex-industries/vault-core/synchronization-utils";
import { ensureSyncKemKeypair } from "@cryptex-industries/vault-core/vault-utils/post-quantum-kem";
import { ensureSyncSigningKeypair } from "@cryptex-industries/vault-core/vault-utils/sync-signing";
import { LinkedDevices } from "@cryptex-industries/vault-core/vault-utils/vault";
import * as syncCrypto from "@cryptex-industries/vault-core/vault-utils/sync-crypto";

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

jest.mock("../src/env/public", () => ({
    env: {
        NEXT_PUBLIC_PUSHER_APP_KEY: "test-key",
        NEXT_PUBLIC_PUSHER_APP_HOST: "localhost",
        NEXT_PUBLIC_PUSHER_APP_PORT: "6001",
        NEXT_PUBLIC_PUSHER_APP_TLS: false,
    },
}));

jest.mock("../src/utils/trpc", () => ({
    trpc: {
        v1: {
            device: {
                signalingAuthChannel: {
                    mutate: jest.fn(async () => ({ auth: "stub-auth" })),
                },
                turnCredentials: {
                    mutate: jest.fn(async () => ({ iceServers: [] })),
                },
            },
        },
    },
}));

import { configureTestVaultCoreRuntime } from "./helpers/vault-core-runtime";
import { trpc } from "../src/utils/trpc";

configureTestVaultCoreRuntime({ trpc });

type SyncHandle = {
    resetPeer(deviceID: string): void;
    ensureOutboundSession(
        deviceID: string,
        channel: RTCDataChannel,
    ): Promise<unknown>;
    transmitSyncHello(
        deviceID: string,
        dataChannel: RTCDataChannel,
    ): Promise<void>;
    onDataChannelMessage(
        remoteDeviceID: string,
        dataChannel: RTCDataChannel,
        event: MessageEvent,
    ): Promise<void>;
};

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

type KeySet = {
    local: LinkedDevices;
    remote: LinkedDevices;
};

let keys: KeySet;

beforeAll(async () => {
    keys = {
        local: new LinkedDevices(),
        remote: new LinkedDevices(),
    };
    await ensureSyncSigningKeypair(keys.local);
    await ensureSyncKemKeypair(keys.local);
    await ensureSyncSigningKeypair(keys.remote);
    await ensureSyncKemKeypair(keys.remote);
});

const asArrayBuffer = (bytes: Uint8Array | ArrayBuffer): ArrayBuffer =>
    bytes instanceof ArrayBuffer
        ? bytes
        : (bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer);

const createMessageEvent = (bytes: Uint8Array | ArrayBuffer): MessageEvent =>
    ({ data: asArrayBuffer(bytes) }) as MessageEvent;

const versionVector = (id: string): VaultUtilTypes.VersionVector => ({
    ID: id,
    Hash: `hash-${id}`,
    Version: 1,
    DateModifiedTimestamp: 1,
    Deleted: false,
});

function createOps(
    own: LinkedDevices,
    peer: LinkedDevices,
    vectors: VaultUtilTypes.VersionVector[] = [],
): VaultOperations {
    return {
        getCredentialVersionVectors: jest.fn(async () => vectors),
        getDirectoryVersionVectors: jest.fn(async () => []),
        getItems: jest.fn(async () => ({ Credentials: [], Directories: [] })),
        updateItems: jest.fn(async () => undefined),
        getSynchronizationConfig: jest.fn(async () => own),
        getSyncSigningPublicKey: jest.fn(async () => own.SyncSigningPublicKey),
        getSyncSigningPrivateKey: jest.fn(
            async () => own.SyncSigningPrivateKey,
        ),
        getSyncKemPublicKey: jest.fn(async () => own.SyncKemPublicKey),
        getSyncKemPrivateKey: jest.fn(async () => own.SyncKemPrivateKey),
        getRemoteSyncPublicKey: jest.fn(async () => peer.SyncSigningPublicKey),
        getRemoteSyncKemPublicKey: jest.fn(async () => peer.SyncKemPublicKey),
    };
}

function createPair() {
    const localOps = createOps(keys.local, keys.remote, [
        versionVector("local"),
    ]);
    const remoteOps = createOps(keys.remote, keys.local);
    const localController = new SyncConnectionController(localOps);
    const remoteController = new SyncConnectionController(remoteOps);
    const localSync = (
        localController as unknown as { _vaultItemSynchronization: SyncHandle }
    )._vaultItemSynchronization;
    const remoteSync = (
        remoteController as unknown as { _vaultItemSynchronization: SyncHandle }
    )._vaultItemSynchronization;

    // Channel.send is sync in WebRTC; delivery/handling is async. Track those
    // handlers so tests can drain the full exchange before asserting.
    const pendingDeliveries: Promise<void>[] = [];
    const enqueue = (delivery: Promise<void>) => {
        pendingDeliveries.push(
            delivery.catch(() => undefined).then(() => undefined),
        );
    };
    const flush = async () => {
        // New sends can enqueue while earlier handlers run (hello → echo → …).
        while (pendingDeliveries.length > 0) {
            const batch = pendingDeliveries.splice(0);
            await Promise.all(batch);
        }
    };

    const localChannel = {
        send: jest.fn((bytes: Uint8Array | ArrayBuffer) => {
            enqueue(
                remoteSync.onDataChannelMessage(
                    "local-device",
                    remoteChannel as unknown as RTCDataChannel,
                    createMessageEvent(bytes),
                ),
            );
        }),
    };
    const remoteChannel = {
        send: jest.fn((bytes: Uint8Array | ArrayBuffer) => {
            enqueue(
                localSync.onDataChannelMessage(
                    "remote-device",
                    localChannel as unknown as RTCDataChannel,
                    createMessageEvent(bytes),
                ),
            );
        }),
    };

    return {
        localOps,
        remoteOps,
        localController,
        remoteController,
        localSync,
        remoteSync,
        localChannel: localChannel as unknown as RTCDataChannel,
        remoteChannel: remoteChannel as unknown as RTCDataChannel,
        localSend: localChannel.send,
        remoteSend: remoteChannel.send,
        flush,
    };
}

describe("VaultItemSynchronization encrypted transport", () => {
    it("does not record completion after a failed save and allows a later retry", async () => {
        const pair = createPair();
        const record = jest.fn(async () => undefined);
        pair.remoteOps.recordSynchronization = record;
        const completed = jest.spyOn(
            pair.remoteController,
            "broadcastWebRTCSynchronizedEvent",
        );
        const updateItems = jest
            .spyOn(pair.remoteOps, "updateItems")
            .mockRejectedValueOnce(new Error("Storage unavailable"));

        await pair.localSync.transmitSyncHello(
            "remote-device",
            pair.localChannel,
        );
        await pair.flush();
        expect(updateItems).toHaveBeenCalledTimes(1);
        expect(record).not.toHaveBeenCalled();
        expect(completed).not.toHaveBeenCalled();

        await pair.localSync.transmitSyncHello(
            "remote-device",
            pair.localChannel,
        );
        await pair.flush();
        expect(updateItems).toHaveBeenCalledTimes(2);
        expect(record).toHaveBeenCalledTimes(1);
        expect(completed).toHaveBeenCalledTimes(1);
    });

    it("does not publish a handshake that finishes after disconnect", async () => {
        const pair = createPair();
        const entered = deferred();
        const release = deferred();
        const derive = syncCrypto.deriveAeadKey;
        const spy = jest
            .spyOn(syncCrypto, "deriveAeadKey")
            .mockImplementationOnce(async (...args) => {
                entered.resolve();
                await release.promise;
                return derive(...args);
            });
        try {
            const pending = pair.localSync.ensureOutboundSession(
                "remote-device",
                pair.localChannel,
            );
            expect(
                pair.localSync.ensureOutboundSession(
                    "remote-device",
                    pair.localChannel,
                ),
            ).toBe(pending);
            await entered.promise;
            pair.localSync.resetPeer("remote-device");
            release.resolve();
            await expect(pending).resolves.toBeNull();
            expect(pair.localSend).not.toHaveBeenCalled();
        } finally {
            release.resolve();
            spy.mockRestore();
        }
    });

    it("drops in-flight and queued ciphertext after disconnect", async () => {
        const pair = createPair();
        await pair.localSync.transmitSyncHello(
            "remote-device",
            pair.localChannel,
        );
        await pair.flush();
        pair.localSend.mockClear();
        const entered = deferred();
        const release = deferred();
        const seal = syncCrypto.sealAead;
        const spy = jest
            .spyOn(syncCrypto, "sealAead")
            .mockImplementationOnce(async (...args) => {
                entered.resolve();
                await release.promise;
                return seal(...args);
            });
        try {
            const sends = [
                pair.localSync.transmitSyncHello(
                    "remote-device",
                    pair.localChannel,
                ),
                pair.localSync.transmitSyncHello(
                    "remote-device",
                    pair.localChannel,
                ),
            ];
            await entered.promise;
            pair.localSync.resetPeer("remote-device");
            pair.remoteSync.resetPeer("local-device");
            release.resolve();
            await Promise.all(sends);
            expect(pair.localSend).not.toHaveBeenCalled();
            await pair.localSync.transmitSyncHello(
                "remote-device",
                pair.localChannel,
            );
            await pair.flush();
            expect(pair.localSend).toHaveBeenCalled();
        } finally {
            release.resolve();
            spy.mockRestore();
        }
    });

    it("recovers from a synchronous handshake send failure", async () => {
        const pair = createPair();
        pair.localSend.mockImplementationOnce(() => {
            throw new Error("channel closed");
        });
        await expect(
            pair.localSync.ensureOutboundSession(
                "remote-device",
                pair.localChannel,
            ),
        ).rejects.toThrow("channel closed");
        await pair.localSync.transmitSyncHello(
            "remote-device",
            pair.localChannel,
        );
        await pair.flush();
        expect(pair.localSend.mock.calls.length).toBeGreaterThan(2);
    });

    it("converges on one session when both devices sync concurrently", async () => {
        const pair = createPair();
        const localError = jest.spyOn(
            pair.localController,
            "broadcastWebRTCSyncErrorEvent",
        );
        const remoteError = jest.spyOn(
            pair.remoteController,
            "broadcastWebRTCSyncErrorEvent",
        );
        await Promise.all([
            pair.localSync.transmitSyncHello(
                "remote-device",
                pair.localChannel,
            ),
            pair.remoteSync.transmitSyncHello(
                "local-device",
                pair.remoteChannel,
            ),
            pair.localSync.transmitSyncHello(
                "remote-device",
                pair.localChannel,
            ),
        ]);
        await pair.flush();
        const messages = [
            ...pair.localSend.mock.calls,
            ...pair.remoteSend.mock.calls,
        ]
            .map((call) =>
                VaultUtilTypes.SynchronizationEnvelope.decode(
                    new Uint8Array(call[0] as ArrayBuffer),
                ),
            )
            .filter(
                (message) =>
                    message.Command ===
                    VaultUtilTypes.SyncWireMessageCommand.SyncEncryptedMessage,
            );
        expect(messages.length).toBeGreaterThanOrEqual(6);
        expect(new Set(messages.map((message) => message.SessionID)).size).toBe(
            1,
        );
        expect(localError).not.toHaveBeenCalled();
        expect(remoteError).not.toHaveBeenCalled();
    });

    it("starts a fresh session after the previous connection is cleared", async () => {
        const pair = createPair();
        await pair.localSync.transmitSyncHello(
            "remote-device",
            pair.localChannel,
        );
        await pair.flush();
        const firstSession = VaultUtilTypes.SynchronizationEnvelope.decode(
            new Uint8Array(pair.localSend.mock.calls[0]![0] as ArrayBuffer),
        ).SessionID;
        pair.localSync.resetPeer("remote-device");
        pair.remoteSync.resetPeer("local-device");
        pair.localSend.mockClear();
        await pair.localSync.transmitSyncHello(
            "remote-device",
            pair.localChannel,
        );
        await pair.flush();
        const nextSession = VaultUtilTypes.SynchronizationEnvelope.decode(
            new Uint8Array(pair.localSend.mock.calls[0]![0] as ArrayBuffer),
        );
        expect(nextSession.Command).toBe(
            VaultUtilTypes.SyncWireMessageCommand.SyncSessionInit,
        );
        expect(nextSession.SessionID).not.toBe(firstSession);
    });

    it("starts an authenticated ML-KEM session before sending sync data", async () => {
        const { localSync, localChannel, localSend } = createPair();

        await localSync.transmitSyncHello("remote-device", localChannel);

        expect(localSend).toHaveBeenCalled();
        const first = VaultUtilTypes.SynchronizationEnvelope.decode(
            new Uint8Array(localSend.mock.calls[0]![0] as ArrayBuffer),
        );
        expect(first.Command).toBe(
            VaultUtilTypes.SyncWireMessageCommand.SyncSessionInit,
        );
        expect(first.KemCiphertext.length).toBeGreaterThan(0);
        expect(first.HandshakeSignature.length).toBeGreaterThan(0);

        const encrypted = localSend.mock.calls
            .map((call) =>
                VaultUtilTypes.SynchronizationEnvelope.decode(
                    new Uint8Array(call[0] as ArrayBuffer),
                ),
            )
            .find(
                (message) =>
                    message.Command ===
                    VaultUtilTypes.SyncWireMessageCommand.SyncEncryptedMessage,
            );
        expect(encrypted).toBeDefined();
        expect(encrypted?.Ciphertext.length).toBeGreaterThan(0);
        expect(encrypted?.Ciphertext).not.toEqual(
            expect.arrayContaining(
                Array.from(new TextEncoder().encode("local")),
            ),
        );
    });

    it("rejects plaintext legacy sync messages", async () => {
        const { localController, localSync, localChannel } = createPair();
        const errorSpy = jest
            .spyOn(localController, "broadcastWebRTCSyncErrorEvent")
            .mockImplementation(() => undefined);
        const plaintext = await SynchronizationEnvelope.createSyncHelloMessage([
            versionVector("legacy"),
        ]);

        await localSync.onDataChannelMessage(
            "remote-device",
            localChannel,
            createMessageEvent(plaintext.data),
        );

        expect(errorSpy).toHaveBeenCalledWith("remote-device");
    });

    it("rejects tampered encrypted messages", async () => {
        const {
            localSync,
            remoteSync,
            localChannel,
            remoteChannel,
            localSend,
        } = createPair();
        await localSync.transmitSyncHello("remote-device", localChannel);

        const encrypted = localSend.mock.calls
            .map((call) => new Uint8Array(call[0] as ArrayBuffer))
            .find((bytes) => {
                const envelope =
                    VaultUtilTypes.SynchronizationEnvelope.decode(bytes);
                return (
                    envelope.Command ===
                    VaultUtilTypes.SyncWireMessageCommand.SyncEncryptedMessage
                );
            });
        expect(encrypted).toBeDefined();

        const tampered = new Uint8Array(encrypted!);
        const lastIndex = tampered.length - 1;
        tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 1;

        await expect(
            remoteSync.onDataChannelMessage(
                "local-device",
                remoteChannel,
                createMessageEvent(tampered),
            ),
        ).resolves.toBeUndefined();
    });

    it("rejects replayed encrypted messages by sequence", async () => {
        const {
            localSync,
            remoteSync,
            localChannel,
            remoteChannel,
            localSend,
            remoteSend,
            flush,
        } = createPair();
        await localSync.transmitSyncHello("remote-device", localChannel);
        await flush();

        const encrypted = localSend.mock.calls
            .map((call) => new Uint8Array(call[0] as ArrayBuffer))
            .find((bytes) => {
                const envelope =
                    VaultUtilTypes.SynchronizationEnvelope.decode(bytes);
                return (
                    envelope.Command ===
                    VaultUtilTypes.SyncWireMessageCommand.SyncEncryptedMessage
                );
            });
        expect(encrypted).toBeDefined();
        const sendsBeforeReplay = remoteSend.mock.calls.length;

        await remoteSync.onDataChannelMessage(
            "local-device",
            remoteChannel,
            createMessageEvent(encrypted!),
        );
        await flush();

        expect(remoteSend.mock.calls).toHaveLength(sendsBeforeReplay);
    });
});
