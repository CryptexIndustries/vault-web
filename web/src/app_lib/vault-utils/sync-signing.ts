import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import * as VaultUtilTypes from "../proto/vault";
import type { LinkedDevices } from "./vault";

export const LINK_SYNC_KEY_MESSAGE_TYPE = "sync-signing-public-key" as const;

export function syncEnvelopeSignableBytes(
    id: string,
    command: VaultUtilTypes.VaultItemSynchronizationMessageCommand,
    payload: Uint8Array,
): Uint8Array {
    return VaultUtilTypes.SynchronizationEnvelope.encode({
        ID: id,
        Command: command,
        Payload: payload,
        Signature: new Uint8Array(),
    }).finish();
}

export async function ensureSyncSigningKeypair(
    linkedDevices: LinkedDevices,
): Promise<boolean> {
    if (hasValidSyncSigningKeypair(linkedDevices)) {
        return false;
    }

    const { publicKey, secretKey } = ml_dsa65.keygen();
    linkedDevices.SyncSigningPublicKey = bytesToBase64Url(publicKey);
    linkedDevices.SyncSigningPrivateKey = bytesToBase64Url(secretKey);
    return true;
}

export async function signSyncEnvelopeFields(
    privateKey: string,
    id: string,
    command: VaultUtilTypes.VaultItemSynchronizationMessageCommand,
    payload: Uint8Array,
): Promise<Uint8Array> {
    const signable = syncEnvelopeSignableBytes(id, command, payload);
    return ml_dsa65.sign(signable, base64UrlToBytes(privateKey));
}

export async function verifySyncEnvelopeFields(
    publicKey: string,
    id: string,
    command: VaultUtilTypes.VaultItemSynchronizationMessageCommand,
    payload: Uint8Array,
    signature: Uint8Array,
): Promise<boolean> {
    if (!publicKey || signature.length === 0) {
        return false;
    }

    try {
        const publicKeyBytes = base64UrlToBytes(publicKey);
        if (
            publicKeyBytes.length !== ml_dsa65.lengths.publicKey ||
            signature.length !== ml_dsa65.lengths.signature
        ) {
            return false;
        }

        const signable = syncEnvelopeSignableBytes(id, command, payload);
        return ml_dsa65.verify(signature, signable, publicKeyBytes);
    } catch {
        return false;
    }
}

export function encodeLinkSyncKeyMessage(publicKey: string): Uint8Array {
    return new TextEncoder().encode(
        JSON.stringify({
            type: LINK_SYNC_KEY_MESSAGE_TYPE,
            publicKey: publicKey,
        }),
    );
}

export function parseLinkSyncKeyMessage(data: ArrayBuffer): string | null {
    try {
        const text = new TextDecoder().decode(new Uint8Array(data));
        const parsed = JSON.parse(text) as {
            type?: string;
            publicKey?: string;
        };
        if (
            parsed.type === LINK_SYNC_KEY_MESSAGE_TYPE &&
            typeof parsed.publicKey === "string" &&
            parsed.publicKey.length > 0
        ) {
            return parsed.publicKey;
        }
    } catch {
        return null;
    }
    return null;
}

export function isLinkSyncKeyMessage(data: ArrayBuffer): boolean {
    return parseLinkSyncKeyMessage(data) != null;
}

function hasValidSyncSigningKeypair(linkedDevices: LinkedDevices): boolean {
    try {
        return (
            base64UrlToBytes(linkedDevices.SyncSigningPublicKey).length ===
                ml_dsa65.lengths.publicKey &&
            base64UrlToBytes(linkedDevices.SyncSigningPrivateKey).length ===
                ml_dsa65.lengths.secretKey
        );
    } catch {
        return false;
    }
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function base64UrlToBytes(base64Url: string): Uint8Array {
    const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const base64 = pad ? padded + "=".repeat(4 - pad) : padded;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
