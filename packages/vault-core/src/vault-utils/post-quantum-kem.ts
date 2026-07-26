import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { base64UrlToUint8, uint8ToBase64Url } from "../encoding";
import type { LinkedDevices } from "./vault";

export async function ensureSyncKemKeypair(
    linkedDevices: LinkedDevices,
): Promise<boolean> {
    if (hasValidSyncKemKeypair(linkedDevices)) {
        return false;
    }

    const { publicKey, secretKey } = ml_kem768.keygen();
    linkedDevices.SyncKemPublicKey = uint8ToBase64Url(publicKey);
    linkedDevices.SyncKemPrivateKey = uint8ToBase64Url(secretKey);
    return true;
}

export function encapsulateSyncKem(publicKey: string): {
    kemCiphertext: Uint8Array;
    sharedSecret: Uint8Array;
} {
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(
        base64UrlToUint8(publicKey),
    );
    return { kemCiphertext: cipherText, sharedSecret };
}

export function decapsulateSyncKem(
    kemCiphertext: Uint8Array,
    privateKey: string,
): Uint8Array {
    return ml_kem768.decapsulate(kemCiphertext, base64UrlToUint8(privateKey));
}

export function isValidSyncKemPublicKey(publicKey: string): boolean {
    try {
        return (
            base64UrlToUint8(publicKey).length === ml_kem768.lengths.publicKey
        );
    } catch {
        return false;
    }
}

function hasValidSyncKemKeypair(linkedDevices: LinkedDevices): boolean {
    try {
        return (
            base64UrlToUint8(linkedDevices.SyncKemPublicKey).length ===
                ml_kem768.lengths.publicKey &&
            base64UrlToUint8(linkedDevices.SyncKemPrivateKey).length ===
                ml_kem768.lengths.secretKey
        );
    } catch {
        return false;
    }
}
