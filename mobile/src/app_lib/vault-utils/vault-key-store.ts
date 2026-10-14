/**
 * Device-bound additional key protection storage. Never synced.
 * Stores raw HKDF IKM bytes because enrollment CryptoKeys are non-extractable.
 */

import * as SecureStore from "expo-secure-store";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import type { VaultHkdfKey } from "@cryptex-industries/vault-core/envelope-crypto";
import { importHkdfBaseKey } from "@cryptex-industries/vault-core/vault-utils/envelope-encryption";
import {
    base64ToUint8,
    uint8ToBase64,
} from "@cryptex-industries/vault-core/encoding";

type StoredAdditionalKeyProtection = {
    vaultDbIndex: number;
    kind: VaultUtilTypes.AdditionalKeyProtectionKind;
    /** Base64 raw HKDF IKM (32 bytes). */
    protectionIkmb64: string | null;
    webauthnCredentialId?: string;
    webauthnPrfSalt?: string;
};

const secureKey = (vaultDbIndex: number) =>
    `cryptex.device-akp.${vaultDbIndex}`;

export async function setDeviceAdditionalKeyProtectionRawKey(
    vaultDbIndex: number,
    protectionIkm: Uint8Array,
    kind: VaultUtilTypes.AdditionalKeyProtectionKind,
    webauthnCredentialId?: string,
    webauthnPrfSalt?: string,
): Promise<void> {
    const stored: StoredAdditionalKeyProtection = {
        vaultDbIndex,
        kind,
        protectionIkmb64: uint8ToBase64(protectionIkm),
        webauthnCredentialId,
        webauthnPrfSalt,
    };

    await SecureStore.setItemAsync(
        secureKey(vaultDbIndex),
        JSON.stringify(stored),
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
}

export async function setDeviceAdditionalKeyProtectionKey(
    vaultDbIndex: number,
    protectionHkdfKey: VaultHkdfKey | null,
    kind: VaultUtilTypes.AdditionalKeyProtectionKind,
    webauthnCredentialId?: string,
    webauthnPrfSalt?: string,
): Promise<void> {
    if (!protectionHkdfKey) {
        await SecureStore.setItemAsync(
            secureKey(vaultDbIndex),
            JSON.stringify({
                vaultDbIndex,
                kind,
                protectionIkmb64: null,
                webauthnCredentialId,
                webauthnPrfSalt,
            } satisfies StoredAdditionalKeyProtection),
            { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
        );
        return;
    }

    throw new Error(
        "Cannot persist an opaque additional key protection key. " +
            "Use setDeviceAdditionalKeyProtectionRawKey with the source IKM.",
    );
}

export async function getDeviceAdditionalKeyProtectionKey(
    vaultDbIndex: number,
): Promise<VaultHkdfKey | null> {
    const raw = await SecureStore.getItemAsync(secureKey(vaultDbIndex));
    if (!raw) return null;

    const stored = JSON.parse(raw) as StoredAdditionalKeyProtection;
    if (!stored.protectionIkmb64) return null;
    const protectionIkm = base64ToUint8(stored.protectionIkmb64);
    try {
        return await importHkdfBaseKey(protectionIkm);
    } finally {
        protectionIkm.fill(0);
    }
}

export async function clearDeviceAdditionalKeyProtection(
    vaultDbIndex: number,
): Promise<void> {
    await SecureStore.deleteItemAsync(secureKey(vaultDbIndex));
}
