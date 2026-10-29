import type { IncomingRequest } from "./approver-types";
import { sanitizeDisplayText } from "./request-check";
import type { Process } from "../proto/agent";

/**
 * Remembered approvals. They live in memory only and end when the vault
 * locks (each app clears them in its lock path). Forwarded,
 * destination-unknown and non-git SSHSIG requests are never remembered.
 * Shared by the Android app and the web dashboard.
 */

/** "once" answers only this request. */
export type RememberChoice = "once" | "process" | "host";

type Rule =
    | {
          kind: "process";
          agentId: string;
          credentialId: string;
          exe: string;
      }
    | {
          kind: "host";
          agentId: string;
          credentialId: string;
          hostKeyFingerprint: string;
      }
    | {
          // Git signing: one git process (pid and program), as decided in the
          // design doc. A new process asks again.
          kind: "git-process";
          agentId: string;
          credentialId: string;
          pid: number;
          exe: string;
      };

const SSH_PROGRAMS = new Set(["ssh", "scp", "sftp", "ssh-keygen", "ssh-add"]);

function baseName(path: string) {
    return path.split("/").pop() ?? path;
}

/**
 * The program that caused the request. processes[0] connected to the agent
 * socket (usually ssh or ssh-keygen); for git push or git commit -S the
 * interesting one is its parent.
 */
export function callerProcess(processes: readonly Process[]): Process | null {
    const first = processes[0];
    if (!first) return null;
    const parent = processes[1];
    if (
        SSH_PROGRAMS.has(baseName(first.exe)) &&
        parent &&
        baseName(parent.exe) === "git"
    )
        return parent;
    return first;
}

/** "git push" as reported by the machine, sanitized. */
export function processLabel(
    process: Process | null,
    unknown = "Unknown program",
): string {
    if (!process) return unknown;
    const args = process.args.length
        ? process.args
              .map((arg, index) => (index === 0 ? baseName(arg) : arg))
              .join(" ")
        : baseName(process.exe);
    return sanitizeDisplayText(args || unknown, 80);
}

/** Short program name for the Remember rows, such as "git". */
export function processName(
    process: Process | null,
    fallback = "this program",
): string {
    return sanitizeDisplayText(
        (process && baseName(process.exe)) || fallback,
        32,
    );
}

export function isGitSignature(request: Pick<IncomingRequest, "check">) {
    return (
        request.check.kind === "signature" && request.check.namespace === "git"
    );
}

/** The choices the approval screen offers; empty hides the section. */
export function rememberChoices(
    request: Pick<IncomingRequest, "check" | "sign">,
): RememberChoice[] {
    const { check } = request;
    if (check.forwardedVia.length || check.destinationUnknown) return [];
    if (check.kind === "login" && check.verifiedHost)
        // Without its path, a program rule would match every other program
        // whose path the machine couldn't read.
        return callerProcess(request.sign.processes)?.exe
            ? ["once", "process", "host"]
            : ["once", "host"];
    if (isGitSignature(request)) return ["once", "process"];
    return [];
}

function ruleFor(
    request: IncomingRequest,
    credentialId: string,
    choice: RememberChoice,
): Rule | null {
    if (choice === "once" || !rememberChoices(request).includes(choice))
        return null;
    const caller = callerProcess(request.sign.processes);
    if (isGitSignature(request)) {
        if (!caller) return null;
        return {
            kind: "git-process",
            agentId: request.agentId,
            credentialId,
            pid: caller.pid,
            exe: caller.exe,
        };
    }
    if (choice === "host") {
        const fingerprint = request.check.verifiedHost?.fingerprint;
        return fingerprint
            ? {
                  kind: "host",
                  agentId: request.agentId,
                  credentialId,
                  hostKeyFingerprint: fingerprint,
              }
            : null;
    }
    return caller
        ? {
              kind: "process",
              agentId: request.agentId,
              credentialId,
              exe: caller.exe,
          }
        : null;
}

export class RememberedApprovals {
    private rules: Rule[] = [];

    add(
        request: IncomingRequest,
        credentialId: string,
        choice: RememberChoice,
    ) {
        const rule = ruleFor(request, credentialId, choice);
        if (rule) this.rules.push(rule);
        return rule !== null;
    }

    /** True when a remembered rule approves this request with this key. */
    matches(request: IncomingRequest, credentialId: string): boolean {
        // Same guard as the choices: these requests always ask.
        if (!rememberChoices(request).length) return false;
        const caller = callerProcess(request.sign.processes);
        const git = isGitSignature(request);
        return this.rules.some((rule) => {
            if (
                rule.agentId !== request.agentId ||
                rule.credentialId !== credentialId
            )
                return false;
            if (git)
                return (
                    rule.kind === "git-process" &&
                    !!caller &&
                    rule.pid === caller.pid &&
                    rule.exe === caller.exe
                );
            if (request.check.kind !== "login") return false;
            if (rule.kind === "host")
                return (
                    rule.hostKeyFingerprint ===
                    request.check.verifiedHost?.fingerprint
                );
            return (
                rule.kind === "process" && !!caller && rule.exe === caller.exe
            );
        });
    }

    forgetAgent(agentId: string) {
        this.rules = this.rules.filter((rule) => rule.agentId !== agentId);
    }

    clear() {
        this.rules = [];
    }

    get size() {
        return this.rules.length;
    }
}
