import { BACKUP_FILE_EXTENSION } from "@/utils/consts";
import { MessageType } from "../types/sw-messaging";
import type {
    CreateEncryptedBackupResponse,
    GetBackupContextResponse,
} from "../types/sw-messaging";
import {
    createIndexedDbBackupBlobStore,
    isBackupStagingId,
} from "./backup-staging";
import { sendEncryptedEnvelopeToSW } from "./sw-envelope-client";

export type CreatedEncryptedBackup = {
    bytes: Uint8Array;
    completedAt: Date;
};

const stagedBackupStore = createIndexedDbBackupBlobStore();

export async function createEncryptedBackupViaSW(
    recordLocalReceipt = true,
): Promise<
    { ok: true; backup: CreatedEncryptedBackup } | { ok: false; error: string }
> {
    const result =
        await sendEncryptedEnvelopeToSW<CreateEncryptedBackupResponse>(
            MessageType.CreateEncryptedBackup,
            { recordLocalReceipt },
        );
    if (!result.ok) return { ok: false, error: result.error };
    if (!result.payload.ok) return result.payload;
    if (!isBackupStagingId(result.payload.stagingId)) {
        return { ok: false, error: "BACKUP_STAGE_MISSING" };
    }

    const bytes = await stagedBackupStore.take(result.payload.stagingId);
    if (!bytes || bytes.byteLength !== result.payload.byteLength) {
        return { ok: false, error: "BACKUP_STAGE_MISSING" };
    }

    return {
        ok: true,
        backup: {
            bytes,
            completedAt: new Date(result.payload.completedAt),
        },
    };
}

export async function getBackupContextViaSW(): Promise<GetBackupContextResponse> {
    const result = await sendEncryptedEnvelopeToSW<GetBackupContextResponse>(
        MessageType.GetBackupContext,
        null,
    );
    if (!result.ok) return { ok: false, error: result.error };
    return result.payload;
}

export function downloadLocalBackupFile(
    bytes: Uint8Array,
    createdAt: Date,
): void {
    const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cryptexvault-bk-${createdAt.getTime()}.${BACKUP_FILE_EXTENSION}`;
    anchor.click();
    URL.revokeObjectURL(url);
}
