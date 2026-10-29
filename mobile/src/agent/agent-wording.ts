import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import {
    historyTitleParts,
    requestTitleParts,
    serverName,
    type KnownHostCheck,
} from "@cryptex-industries/vault-core/agent/agent-format";
import type { IncomingRequest } from "@cryptex-industries/vault-core/agent/approver-types";
import {
    callerProcess,
    isGitSignature,
    processName,
    type RememberChoice,
} from "@cryptex-industries/vault-core/agent/remember";
import { sanitizeDisplayText } from "@cryptex-industries/vault-core/agent/request-check";
import {
    AgentRequestOutcome,
    type AgentRequestRecord,
    type ConnectedAgent,
} from "@cryptex-industries/vault-core/proto";

/** "Just now", "4 min ago", "3 hours ago", "Yesterday", or a date. */
export function formatAgo(timestamp: number, now = Date.now()): string {
    if (!timestamp)
        return t({ message: "Never", comment: "When an agent was last used" });
    const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
    if (minutes < 1) return t`Just now`;
    if (minutes < 60)
        return plural(minutes, { one: "# min ago", other: "# min ago" });
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return plural(hours, { one: "# hour ago", other: "# hours ago" });
    if (hours < 48) return t`Yesterday`;
    return new Date(timestamp).toLocaleDateString(i18n.locale, {
        day: "numeric",
        month: "short",
        year:
            new Date(timestamp).getFullYear() === new Date(now).getFullYear()
                ? undefined
                : "numeric",
    });
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
    const count = agent.CredentialIDs.length;
    if (!approvedHere) {
        if (!agent.ApproverName)
            return plural(count, {
                one: "# key, approver: another device",
                other: "# keys, approver: another device",
            });
        const approver = sanitizeDisplayText(agent.ApproverName);
        return plural(count, {
            one: `# key, approver: ${approver}`,
            other: `# keys, approver: ${approver}`,
        });
    }
    if (!agent.LastUsedTimestamp)
        return plural(count, {
            one: "# key, not used yet",
            other: "# keys, not used yet",
        });
    const used = formatAgo(agent.LastUsedTimestamp, now).toLowerCase();
    return plural(count, {
        one: `# key, used ${used}`,
        other: `# keys, used ${used}`,
    });
}

export function historyTitle(entry: AgentRequestRecord): string {
    const title = historyTitleParts(entry);
    switch (title.kind) {
        case "git-signature":
            return t`Git signature`;
        case "signature": {
            const namespace = title.namespace;
            return t`${namespace} signature`;
        }
        case "login": {
            const { program, server } = title;
            return t`${program} to ${server}`;
        }
        case "unknown-login": {
            const program = title.program;
            return t`${program} to an unknown server`;
        }
        case "other":
            return t`Other request`;
    }
}

export function outcomeLabel(outcome: AgentRequestOutcome): string {
    switch (outcome) {
        case AgentRequestOutcome.AgentOutcomeApproved:
            return t({ message: "Approved", comment: "Agent request outcome" });
        case AgentRequestOutcome.AgentOutcomeApprovedByRule:
            return t`Approved automatically`;
        case AgentRequestOutcome.AgentOutcomeDenied:
            return t({ message: "Denied", comment: "Agent request outcome" });
        case AgentRequestOutcome.AgentOutcomeExpired:
            return t({ message: "Expired", comment: "Agent request outcome" });
        case AgentRequestOutcome.AgentOutcomeRefused:
            return t({ message: "Refused", comment: "Agent request outcome" });
        default:
            return t({ message: "Unknown", comment: "Agent request outcome" });
    }
}

/** The approval screen title. */
export function requestTitle(request: Pick<IncomingRequest, "check">): string {
    const title = requestTitleParts(request);
    switch (title.kind) {
        case "git-signature":
            return t`Sign a git commit?`;
        case "file-signature":
            return t`Sign a file?`;
        case "signature": {
            const namespace = title.namespace;
            return t`Create a ${namespace} signature?`;
        }
        case "unknown-login":
            return t`SSH login, destination unknown`;
        case "login": {
            const server = title.server;
            return server
                ? t`Sign in to ${server}?`
                : t`Sign in to this server?`;
        }
    }
}

/** The label of a Remember choice on the approval screen. */
export function rememberLabel(
    choice: RememberChoice,
    request: IncomingRequest,
    keyName: string,
    agentName: string,
): string {
    if (choice === "once") return t`Only this request`;
    if (isGitSignature(request))
        return t`${keyName} key for this git process, until it exits or the vault locks`;
    if (choice === "process") {
        const program = processName(callerProcess(request.sign.processes), "");
        return program
            ? t`${keyName} key for ${program} on ${agentName}, until the vault locks`
            : t`${keyName} key for this program on ${agentName}, until the vault locks`;
    }
    const host = request.check.verifiedHost;
    if (!host) return t`${keyName} key for this server, until the vault locks`;
    const server = serverName(host);
    return t`${keyName} key for ${server}, until the vault locks`;
}

/** Warnings for the approval screen, strongest first; empty when nothing changed. */
export function knownHostWarnings(check: KnownHostCheck | null): string[] {
    if (!check?.name) return [];
    const name = check.name;
    const warnings: string[] = [];
    if (check.otherKey)
        warnings.push(t`${name} has a different host key than before.`);
    if (check.previousNames.length) {
        const previous = check.previousNames[0];
        warnings.push(
            t`This machine now calls this server ${name}. Before, it was ${previous}.`,
        );
    }
    return warnings;
}

/** The note under the Server row: whose word the name is. */
export function serverNameNote(check: KnownHostCheck | null): string {
    if (check?.known) return t`You approved this name for this host key before`;
    return t`Name reported by the machine, not verified`;
}
