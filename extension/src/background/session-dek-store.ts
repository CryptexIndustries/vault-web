/**
 * Extension-only DEK session store.
 *
 * Keep this file under `extension/src`: it depends on `chrome.storage.session`
 * and must not be imported by the web app. The stored raw key is memory-backed
 * browser-session state, not IndexedDB/local disk state.
 */

import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    base64ToUint8,
    uint8ToBase64,
} from "@cryptex-industries/vault-core/encoding";
import { isPrimarySlot } from "@cryptex-industries/vault-core/vault-utils/encryption";
import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    isEnvelopeBlob,
    openPrimarySlot,
} from "@cryptex-industries/vault-core/vault-utils/envelope-encryption";
import { resolveAdditionalKeyProtectionForUnlock } from "@cryptex-industries/vault-core/vault-utils/additional-key-protection";
import type { VaultMetadata } from "@/app_lib/vault-utils/storage";
import { setDeviceAdditionalKeyProtectionKey } from "@/app_lib/vault-utils/vault-key-store";

const STORAGE_PREFIX = "SESSION_DEK:";
const AES_GCM_256_BYTES = 32;

type StoredSessionDEK = {
    v: 1;
    alg: "AES-GCM-256";
    rawB64: string;
    storedAt: number;
};

type SessionStorageWithAccessLevel = chrome.storage.StorageArea & {
    setAccessLevel?: (details: {
        accessLevel: "TRUSTED_CONTEXTS";
    }) => Promise<void>;
};

type SessionDEKUnlockParams = {
    masterPassword: string;
    protectionPhrase?: string;
};

let accessLevelPromise: Promise<void> | null = null;

const storageKey = (vaultDbIndex: number): string =>
    `${STORAGE_PREFIX}${vaultDbIndex}`;

const isStoredSessionDEK = (value: unknown): value is StoredSessionDEK => {
    if (!value || typeof value !== "object") return false;
    const rec = value as Partial<StoredSessionDEK>;
    return (
        rec.v === 1 &&
        rec.alg === "AES-GCM-256" &&
        typeof rec.rawB64 === "string" &&
        typeof rec.storedAt === "number"
    );
};

async function ensureTrustedContextOnly(): Promise<void> {
    if (!accessLevelPromise) {
        accessLevelPromise = (async () => {
            const session = chrome.storage
                .session as SessionStorageWithAccessLevel;
            await session.setAccessLevel?.({
                accessLevel: "TRUSTED_CONTEXTS",
            });
        })();
    }
    await accessLevelPromise;
}

async function deriveExtractableSessionDEK(
    vaultDbIndex: number,
    metadata: VaultMetadata,
    params: SessionDEKUnlockParams,
): Promise<CryptoKey> {
    const blob = metadata.Blob;
    if (!blob?.Envelope || !isEnvelopeBlob(blob)) {
        throw new Error("SESSION_DEK_ENVELOPE_MISSING");
    }

    const vaultId = blob.Envelope.VaultID;
    if (!vaultId) {
        throw new Error("SESSION_DEK_VAULT_ID_MISSING");
    }

    const primarySlot = blob.Envelope.Slots.find(isPrimarySlot);
    if (!primarySlot) {
        throw new Error("SESSION_DEK_PRIMARY_SLOT_MISSING");
    }

    if (
        blob.Envelope.PrimaryProtectionKind ===
        VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF
    ) {
        throw new Error("EXTENSION_WEBAUTHN_UNSUPPORTED");
    }

    const protectionKind = blob.Envelope.PrimaryProtectionKind;
    const enteredProtectionPhrase = params.protectionPhrase?.trim();
    const additionalKeyProtectionHkdfBase =
        await resolveAdditionalKeyProtectionForUnlock(
            vaultDbIndex,
            protectionKind,
            {
                protectionPhrase: enteredProtectionPhrase || undefined,
                protectionPhraseSaltB64:
                    primarySlot.ProtectionPhraseSalt || undefined,
                protectionPhraseKdfConfig: new KeyDerivationConfig_Argon2ID(
                    primarySlot.KDFConfigArgon2ID?.memLimit ??
                        KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                    primarySlot.KDFConfigArgon2ID?.opsLimit ??
                        KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
                ),
            },
        );

    const dek = await openPrimarySlot(
        primarySlot,
        params.masterPassword,
        vaultId,
        additionalKeyProtectionHkdfBase,
        true,
    );
    if (dek.isErr()) {
        throw new Error(dek.error);
    }

    if (
        enteredProtectionPhrase &&
        additionalKeyProtectionHkdfBase &&
        (protectionKind ===
            VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128 ||
            protectionKind ===
                VaultUtilTypes.AdditionalKeyProtectionKind
                    .PROTECTION_PHRASE_256)
    ) {
        await setDeviceAdditionalKeyProtectionKey(
            vaultDbIndex,
            additionalKeyProtectionHkdfBase,
            protectionKind,
        ).catch(() => undefined);
    }

    return dek.value;
}

async function setSessionDEK(
    vaultDbIndex: number,
    dek: CryptoKey,
): Promise<void> {
    await ensureTrustedContextOnly();

    const exported = await crypto.subtle.exportKey("raw", dek);
    const raw = new Uint8Array(exported);
    try {
        if (raw.byteLength !== AES_GCM_256_BYTES) {
            throw new Error("INVALID_SESSION_DEK_LENGTH");
        }

        await chrome.storage.session.set({
            [storageKey(vaultDbIndex)]: {
                v: 1,
                alg: "AES-GCM-256",
                rawB64: uint8ToBase64(raw),
                storedAt: Date.now(),
            } satisfies StoredSessionDEK,
        });
    } finally {
        raw.fill(0);
    }
}

export async function setSessionDEKFromVaultMetadata(
    vaultDbIndex: number,
    metadata: VaultMetadata,
    params: SessionDEKUnlockParams,
): Promise<void> {
    const dek = await deriveExtractableSessionDEK(
        vaultDbIndex,
        metadata,
        params,
    );
    await setSessionDEK(vaultDbIndex, dek);
}

/** Re-derives the primary DEK to confirm the current vault password. */
export async function verifyVaultMasterPassword(
    metadata: VaultMetadata | VaultUtilTypes.VaultMetadata,
    masterPassword: string,
): Promise<boolean> {
    if (!masterPassword) return false;
    try {
        const index = (metadata as VaultMetadata).DBIndex;
        if (index == null) return false;
        await deriveExtractableSessionDEK(index, metadata as VaultMetadata, {
            masterPassword,
        });
        return true;
    } catch {
        return false;
    }
}

export async function getSessionDEK(
    vaultDbIndex: number,
): Promise<CryptoKey | null> {
    await ensureTrustedContextOnly();

    const result = await chrome.storage.session.get([storageKey(vaultDbIndex)]);
    const stored = result[storageKey(vaultDbIndex)];
    if (!isStoredSessionDEK(stored)) return null;

    const raw = base64ToUint8(stored.rawB64);
    if (raw.byteLength !== AES_GCM_256_BYTES) {
        raw.fill(0);
        return null;
    }
    const importBytes = Uint8Array.from(raw);
    try {
        return await crypto.subtle.importKey(
            "raw",
            importBytes,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        );
    } finally {
        raw.fill(0);
        importBytes.fill(0);
    }
}

export async function clearSessionDEK(vaultDbIndex: number): Promise<void> {
    await chrome.storage.session.remove(storageKey(vaultDbIndex));
}

export async function clearAllVaultKeyMaterial(): Promise<void> {
    const all = await chrome.storage.session.get(null);
    const keys = Object.keys(all).filter((key) =>
        key.startsWith(STORAGE_PREFIX),
    );
    if (keys.length > 0) {
        await chrome.storage.session.remove(keys);
    }
}
