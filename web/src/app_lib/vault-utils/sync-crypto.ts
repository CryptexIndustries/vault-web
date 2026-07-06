import { ulid } from "ulidx";
import * as VaultUtilTypes from "../proto/vault";

export const SYNC_PROTOCOL_VERSION = 1;
export const AES_GCM_NONCE_BYTES = 12;

export type AeadSealed = {
    nonce: Uint8Array;
    ciphertext: Uint8Array;
};

export type SyncKeyPair = {
    signingPublicKey: string;
    signingPrivateKey: string;
    kemPublicKey: string;
    kemPrivateKey: string;
};

export function createSessionId(): string {
    return ulid();
}

export function createNonce(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_BYTES));
}

export function buildSyncKeyBundle(
    signingPublicKey: string,
    kemPublicKey: string,
): VaultUtilTypes.SyncKeyBundle {
    return {
        SyncSigningPublicKey: signingPublicKey,
        SyncKemPublicKey: kemPublicKey,
    };
}

export function encodeSyncKeyBundle(
    bundle: VaultUtilTypes.SyncKeyBundle,
): Uint8Array {
    return VaultUtilTypes.SyncKeyBundle.encode(bundle).finish();
}

export function encodeSyncPlaintextMessage(
    id: string,
    command: VaultUtilTypes.VaultItemSynchronizationMessageCommand,
    payload: Uint8Array,
): Uint8Array {
    return VaultUtilTypes.SyncPlaintextMessage.encode({
        ID: id,
        Command: command,
        Payload: payload,
    }).finish();
}

export function syncSessionInitTranscript(
    sessionId: string,
    initiatorBundle: VaultUtilTypes.SyncKeyBundle,
    responderBundle: VaultUtilTypes.SyncKeyBundle,
    kemCiphertext: Uint8Array,
): Uint8Array {
    return concatBytes(
        utf8("cryptex/sync/session-init/v1"),
        utf8(sessionId),
        encodeSyncKeyBundle(initiatorBundle),
        encodeSyncKeyBundle(responderBundle),
        kemCiphertext,
    );
}

export function syncSessionAcceptTranscript(
    sessionId: string,
    initiatorBundle: VaultUtilTypes.SyncKeyBundle,
    responderBundle: VaultUtilTypes.SyncKeyBundle,
    kemCiphertext: Uint8Array,
): Uint8Array {
    return concatBytes(
        utf8("cryptex/sync/session-accept/v1"),
        syncSessionInitTranscript(
            sessionId,
            initiatorBundle,
            responderBundle,
            kemCiphertext,
        ),
    );
}

export function syncMessageAad(
    sessionId: string,
    envelopeId: string,
    sequence: number,
    senderDeviceId: string,
    recipientDeviceId: string,
    transcriptHash: Uint8Array,
): Uint8Array {
    return concatBytes(
        utf8("cryptex/sync/message/v1"),
        utf8(String(SYNC_PROTOCOL_VERSION)),
        utf8(
            String(VaultUtilTypes.SyncWireMessageCommand.SyncEncryptedMessage),
        ),
        utf8(sessionId),
        utf8(envelopeId),
        utf8(String(sequence)),
        utf8(senderDeviceId),
        utf8(recipientDeviceId),
        transcriptHash,
    );
}

export function linkSenderHelloMacBytes(
    syncId: string,
    packageSenderBundle: VaultUtilTypes.SyncKeyBundle,
    nonce: Uint8Array,
): Uint8Array {
    return concatBytes(
        utf8("cryptex/link/sender-hello/v1"),
        utf8(syncId),
        encodeSyncKeyBundle(packageSenderBundle),
        nonce,
    );
}

export function linkReceiverBundleMacBytes(
    syncId: string,
    senderBundle: VaultUtilTypes.SyncKeyBundle,
    receiverBundle: VaultUtilTypes.SyncKeyBundle,
    nonce: Uint8Array,
): Uint8Array {
    return concatBytes(
        utf8("cryptex/link/receiver-bundle/v1"),
        utf8(syncId),
        encodeSyncKeyBundle(senderBundle),
        encodeSyncKeyBundle(receiverBundle),
        nonce,
    );
}

export function linkVaultTransferContext(
    syncId: string,
    senderBundle: VaultUtilTypes.SyncKeyBundle,
    receiverBundle: VaultUtilTypes.SyncKeyBundle,
    kemCiphertext: Uint8Array,
): Uint8Array {
    return concatBytes(
        utf8("cryptex/link/vault-transfer/v1"),
        utf8(syncId),
        encodeSyncKeyBundle(senderBundle),
        encodeSyncKeyBundle(receiverBundle),
        kemCiphertext,
    );
}

export async function deriveAeadKey(
    sharedSecret: Uint8Array,
    context: Uint8Array,
): Promise<CryptoKey> {
    const baseKey = await crypto.subtle.importKey(
        "raw",
        toArrayBuffer(sharedSecret),
        "HKDF",
        false,
        ["deriveKey"],
    );
    const contextHash = await sha256(context);
    return crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: toArrayBuffer(contextHash),
            info: toArrayBuffer(
                concatBytes(utf8("cryptex/aead/v1"), contextHash),
            ),
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
    );
}

export async function sealAead(
    key: CryptoKey,
    plaintext: Uint8Array,
    aad: Uint8Array,
): Promise<AeadSealed> {
    const nonce = createNonce();
    const encrypted = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: toArrayBuffer(nonce),
            additionalData: toArrayBuffer(aad),
        },
        key,
        toArrayBuffer(plaintext),
    );
    return { nonce, ciphertext: new Uint8Array(encrypted) };
}

export async function openAead(
    key: CryptoKey,
    sealed: AeadSealed,
    aad: Uint8Array,
): Promise<Uint8Array> {
    const decrypted = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: toArrayBuffer(sealed.nonce),
            additionalData: toArrayBuffer(aad),
        },
        key,
        toArrayBuffer(sealed.ciphertext),
    );
    return new Uint8Array(decrypted);
}

export async function createLinkMac(
    mnemonic: string,
    bytes: Uint8Array,
): Promise<Uint8Array> {
    const key = await importLinkMacKey(mnemonic);
    const mac = await crypto.subtle.sign("HMAC", key, toArrayBuffer(bytes));
    return new Uint8Array(mac);
}

export async function hashTranscript(bytes: Uint8Array): Promise<Uint8Array> {
    return sha256(bytes);
}

export async function verifyLinkMac(
    mnemonic: string,
    bytes: Uint8Array,
    mac: Uint8Array,
): Promise<boolean> {
    const expected = await createLinkMac(mnemonic, bytes);
    return constantTimeEqual(expected, mac);
}

function utf8(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(
        await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes)),
    );
}

async function importLinkMacKey(mnemonic: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        "raw",
        toArrayBuffer(utf8(mnemonic)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a[i]! ^ b[i]!;
    }
    return diff === 0;
}
