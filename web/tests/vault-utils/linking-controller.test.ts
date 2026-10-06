import { describe, expect, it, beforeAll } from "@jest/globals";
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "util";

import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    decapsulateSyncKem,
    encapsulateSyncKem,
    ensureSyncKemKeypair,
} from "@cryptex-industries/vault-core/vault-utils/post-quantum-kem";
import {
    ensureSyncSigningKeypair,
    signSyncBytes,
    verifySyncBytes,
} from "@cryptex-industries/vault-core/vault-utils/sync-signing";
import {
    buildSyncKeyBundle,
    createLinkMac,
    createNonce,
    deriveAeadKey,
    linkReceiverBundleMacBytes,
    linkSenderHelloMacBytes,
    linkVaultTransferContext,
    openAead,
    sealAead,
    verifyLinkMac,
} from "@cryptex-industries/vault-core/vault-utils/sync-crypto";
import {
    LinkingProcessController,
    LinkingProcessState,
    LinkingProcessStep,
    type LinkingProcessStatus,
} from "@cryptex-industries/vault-core/vault-utils/linking";
import { LinkedDevices } from "@cryptex-industries/vault-core/vault-utils/vault";

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

let sender: LinkedDevices;
let receiver: LinkedDevices;

beforeAll(async () => {
    sender = new LinkedDevices();
    receiver = new LinkedDevices();
    await ensureSyncSigningKeypair(sender);
    await ensureSyncKemKeypair(sender);
    await ensureSyncSigningKeypair(receiver);
    await ensureSyncKemKeypair(receiver);
});

describe("encrypted link protocol", () => {
    it("binds receiver key bundle to sender bundle and mnemonic MAC", async () => {
        const syncID = "sync-id";
        const mnemonic = "test mnemonic";
        const senderBundle = buildSyncKeyBundle(
            sender.SyncSigningPublicKey,
            sender.SyncKemPublicKey,
        );
        const receiverBundle = buildSyncKeyBundle(
            receiver.SyncSigningPublicKey,
            receiver.SyncKemPublicKey,
        );
        const nonce = createNonce();

        const mac = await createLinkMac(
            mnemonic,
            linkReceiverBundleMacBytes(
                syncID,
                senderBundle,
                receiverBundle,
                nonce,
            ),
        );
        const swappedSender = buildSyncKeyBundle(
            sender.SyncSigningPublicKey,
            receiver.SyncKemPublicKey,
        );
        const swappedMac = await createLinkMac(
            mnemonic,
            linkReceiverBundleMacBytes(
                syncID,
                swappedSender,
                receiverBundle,
                nonce,
            ),
        );

        expect(mac).not.toEqual(swappedMac);
    });

    it("authenticates and encrypts the vault transfer", async () => {
        const syncID = "sync-id";
        const senderBundle = buildSyncKeyBundle(
            sender.SyncSigningPublicKey,
            sender.SyncKemPublicKey,
        );
        const receiverBundle = buildSyncKeyBundle(
            receiver.SyncSigningPublicKey,
            receiver.SyncKemPublicKey,
        );
        const plaintext = VaultUtilTypes.Vault.encode({
            Version: 1,
            CurrentVersion: 1,
            LinkedDevices: new LinkedDevices(),
            Directories: [],
            Credentials: [],
            OnlineServices: undefined,
        }).finish();

        const { kemCiphertext, sharedSecret } = encapsulateSyncKem(
            receiverBundle.SyncKemPublicKey,
        );
        const context = linkVaultTransferContext(
            syncID,
            senderBundle,
            receiverBundle,
            kemCiphertext,
        );
        const senderKey = await deriveAeadKey(sharedSecret, context);
        const sealed = await sealAead(senderKey, plaintext, context);
        const handshakeSignature = await signSyncBytes(
            sender.SyncSigningPrivateKey,
            context,
        );
        const transfer = VaultUtilTypes.LinkVaultTransfer.decode(
            VaultUtilTypes.LinkVaultTransfer.encode({
                KemCiphertext: kemCiphertext,
                Nonce: sealed.nonce,
                Ciphertext: sealed.ciphertext,
                HandshakeSignature: handshakeSignature,
            }).finish(),
        );

        const receiverSecret = decapsulateSyncKem(
            transfer.KemCiphertext,
            receiver.SyncKemPrivateKey,
        );
        const receiverKey = await deriveAeadKey(receiverSecret, context);
        const opened = await openAead(
            receiverKey,
            {
                nonce: transfer.Nonce,
                ciphertext: transfer.Ciphertext,
            },
            context,
        );

        await expect(
            verifySyncBytes(
                sender.SyncSigningPublicKey,
                transfer.HandshakeSignature,
                context,
            ),
        ).resolves.toBe(true);
        expect(Array.from(opened)).toEqual(Array.from(plaintext));
        const tamperedCiphertext = new Uint8Array(sealed.ciphertext);
        tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 1;
        await expect(
            openAead(
                receiverKey,
                {
                    nonce: sealed.nonce,
                    ciphertext: tamperedCiphertext,
                },
                context,
            ),
        ).rejects.toHaveProperty("name", "OperationError");

        const attackerBundle = buildSyncKeyBundle(
            receiver.SyncSigningPublicKey,
            sender.SyncKemPublicKey,
        );
        const wrongContext = linkVaultTransferContext(
            syncID,
            attackerBundle,
            receiverBundle,
            kemCiphertext,
        );
        await expect(
            openAead(receiverKey, sealed, wrongContext),
        ).rejects.toHaveProperty("name", "OperationError");

        const forgedSignature = await signSyncBytes(
            receiver.SyncSigningPrivateKey,
            context,
        );
        await expect(
            verifySyncBytes(
                sender.SyncSigningPublicKey,
                forgedSignature,
                context,
            ),
        ).resolves.toBe(false);
    });

    it("rejects an unsigned vault transfer before exposing vault data", async () => {
        const syncID = "sync-id";
        const senderBundle = buildSyncKeyBundle(
            sender.SyncSigningPublicKey,
            sender.SyncKemPublicKey,
        );
        const statuses: LinkingProcessStatus[] = [];
        const webRTCConnection = {
            close: () => undefined,
        } as unknown as RTCPeerConnection;
        const controller = Reflect.construct(LinkingProcessController, [
            {
                SyncID: syncID,
                OnlineServices: undefined,
                STUNServers: [],
                TURNServers: [],
                SignalingServer: undefined,
                SenderKeyBundle: senderBundle,
            },
            false,
            {
                signingPublicKey: receiver.SyncSigningPublicKey,
                signingPrivateKey: receiver.SyncSigningPrivateKey,
                kemPublicKey: receiver.SyncKemPublicKey,
                kemPrivateKey: receiver.SyncKemPrivateKey,
            },
            "test mnemonic",
            async (status: LinkingProcessStatus) => {
                statuses.push(status);
            },
            { disconnect: () => undefined, unbind: () => undefined },
            {},
            webRTCConnection,
        ]);
        Reflect.set(controller, "receiverKeyBundleSent", true);
        Reflect.set(controller, "senderKeyBundle", senderBundle);
        Reflect.apply(
            Reflect.get(controller, "bindWebRTCConnection"),
            controller,
            [],
        );

        const receiveChannel = {
            send: () => undefined,
        } as unknown as RTCDataChannel;
        webRTCConnection.ondatachannel!.call(webRTCConnection, {
            channel: receiveChannel,
        } as RTCDataChannelEvent);
        await receiveChannel.onmessage!.call(receiveChannel, {
            data: VaultUtilTypes.LinkVaultTransfer.encode({
                KemCiphertext: createNonce(),
                Nonce: createNonce(),
                Ciphertext: createNonce(),
                HandshakeSignature: new Uint8Array(),
            }).finish(),
        } as MessageEvent);

        expect(statuses).toContainEqual(
            expect.objectContaining({
                Step: LinkingProcessStep.VaultTransfer,
                State: LinkingProcessState.Error,
                LogMessage: expect.objectContaining({
                    message:
                        "Vault transfer could not be authenticated. Update the sending device and try again.",
                }),
            }),
        );
        expect(statuses.some((status) => status.VaultBinaryData)).toBe(false);
        expect(
            statuses.some(
                (status) => status.Step === LinkingProcessStep.VaultSave,
            ),
        ).toBe(false);
    });

    it("authenticates sender hello with mnemonic MAC", async () => {
        const syncID = "sync-id";
        const mnemonic = "test mnemonic";
        const senderBundle = buildSyncKeyBundle(
            sender.SyncSigningPublicKey,
            sender.SyncKemPublicKey,
        );
        const nonce = createNonce();
        const mac = await createLinkMac(
            mnemonic,
            linkSenderHelloMacBytes(syncID, senderBundle, nonce),
        );

        const hello = VaultUtilTypes.LinkSenderHello.encode({
            Nonce: nonce,
            Mac: mac,
        }).finish();
        const decoded = VaultUtilTypes.LinkSenderHello.decode(hello);
        const attackerBundle = buildSyncKeyBundle(
            receiver.SyncSigningPublicKey,
            receiver.SyncKemPublicKey,
        );

        expect(Array.from(decoded.Mac)).toEqual(Array.from(mac));
        await expect(
            verifyLinkMac(
                mnemonic,
                linkSenderHelloMacBytes(syncID, senderBundle, decoded.Nonce),
                decoded.Mac,
            ),
        ).resolves.toBe(true);
        await expect(
            verifyLinkMac(
                "wrong mnemonic",
                linkSenderHelloMacBytes(syncID, senderBundle, decoded.Nonce),
                decoded.Mac,
            ),
        ).resolves.toBe(false);
        await expect(
            verifyLinkMac(
                mnemonic,
                linkSenderHelloMacBytes(
                    "wrong-sync-id",
                    senderBundle,
                    decoded.Nonce,
                ),
                decoded.Mac,
            ),
        ).resolves.toBe(false);
        await expect(
            verifyLinkMac(
                mnemonic,
                linkSenderHelloMacBytes(syncID, attackerBundle, decoded.Nonce),
                decoded.Mac,
            ),
        ).resolves.toBe(false);
    });

    it("does not carry sender public keys in sender hello", async () => {
        const senderBundle = buildSyncKeyBundle(
            sender.SyncSigningPublicKey,
            sender.SyncKemPublicKey,
        );
        const encodedSenderBundle =
            VaultUtilTypes.SyncKeyBundle.encode(senderBundle).finish();
        const hello = VaultUtilTypes.LinkSenderHello.encode({
            Nonce: createNonce(),
            Mac: createNonce(),
        }).finish();

        expect(
            Buffer.from(hello).includes(Buffer.from(encodedSenderBundle)),
        ).toBe(false);
    });
});
