/**
 * Connected agent records (keyless cryptex-agent machines), stored in the
 * vault and synced like share links: version vectors plus last-writer-wins,
 * with tamper guards on the identity fields.
 */

import { sha256 } from "@noble/hashes/sha2.js";

import { base64ToUint8, uint8ToBase64, uint8ToBase64Url } from "../encoding";
import { bytesEqual } from "../internal/ssh/wire";
import * as VaultUtilTypes from "../proto/vault";
import { getVaultCoreRuntime, isVaultCoreRuntimeConfigured } from "../runtime";
import { shouldAcceptVersionedRecord } from "./vault";

// History limits, matching the ConnectedAgent.History comment in vault.proto.
export const CONNECTED_AGENT_HISTORY_MAX_ENTRIES = 200;
export const CONNECTED_AGENT_HISTORY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** Approved server names kept per agent (ConnectedAgent.KnownHosts). */
export const CONNECTED_AGENT_MAX_KNOWN_HOSTS = 100;
/** known_hosts names are capped at this length (request-check HOST_NAME_LENGTH). */
const KNOWN_HOST_NAME_LENGTH = 255;

/**
 * Tombstones jump this far ahead in version so a revocation always beats
 * edits (history, key grants) other devices made in the meantime.
 */
export const CONNECTED_AGENT_TOMBSTONE_VERSION_BUMP = 1_000_000;

// Ed25519 public keys and seeds, and X-Wing (ML-KEM-768 + X25519) public keys.
const SIGN_PUBLIC_KEY_SIZE = 32;
const REVOCATION_SEED_SIZE = 32;
const KEM_PUBLIC_KEY_SIZE = 1216;

export type ConnectedAgentContent = Omit<
    VaultUtilTypes.ConnectedAgent,
    "Hash" | "Version" | "DateModifiedTimestamp"
>;

/**
 * Fields fixed at pairing. A synced update that changes any of them could
 * point the vault at a different machine or approver, so merges refuse it.
 */
const IDENTITY_FIELDS = [
    "AgentSignPublicKey",
    "AgentKEMPublicKey",
    "ApproverSignPublicKey",
    "ApproverKEMPublicKey",
    "RevocationSeed",
] as const;

/** Fields the apps may change after pairing. */
export type ConnectedAgentChanges = Partial<
    Pick<
        VaultUtilTypes.ConnectedAgent,
        | "Name"
        | "Hostname"
        | "OS"
        | "Arch"
        | "AgentVersion"
        | "ApproverName"
        | "CredentialIDs"
        | "KeysRevision"
        | "LastUsedTimestamp"
        | "History"
        | "Paused"
    >
>;

export const connectedAgentID = (agentSignPublicKey: Uint8Array): string =>
    uint8ToBase64Url(agentSignPublicKey);

const digestHex = (value: Uint8Array): string =>
    Array.from(sha256(value))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

/**
 * SHA-256 over the protobuf encoding with the sync metadata zeroed. The
 * encoding is deterministic and covers every field, history included, so any
 * change reaches the other devices. Synchronous, so merges can recompute it.
 */
export const hashConnectedAgentSync = (record: ConnectedAgentContent): string =>
    digestHex(
        VaultUtilTypes.ConnectedAgent.encode({
            ...record,
            Hash: "",
            Version: 0,
            DateModifiedTimestamp: 0,
        }).finish(),
    );

export async function createConnectedAgentRecord(
    input: Omit<
        ConnectedAgentContent,
        | "ID"
        | "History"
        | "Deleted"
        | "LastUsedTimestamp"
        | "PairedAtTimestamp"
        | "KnownHosts"
        | "Paused"
    > &
        Partial<Pick<ConnectedAgentContent, "PairedAtTimestamp">>,
    now = Date.now(),
): Promise<VaultUtilTypes.ConnectedAgent> {
    const record: ConnectedAgentContent = {
        ...input,
        // The ID is derived so it can't drift from the key it names.
        ID: connectedAgentID(input.AgentSignPublicKey),
        CredentialIDs: [...input.CredentialIDs],
        PairedAtTimestamp: input.PairedAtTimestamp ?? now,
        LastUsedTimestamp: 0,
        History: [],
        KnownHosts: [],
        Paused: false,
        Deleted: false,
    };
    return {
        ...record,
        Hash: hashConnectedAgentSync(record),
        Version: 0,
        DateModifiedTimestamp: now,
    };
}

/** Returns a new version of the record, or the same object if nothing changed. */
export async function updateConnectedAgentRecord(
    record: VaultUtilTypes.ConnectedAgent,
    changes: ConnectedAgentChanges,
    now = Date.now(),
): Promise<VaultUtilTypes.ConnectedAgent> {
    const next = { ...record, ...changes };
    const hash = hashConnectedAgentSync(next);
    if (hash === record.Hash) return record;
    return {
        ...next,
        Hash: hash,
        Version: record.Version + 1,
        DateModifiedTimestamp: now,
    };
}

/** Newest first, without entries older than 90 days or beyond 200. */
export function pruneConnectedAgentHistory(
    history: readonly VaultUtilTypes.AgentRequestRecord[],
    now = Date.now(),
): VaultUtilTypes.AgentRequestRecord[] {
    const cutoff = now - CONNECTED_AGENT_HISTORY_MAX_AGE_MS;
    return history
        .filter((entry) => entry.Timestamp >= cutoff)
        .sort((a, b) => b.Timestamp - a.Timestamp)
        .slice(0, CONNECTED_AGENT_HISTORY_MAX_ENTRIES);
}

/**
 * One entry per host key and name, the earliest kept, at most
 * CONNECTED_AGENT_MAX_KNOWN_HOSTS (the oldest go first). Sorted, so every
 * device ends up with the same list and the same hash.
 */
export function mergeKnownHosts(
    ...lists: readonly (readonly VaultUtilTypes.AgentKnownHost[])[]
): VaultUtilTypes.AgentKnownHost[] {
    const byKey = new Map<string, VaultUtilTypes.AgentKnownHost>();
    for (const list of lists)
        for (const entry of list) {
            if (
                !entry.Fingerprint ||
                !entry.Name ||
                entry.Name.length > KNOWN_HOST_NAME_LENGTH
            )
                continue;
            const key = `${entry.Fingerprint}\n${entry.Name}`;
            const seen = byKey.get(key);
            if (!seen || entry.FirstSeenTimestamp < seen.FirstSeenTimestamp)
                byKey.set(key, { ...entry });
        }
    const byAge = (
        a: VaultUtilTypes.AgentKnownHost,
        b: VaultUtilTypes.AgentKnownHost,
    ) =>
        a.FirstSeenTimestamp - b.FirstSeenTimestamp ||
        (a.Fingerprint < b.Fingerprint
            ? -1
            : a.Fingerprint > b.Fingerprint
              ? 1
              : 0) ||
        (a.Name < b.Name ? -1 : a.Name > b.Name ? 1 : 0);
    return [...byKey.values()]
        .sort(byAge)
        .slice(-CONNECTED_AGENT_MAX_KNOWN_HOSTS);
}

/**
 * Adds requests to the history (one, or the ones queued while the vault
 * was locked, in one write). Approved requests also move
 * LastUsedTimestamp, so one write (and one version bump) covers both. A
 * login the user approved (not a remembered rule) records the server name
 * for its host key in KnownHosts, so denied or ignored prompts can't seed
 * names.
 */
export function appendConnectedAgentHistory(
    record: VaultUtilTypes.ConnectedAgent,
    added:
        | VaultUtilTypes.AgentRequestRecord
        | readonly VaultUtilTypes.AgentRequestRecord[],
    now = Date.now(),
): Promise<VaultUtilTypes.ConnectedAgent> {
    const entries: readonly VaultUtilTypes.AgentRequestRecord[] = Array.isArray(
        added,
    )
        ? added
        : [added as VaultUtilTypes.AgentRequestRecord];
    const { AgentOutcomeApproved, AgentOutcomeApprovedByRule } =
        VaultUtilTypes.AgentRequestOutcome;
    const approved = entries.filter(
        (entry) =>
            entry.Outcome === AgentOutcomeApproved ||
            entry.Outcome === AgentOutcomeApprovedByRule,
    );
    const learned = entries
        .filter(
            (entry) =>
                entry.Outcome === AgentOutcomeApproved &&
                entry.Kind ===
                    VaultUtilTypes.AgentRequestKind.AgentRequestLogin &&
                !!entry.Host &&
                !!entry.HostKeyFingerprint,
        )
        .map((entry) => ({
            Fingerprint: entry.HostKeyFingerprint,
            Name: entry.Host,
            FirstSeenTimestamp: entry.Timestamp,
        }));
    return updateConnectedAgentRecord(
        record,
        {
            History: pruneConnectedAgentHistory(
                [...entries.map((entry) => ({ ...entry })), ...record.History],
                now,
            ),
            LastUsedTimestamp: Math.max(
                record.LastUsedTimestamp,
                ...approved.map((entry) => entry.Timestamp),
            ),
            ...(learned.length > 0 && {
                KnownHosts: mergeKnownHosts(record.KnownHosts ?? [], learned),
            }),
        },
        now,
    );
}

/**
 * Turns the record into a tombstone. The keys and revocation seed stay: the
 * merge guards compare them, and the seed lets any device retry a revoke that
 * didn't reach the relay. Grants and history go, since nothing reads them.
 */
export async function markConnectedAgentDeleted(
    record: VaultUtilTypes.ConnectedAgent,
    now = Date.now(),
): Promise<VaultUtilTypes.ConnectedAgent> {
    if (record.Deleted) return record;
    const tombstone = await updateConnectedAgentRecord(
        { ...record, Deleted: true, KnownHosts: [], Paused: false },
        { CredentialIDs: [], History: [] },
        now,
    );
    return {
        ...tombstone,
        Version: record.Version + CONNECTED_AGENT_TOMBSTONE_VERSION_BUMP,
        DateModifiedTimestamp: now,
    };
}

const logRejected = (reason: string, record: VaultUtilTypes.ConnectedAgent) => {
    const context = { agentId: record.ID, reason };
    const message = "Rejected a synced connected agent record";
    if (isVaultCoreRuntimeConfigured()) {
        getVaultCoreRuntime().syncLog.warn(message, context);
    } else {
        console.warn(message, context);
    }
};

/**
 * A relay URL a record may name: https, or http only on this machine
 * (development and end-to-end tests). Empty means the hosted relay.
 */
export function isAllowedRelayUrl(relayUrl: string): boolean {
    if (relayUrl === "") return true;
    const match = /^(https?):\/\/([^/?#@]+)(\/[^?#]*)?$/i.exec(relayUrl);
    if (!match) return false;
    if (match[1]!.toLowerCase() === "https") return true;
    return isLocalRelayHost(match[2]!);
}

/** localhost, 127.0.0.1 or [::1], with or without a port. */
export function isLocalRelayHost(authority: string): boolean {
    const host = authority
        .toLowerCase()
        .replace(/:\d*$/, "")
        .replace(/^\[(.*)\]$/, "$1");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

const hasValidIdentity = (record: VaultUtilTypes.ConnectedAgent): boolean =>
    record.AgentSignPublicKey.length === SIGN_PUBLIC_KEY_SIZE &&
    record.ApproverSignPublicKey.length === SIGN_PUBLIC_KEY_SIZE &&
    record.AgentKEMPublicKey.length === KEM_PUBLIC_KEY_SIZE &&
    record.ApproverKEMPublicKey.length === KEM_PUBLIC_KEY_SIZE &&
    record.RevocationSeed.length === REVOCATION_SEED_SIZE &&
    record.ID === connectedAgentID(record.AgentSignPublicKey) &&
    isAllowedRelayUrl(record.RelayOrigin);

/**
 * What a received record becomes before it is stored: the relay stays the
 * one it was paired on, history is pruned and capped, approved names are
 * the union of both sides, and the hash is recomputed over the result.
 */
function normalizeReceived(
    winner: VaultUtilTypes.ConnectedAgent,
    other: VaultUtilTypes.ConnectedAgent | undefined,
    relayOrigin: string,
    now: number,
): VaultUtilTypes.ConnectedAgent {
    const next = cloneConnectedAgent(winner);
    next.RelayOrigin = relayOrigin;
    if (next.Deleted) {
        next.KnownHosts = [];
        next.History = [];
    } else {
        next.History = pruneConnectedAgentHistory(next.History, now);
        next.KnownHosts = mergeKnownHosts(
            other && !other.Deleted ? other.KnownHosts : [],
            next.KnownHosts,
        );
    }
    next.Hash = hashConnectedAgentSync(next);
    return next;
}

/**
 * Merges records received from a linked device. Updates may never change an
 * existing record's keys, revocation seed or relay, and a deleted agent
 * stays deleted. Rejected records are logged and skipped.
 */
export function mergeReceivedConnectedAgents(
    current: readonly VaultUtilTypes.ConnectedAgent[],
    incoming: readonly VaultUtilTypes.ConnectedAgent[],
    now = Date.now(),
): VaultUtilTypes.ConnectedAgent[] {
    const records = new Map(current.map((record) => [record.ID, record]));
    for (const record of incoming) {
        const existing = records.get(record.ID);
        if (!existing) {
            if (!hasValidIdentity(record)) {
                logRejected("invalid identity", record);
                continue;
            }
            records.set(
                record.ID,
                normalizeReceived(record, undefined, record.RelayOrigin, now),
            );
            continue;
        }
        const changedField = IDENTITY_FIELDS.find(
            (field) => !bytesEqual(existing[field], record[field]),
        );
        if (changedField) {
            logRejected(`${changedField} changed`, record);
            continue;
        }
        if (existing.Deleted && !record.Deleted) {
            logRejected("record was deleted", record);
            continue;
        }
        if (record.RelayOrigin !== existing.RelayOrigin)
            logRejected("RelayOrigin changed (kept the first)", record);
        // Compared by its real hash: a sender can't win ties with a made-up one.
        const candidate = normalizeReceived(
            record,
            undefined,
            existing.RelayOrigin,
            now,
        );
        // A tombstone wins over a live record whatever its version.
        const accept =
            (candidate.Deleted && !existing.Deleted) ||
            shouldAcceptVersionedRecord(existing, candidate);
        const merged = normalizeReceived(
            accept ? candidate : existing,
            accept ? existing : candidate,
            existing.RelayOrigin,
            now,
        );
        // Rejected: this side's record stays, with the names the other side
        // approved.
        if (accept || merged.Hash !== existing.Hash)
            records.set(record.ID, merged);
    }
    return [...records.values()];
}

/** Copies arrays too, so later edits can't reach into the sender's object. */
export const cloneConnectedAgent = (
    record: VaultUtilTypes.ConnectedAgent,
): VaultUtilTypes.ConnectedAgent => ({
    ...record,
    AgentSignPublicKey: new Uint8Array(record.AgentSignPublicKey),
    AgentKEMPublicKey: new Uint8Array(record.AgentKEMPublicKey),
    ApproverSignPublicKey: new Uint8Array(record.ApproverSignPublicKey),
    ApproverKEMPublicKey: new Uint8Array(record.ApproverKEMPublicKey),
    RevocationSeed: new Uint8Array(record.RevocationSeed),
    CredentialIDs: [...record.CredentialIDs],
    History: record.History.map((entry) => ({ ...entry })),
    KnownHosts: (record.KnownHosts ?? []).map((entry) => ({ ...entry })),
    Paused: record.Paused ?? false,
});

/** Not deleted, most recently paired first. */
export const visibleConnectedAgents = (
    records: readonly VaultUtilTypes.ConnectedAgent[],
): VaultUtilTypes.ConnectedAgent[] =>
    records
        .filter((record) => !record.Deleted)
        .sort((a, b) => b.PairedAtTimestamp - a.PairedAtTimestamp);

/**
 * JSON channels (extension messages, chrome.storage) turn Uint8Array into
 * plain objects, which would corrupt the keys. Records cross them as base64
 * protobuf instead.
 */
export const connectedAgentsToTransport = (
    records: readonly VaultUtilTypes.ConnectedAgent[],
): string[] =>
    records.map((record) =>
        uint8ToBase64(VaultUtilTypes.ConnectedAgent.encode(record).finish()),
    );

/** Reverses connectedAgentsToTransport, skipping values that don't decode. */
export function connectedAgentsFromTransport(
    values: unknown,
): VaultUtilTypes.ConnectedAgent[] {
    if (!Array.isArray(values)) return [];
    const records: VaultUtilTypes.ConnectedAgent[] = [];
    for (const value of values) {
        if (typeof value !== "string") continue;
        try {
            records.push(
                VaultUtilTypes.ConnectedAgent.decode(base64ToUint8(value)),
            );
        } catch {
            // A damaged entry shouldn't cost the others.
        }
    }
    return records;
}
