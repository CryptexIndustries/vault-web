import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { base64UrlToUint8, uint8ToBase64Url } from "@/lib/utils";
import type { LinkedDevices } from "./vault";

export async function ensureSyncSigningKeypair(
    linkedDevices: LinkedDevices,
): Promise<boolean> {
    if (hasValidSyncSigningKeypair(linkedDevices)) {
        return false;
    }

    const { publicKey, secretKey } = ml_dsa65.keygen();
    linkedDevices.SyncSigningPublicKey = uint8ToBase64Url(publicKey);
    linkedDevices.SyncSigningPrivateKey = uint8ToBase64Url(secretKey);
    return true;
}

export async function signSyncBytes(
    privateKey: string,
    bytes: Uint8Array,
): Promise<Uint8Array> {
    return ml_dsa65.sign(bytes, base64UrlToUint8(privateKey));
}

export async function verifySyncBytes(
    publicKey: string,
    signature: Uint8Array,
    bytes: Uint8Array,
): Promise<boolean> {
    if (!publicKey || signature.length === 0) {
        return false;
    }

    try {
        const publicKeyBytes = base64UrlToUint8(publicKey);
        if (
            publicKeyBytes.length !== ml_dsa65.lengths.publicKey ||
            signature.length !== ml_dsa65.lengths.signature
        ) {
            return false;
        }

        return ml_dsa65.verify(signature, bytes, publicKeyBytes);
    } catch {
        return false;
    }
}

function hasValidSyncSigningKeypair(linkedDevices: LinkedDevices): boolean {
    try {
        return (
            base64UrlToUint8(linkedDevices.SyncSigningPublicKey).length ===
                ml_dsa65.lengths.publicKey &&
            base64UrlToUint8(linkedDevices.SyncSigningPrivateKey).length ===
                ml_dsa65.lengths.secretKey
        );
    } catch {
        return false;
    }
}
