/**
 * Search, filter, sort and retention for the sender's "Shared links" list.
 * Shared by web, extension and mobile so all three list the same way.
 */

import type * as VaultUtilTypes from "../proto/vault";
import type { ShareStatus } from "./share-client";
import {
    displayShareStatus,
    isShareLinkFinal,
    tombstoneShareLinkRecord,
} from "./share-records";

/** Statuses a list row can show. "unknown" is displayed as expired. */
export type ShareListStatus = Exclude<ShareStatus, "unknown">;
export type ShareListSort = "newest" | "oldest" | "expiring" | "name";

export const SHARE_LIST_STATUSES: { value: ShareListStatus; label: string }[] =
    [
        { value: "active", label: "Active" },
        { value: "viewed", label: "Opened" },
        { value: "expired", label: "Expired" },
        { value: "revoked", label: "Revoked" },
        { value: "burned", label: "Destroyed" },
    ];

export const SHARE_LIST_SORTS: { value: ShareListSort; label: string }[] = [
    { value: "newest", label: "Newest first" },
    { value: "oldest", label: "Oldest first" },
    { value: "expiring", label: "Expiring soonest" },
    { value: "name", label: "Name A–Z" },
];

export const SHARE_STATUS_LABELS: Record<ShareStatus, string> = {
    active: "Active",
    viewed: "Opened",
    expired: "Expired",
    revoked: "Revoked",
    burned: "Destroyed",
    unknown: "Expired",
};

/** Finished links leave the list this long after they end. */
export const SHARE_LINK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type ShareListRow = {
    record: VaultUtilTypes.ShareLink;
    status: ShareListStatus;
    /** Label, else the shared item's name, else a placeholder. */
    name: string;
    host: string;
};

const listStatus = (status: ShareStatus): ShareListStatus =>
    status === "unknown" ? "expired" : status;

const hostOf = (origin: string): string => {
    try {
        return new URL(origin).host;
    } catch {
        return origin;
    }
};

export function toShareListRows(
    records: readonly VaultUtilTypes.ShareLink[],
    credentialNames: ReadonlyMap<string, string>,
    now = Date.now(),
    placeholders = { deletedItem: "Deleted item", secret: "Secret" },
): ShareListRow[] {
    return records
        .filter((record) => !record.Deleted)
        .map((record) => ({
            record,
            status: listStatus(displayShareStatus(record, now)),
            name:
                record.Label ||
                credentialNames.get(record.CredentialID) ||
                (record.CredentialID
                    ? placeholders.deletedItem
                    : placeholders.secret),
            host: hostOf(record.ServerOrigin),
        }));
}

export function countShareListRows(
    rows: readonly ShareListRow[],
): Record<ShareListStatus, number> {
    const counts = { active: 0, viewed: 0, expired: 0, revoked: 0, burned: 0 };
    for (const row of rows) counts[row.status] += 1;
    return counts;
}

const byNewest = (a: ShareListRow, b: ShareListRow) =>
    b.record.CreatedAtTimestamp - a.record.CreatedAtTimestamp ||
    a.record.ID.localeCompare(b.record.ID);

const comparators: Record<
    ShareListSort,
    (a: ShareListRow, b: ShareListRow) => number
> = {
    newest: byNewest,
    oldest: (a, b) => -byNewest(a, b),
    // Active links by deadline first; finished links follow, newest first.
    expiring: (a, b) => {
        const aActive = a.status === "active";
        const bActive = b.status === "active";
        if (aActive !== bActive) return aActive ? -1 : 1;
        if (aActive) {
            return (
                a.record.ExpiresAtTimestamp - b.record.ExpiresAtTimestamp ||
                byNewest(a, b)
            );
        }
        return byNewest(a, b);
    },
    name: (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        byNewest(a, b),
};

export function queryShareListRows(
    rows: readonly ShareListRow[],
    options: {
        query: string;
        /** Empty shows every status. */
        statuses: readonly ShareListStatus[];
        sort: ShareListSort;
    },
): ShareListRow[] {
    const statuses = new Set(options.statuses);
    const terms = options.query
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    return rows
        .filter((row) => statuses.size === 0 || statuses.has(row.status))
        .filter((row) => {
            if (terms.length === 0) return true;
            const haystack = `${row.name} ${row.host}`.toLocaleLowerCase();
            return terms.every((term) => haystack.includes(term));
        })
        .sort(comparators[options.sort]);
}

/** When a finished link ended, for retention. Undefined while it is active. */
export function shareLinkEndedAt(
    record: VaultUtilTypes.ShareLink,
    now = Date.now(),
): number | undefined {
    if (!isShareLinkFinal(record, now)) return undefined;
    switch (record.Status) {
        case "viewed":
            return record.ViewedAtTimestamp || record.DateModifiedTimestamp;
        case "revoked":
        case "burned":
            return record.DateModifiedTimestamp;
        default:
            return record.ExpiresAtTimestamp;
    }
}

/**
 * Turns finished links older than the retention period into small
 * tombstones. Tombstones stay so the removal syncs to other devices.
 * Returns the same array when nothing changed.
 */
export async function pruneEndedShareLinks(
    records: VaultUtilTypes.ShareLink[],
    now = Date.now(),
    retentionMs = SHARE_LINK_RETENTION_MS,
): Promise<VaultUtilTypes.ShareLink[]> {
    let changed = false;
    const next = await Promise.all(
        records.map(async (record) => {
            const endedAt = shareLinkEndedAt(record, now);
            if (
                record.Deleted ||
                endedAt === undefined ||
                now - endedAt < retentionMs
            ) {
                return record;
            }
            changed = true;
            return tombstoneShareLinkRecord(record, now);
        }),
    );
    return changed ? next : records;
}
