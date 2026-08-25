import {
    EncryptedBlob,
    type Vault as VaultProto,
} from "@cryptex-industries/vault-core/proto";
import { EncryptedBlob as EncryptedBlobClass } from "@cryptex-industries/vault-core/vault-utils/encryption";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";

import { serializeVault } from "@/app_lib/vault-utils/storage";
import {
    localBackupReceiptStorageKey,
    openLocalBackupReceipt,
    sealLocalBackupReceipt,
    type LocalBackupReceipt,
} from "@/app_lib/backup-status";
import {
    MessageType,
    type CreateEncryptedBackupRequest,
    type CreateEncryptedBackupResponse,
    type GetBackupContextResponse,
} from "../types/sw-messaging";
import type { BackupBlobStore } from "../utils/backup-staging";

/** ULID-shaped vault IDs, plus a short alphanumeric bound for storage keys. */
const VAULT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Sanity ceiling for a staged `.cryx`. Ciphertext never enters a runtime
 * message; this only stops a runaway serialize from filling IndexedDB.
 */
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;

export type BackupReceiptStore = {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
};

export type { BackupBlobStore };

export type EncryptedBackupBytes = {
    bytes: Uint8Array;
    vaultId: string;
    source: Uint8Array;
};

export type EncryptedBackupBytesResult =
    | { ok: true; backup: EncryptedBackupBytes }
    | {
          ok: false;
          error:
              | "VAULT_ID_MISSING"
              | "VAULT_ID_INVALID"
              | "BACKUP_TOO_LARGE"
              | "BACKUP_SERIALIZE_FAILED";
      };

export function parseCreateEncryptedBackupRequest(
    payload: unknown,
): CreateEncryptedBackupRequest | null {
    if (
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload)
    ) {
        return null;
    }
    if (
        Object.keys(payload).length !== 1 ||
        !("recordLocalReceipt" in payload) ||
        typeof payload.recordLocalReceipt !== "boolean"
    ) {
        return null;
    }
    return { recordLocalReceipt: payload.recordLocalReceipt };
}

function vaultIdFromBlob(blob: EncryptedBlob): string | null {
    const vaultId = blob.Envelope?.VaultID?.trim();
    if (!vaultId) return null;
    return VAULT_ID_PATTERN.test(vaultId) ? vaultId : null;
}

function restoreEncryptedBlob(blob: EncryptedBlob): EncryptedBlobClass {
    const restored = Object.assign(EncryptedBlobClass.CreateDefault(), blob);
    if (blob.Envelope) {
        restored.Envelope = blob.Envelope;
    }
    return restored;
}

/** Protobuf fingerprint of the session blob. Must not use a restored clone. */
function backupSourceFingerprint(blob: EncryptedBlob): Uint8Array {
    return EncryptedBlob.encode(blob).finish();
}

function cloneBlobForSerialize(source: Uint8Array): EncryptedBlobClass {
    return restoreEncryptedBlob(EncryptedBlob.decode(source));
}

export function classifyBackupCiphertextSize(
    byteLength: number,
): "BACKUP_SERIALIZE_FAILED" | "BACKUP_TOO_LARGE" | null {
    if (byteLength === 0) return "BACKUP_SERIALIZE_FAILED";
    if (byteLength > MAX_BACKUP_BYTES) return "BACKUP_TOO_LARGE";
    return null;
}

export async function createEncryptedBackupBytes(
    vault: VaultProto,
    blob: EncryptedBlob,
    dek: CryptoKey,
): Promise<EncryptedBackupBytesResult> {
    const vaultId = blob.Envelope?.VaultID?.trim();
    if (!vaultId) {
        return { ok: false, error: "VAULT_ID_MISSING" };
    }
    if (!VAULT_ID_PATTERN.test(vaultId)) {
        return { ok: false, error: "VAULT_ID_INVALID" };
    }

    const source = backupSourceFingerprint(blob);
    const bytes = await serializeVault(
        Object.assign(new Vault(), vault),
        cloneBlobForSerialize(source),
        dek,
    );
    const sizeError = classifyBackupCiphertextSize(bytes.byteLength);
    if (sizeError) {
        return { ok: false, error: sizeError };
    }
    return {
        ok: true,
        backup: {
            bytes,
            vaultId,
            source,
        },
    };
}

export async function readStoredLocalBackupReceipt(
    store: BackupReceiptStore,
    vaultId: string,
    source: Uint8Array,
    dek: CryptoKey,
): Promise<LocalBackupReceipt | null> {
    const stored = await store.get(localBackupReceiptStorageKey(vaultId));
    return openLocalBackupReceipt(vaultId, stored, source, dek);
}

export async function writeStoredLocalBackupReceipt(
    store: BackupReceiptStore,
    vaultId: string,
    source: Uint8Array,
    dek: CryptoKey,
    completedAt: Date,
): Promise<void> {
    await store.set(
        localBackupReceiptStorageKey(vaultId),
        await sealLocalBackupReceipt(vaultId, source, dek, completedAt),
    );
}

export function createChromeLocalBackupReceiptStore(): BackupReceiptStore {
    return {
        async get(key: string): Promise<string | null> {
            const record = await chrome.storage.local.get(key);
            const value: unknown = record[key];
            return typeof value === "string" ? value : null;
        },
        async set(key: string, value: string): Promise<void> {
            await chrome.storage.local.set({ [key]: value });
        },
    };
}

export function redactBackupHandlerResult(
    type: MessageType,
    result: unknown,
): unknown {
    if (type !== MessageType.CreateEncryptedBackup) {
        return result;
    }
    if (
        typeof result !== "object" ||
        result === null ||
        !("ok" in result) ||
        result.ok !== true
    ) {
        return result;
    }
    return {
        ok: true,
        completedAt:
            "completedAt" in result && typeof result.completedAt === "string"
                ? result.completedAt
                : undefined,
        byteLength:
            "byteLength" in result && typeof result.byteLength === "number"
                ? result.byteLength
                : undefined,
        stagingId: "[redacted]",
    };
}

export async function handleCreateEncryptedBackupRequest(input: {
    vault: VaultProto | null;
    blob: EncryptedBlob | undefined;
    dek: CryptoKey | null;
    store: BackupReceiptStore;
    blobs: BackupBlobStore;
    recordLocalReceipt: boolean;
}): Promise<CreateEncryptedBackupResponse> {
    if (!input.vault || !input.blob || !input.dek) {
        return { ok: false, error: "VAULT_NOT_UNLOCKED" };
    }

    let created: EncryptedBackupBytesResult;
    try {
        created = await createEncryptedBackupBytes(
            input.vault,
            input.blob,
            input.dek,
        );
    } catch {
        return { ok: false, error: "BACKUP_SERIALIZE_FAILED" };
    }
    if (!created.ok) {
        return { ok: false, error: created.error };
    }

    const stagingId = crypto.randomUUID();
    await input.blobs.clear();
    try {
        await input.blobs.put(stagingId, created.backup.bytes);
    } catch {
        return { ok: false, error: "BACKUP_STAGE_FAILED" };
    }

    const completedAt = new Date();
    if (input.recordLocalReceipt) {
        try {
            await writeStoredLocalBackupReceipt(
                input.store,
                created.backup.vaultId,
                created.backup.source,
                input.dek,
                completedAt,
            );
        } catch {
            await input.blobs.take(stagingId);
            return { ok: false, error: "BACKUP_STAGE_FAILED" };
        }
    }

    return {
        ok: true,
        stagingId,
        byteLength: created.backup.bytes.byteLength,
        completedAt: completedAt.toISOString(),
    };
}

export async function handleGetBackupContextRequest(input: {
    blob: EncryptedBlob | undefined;
    dek: CryptoKey | null;
    hasOnlineServicesSession: boolean;
    store: BackupReceiptStore;
}): Promise<GetBackupContextResponse> {
    if (!input.blob || !input.dek) {
        return { ok: false, error: "VAULT_NOT_UNLOCKED" };
    }

    const vaultId = vaultIdFromBlob(input.blob);
    if (!vaultId) {
        return {
            ok: true,
            hasOnlineServicesSession: input.hasOnlineServicesSession,
            localReceipt: null,
        };
    }

    const receipt = await readStoredLocalBackupReceipt(
        input.store,
        vaultId,
        backupSourceFingerprint(input.blob),
        input.dek,
    );

    return {
        ok: true,
        hasOnlineServicesSession: input.hasOnlineServicesSession,
        localReceipt: receipt
            ? {
                  completedAt: receipt.completedAt.toISOString(),
                  isCurrent: receipt.isCurrent,
              }
            : null,
    };
}
