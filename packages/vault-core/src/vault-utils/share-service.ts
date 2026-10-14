/**
 * Creating and managing one-time share links, independent of where the vault
 * lives (web atoms, extension service worker, mobile session).
 */

import type * as VaultUtilTypes from "../proto/vault";
import { base64UrlToUint8, uint8ToBase64Url } from "../encoding";
import {
    ShareClient,
    ShareServerError,
    type ShareStatusReport,
} from "./share-client";
import {
    formatShareLink,
    generateShareManageToken,
    generateShareSecret,
    sealSharePayload,
    type SharePayload,
} from "./share-link";
import {
    applyShareStatusReports,
    createShareLinkRecord,
    dismissShareLinkRecord,
    isValidShareServerOrigin,
} from "./share-records";
import { pruneEndedShareLinks } from "./share-list";

export type ShareLinkStore = {
    getShareLinks: () => Promise<VaultUtilTypes.ShareLink[]>;
    /** Runs `update` against the latest records and persists the result. */
    updateShareLinks: (
        update: (
            current: VaultUtilTypes.ShareLink[],
        ) => Promise<VaultUtilTypes.ShareLink[]>,
    ) => Promise<void>;
    getShareSettings: () => Promise<VaultUtilTypes.ShareSettings | undefined>;
    /**
     * Identifies the unlocked vault. A link created while the user switches
     * vaults is revoked instead of being saved into the other vault.
     */
    vaultKey?: () => Promise<string | number | undefined>;
};

export type ShareServiceDeps = {
    store: ShareLinkStore;
    /** Server used when the settings don't name one. */
    defaultOrigin: string;
    /** Online Services ticket for the managed server; undefined when signed out. */
    getTicket?: () => Promise<string>;
    fetch?: typeof fetch;
};

export type ShareSetupErrorCode =
    | "sign_in_required"
    | "subscription_required"
    | "token_required"
    | "too_large"
    | "expiry_too_long"
    | "not_online_services_server"
    | "vault_changed"
    | "share_id_conflict";

/** Something the user has to fix before a share can be created. */
export class ShareSetupError extends Error {
    constructor(public readonly code: ShareSetupErrorCode) {
        super(`SHARE_SETUP_${code.toUpperCase()}`);
        this.name = "ShareSetupError";
    }
}

export function resolveShareServer(
    settings: VaultUtilTypes.ShareSettings | undefined,
    defaultOrigin: string,
): { origin: string; creationToken: string } {
    const origin = settings?.ServerOrigin?.trim() || defaultOrigin;
    return {
        origin: new URL(origin).origin,
        creationToken: settings?.CreationToken?.trim() ?? "",
    };
}

/**
 * Reads `aud` from an Online Services ticket without checking the signature.
 * The share server verifies tickets; the client only needs to know which
 * server a ticket was issued for.
 */
export function ticketAudience(ticket: string): string | undefined {
    const parts = ticket.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
    try {
        const claims: unknown = JSON.parse(
            new TextDecoder().decode(base64UrlToUint8(parts[0])),
        );
        if (typeof claims !== "object" || claims === null) return undefined;
        const audience = (claims as { aud?: unknown }).aud;
        return typeof audience === "string" ? audience : undefined;
    } catch {
        return undefined;
    }
}

const clientFor = (deps: ShareServiceDeps, origin: string) =>
    new ShareClient(origin, { fetch: deps.fetch });

export type CreateShareLinkInput = {
    payload: SharePayload;
    /** Shown in the sender's list only. */
    label: string;
    credentialId: string;
    ttlSeconds: number;
    passphrase?: string;
};

export async function createShareLink(
    deps: ShareServiceDeps,
    input: CreateShareLinkInput,
): Promise<{ link: string; record: VaultUtilTypes.ShareLink }> {
    const vaultAtStart = await deps.store.vaultKey?.();
    const { origin, creationToken } = resolveShareServer(
        await deps.store.getShareSettings(),
        deps.defaultOrigin,
    );
    const client = clientFor(deps, origin);
    const info = await client.info();

    const getTicket = info.auth === "ticket" ? deps.getTicket : undefined;
    if (info.auth === "ticket" && !getTicket) {
        throw new ShareSetupError("sign_in_required");
    }
    if (info.auth !== "ticket" && !creationToken) {
        throw new ShareSetupError("token_required");
    }
    if (input.ttlSeconds > info.maxTtl) {
        throw new ShareSetupError("expiry_too_long");
    }
    const passphrase = input.passphrase || undefined;
    const secret = generateShareSecret();
    const manageToken = generateShareManageToken();
    const sealed = await sealSharePayload(input.payload, secret, passphrase);
    if (sealed.ciphertext.byteLength > info.maxBytes) {
        throw new ShareSetupError("too_large");
    }

    // Tickets are single-use, so only fetch one once the share is ready.
    let auth: Parameters<ShareClient["create"]>[1];
    if (getTicket) {
        const ticket = await getTicket();
        // A custom server can claim ticket auth; never hand it a ticket that
        // was issued for the managed server.
        if (ticketAudience(ticket) !== origin) {
            throw new ShareSetupError("not_online_services_server");
        }
        auth = { kind: "ticket", ticket };
    } else {
        auth = { kind: "token", token: creationToken };
    }

    const created = await client.create(
        {
            ciphertext: sealed.ciphertext,
            peekTokenHash: sealed.peekTokenHash,
            revealTokenHash: sealed.revealTokenHash,
            manageToken,
            ttlSeconds: input.ttlSeconds,
            passphrase: !!passphrase,
        },
        auth,
    );

    const record = await createShareLinkRecord({
        id: created.id,
        serverOrigin: origin,
        manageToken: uint8ToBase64Url(manageToken),
        credentialId: input.credentialId,
        label: input.label,
        expiresAt: created.expiresAt,
        passphrase: !!passphrase,
    });
    try {
        if (deps.store.vaultKey) {
            const vaultNow = await deps.store.vaultKey().catch(() => undefined);
            if (vaultNow === undefined || vaultNow !== vaultAtStart) {
                throw new ShareSetupError("vault_changed");
            }
        }
        if (
            (await deps.store.getShareLinks()).some((e) => e.ID === record.ID)
        ) {
            throw new ShareSetupError("share_id_conflict");
        }
        await deps.store.updateShareLinks(async (current) => {
            // IDs identify records everywhere, so a server can't reuse one.
            if (current.some((entry) => entry.ID === record.ID)) {
                throw new ShareSetupError("share_id_conflict");
            }
            return [...current, record];
        });
    } catch (error) {
        // Without the record the sender couldn't revoke it, so don't leave
        // the share behind.
        await client.revoke(created.id, manageToken).catch(() => undefined);
        throw error;
    }
    return { link: formatShareLink(origin, created.id, secret), record };
}

/** The share server accepts at most this many links per status request. */
export const SHARE_STATUS_BATCH_SIZE = 200;

const sameRecords = (
    a: readonly VaultUtilTypes.ShareLink[],
    b: readonly VaultUtilTypes.ShareLink[],
) => a.length === b.length && a.every((record, index) => record === b[index]);

/**
 * Asks each server about links that may still be open, then drops finished
 * links past the retention period. Writes the vault only if something changed.
 */
export async function refreshShareStatuses(
    deps: ShareServiceDeps,
    now = Date.now(),
): Promise<void> {
    const records = await deps.store.getShareLinks();
    const byOrigin = new Map<string, VaultUtilTypes.ShareLink[]>();
    for (const record of records) {
        // Includes links whose expiry the server hasn't confirmed yet.
        if (record.Deleted || record.Status !== "active") continue;
        if (!isValidShareServerOrigin(record.ServerOrigin)) continue;
        const group = byOrigin.get(record.ServerOrigin) ?? [];
        group.push(record);
        byOrigin.set(record.ServerOrigin, group);
    }
    const reports: (ShareStatusReport & { origin: string })[] = [];
    for (const [origin, group] of byOrigin) {
        const client = clientFor(deps, origin);
        try {
            for (
                let start = 0;
                start < group.length;
                start += SHARE_STATUS_BATCH_SIZE
            ) {
                const batch = group.slice(
                    start,
                    start + SHARE_STATUS_BATCH_SIZE,
                );
                const asked = new Set(batch.map((record) => record.ID));
                const answers = await client.status(
                    batch.map((record) => ({
                        id: record.ID,
                        manageToken: base64UrlToUint8(record.ManageToken),
                    })),
                );
                // A server may only speak for the links it was asked about.
                for (const answer of answers) {
                    if (asked.has(answer.id)) {
                        reports.push({ ...answer, origin });
                    }
                }
            }
        } catch (error) {
            // One unreachable server shouldn't hide the others.
            if (!(error instanceof ShareServerError)) throw error;
        }
    }
    const update = async (current: VaultUtilTypes.ShareLink[]) =>
        pruneEndedShareLinks(
            await applyShareStatusReports(current, reports, now),
            now,
        );
    if (sameRecords(records, await update(records))) return;
    await deps.store.updateShareLinks(update);
}

export async function revokeShareLink(
    deps: ShareServiceDeps,
    id: string,
): Promise<void> {
    const record = (await deps.store.getShareLinks()).find(
        (entry) => entry.ID === id,
    );
    if (!record || record.Deleted) return;
    // Ask the server whenever the stored status is still active, even if the
    // local clock says the link expired: the clock may be ahead.
    if (record.Status !== "active") return;
    let report: ShareStatusReport;
    try {
        report = await clientFor(deps, record.ServerOrigin).revoke(
            record.ID,
            base64UrlToUint8(record.ManageToken),
        );
    } catch (error) {
        if (!(error instanceof ShareServerError && error.code === "gone")) {
            throw error;
        }
        // The server no longer knows the link, so it can't be opened.
        report = { id, status: "expired", expiresAt: null, viewedAt: null };
    }
    await deps.store.updateShareLinks((current) =>
        applyShareStatusReports(current, [
            { ...report, id, origin: record.ServerOrigin },
        ]),
    );
}

/** Removes a link from the list everywhere, revoking it first if still open. */
export async function dismissShareLink(
    deps: ShareServiceDeps,
    id: string,
): Promise<void> {
    await revokeShareLink(deps, id);
    await deps.store.updateShareLinks((current) =>
        Promise.all(
            current.map((entry) =>
                entry.ID === id && !entry.Deleted
                    ? dismissShareLinkRecord(entry)
                    : entry,
            ),
        ),
    );
}
