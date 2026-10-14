/**
 * Sender-side records of one-time share links, stored in the vault and
 * synced like directories (version vectors plus last-writer-wins).
 */

import type * as VaultUtilTypes from "../proto/vault";
import type { ShareStatus } from "./share-client";
import { shouldAcceptVersionedRecord } from "./vault";

/** Statuses after which the server no longer holds the ciphertext. */
const FINAL_SHARE_STATUSES = new Set<string>([
    "viewed",
    "expired",
    "revoked",
    "burned",
]);

export const isShareLinkFinal = (
    record: Pick<VaultUtilTypes.ShareLink, "Status" | "ExpiresAtTimestamp">,
    now = Date.now(),
): boolean =>
    FINAL_SHARE_STATUSES.has(record.Status) || record.ExpiresAtTimestamp <= now;

/** Status to show, treating an expiry the server hasn't confirmed yet as expired. */
export const displayShareStatus = (
    record: Pick<VaultUtilTypes.ShareLink, "Status" | "ExpiresAtTimestamp">,
    now = Date.now(),
): ShareStatus => {
    if (FINAL_SHARE_STATUSES.has(record.Status)) {
        return record.Status as ShareStatus;
    }
    return record.ExpiresAtTimestamp <= now ? "expired" : "active";
};

const digestHex = async (value: string): Promise<string> => {
    const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
};

export const hashShareLink = (
    record: Omit<
        VaultUtilTypes.ShareLink,
        "Hash" | "Version" | "DateModifiedTimestamp"
    >,
): Promise<string> =>
    digestHex(
        [
            record.ID,
            record.ServerOrigin,
            record.ManageToken,
            record.CredentialID,
            record.Label,
            String(record.CreatedAtTimestamp),
            String(record.ExpiresAtTimestamp),
            String(record.Passphrase),
            record.Status,
            String(record.ViewedAtTimestamp),
            String(record.Deleted),
        ].join("\u0000"),
    );

export async function createShareLinkRecord(input: {
    id: string;
    serverOrigin: string;
    manageToken: string;
    credentialId: string;
    label: string;
    expiresAt: number;
    passphrase: boolean;
    now?: number;
}): Promise<VaultUtilTypes.ShareLink> {
    const now = input.now ?? Date.now();
    const record = {
        ID: input.id,
        ServerOrigin: new URL(input.serverOrigin).origin,
        ManageToken: input.manageToken,
        CredentialID: input.credentialId,
        Label: input.label,
        CreatedAtTimestamp: now,
        ExpiresAtTimestamp: input.expiresAt,
        Passphrase: input.passphrase,
        Status: "active",
        ViewedAtTimestamp: 0,
        Deleted: false,
    };
    return {
        ...record,
        Hash: await hashShareLink(record),
        Version: 0,
        DateModifiedTimestamp: now,
    };
}

/** Returns a new version of the record, or the same object if nothing changed. */
export async function updateShareLinkRecord(
    record: VaultUtilTypes.ShareLink,
    changes: Partial<
        Pick<
            VaultUtilTypes.ShareLink,
            "Status" | "ViewedAtTimestamp" | "Deleted" | "Label"
        >
    >,
    now = Date.now(),
): Promise<VaultUtilTypes.ShareLink> {
    const next = { ...record, ...changes };
    const hash = await hashShareLink(next);
    if (hash === record.Hash) return record;
    return {
        ...next,
        Hash: hash,
        Version: record.Version + 1,
        DateModifiedTimestamp: now,
    };
}

/**
 * Tombstones jump this far ahead in version so a removal always beats status
 * updates other devices made to the same record in the meantime.
 */
export const SHARE_TOMBSTONE_VERSION_BUMP = 1_000_000;

/**
 * Hides a record everywhere and drops what it no longer needs: the manage
 * token, the item and the label.
 */
export async function tombstoneShareLinkRecord(
    record: VaultUtilTypes.ShareLink,
    now = Date.now(),
): Promise<VaultUtilTypes.ShareLink> {
    const tombstone = await updateShareLinkRecord(
        { ...record, ManageToken: "", CredentialID: "" },
        { Deleted: true, Label: "" },
        now,
    );
    return {
        ...tombstone,
        Version: record.Version + SHARE_TOMBSTONE_VERSION_BUMP,
    };
}

/** Removing a link from the list turns its record into a tombstone. */
export const dismissShareLinkRecord = tombstoneShareLinkRecord;

/** Share servers must be HTTPS, apart from local development hosts. */
export function isValidShareServerOrigin(origin: string): boolean {
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    if (url.origin !== origin) return false;
    if (url.protocol === "https:") return true;
    return (
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]", "10.0.2.2"].includes(url.hostname)
    );
}

/**
 * Applies server status reports. Status only moves forward: once a link is
 * viewed, revoked or burned, a later "active" report can't undo that.
 */
export async function applyShareStatusReports(
    records: readonly VaultUtilTypes.ShareLink[],
    reports: readonly {
        /** The server that answered. Its reports only apply to its links. */
        origin: string;
        id: string;
        status: ShareStatus;
        viewedAt: number | null;
    }[],
    now = Date.now(),
): Promise<VaultUtilTypes.ShareLink[]> {
    const key = (origin: string, id: string) => `${origin}\n${id}`;
    const byKey = new Map(
        reports.map((report) => [key(report.origin, report.id), report]),
    );
    return Promise.all(
        records.map(async (record) => {
            const report = byKey.get(key(record.ServerOrigin, record.ID));
            if (
                !report ||
                record.Deleted ||
                FINAL_SHARE_STATUSES.has(record.Status) ||
                report.status === "active"
            ) {
                return record;
            }
            // The server forgets tombstones after a while.
            const status =
                report.status === "unknown" ? "expired" : report.status;
            return updateShareLinkRecord(
                record,
                {
                    Status: status,
                    ViewedAtTimestamp: report.viewedAt ?? 0,
                },
                now,
            );
        }),
    );
}

export function mergeReceivedShareLinks(
    current: readonly VaultUtilTypes.ShareLink[],
    incoming: readonly VaultUtilTypes.ShareLink[],
): VaultUtilTypes.ShareLink[] {
    const records = new Map(current.map((record) => [record.ID, record]));
    for (const record of incoming) {
        const existing = records.get(record.ID);
        if (existing) {
            // Removal is final, and a link never moves to another server or
            // changes its token. A peer that tries either is ignored.
            if (existing.Deleted && !record.Deleted) continue;
            if (record.ServerOrigin !== existing.ServerOrigin) continue;
            if (
                record.ManageToken &&
                record.ManageToken !== existing.ManageToken
            ) {
                continue;
            }
        } else if (!isValidShareServerOrigin(record.ServerOrigin)) {
            continue;
        }
        if (shouldAcceptVersionedRecord(existing, record)) {
            records.set(record.ID, { ...record });
        }
    }
    return [...records.values()];
}

/** Newest first, tombstones hidden. */
export const visibleShareLinks = (
    records: readonly VaultUtilTypes.ShareLink[],
): VaultUtilTypes.ShareLink[] =>
    records
        .filter((record) => !record.Deleted)
        .sort((a, b) => b.CreatedAtTimestamp - a.CreatedAtTimestamp);
