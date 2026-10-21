import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { AlertTriangle, Pause } from "lucide-react";
import { toast } from "sonner";
import {
    checkKnownHost,
    forwardedViaLabel,
    isDestinationUnknown,
    knownHostWarnings,
    rememberLabel,
    requestHasHiddenCharacters,
    requestTitle,
    serverName,
    serverNameNote,
} from "@cryptex-industries/vault-core/agent/agent-format";
import {
    callerProcess,
    isGitSignature,
    processLabel,
    rememberChoices,
    type RememberChoice,
} from "@cryptex-industries/vault-core/agent/remember";
import {
    hasHiddenCharacters,
    sanitizeDisplayText,
} from "@cryptex-industries/vault-core/agent/request-check";
import { RequestGoneError } from "@cryptex-industries/vault-core/agent/runtime";
import { liveAgent } from "@cryptex-industries/vault-core/agent/vault-agents";
import type { WebAgentHost } from "@/app_lib/agent/web-agent-host";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { unlockedVaultAtom } from "@/utils/atoms";
import { getSSHKeyInfo } from "@/utils/ssh-key";
import { AgentInfoField, AgentSectionLabel, VerifiedBadge } from "./agent-ui";

function Warning({ children }: { children: React.ReactNode }) {
    return (
        <div
            role="alert"
            className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"
        >
            <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
            />
            <span>{children}</span>
        </div>
    );
}

/**
 * Approve ignores clicks, Enter and Space this long after each request
 * appears, so a keystroke or click meant for the page underneath can't
 * approve a prompt that just opened (browsers do the same for permission
 * prompts).
 */
export const APPROVE_DELAY_MS = 700;

/**
 * The approval dialog over the dashboard, with the content of the Android
 * approval screen. One request at a time; answering moves on to the next.
 * Closing it denies the request. It opens by itself, so nothing in it has
 * focus that a stray keystroke could approve.
 */
export function AgentRequestDialog({
    host,
    requestId,
}: {
    host: WebAgentHost;
    requestId: string;
}) {
    const request = host.getRequest(requestId);
    const vault = useAtomValue(unlockedVaultAtom);
    const [choice, setChoice] = useState<RememberChoice>("once");
    const [busy, setBusy] = useState<"approve" | "deny" | "pause" | null>(null);
    // The request ID Approve is armed for, after APPROVE_DELAY_MS.
    const [armedFor, setArmedFor] = useState<string | null>(null);

    useEffect(() => {
        host.setShownRequest(requestId);
        setChoice("once");
        setArmedFor(null);
        const timer = setTimeout(
            () => setArmedFor(requestId),
            APPROVE_DELAY_MS,
        );
        return () => {
            clearTimeout(timer);
            host.setShownRequest(null);
        };
    }, [host, requestId]);

    // Answered elsewhere, expired or withdrawn: show the next one, or close.
    useEffect(() => {
        if (!request && !busy) host.showNext();
    }, [request, busy, host]);

    if (!request) return null;

    const { check } = request;
    const key = host.keyFor(request);
    const agentName = sanitizeDisplayText(host.agentName(request.agentId));
    const caller = callerProcess(request.sign.processes);
    const keyName = key
        ? sanitizeDisplayText(key.name || "SSH key", 40)
        : "Unknown";
    const keyLabel = key
        ? `${keyName}, ${getSSHKeyInfo(key.sshKey)?.label ?? "SSH key"}`
        : "Not granted to this agent";
    const choices = rememberChoices(request);
    const unknown = isDestinationUnknown(request);
    const signature = check.kind === "signature";
    const forwarded = check.forwardedVia.length > 0;
    const via = forwardedViaLabel(request);
    const armed = armedFor === request.id;
    const waiting = host.waitingCount();
    const knownHost = checkKnownHost(
        liveAgent(vault, request.agentId),
        request,
    );
    const hostWarnings = knownHostWarnings(knownHost);
    const hidden = requestHasHiddenCharacters(request);
    const processText = `${processLabel(caller)}${caller ? ` (pid ${caller.pid})` : ""}`;
    const hiddenProcess = hasHiddenCharacters(processText);
    const hiddenServerName =
        !!knownHost?.name && hasHiddenCharacters(knownHost.name);

    // Each answer moves on to the next request when it settles.
    const answer = async (
        kind: NonNullable<typeof busy>,
        action: () => Promise<unknown>,
    ) => {
        setBusy(kind);
        try {
            await action();
        } finally {
            setBusy(null);
            host.showNext();
        }
    };

    const approve = () => {
        if (!armed) return;
        void answer("approve", () =>
            host.approve(request.id, choice).catch((error: unknown) => {
                toast.error(
                    error instanceof RequestGoneError
                        ? "This request is no longer waiting."
                        : error instanceof Error
                          ? error.message
                          : "Couldn't sign this request.",
                );
            }),
        );
    };

    const deny = () => void answer("deny", () => host.deny(request.id));

    // Refuses this and every later request from the agent without asking.
    const pause = () =>
        void answer("pause", () =>
            host.setPaused(request.agentId, true).then(
                () => toast.success(`Paused ${agentName}`),
                () => toast.error("Couldn't pause the agent. Try again."),
            ),
        );

    const approveButton = (
        <Button
            key="approve"
            data-testid="agent-approve"
            variant={unknown ? "outline" : "default"}
            disabled={!key || busy !== null || !armed}
            onClick={approve}
        >
            {busy === "approve"
                ? "Signing…"
                : unknown
                  ? "Approve once"
                  : "Approve"}
        </Button>
    );
    const denyButton = (
        <Button
            key="deny"
            data-testid="agent-deny"
            variant={unknown ? "default" : "outline"}
            disabled={busy !== null}
            onClick={deny}
        >
            {busy === "deny" ? "Denying…" : "Deny"}
        </Button>
    );

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open && busy === null) deny();
            }}
        >
            <DialogContent
                className="max-h-[90vh] overflow-y-auto focus:outline-none sm:max-w-lg"
                data-testid="agent-request"
                onInteractOutside={(event) => event.preventDefault()}
                tabIndex={-1}
                onOpenAutoFocus={(event) => {
                    // Never Approve: the dialog opens by itself, maybe while
                    // the user is typing. Deny when it is the default.
                    event.preventDefault();
                    const content = event.currentTarget as HTMLElement | null;
                    const target = unknown
                        ? content?.querySelector<HTMLElement>(
                              "[data-testid=agent-deny]",
                          )
                        : content;
                    target?.focus();
                }}
            >
                <DialogHeader>
                    {waiting > 1 ? (
                        <p
                            className="text-xs font-medium tabular-nums text-muted-foreground"
                            data-testid="agent-request-count"
                        >
                            {`1 of ${waiting} waiting`}
                        </p>
                    ) : null}
                    <DialogTitle className="text-xl font-medium leading-snug">
                        {requestTitle(request)}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        An SSH request from {agentName}
                    </DialogDescription>
                </DialogHeader>

                {hostWarnings.map((warning) => (
                    <Warning key={warning}>
                        <span data-testid="agent-host-warning">{warning}</span>
                    </Warning>
                ))}
                {hidden ? (
                    <Warning>
                        Some details contain hidden characters, shown as �.
                        Check them carefully.
                    </Warning>
                ) : null}

                {unknown ? (
                    <Warning>
                        This client didn&apos;t say which server it is logging
                        in to. Approve only if you just started this login
                        yourself.
                    </Warning>
                ) : null}
                {forwarded ? (
                    <Warning>
                        {`This request came through agent forwarding on ${via}. A server you're logged in to is asking to use your key.`}
                    </Warning>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                    <AgentInfoField label="Agent" value={agentName} />
                    {check.user ? (
                        <AgentInfoField
                            label="User"
                            value={sanitizeDisplayText(check.user)}
                            hidden={hasHiddenCharacters(check.user)}
                        />
                    ) : signature ? (
                        <AgentInfoField
                            label="Namespace"
                            value={sanitizeDisplayText(
                                check.namespace || "none",
                                32,
                            )}
                            monospace
                        />
                    ) : null}
                    {forwarded ? (
                        <div className="sm:col-span-2">
                            <AgentInfoField label="Via" value={via} />
                        </div>
                    ) : null}
                    {check.kind === "login" && check.verifiedHost ? (
                        <>
                            <div className="sm:col-span-2">
                                <AgentInfoField
                                    label="Server"
                                    testId="agent-request-server"
                                    value={serverName(check.verifiedHost)}
                                    monospace={hiddenServerName}
                                    hidden={
                                        hiddenServerName &&
                                        check.verifiedHost.names.length > 0
                                    }
                                    note={
                                        check.verifiedHost.names.length
                                            ? serverNameNote(knownHost)
                                            : undefined
                                    }
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <AgentInfoField
                                    label="Host key"
                                    value={check.verifiedHost.fingerprint}
                                    badge={<VerifiedBadge />}
                                    testId="agent-request-host-key"
                                    monospace
                                />
                            </div>
                        </>
                    ) : null}
                    <div className="sm:col-span-2">
                        <AgentInfoField label="Key" value={keyLabel} />
                    </div>
                    <div className="sm:col-span-2">
                        <AgentInfoField
                            label="Process"
                            value={processText}
                            hidden={hiddenProcess}
                            note={
                                hiddenProcess || !(signature && caller?.cwd)
                                    ? "Reported by the machine"
                                    : undefined
                            }
                        />
                    </div>
                    {signature && caller?.cwd ? (
                        <div className="sm:col-span-2">
                            <AgentInfoField
                                label="Folder"
                                value={sanitizeDisplayText(caller.cwd, 120)}
                                hidden={hasHiddenCharacters(caller.cwd)}
                                note="Process and folder are reported by the machine"
                            />
                        </div>
                    ) : null}
                </div>

                {signature || unknown ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        {signature
                            ? isGitSignature(request)
                                ? "Cryptex Vault sees only a hash of the commit. The repository isn't verified."
                                : "Cryptex Vault sees only a hash of what is signed."
                            : "Requests like this are never remembered."}
                    </p>
                ) : null}

                {choices.length && key ? (
                    <div role="radiogroup" aria-label="Remember">
                        <AgentSectionLabel title="Remember" className="mt-0" />
                        {choices.map((item) => (
                            <button
                                key={item}
                                type="button"
                                role="radio"
                                aria-checked={choice === item}
                                data-testid={`agent-remember-${item}`}
                                onClick={() => setChoice(item)}
                                className="flex w-full items-start gap-3 rounded-md px-1 py-2 text-left text-sm hover:bg-muted/40"
                            >
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2",
                                        choice === item
                                            ? "border-primary"
                                            : "border-input",
                                    )}
                                >
                                    {choice === item ? (
                                        <span className="h-2 w-2 rounded-full bg-primary" />
                                    ) : null}
                                </span>
                                <span className="text-foreground">
                                    {rememberLabel(
                                        item,
                                        request,
                                        keyName,
                                        agentName,
                                    )}
                                </span>
                            </button>
                        ))}
                    </div>
                ) : null}

                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                    <p className="text-xs text-muted-foreground">
                        Not expecting this?
                    </p>
                    <Button
                        variant="ghost"
                        size="sm"
                        data-testid="agent-pause"
                        disabled={busy !== null}
                        onClick={pause}
                    >
                        <Pause className="h-4 w-4" aria-hidden="true" />
                        {busy === "pause" ? "Pausing…" : "Pause agent"}
                    </Button>
                </div>

                <DialogFooter className="sticky -bottom-6 -mx-6 -mb-6 gap-2 border-t border-border bg-background px-6 py-4 sm:gap-0">
                    {unknown
                        ? [approveButton, denyButton]
                        : [denyButton, approveButton]}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
