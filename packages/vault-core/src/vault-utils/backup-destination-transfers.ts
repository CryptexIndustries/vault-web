/**
 * Network side of backup destinations: listing, uploading with pruning, and
 * the connection test. Kept apart from the record code so sync never loads
 * the S3 client.
 */

import { ulid } from "ulidx";

import type * as VaultUtilTypes from "../proto/vault";
import {
    backupDeviceFolder,
    backupObjectKey,
    parseBackupObjectKey,
    selectBackupsToPrune,
    type BackupObject,
} from "./backup-destinations";
import {
    S3Error,
    deleteS3Object,
    listS3Objects,
    putS3Object,
    type S3Fetch,
    type S3Location,
} from "./s3-client";

type BackupDestination = VaultUtilTypes.BackupDestination;

/** Every backup under the destination's prefix, newest first. */
export async function listBackupsInDestination(
    destination: S3Location & Pick<BackupDestination, "Prefix">,
    fetchImpl?: S3Fetch,
): Promise<BackupObject[]> {
    const objects = await listS3Objects(
        destination,
        destination.Prefix,
        fetchImpl,
    );
    return objects
        .map((object) => parseBackupObjectKey(destination.Prefix, object))
        .filter((backup): backup is BackupObject => backup != null)
        .sort((a, b) => b.createdAt - a.createdAt);
}

export type BackupUploadResult = {
    key: string;
    /** The upload succeeded, but removing old backups failed. */
    pruneError?: S3Error;
};

export type BackupUploadOptions = {
    now?: number;
    fetch?: S3Fetch;
    /** Delete all of this device's other backups instead of thinning them. */
    deleteOlder?: boolean;
    /**
     * Checked before each deletion: an upload that outlived its session must
     * not delete backups a newer session wrote meanwhile.
     */
    stillCurrent?: () => boolean;
};

/** Uploads to this device's folder, then removes its backups past retention. */
export async function uploadToBackupDestination(
    destination: BackupDestination,
    deviceID: string,
    bytes: Uint8Array,
    {
        now = Date.now(),
        fetch: fetchImpl,
        deleteOlder = false,
        stillCurrent = () => true,
    }: BackupUploadOptions = {},
): Promise<BackupUploadResult> {
    const key = backupObjectKey(destination, deviceID, now);
    await putS3Object(destination, key, bytes, fetchImpl);
    if ((destination.KeepAll && !deleteOlder) || !stillCurrent()) {
        return { key };
    }
    try {
        const folder = backupDeviceFolder(destination, deviceID);
        // Check the folder here too: a faulty listing must not make this
        // device delete another device's backups.
        const backups = (await listS3Objects(destination, folder, fetchImpl))
            .map((object) => parseBackupObjectKey(destination.Prefix, object))
            .filter(
                (backup): backup is BackupObject =>
                    backup?.destinationID === destination.ID &&
                    backup.deviceID === deviceID,
            );
        const toDelete = deleteOlder
            ? backups.filter((backup) => backup.key !== key)
            : selectBackupsToPrune(backups, key, now);
        for (const backup of toDelete) {
            if (!stillCurrent()) break;
            await deleteS3Object(destination, backup.key, fetchImpl);
        }
        return { key };
    } catch (error) {
        if (!(error instanceof S3Error)) throw error;
        return { key, pruneError: error };
    }
}

/**
 * Writes, lists and removes a small file in the destination's folder. With
 * KeepAll the key doesn't need delete rights, so a refused delete passes.
 */
export async function testBackupDestination(
    destination: S3Location &
        Pick<BackupDestination, "ID" | "Prefix" | "KeepAll">,
    fetchImpl?: S3Fetch,
): Promise<void> {
    const folder = `${destination.Prefix}${destination.ID}/`;
    const key = `${folder}connection-test-${ulid()}`;
    await putS3Object(
        destination,
        key,
        new TextEncoder().encode("Cryptex Vault connection test\n"),
        fetchImpl,
    );
    await listS3Objects(destination, folder, fetchImpl);
    try {
        await deleteS3Object(destination, key, fetchImpl);
    } catch (error) {
        if (
            !destination.KeepAll ||
            !(error instanceof S3Error) ||
            error.code !== "ACCESS_DENIED"
        ) {
            throw error;
        }
    }
}
