import { base64ToUint8, uint8ToBase64 } from "@cryptex-industries/vault-core";

export const BACKUP_REMINDER_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
export const LOCAL_BACKUP_STATUS_EVENT = "cryptex:local-backup-status";
// localStorage is only a transport. The DEK-authenticated payload is the source
// of truth, and its domain also binds a receipt to one specific vault
const RECEIPT_DOMAIN = "cryptex:local-backup-receipt";
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const MAX_RECEIPT_CIPHERTEXT_BYTES = 384;

type Receipt = { at: number; source: string };

export type LocalBackupReceipt = { completedAt: Date; isCurrent: boolean };
export type BackupSource = "local" | "managed";
export type BackupOverview = {
    latestBackupAt: Date | null;
    latestSource: BackupSource | null;
    isStale: boolean;
    needsReminder: boolean;
};

const storageKey = (vaultId: string) => `${RECEIPT_DOMAIN}:${vaultId}`;

const aad = (vaultId: string) =>
    new TextEncoder().encode(`${RECEIPT_DOMAIN}:${vaultId}`);

// Reuse the non-extractable DEK with a fresh IV and domain-separated AAD
const gcm = (vaultId: string, iv: Uint8Array) => ({
    name: "AES-GCM" as const,
    iv,
    additionalData: aad(vaultId),
});

const fingerprint = async (source: Uint8Array) =>
    uint8ToBase64(
        new Uint8Array(
            await crypto.subtle.digest("SHA-256", new Uint8Array(source)),
        ),
    );

// Read localStorage as hostile input: bound its size, authenticate it, and
// validate its shape before using the timestamp or source fingerprint
export async function getLocalBackupReceipt(
    vaultId: string,
    source: Uint8Array,
    dek: CryptoKey,
): Promise<LocalBackupReceipt | null> {
    try {
        const stored = localStorage.getItem(storageKey(vaultId));
        if (!stored || stored.length > 512) return null;
        const parts = stored.split(".");
        if (
            parts.length !== 2 ||
            !/^[\w+/=]+$/.test(parts[0]!) ||
            !/^[\w+/=]+$/.test(parts[1]!)
        )
            return null;
        const iv = base64ToUint8(parts[0]!);
        const box = base64ToUint8(parts[1]!);
        if (
            iv.length !== AES_GCM_IV_BYTES ||
            box.length <= AES_GCM_TAG_BYTES ||
            box.length > MAX_RECEIPT_CIPHERTEXT_BYTES
        )
            return null;
        const plaintext = await crypto.subtle.decrypt(
            gcm(vaultId, new Uint8Array(iv)),
            dek,
            new Uint8Array(box),
        );
        const receipt = JSON.parse(
            new TextDecoder().decode(plaintext),
        ) as Partial<Receipt>;
        if (
            !Number.isSafeInteger(receipt.at) ||
            receipt.at! < 0 ||
            typeof receipt.source !== "string"
        )
            return null;
        const completedAt = new Date(receipt.at!);
        if (Number.isNaN(completedAt.getTime())) return null;
        return {
            completedAt,
            isCurrent: receipt.source === (await fingerprint(source)),
        };
    } catch {
        // Corrupt and forged receipts are deliberately indistinguishable
        return null;
    }
}

// This records that Cryptex Vault initiated a download. It cannot prove that the
// downloaded file still exists on the user's device
export async function recordLocalBackupCompleted(
    vaultId: string,
    source: Uint8Array,
    dek: CryptoKey,
    completedAt = new Date(),
): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
    const body = new TextEncoder().encode(
        JSON.stringify({
            at: completedAt.getTime(),
            source: await fingerprint(source),
        } satisfies Receipt),
    );
    const box = await crypto.subtle.encrypt(gcm(vaultId, iv), dek, body);
    localStorage.setItem(
        storageKey(vaultId),
        `${uint8ToBase64(iv)}.${uint8ToBase64(new Uint8Array(box))}`,
    );
    window.dispatchEvent(new Event(LOCAL_BACKUP_STATUS_EVENT));
}

// Only confirmed Premium users with disabled managed backups are reminded
export function getBackupOverview({
    localBackupAt,
    managedBackupAt,
    managedEnabled,
    managedEntitled,
    now = new Date(),
}: {
    localBackupAt: Date | null;
    managedBackupAt: Date | null;
    managedEnabled: boolean;
    managedEntitled: boolean;
    now?: Date;
}): BackupOverview {
    const localIsLatest =
        localBackupAt != null &&
        (managedBackupAt == null || localBackupAt >= managedBackupAt);
    const latestBackupAt = localIsLatest ? localBackupAt : managedBackupAt;
    const latestSource = latestBackupAt
        ? localIsLatest
            ? "local"
            : "managed"
        : null;
    const age = latestBackupAt
        ? Math.max(0, now.getTime() - latestBackupAt.getTime())
        : Infinity;
    const isStale = age >= BACKUP_REMINDER_AFTER_MS;
    return {
        latestBackupAt,
        latestSource,
        isStale,
        needsReminder: managedEntitled && !managedEnabled && isStale,
    };
}

export function formatBackupAge(completedAt: Date, now = new Date()): string {
    const minutes = Math.floor(
        Math.max(0, now.getTime() - completedAt.getTime()) / 60_000,
    );
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`;
    if (minutes < 43_200) return `${Math.floor(minutes / 1_440)}d ago`;
    return completedAt.toLocaleDateString();
}
