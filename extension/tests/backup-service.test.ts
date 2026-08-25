/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";

Object.defineProperties(globalThis, {
    crypto: { value: webcrypto, configurable: true },
    TextEncoder: { value: TextEncoder, configurable: true },
    TextDecoder: { value: TextDecoder, configurable: true },
});

const serializeVaultMock = jest.fn(async () => new Uint8Array([9, 8, 7]));

jest.mock("@/app_lib/vault-utils/storage", () => ({
    serializeVault: serializeVaultMock,
}));

import {
    EncryptedBlob,
    KeyEnvelope,
} from "@cryptex-industries/vault-core/proto";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";

import {
    classifyBackupCiphertextSize,
    createEncryptedBackupBytes,
    handleCreateEncryptedBackupRequest,
    handleGetBackupContextRequest,
    MAX_BACKUP_BYTES,
    parseCreateEncryptedBackupRequest,
    readStoredLocalBackupReceipt,
    redactBackupHandlerResult,
    writeStoredLocalBackupReceipt,
    type BackupBlobStore,
    type BackupReceiptStore,
} from "../src/background/backup-service";
import { MessageType } from "../src/types/sw-messaging";
import { isBackupStagingId } from "../src/utils/backup-staging";

function memoryReceiptStore(): BackupReceiptStore & {
    records: Map<string, string>;
} {
    const records = new Map<string, string>();
    return {
        records,
        get: async (key) => records.get(key) ?? null,
        set: async (key, value) => {
            records.set(key, value);
        },
    };
}

function memoryBlobStore(): BackupBlobStore & {
    records: Map<string, Uint8Array>;
} {
    const records = new Map<string, Uint8Array>();
    return {
        records,
        put: async (id, bytes) => {
            records.set(id, bytes);
        },
        take: async (id) => {
            const value = records.get(id) ?? null;
            records.delete(id);
            return value;
        },
        clear: async () => {
            records.clear();
        },
    };
}

async function aesGcmDek(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
    ]);
}

function blobWithVaultId(vaultId: string): EncryptedBlob {
    return EncryptedBlob.create({
        Envelope: KeyEnvelope.create({ VaultID: vaultId }),
    });
}

describe("parseCreateEncryptedBackupRequest", () => {
    it("reads an explicit receipt flag", () => {
        expect(
            parseCreateEncryptedBackupRequest({ recordLocalReceipt: false }),
        ).toEqual({ recordLocalReceipt: false });
    });

    it("rejects hostile or extra-field payloads", () => {
        expect(parseCreateEncryptedBackupRequest(null)).toBeNull();
        expect(
            parseCreateEncryptedBackupRequest({ recordLocalReceipt: "no" }),
        ).toBeNull();
        expect(
            parseCreateEncryptedBackupRequest({
                recordLocalReceipt: true,
                extra: true,
            }),
        ).toBeNull();
        expect(parseCreateEncryptedBackupRequest([])).toBeNull();
    });
});

describe("classifyBackupCiphertextSize", () => {
    it("rejects empty ciphertext as a serialize failure", () => {
        expect(classifyBackupCiphertextSize(0)).toBe("BACKUP_SERIALIZE_FAILED");
    });

    it("rejects ciphertext above the IndexedDB sanity ceiling", () => {
        expect(classifyBackupCiphertextSize(MAX_BACKUP_BYTES + 1)).toBe(
            "BACKUP_TOO_LARGE",
        );
        expect(classifyBackupCiphertextSize(MAX_BACKUP_BYTES)).toBeNull();
    });
});

describe("createEncryptedBackupBytes", () => {
    it("rejects a blob without a vault id", async () => {
        const dek = await aesGcmDek();
        await expect(
            createEncryptedBackupBytes(
                new Vault(),
                EncryptedBlob.create({}),
                dek,
            ),
        ).resolves.toEqual({ ok: false, error: "VAULT_ID_MISSING" });
        expect(serializeVaultMock).not.toHaveBeenCalled();
    });

    it("rejects a vault id that is not a bounded storage key", async () => {
        const dek = await aesGcmDek();
        await expect(
            createEncryptedBackupBytes(
                new Vault(),
                blobWithVaultId("../evil"),
                dek,
            ),
        ).resolves.toEqual({ ok: false, error: "VAULT_ID_INVALID" });
        expect(serializeVaultMock).not.toHaveBeenCalled();
    });

    it("returns serialized ciphertext for a vault-bound blob", async () => {
        const dek = await aesGcmDek();
        const result = await createEncryptedBackupBytes(
            new Vault(),
            blobWithVaultId("vault-1"),
            dek,
        );
        expect(result).toEqual({
            ok: true,
            backup: {
                bytes: new Uint8Array([9, 8, 7]),
                vaultId: "vault-1",
                source: expect.any(Uint8Array),
            },
        });
    });
});

describe("backup receipt store", () => {
    beforeEach(() => {
        serializeVaultMock.mockClear();
    });

    it("round-trips a DEK-authenticated receipt", async () => {
        const dek = await aesGcmDek();
        const store = memoryReceiptStore();
        const source = new Uint8Array([1, 2, 3]);
        const completedAt = new Date("2026-08-08T10:00:00.000Z");

        await writeStoredLocalBackupReceipt(
            store,
            "vault-1",
            source,
            dek,
            completedAt,
        );
        await expect(
            readStoredLocalBackupReceipt(store, "vault-1", source, dek),
        ).resolves.toEqual({ completedAt, isCurrent: true });
        await expect(
            readStoredLocalBackupReceipt(
                store,
                "vault-1",
                new Uint8Array([9]),
                dek,
            ),
        ).resolves.toEqual({ completedAt, isCurrent: false });
    });
});

describe("backup message handlers", () => {
    it("refuses to create a backup without an unlocked vault", async () => {
        await expect(
            handleCreateEncryptedBackupRequest({
                vault: null,
                blob: undefined,
                dek: null,
                store: memoryReceiptStore(),
                blobs: memoryBlobStore(),
                recordLocalReceipt: true,
            }),
        ).resolves.toEqual({ ok: false, error: "VAULT_NOT_UNLOCKED" });
    });

    it("stages ciphertext and records a local receipt", async () => {
        const dek = await aesGcmDek();
        const store = memoryReceiptStore();
        const blobs = memoryBlobStore();
        const result = await handleCreateEncryptedBackupRequest({
            vault: new Vault(),
            blob: blobWithVaultId("vault-1"),
            dek,
            store,
            blobs,
            recordLocalReceipt: true,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(isBackupStagingId(result.stagingId)).toBe(true);
        expect(result.byteLength).toBe(3);
        await expect(blobs.take(result.stagingId)).resolves.toEqual(
            new Uint8Array([9, 8, 7]),
        );
        await expect(blobs.take(result.stagingId)).resolves.toBeNull();
        const context = await handleGetBackupContextRequest({
            blob: blobWithVaultId("vault-1"),
            dek,
            hasOnlineServicesSession: true,
            store,
        });
        expect(context).toEqual({
            ok: true,
            hasOnlineServicesSession: true,
            localReceipt: {
                completedAt: result.completedAt,
                isCurrent: true,
            },
        });
    });

    it("can skip writing a local receipt for managed uploads", async () => {
        const dek = await aesGcmDek();
        const store = memoryReceiptStore();
        const result = await handleCreateEncryptedBackupRequest({
            vault: new Vault(),
            blob: blobWithVaultId("vault-1"),
            dek,
            store,
            blobs: memoryBlobStore(),
            recordLocalReceipt: false,
        });
        expect(result.ok).toBe(true);
        const context = await handleGetBackupContextRequest({
            blob: blobWithVaultId("vault-1"),
            dek,
            hasOnlineServicesSession: false,
            store,
        });
        expect(context).toEqual({
            ok: true,
            hasOnlineServicesSession: false,
            localReceipt: null,
        });
    });
});

describe("redactBackupHandlerResult", () => {
    it("strips the staging id from successful create responses", () => {
        expect(
            redactBackupHandlerResult(MessageType.CreateEncryptedBackup, {
                ok: true,
                stagingId: "11111111-1111-4111-8111-111111111111",
                byteLength: 3,
                completedAt: "2026-08-08T10:00:00.000Z",
            }),
        ).toEqual({
            ok: true,
            completedAt: "2026-08-08T10:00:00.000Z",
            byteLength: 3,
            stagingId: "[redacted]",
        });
    });

    it("leaves error responses and other message types intact", () => {
        const failure = { ok: false, error: "VAULT_NOT_UNLOCKED" };
        expect(
            redactBackupHandlerResult(
                MessageType.CreateEncryptedBackup,
                failure,
            ),
        ).toBe(failure);
        const other = { ok: true, hasOnlineServicesSession: false };
        expect(
            redactBackupHandlerResult(MessageType.GetBackupContext, other),
        ).toBe(other);
    });
});

describe("isBackupStagingId", () => {
    it("accepts UUID staging keys and rejects other strings", () => {
        expect(isBackupStagingId("11111111-1111-4111-8111-111111111111")).toBe(
            true,
        );
        expect(isBackupStagingId("../evil")).toBe(false);
        expect(isBackupStagingId("")).toBe(false);
    });
});
