/**
 * S3-compatible backup destinations, stored in the vault and synced like
 * share links (version vectors plus last-writer-wins). Every device uploads
 * the encrypted .cryx to its own folder and prunes only that folder:
 *
 *   <Prefix><destination ID>/<device ID>/<timestamp>.cryx
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { ulid } from "ulidx";

import { base64UrlToUint8, uint8ToBase64Url } from "../encoding";
import * as VaultUtilTypes from "../proto/vault";
import type { S3Object } from "./s3-client";
import { shouldAcceptVersionedRecord } from "./vault";

type BackupDestination = VaultUtilTypes.BackupDestination;

const BACKUP_DESTINATION_DEFAULT_REGION = "us-east-1";

/**
 * Tombstones jump this far ahead in version so a removal always beats edits
 * other devices made to the same record in the meantime.
 */
export const BACKUP_DESTINATION_TOMBSTONE_VERSION_BUMP = 1_000_000;

export type BackupDestinationInput = Pick<
    BackupDestination,
    | "Name"
    | "Endpoint"
    | "Region"
    | "Bucket"
    | "Prefix"
    | "PathStyle"
    | "AccessKeyID"
    | "SecretAccessKey"
    | "KeepAll"
>;

export type BackupDestinationField = keyof BackupDestinationInput;

type BackupDestinationValidation =
    | { ok: true; value: BackupDestinationInput }
    | { ok: false; field: BackupDestinationField; message: string };

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "10.0.2.2"];

/** HTTPS only, apart from local development hosts. Returns the origin. */
function normalizeBackupEndpoint(endpoint: string): string | null {
    let url: URL;
    try {
        url = new URL(endpoint.trim());
    } catch {
        return null;
    }
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname)) {
        return url.origin;
    }
    return null;
}

/** Empty, or slash-separated segments ending in "/". */
function normalizeBackupPrefix(prefix: string): string | null {
    const segments = prefix
        .trim()
        .split("/")
        .filter((segment) => segment.length > 0);
    if (
        segments.some(
            (segment) =>
                segment === "." ||
                segment === ".." ||
                // eslint-disable-next-line no-control-regex
                /[\u0000-\u001f\u007f\\]/.test(segment),
        )
    ) {
        return null;
    }
    const normalized = segments.length ? `${segments.join("/")}/` : "";
    return normalized.length <= 256 ? normalized : null;
}

/** Destination IDs are ULIDs; they become a folder name in object keys. */
const DESTINATION_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const BUCKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,61}[A-Za-z0-9]$/;
const REGION_PATTERN = /^[a-z0-9-]{1,32}$/;
const CREDENTIAL_PATTERN = /^\S{1,256}$/;

export function validateBackupDestinationInput(
    input: BackupDestinationInput,
): BackupDestinationValidation {
    const name = input.Name.trim();
    if (name.length < 1 || name.length > 64) {
        return {
            ok: false,
            field: "Name",
            message: "Enter a name of up to 64 characters.",
        };
    }
    const endpoint = normalizeBackupEndpoint(input.Endpoint);
    if (!endpoint) {
        return {
            ok: false,
            field: "Endpoint",
            message: "Enter the endpoint as an https:// address with no path.",
        };
    }
    const region = input.Region.trim() || BACKUP_DESTINATION_DEFAULT_REGION;
    if (!REGION_PATTERN.test(region)) {
        return {
            ok: false,
            field: "Region",
            message: "Enter a region such as us-east-1, or auto for R2.",
        };
    }
    const bucket = input.Bucket.trim();
    if (!BUCKET_PATTERN.test(bucket)) {
        return {
            ok: false,
            field: "Bucket",
            message:
                "Enter a bucket name of 3 to 63 letters, digits, dots or hyphens.",
        };
    }
    const prefix = normalizeBackupPrefix(input.Prefix);
    if (prefix == null) {
        return {
            ok: false,
            field: "Prefix",
            message: "Use folder names separated by /, without . or .. parts.",
        };
    }
    const accessKeyID = input.AccessKeyID.trim();
    if (!CREDENTIAL_PATTERN.test(accessKeyID)) {
        return {
            ok: false,
            field: "AccessKeyID",
            message: "Enter the access key ID.",
        };
    }
    const secretAccessKey = input.SecretAccessKey.trim();
    if (!CREDENTIAL_PATTERN.test(secretAccessKey)) {
        return {
            ok: false,
            field: "SecretAccessKey",
            message: "Enter the secret access key.",
        };
    }
    return {
        ok: true,
        value: {
            Name: name,
            Endpoint: endpoint,
            Region: region,
            Bucket: bucket,
            Prefix: prefix,
            PathStyle: input.PathStyle,
            AccessKeyID: accessKeyID,
            SecretAccessKey: secretAccessKey,
            KeepAll: input.KeepAll,
        },
    };
}

const digestHex = (value: Uint8Array): string =>
    Array.from(sha256(value), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");

/** SHA-256 over the protobuf encoding with the sync metadata zeroed. */
const hashBackupDestination = (record: BackupDestination): string =>
    digestHex(
        VaultUtilTypes.BackupDestination.encode({
            ...record,
            Hash: "",
            Version: 0,
            DateModifiedTimestamp: 0,
        }).finish(),
    );

/** Expects input that passed validateBackupDestinationInput. */
export function createBackupDestinationRecord(
    input: BackupDestinationInput,
    now = Date.now(),
): BackupDestination {
    const record: BackupDestination = {
        ...input,
        ID: ulid(now),
        Paused: false,
        CreatedAtTimestamp: now,
        Hash: "",
        Version: 0,
        DateModifiedTimestamp: now,
        Deleted: false,
    };
    return { ...record, Hash: hashBackupDestination(record) };
}

/** Returns a new version of the record, or the same object if nothing changed. */
export function updateBackupDestinationRecord(
    record: BackupDestination,
    changes: Partial<
        BackupDestinationInput & Pick<BackupDestination, "Paused">
    >,
    now = Date.now(),
): BackupDestination {
    const next = { ...record, ...changes };
    const hash = hashBackupDestination(next);
    if (hash === record.Hash) return record;
    return {
        ...next,
        Hash: hash,
        Version: record.Version + 1,
        DateModifiedTimestamp: now,
    };
}

/** Hides the destination everywhere and drops its keys. */
export function tombstoneBackupDestinationRecord(
    record: BackupDestination,
    now = Date.now(),
): BackupDestination {
    const deleted: BackupDestination = {
        ...record,
        Name: "",
        Endpoint: "",
        Region: "",
        Bucket: "",
        Prefix: "",
        AccessKeyID: "",
        SecretAccessKey: "",
        Deleted: true,
    };
    return {
        ...deleted,
        Hash: hashBackupDestination(deleted),
        Version: record.Version + BACKUP_DESTINATION_TOMBSTONE_VERSION_BUMP,
        DateModifiedTimestamp: now,
    };
}

export type BackupDestinationChange =
    | { type: "add"; record: BackupDestination }
    | { type: "edit"; id: string; input: BackupDestinationInput }
    | { type: "pause"; id: string; paused: boolean }
    | { type: "remove"; id: string };

/**
 * Applies a change to the records as they are when the vault is written, not
 * to the copy the UI showed, so changes synced meanwhile survive and a record
 * removed meanwhile stays removed.
 */
export function applyBackupDestinationChange(
    records: readonly BackupDestination[],
    change: BackupDestinationChange,
    now = Date.now(),
): BackupDestination[] {
    switch (change.type) {
        case "add":
            return mergeReceivedBackupDestinations(records, [change.record]);
        case "edit": {
            const validation = validateBackupDestinationInput(change.input);
            if (!validation.ok) throw new Error(validation.message);
            return records.map((record) =>
                record.ID === change.id && !record.Deleted
                    ? updateBackupDestinationRecord(
                          record,
                          validation.value,
                          now,
                      )
                    : record,
            );
        }
        case "pause":
            return records.map((record) =>
                record.ID === change.id && !record.Deleted
                    ? updateBackupDestinationRecord(
                          record,
                          { Paused: change.paused },
                          now,
                      )
                    : record,
            );
        case "remove":
            return records.map((record) =>
                record.ID === change.id && !record.Deleted
                    ? tombstoneBackupDestinationRecord(record, now)
                    : record,
            );
    }
}

export function mergeReceivedBackupDestinations(
    current: readonly BackupDestination[],
    incoming: readonly BackupDestination[],
): BackupDestination[] {
    const records = new Map(current.map((record) => [record.ID, record]));
    for (const record of incoming) {
        if (!DESTINATION_ID_PATTERN.test(record.ID)) continue;
        const existing = records.get(record.ID);
        // Removal is final.
        if (existing?.Deleted && !record.Deleted) continue;
        if (!record.Deleted && !validateBackupDestinationInput(record).ok) {
            continue;
        }
        if (shouldAcceptVersionedRecord(existing, record)) {
            records.set(record.ID, { ...record });
        }
    }
    return [...records.values()];
}

/** Oldest first, tombstones hidden. */
export const visibleBackupDestinations = (
    records: readonly BackupDestination[],
): BackupDestination[] =>
    records
        .filter((record) => !record.Deleted)
        .sort((a, b) => a.CreatedAtTimestamp - b.CreatedAtTimestamp);

export type BackupDevicePlatform = "web" | "extension" | "android";

const DEVICE_ID_PATTERN = /^(web|extension|android)-[0-9A-HJKMNP-TV-Z]{26}$/;

export const createBackupDeviceID = (platform: BackupDevicePlatform): string =>
    `${platform}-${ulid()}`;

const isBackupDeviceID = (value: string): boolean =>
    DEVICE_ID_PATTERN.test(value);

type BackupDeviceIdentity = Pick<
    VaultUtilTypes.LinkedDevices,
    "BackupDeviceID" | "BackupMarkerKey"
>;

/**
 * This installation's backup folder name and marker key, filling in whichever
 * is missing, or null when both are set. They live in LinkedDevices, which
 * never syncs or goes into backups.
 */
export function newBackupDeviceIdentity(
    current: BackupDeviceIdentity,
    platform: BackupDevicePlatform,
): BackupDeviceIdentity | null {
    const hasID = isBackupDeviceID(current.BackupDeviceID);
    const hasKey = Boolean(current.BackupMarkerKey);
    if (hasID && hasKey) return null;
    return {
        BackupDeviceID: hasID
            ? current.BackupDeviceID
            : createBackupDeviceID(platform),
        BackupMarkerKey: hasKey
            ? current.BackupMarkerKey
            : uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    };
}

/**
 * Fingerprint of what a backup made now would hold: the vault without the
 * parts backups leave out, plus the key envelope, so a security change counts
 * as a change. Keyed with the marker key from the vault, so the copy stored
 * outside it says nothing about the contents.
 */
export async function backupSourceHash(
    vault: VaultUtilTypes.Vault,
    envelope: VaultUtilTypes.KeyEnvelope | undefined,
    markerKey: string,
): Promise<string> {
    const envelopeBytes = envelope
        ? VaultUtilTypes.KeyEnvelope.encode(envelope).finish()
        : new Uint8Array();
    const vaultBytes = VaultUtilTypes.Vault.encode({
        ...vault,
        LinkedDevices: undefined,
        AgentApprover: undefined,
    }).finish();
    const message = new Uint8Array(
        4 + envelopeBytes.byteLength + vaultBytes.byteLength,
    );
    new DataView(message.buffer).setUint32(0, envelopeBytes.byteLength);
    message.set(envelopeBytes, 4);
    message.set(vaultBytes, 4 + envelopeBytes.byteLength);
    const key = await crypto.subtle.importKey(
        "raw",
        new Uint8Array(base64UrlToUint8(markerKey)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    return uint8ToBase64Url(
        new Uint8Array(await crypto.subtle.sign("HMAC", key, message)),
    );
}

export const backupDeviceFolder = (
    destination: Pick<BackupDestination, "ID" | "Prefix">,
    deviceID: string,
): string => `${destination.Prefix}${destination.ID}/${deviceID}/`;

/** Sorts by name in time order: 2026-10-26T09-14-03-512Z.cryx */
const formatTimestamp = (timestamp: number): string =>
    new Date(timestamp).toISOString().replace(/[:.]/g, "-");

const TIMESTAMP_FILE_PATTERN =
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.cryx$/;

export const backupObjectKey = (
    destination: Pick<BackupDestination, "ID" | "Prefix">,
    deviceID: string,
    timestamp: number,
): string =>
    `${backupDeviceFolder(destination, deviceID)}${formatTimestamp(timestamp)}.cryx`;

export type BackupObject = {
    key: string;
    destinationID: string;
    deviceID: string;
    platform: BackupDevicePlatform;
    createdAt: number;
    size: number;
};

/** Reads a key this module wrote under the prefix; anything else is null. */
export function parseBackupObjectKey(
    prefix: string,
    object: Pick<S3Object, "key" | "size">,
): BackupObject | null {
    if (!object.key.startsWith(prefix)) return null;
    const [destinationID = "", deviceID = "", file = "", ...rest] = object.key
        .slice(prefix.length)
        .split("/");
    if (rest.length > 0) return null;
    if (!DESTINATION_ID_PATTERN.test(destinationID)) return null;
    if (!isBackupDeviceID(deviceID)) return null;
    const match = TIMESTAMP_FILE_PATTERN.exec(file);
    if (!match) return null;
    const [, date, hours, minutes, seconds, millis] = match;
    const createdAt = Date.parse(
        `${date}T${hours}:${minutes}:${seconds}.${millis}Z`,
    );
    if (!Number.isFinite(createdAt)) return null;
    return {
        key: object.key,
        destinationID,
        deviceID,
        platform: deviceID.split("-")[0] as BackupDevicePlatform,
        createdAt,
        size: object.size,
    };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Backups to delete, keeping what managed backups keep: everything from the
 * last day, the newest of each day for 30 days and of each month for a year.
 * The backup just written always stays, even if the clock went back.
 */
export function selectBackupsToPrune(
    backups: readonly BackupObject[],
    justWrittenKey: string,
    now: number,
): BackupObject[] {
    const keep = new Set([justWrittenKey]);
    const newestPerPeriod = new Map<string, BackupObject>();
    for (const backup of backups) {
        const age = now - backup.createdAt;
        if (age <= DAY_MS) {
            keep.add(backup.key);
            continue;
        }
        if (age > 366 * DAY_MS) continue;
        // "2026-10-26" for a day, "2026-10" for a month.
        const period = new Date(backup.createdAt)
            .toISOString()
            .slice(0, age <= 30 * DAY_MS ? 10 : 7);
        const newest = newestPerPeriod.get(period);
        if (!newest || backup.createdAt > newest.createdAt) {
            newestPerPeriod.set(period, backup);
        }
    }
    for (const backup of newestPerPeriod.values()) keep.add(backup.key);
    return backups.filter((backup) => !keep.has(backup.key));
}
