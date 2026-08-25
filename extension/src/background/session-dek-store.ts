/**
 * Extension-only DEK session store.
 *
 * Keep this file under `extension/src`: it depends on `chrome.storage.session`
 * and must not be imported by the web app. The stored raw key is memory-backed
 * browser-session state, not IndexedDB/local disk state.
 */

import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import { isPrimarySlot } from "@cryptex-industries/vault-core/vault-utils/encryption";
import {
    isEnvelopeBlob,
    openPrimarySlot,
} from "@cryptex-industries/vault-core/vault-utils/envelope-encryption";
import type { VaultMetadata } from "@/app_lib/vault-utils/storage";

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

const bytesToBase64 = (bytes: Uint8Array) => bytes.toBase64();
const base64ToBytes = (base64: string) => Uint8Array.fromBase64(base64);

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
        blob.Envelope.PrimaryFactorKind !== VaultUtilTypes.SecondFactorKind.NONE
    ) {
        throw new Error("EXTENSION_2FA_UNSUPPORTED");
    }

    const dek = await openPrimarySlot(
        primarySlot,
        params.masterPassword,
        vaultId,
        null,
        true,
    );
    if (dek.isErr()) {
        throw new Error(dek.error);
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
                rawB64: bytesToBase64(raw),
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
    const dek = await deriveExtractableSessionDEK(metadata, params);
    await setSessionDEK(vaultDbIndex, dek);
}

/** Re-derives the primary DEK to confirm the current vault password. */
export async function verifyVaultMasterPassword(
    metadata: VaultMetadata | VaultUtilTypes.VaultMetadata,
    masterPassword: string,
): Promise<boolean> {
    if (!masterPassword) return false;
    try {
        await deriveExtractableSessionDEK(metadata as VaultMetadata, {
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

    const raw = base64ToBytes(stored.rawB64);
    try {
        if (raw.byteLength !== AES_GCM_256_BYTES) return null;
        return await crypto.subtle.importKey(
            "raw",
            raw,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
        );
    } finally {
        raw.fill(0);
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
