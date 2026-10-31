/** Display text for connected agents, shared by the Android app and the web dashboard. */

import {
    AgentRequestKind,
    AgentRequestOutcome,
    type AgentKnownHost,
    type AgentRequestRecord,
    type ConnectedAgent,
} from "../proto/vault";
import type { SSHKeyInfo } from "../vault-utils/ssh-key-info";
import type { VaultCredential } from "../vault-utils/vault";
import type { ClaimedPairing, IncomingRequest } from "./approver-types";
import {
    callerProcess,
    isGitSignature,
    processName,
    type RememberChoice,
} from "./remember";
import { hasHiddenCharacters, sanitizeDisplayText } from "./request-check";

/** "Just now", "4 min ago", "3 hours ago", "Yesterday", or a date. */
export function formatAgo(timestamp: number, now = Date.now()): string {
    if (!timestamp) return "Never";
    const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
    if (hours < 48) return "Yesterday";
    return new Date(timestamp).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year:
            new Date(timestamp).getFullYear() === new Date(now).getFullYear()
                ? undefined
                : "numeric",
    });
}

export function keyCount(count: number) {
    return count === 1 ? "1 key" : `${count} keys`;
}

/** Second line of an agent row in the Devices list. */
export function agentRowSubtitle(
    agent: Pick<
        ConnectedAgent,
        "CredentialIDs" | "LastUsedTimestamp" | "ApproverName"
    >,
    approvedHere: boolean,
    now = Date.now(),
): string {
    const keys = keyCount(agent.CredentialIDs.length);
    if (!approvedHere)
        return `${keys}, approver: ${sanitizeDisplayText(agent.ApproverName || "another device")}`;
    if (!agent.LastUsedTimestamp) return `${keys}, not used yet`;
    return `${keys}, used ${formatAgo(agent.LastUsedTimestamp, now).toLowerCase()}`;
}

/** "arch-desktop, Linux amd64", as reported by the machine. */
export function machineLabel(
    agent: Pick<ConnectedAgent, "Hostname" | "OS" | "Arch">,
    unknown = "Unknown machine",
) {
    const os = agent.OS
        ? agent.OS.charAt(0).toUpperCase() + agent.OS.slice(1)
        : "";
    const platform = [os, agent.Arch].filter(Boolean).join(" ");
    return sanitizeDisplayText(
        [agent.Hostname || unknown, platform].filter(Boolean).join(", "),
        96,
    );
}

/** machineLabel for a pairing offer, before the agent has a record. */
export function offerMachineLabel(
    offer: Pick<ClaimedPairing["offer"], "hostname" | "os" | "arch">,
    unknown?: string,
) {
    return machineLabel(
        {
            Hostname: offer.hostname,
            OS: offer.os,
            Arch: offer.arch,
        },
        unknown,
    );
}

/** The relay's host, or "Online Services" for the hosted relay (empty origin). */
export function relayLabel(relayOrigin: string, hosted = "Online Services") {
    return relayOrigin ? new URL(relayOrigin).host : hosted;
}

/** A short fingerprint for rows: "SHA256:q9X2…Lk7e". */
export function shortFingerprint(fingerprint: string) {
    const [prefix, body] = fingerprint.split(":");
    if (!body || body.length <= 14) return fingerprint;
    return `${prefix}:${body.slice(0, 8)}…${body.slice(-4)}`;
}

/** A server's known_hosts name, else its short host key fingerprint. */
export function serverName(host: { fingerprint: string; names: string[] }) {
    return sanitizeDisplayText(
        host.names[0] ?? shortFingerprint(host.fingerprint),
    );
}

/** The hops a forwarded request came through, such as "jump.example.com". */
export function forwardedViaLabel(request: Pick<IncomingRequest, "check">) {
    return request.check.forwardedVia.map(serverName).join(", ");
}

/** A login without a usable session-bind: Deny is the default, never remembered. */
export function isDestinationUnknown(request: Pick<IncomingRequest, "check">) {
    const { check } = request;
    return (
        check.kind === "login" &&
        (check.destinationUnknown || !check.verifiedHost)
    );
}

export type AgentKeyOption = {
    id: string;
    name: string;
    /** "Ed25519 SHA256:q9X2…Lk7e" */
    detail: string;
    fingerprint: string;
};

/** SSH key items (sshKeyItems), as the key pickers list them. */
export function agentKeyOptions(
    items: readonly VaultCredential[],
    describe: (credential: VaultCredential) => SSHKeyInfo | null,
    keyLabel = "SSH key",
): AgentKeyOption[] {
    return items.map((credential) => {
        const info = describe(credential);
        return {
            id: credential.ID,
            name: credential.Name || keyLabel,
            detail: info
                ? `${info.label} ${shortFingerprint(info.fingerprint)}`
                : keyLabel,
            fingerprint: info?.fingerprint ?? credential.ID,
        };
    });
}

/** The keys whose name, type or fingerprint contains the query. */
export function filterAgentKeys(
    keys: readonly AgentKeyOption[],
    query: string,
): readonly AgentKeyOption[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return keys;
    return keys.filter((key) =>
        [key.name, key.detail, key.fingerprint].some((text) =>
            text.toLowerCase().includes(needle),
        ),
    );
}

/** True when every shown key is selected, so "Select all" becomes "Clear all". */
export const allKeysSelected = (
    selected: readonly string[],
    shown: readonly AgentKeyOption[],
) => shown.length > 0 && shown.every((key) => selected.includes(key.id));

/**
 * Select all for the shown keys: adds them all, or removes them all when they
 * are already selected. Keys hidden by a search keep their state.
 */
export function toggleShownKeys(
    selected: readonly string[],
    shown: readonly AgentKeyOption[],
): string[] {
    const ids = shown.map((key) => key.id);
    if (allKeysSelected(selected, shown))
        return selected.filter((id) => !ids.includes(id));
    return [...selected, ...ids.filter((id) => !selected.includes(id))];
}

const capitalize = (text: string) =>
    text.charAt(0).toUpperCase() + text.slice(1);

function firstWord(text: string) {
    return text.trim().split(/\s+/)[0] || "ssh";
}

/** What a history entry was, with its display-ready names, for historyTitle. */
export type HistoryTitleParts =
    | { kind: "git-signature" }
    | { kind: "signature"; namespace: string }
    | { kind: "login"; program: string; server: string }
    | { kind: "unknown-login"; program: string }
    | { kind: "other" };

export function historyTitleParts(
    entry: AgentRequestRecord,
): HistoryTitleParts {
    const program = sanitizeDisplayText(firstWord(entry.Process), 32);
    if (entry.Kind === AgentRequestKind.AgentRequestSignature)
        return entry.Namespace === "git"
            ? { kind: "git-signature" }
            : {
                  kind: "signature",
                  namespace: capitalize(
                      sanitizeDisplayText(entry.Namespace || "file", 32),
                  ),
              };
    if (entry.Kind === AgentRequestKind.AgentRequestLogin) {
        if (entry.Host)
            return {
                kind: "login",
                program,
                server: sanitizeDisplayText(entry.Host),
            };
        if (entry.DestinationUnknown) return { kind: "unknown-login", program };
        return {
            kind: "login",
            program,
            server: shortFingerprint(entry.HostKeyFingerprint),
        };
    }
    return { kind: "other" };
}

export function historyTitle(entry: AgentRequestRecord): string {
    const title = historyTitleParts(entry);
    switch (title.kind) {
        case "git-signature":
            return "Git signature";
        case "signature":
            return `${title.namespace} signature`;
        case "login":
            return `${title.program} to ${title.server}`;
        case "unknown-login":
            return `${title.program} to an unknown server`;
        case "other":
            return "Other request";
    }
}

export function outcomeLabel(outcome: AgentRequestOutcome): string {
    switch (outcome) {
        case AgentRequestOutcome.AgentOutcomeApproved:
            return "Approved";
        case AgentRequestOutcome.AgentOutcomeApprovedByRule:
            return "Approved automatically";
        case AgentRequestOutcome.AgentOutcomeDenied:
            return "Denied";
        case AgentRequestOutcome.AgentOutcomeExpired:
            return "Expired";
        case AgentRequestOutcome.AgentOutcomeRefused:
            return "Refused";
        default:
            return "Unknown";
    }
}

/** What the approval screen asks, with its display-ready names, for requestTitle. */
export type RequestTitleParts =
    | { kind: "git-signature" | "file-signature" | "unknown-login" }
    | { kind: "signature"; namespace: string }
    | { kind: "login"; server: string | null };

export function requestTitleParts(
    request: Pick<IncomingRequest, "check">,
): RequestTitleParts {
    const { check } = request;
    if (check.kind === "signature") {
        if (check.namespace === "git") return { kind: "git-signature" };
        if (check.namespace === "file") return { kind: "file-signature" };
        return {
            kind: "signature",
            namespace: sanitizeDisplayText(check.namespace || "file", 32),
        };
    }
    if (check.destinationUnknown || !check.verifiedHost)
        return { kind: "unknown-login" };
    const name = check.verifiedHost.names[0];
    return { kind: "login", server: name ? sanitizeDisplayText(name) : null };
}

/** The approval screen title. */
export function requestTitle(request: Pick<IncomingRequest, "check">): string {
    const title = requestTitleParts(request);
    switch (title.kind) {
        case "git-signature":
            return "Sign a git commit?";
        case "file-signature":
            return "Sign a file?";
        case "signature":
            return `Create a ${title.namespace} signature?`;
        case "unknown-login":
            return "SSH login, destination unknown";
        case "login":
            return `Sign in to ${title.server ?? "this server"}?`;
    }
}

/** The label of a Remember choice on the approval screen. */
export function rememberLabel(
    choice: RememberChoice,
    request: IncomingRequest,
    keyName: string,
    agentName: string,
): string {
    if (choice === "once") return "Only this request";
    const program = processName(callerProcess(request.sign.processes));
    if (isGitSignature(request))
        return `${keyName} key for this git process, until it exits or the vault locks`;
    if (choice === "process")
        return `${keyName} key for ${program} on ${agentName}, until the vault locks`;
    const host = request.check.verifiedHost
        ? serverName(request.check.verifiedHost)
        : "this server";
    return `${keyName} key for ${host}, until the vault locks`;
}

/**
 * What the vault knows about a verified login's server name. Names come
 * from the machine's known_hosts, so only a name the user approved before
 * for this host key counts as known (ConnectedAgent.KnownHosts).
 */
export type KnownHostCheck = {
    /** The reported name, sanitized; null when the machine reported none. */
    name: string | null;
    fingerprint: string;
    /** The user approved this name with this host key before. */
    known: boolean;
    /** Names the user approved for this host key before, when this one is new for it. */
    previousNames: string[];
    /** The user approved this name with another host key before. */
    otherKey: boolean;
};

/** Null for requests without a verified server (signatures, unknown destinations). */
export function checkKnownHost(
    agent: Pick<ConnectedAgent, "KnownHosts"> | undefined,
    request: Pick<IncomingRequest, "check">,
): KnownHostCheck | null {
    const host = request.check.verifiedHost;
    if (request.check.kind !== "login" || !host) return null;
    const entries: readonly AgentKnownHost[] = agent?.KnownHosts ?? [];
    const name = host.names[0] ?? null;
    const sameKey = entries.filter(
        (entry) => entry.Fingerprint === host.fingerprint,
    );
    const known = !!name && sameKey.some((entry) => entry.Name === name);
    return {
        name: name === null ? null : sanitizeDisplayText(name),
        fingerprint: host.fingerprint,
        known,
        previousNames:
            known || !name
                ? []
                : [
                      ...new Set(
                          sameKey
                              .sort(
                                  (a, b) =>
                                      a.FirstSeenTimestamp -
                                      b.FirstSeenTimestamp,
                              )
                              .map((entry) => sanitizeDisplayText(entry.Name)),
                      ),
                  ],
        otherKey:
            !known &&
            !!name &&
            entries.some(
                (entry) =>
                    entry.Name === name &&
                    entry.Fingerprint !== host.fingerprint,
            ),
    };
}

/** Warnings for the approval screen, strongest first; empty when nothing changed. */
export function knownHostWarnings(check: KnownHostCheck | null): string[] {
    if (!check?.name) return [];
    const warnings: string[] = [];
    if (check.otherKey)
        warnings.push(`${check.name} has a different host key than before.`);
    if (check.previousNames.length)
        warnings.push(
            `This machine now calls this server ${check.name}. Before, it was ${check.previousNames[0]}.`,
        );
    return warnings;
}

/** The note under the Server row: whose word the name is. */
export function serverNameNote(check: KnownHostCheck | null): string {
    if (check?.known) return "You approved this name for this host key before";
    return "Name reported by the machine, not verified";
}

/**
 * The machine-controlled strings of a request had characters the
 * sanitizer hides, so the screen can say "contains hidden characters".
 */
export function requestHasHiddenCharacters(
    request: Pick<IncomingRequest, "check" | "sign">,
): boolean {
    const { check, sign } = request;
    const texts = [
        check.namespace ?? "",
        check.user ?? "",
        ...(check.verifiedHost?.names ?? []),
        ...check.forwardedVia.flatMap((hop) => hop.names),
        sign.hostname,
        ...sign.processes.flatMap((process) => [
            process.exe,
            process.cwd,
            ...process.args,
        ]),
    ];
    return texts.some(hasHiddenCharacters);
}
