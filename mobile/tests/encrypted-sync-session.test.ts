import { expect, it, jest } from "@jest/globals";
import * as syncCrypto from "@cryptex-industries/vault-core/vault-utils/sync-crypto";
import {
    SyncConnectionController,
    type VaultOperations,
} from "@cryptex-industries/vault-core/synchronization";
import {
    SynchronizationEnvelope,
    VaultItemSynchronizationMessageCommand,
} from "@cryptex-industries/vault-core/proto";

// Exercise the real handshake state machine and AES-GCM; replace only asymmetric
// primitives so races are deterministic and tests do not generate expensive keys.
jest.mock(
    "@cryptex-industries/vault-core/vault-utils/post-quantum-kem",
    () => ({
        encapsulateSyncKem: () => ({
            kemCiphertext: new Uint8Array(32),
            sharedSecret: new Uint8Array(32),
        }),
        decapsulateSyncKem: () => new Uint8Array(32),
    }),
);
jest.mock("@cryptex-industries/vault-core/vault-utils/sync-signing", () => ({
    signSyncBytes: async () => new Uint8Array(64),
    verifySyncBytes: async () => true,
}));
jest.mock("@cryptex-industries/vault-core/runtime", () => {
    const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
    return {
        getVaultCoreRuntime: () => ({
            syncLog: logger,
            signalingLog: logger,
            webrtcLog: logger,
        }),
    };
});

type Session = { sessionID: string; ready: boolean };
type Engine = {
    ensureOutboundSession: (
        id: string,
        channel: RTCDataChannel,
    ) => Promise<Session>;
    onDataChannelMessage: (
        id: string,
        channel: RTCDataChannel,
        event: MessageEvent,
    ) => Promise<void>;
    resetPeer: (id: string) => void;
    syncSessions: Map<string, Session>;
    sendEncryptedPlaintextMessage: (
        id: string,
        channel: RTCDataChannel,
        envelopeId: string,
        command: number,
        bytes: Uint8Array,
    ) => Promise<boolean>;
};

function engine(local: string, remote: string): Engine {
    const operations = {
        getSyncSigningPublicKey: async () => local,
        getSyncSigningPrivateKey: async () => `private-${local}`,
        getSyncKemPublicKey: async () => `kem-${local}`,
        getSyncKemPrivateKey: async () => `kem-private-${local}`,
        getRemoteSyncPublicKey: async () => remote,
        getRemoteSyncKemPublicKey: async () => `kem-${remote}`,
    } as unknown as VaultOperations;
    return (
        new SyncConnectionController(operations) as unknown as {
            _vaultItemSynchronization: Engine;
        }
    )._vaultItemSynchronization;
}

function peers() {
    const a = engine("a", "b");
    const b = engine("b", "a");
    const errors: unknown[] = [];
    const sent: SynchronizationEnvelope[] = [];
    const toA = {
        readyState: "open",
        send: (data: ArrayBuffer) => {
            sent.push(SynchronizationEnvelope.decode(new Uint8Array(data)));
            void a
                .onDataChannelMessage("b", toB, { data } as MessageEvent)
                .catch((e) => errors.push(e));
        },
    } as RTCDataChannel;
    const toB = {
        readyState: "open",
        send: (data: ArrayBuffer) => {
            sent.push(SynchronizationEnvelope.decode(new Uint8Array(data)));
            void b
                .onDataChannelMessage("a", toA, { data } as MessageEvent)
                .catch((e) => errors.push(e));
        },
    } as RTCDataChannel;
    return { a, b, toA, toB, errors, sent };
}

it("simultaneous initiators converge on one authenticated session", async () => {
    const { a, b, toA, toB, errors } = peers();
    try {
        const [left, right] = await Promise.all([
            a.ensureOutboundSession("b", toB),
            b.ensureOutboundSession("a", toA),
        ]);
        expect(left.ready).toBe(true);
        expect(right.ready).toBe(true);
        expect(left.sessionID).toBe(right.sessionID);
        expect(errors).toEqual([]);
    } finally {
        a.resetPeer("b");
        b.resetPeer("a");
    }
});

it("deduplicates outbound handshakes and forgets the encryption session on disconnect", async () => {
    const { a, b, toB, errors } = peers();
    const first = a.ensureOutboundSession("b", toB);
    expect(a.ensureOutboundSession("b", toB)).toBe(first);
    const previous = await first;
    a.resetPeer("b");
    b.resetPeer("a");
    expect(a.syncSessions.size).toBe(0);
    const next = await a.ensureOutboundSession("b", toB);
    expect(next.sessionID).not.toBe(previous.sessionID);
    expect(errors).toEqual([]);
    a.resetPeer("b");
    b.resetPeer("a");
});

it("preserves wire order when the first concurrent encryption is slow", async () => {
    const { a, b, toB } = peers();
    await a.ensureOutboundSession("b", toB);
    const packets: SynchronizationEnvelope[] = [];
    const channel = {
        send: (data: ArrayBuffer) =>
            packets.push(SynchronizationEnvelope.decode(new Uint8Array(data))),
    } as unknown as RTCDataChannel;
    const seal = syncCrypto.sealAead;
    const spy = jest
        .spyOn(syncCrypto, "sealAead")
        .mockImplementationOnce(async (...args) => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return seal(...args);
        });
    try {
        await Promise.all(
            ["one", "two"].map((id) =>
                a.sendEncryptedPlaintextMessage(
                    "b",
                    channel,
                    id,
                    VaultItemSynchronizationMessageCommand.SyncHello,
                    new Uint8Array(),
                ),
            ),
        );
        expect(packets.map((packet) => packet.Sequence)).toEqual([1, 2]);
    } finally {
        spy.mockRestore();
        a.resetPeer("b");
        b.resetPeer("a");
    }
});
