import { useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import {
    AlertTriangle,
    ArrowLeft,
    GitCommitHorizontal,
    KeyRound,
    Pause,
    PenLine,
    Play,
    Trash2,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import {
    revokeAgent,
    updateAgentKeys,
} from "@cryptex-industries/vault-core/agent/agent-actions";
import {
    formatAgo,
    historyTitle,
    machineLabel,
    outcomeLabel,
    relayLabel,
} from "@cryptex-industries/vault-core/agent/agent-format";
import { sanitizeDisplayText } from "@cryptex-industries/vault-core/agent/request-check";
import { RELAY_FORGOT_AGENT_TEXT } from "@cryptex-industries/vault-core/agent/runtime";
import { sshKeyItems } from "@cryptex-industries/vault-core/agent/vault-agents";
import { AgentRequestKind } from "@cryptex-industries/vault-core/proto";
import { hostedRelayUrl } from "@/app_lib/agent/browser-agent-host";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { unlockedVaultAtom } from "@/utils/atoms";
import { useConnectedAgents } from "./agent-host-context";
import {
    AgentGlyph,
    AgentInfoField,
    AgentRow,
    AgentSectionLabel,
    AgentWarning,
    KeyPicker,
    vaultKeyOptions,
} from "./agent-ui";

const RECENT_COUNT = 5;

const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    });

function Notice({
    children,
    action,
    testId,
}: {
    children: React.ReactNode;
    action?: React.ReactNode;
    testId?: string;
}) {
    return (
        <div
            role="status"
            data-testid={testId}
            className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"
        >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{children}</span>
            {action}
        </div>
    );
}

export function AgentView({
    agentId,
    onBack,
}: {
    agentId: string;
    onBack: () => void;
}) {
    const vault = useAtomValue(unlockedVaultAtom);
    const { agents, approvedHere, host } = useConnectedAgents();
    const agent = agents.find((item) => item.ID === agentId);
    const keys = useMemo(() => vaultKeyOptions(vault), [vault]);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [confirmRevoke, setConfirmRevoke] = useState(false);
    const [revoking, setRevoking] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
    const [pausing, setPausing] = useState(false);

    if (!agent) {
        return (
            <AgentPanel onBack={onBack}>
                <p className="text-sm text-muted-foreground">
                    This agent was revoked or isn&apos;t in this vault anymore.
                </p>
            </AgentPanel>
        );
    }

    const here = approvedHere(agent);
    const name = sanitizeDisplayText(agent.Name || "Agent");

    const saveKeys = async () => {
        if (!host) return;
        setSaving(true);
        try {
            await updateAgentKeys(
                agent,
                sshKeyItems(vault).filter((item) => draft.includes(item.ID)),
                host,
            );
            setEditing(false);
            toast.success("Keys updated");
        } catch {
            toast.error(
                "Couldn't update the keys. Check your connection and try again.",
            );
        } finally {
            setSaving(false);
        }
    };

    const revoke = async () => {
        if (!host) return;
        setRevoking(true);
        try {
            const { relayRevoked } = await revokeAgent(agent, {
                approvedHere: here,
                unregister: (agentId) => host.unregister(agentId),
                hostedRelayUrl: hostedRelayUrl(),
                fetch: (...args) => fetch(...args),
                markRevoked: (agentId) => host.revokeAgentInVault(agentId),
            });
            if (relayRevoked) toast.success("Agent revoked");
            else
                toast.success("Agent revoked", {
                    description:
                        "The relay couldn't be reached. The approving device removes the agent there when it next syncs.",
                });
            onBack();
        } catch {
            toast.error("Couldn't save the revocation in your vault.");
        } finally {
            setRevoking(false);
            setConfirmRevoke(false);
        }
    };

    const setPaused = async (paused: boolean) => {
        if (!host) return;
        setPausing(true);
        try {
            await host.setPaused(agent.ID, paused);
            toast.success(paused ? "Agent paused" : "Agent resumed");
        } catch {
            toast.error(
                paused
                    ? "Couldn't pause the agent. Try again."
                    : "Couldn't resume the agent. Try again.",
            );
        } finally {
            setPausing(false);
        }
    };

    const relayForgot = here && !!host?.relayForgot(agent.ID);

    const history = showAll
        ? agent.History
        : agent.History.slice(0, RECENT_COUNT);

    return (
        <AgentPanel
            onBack={onBack}
            scrollerRef={setScroller}
            actions={
                here ? (
                    <Button
                        variant="outline"
                        size="sm"
                        data-testid="agent-edit-keys"
                        onClick={() => {
                            setDraft(agent.CredentialIDs);
                            setEditing(true);
                        }}
                    >
                        Edit keys
                    </Button>
                ) : null
            }
        >
            <div className="flex items-center gap-3.5">
                <AgentGlyph variant="identity" />
                <div className="min-w-0">
                    <h2 className="truncate text-2xl font-medium tracking-[-0.7px] text-foreground">
                        {name}
                    </h2>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {agent.AgentVersion
                            ? `cryptex-agent ${sanitizeDisplayText(agent.AgentVersion, 32)}`
                            : "cryptex-agent"}
                    </p>
                </div>
            </div>

            {agent.Paused ? (
                <Notice
                    testId="agent-paused"
                    action={
                        <Button
                            size="sm"
                            variant="outline"
                            data-testid="agent-resume"
                            disabled={pausing || !host}
                            onClick={() => void setPaused(false)}
                        >
                            <Play className="h-4 w-4" aria-hidden="true" />
                            Resume
                        </Button>
                    }
                >
                    Paused. Requests from this agent are refused without asking.
                </Notice>
            ) : null}
            {relayForgot ? (
                <Notice testId="agent-relay-forgot">
                    {RELAY_FORGOT_AGENT_TEXT}
                </Notice>
            ) : null}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <AgentInfoField
                    label="Approver"
                    testId="agent-approver"
                    value={
                        here
                            ? `${sanitizeDisplayText(agent.ApproverName || "This browser")} (this browser)`
                            : sanitizeDisplayText(
                                  agent.ApproverName || "Another device",
                              )
                    }
                />
                <AgentInfoField
                    label="Machine"
                    value={machineLabel(agent)}
                    note="Reported by the machine"
                />
                <AgentInfoField
                    label="Paired"
                    value={formatDate(agent.PairedAtTimestamp)}
                />
                <AgentInfoField
                    label="Relay"
                    value={relayLabel(agent.RelayOrigin)}
                />
            </div>

            <AgentSectionLabel
                title="Keys"
                right={String(agent.CredentialIDs.length)}
            />
            <div className="rounded-lg border border-border px-2">
                {agent.CredentialIDs.length ? (
                    agent.CredentialIDs.map((credentialId) => {
                        const key = keys.find(
                            (item) => item.id === credentialId,
                        );
                        return (
                            <AgentRow
                                key={credentialId}
                                title={key?.name ?? "Deleted item"}
                                detail={key?.detail ?? "No longer in the vault"}
                            />
                        );
                    })
                ) : (
                    <p className="px-1 py-3 text-sm text-muted-foreground">
                        No keys.
                    </p>
                )}
            </div>

            <AgentSectionLabel
                title="Recent requests"
                right={
                    agent.History.length > RECENT_COUNT ? (
                        <button
                            type="button"
                            className="text-xs font-medium text-primary hover:underline"
                            onClick={() => setShowAll((value) => !value)}
                        >
                            {showAll ? "Show less" : "See all"}
                        </button>
                    ) : undefined
                }
            />
            <div
                className="rounded-lg border border-border px-2"
                data-testid="agent-history"
            >
                {history.length ? (
                    // Only the rows in view are drawn; the page scrolls them.
                    scroller && (
                        <Virtuoso
                            customScrollParent={scroller}
                            data={history}
                            computeItemKey={(index, entry) =>
                                `${entry.Timestamp}-${index}`
                            }
                            itemContent={(index, entry) => (
                                <AgentRow
                                    // Each row is alone in its wrapper, so
                                    // last: matches every row; set the
                                    // divider by position instead.
                                    className={
                                        index === history.length - 1
                                            ? "border-b-0"
                                            : "last:border-b"
                                    }
                                    icon={
                                        entry.Kind ===
                                        AgentRequestKind.AgentRequestSignature
                                            ? entry.Namespace === "git"
                                                ? GitCommitHorizontal
                                                : PenLine
                                            : KeyRound
                                    }
                                    title={historyTitle(entry)}
                                    detail={`${outcomeLabel(entry.Outcome)}, ${formatAgo(entry.Timestamp).toLowerCase()}`}
                                    monospace={false}
                                />
                            )}
                        />
                    )
                ) : (
                    <p className="px-1 py-3 text-sm text-muted-foreground">
                        No requests yet.
                    </p>
                )}
            </div>

            <Separator className="my-6" />
            <div className="flex flex-wrap gap-2">
                {agent.Paused ? null : (
                    <Button
                        variant="outline"
                        data-testid="agent-pause-page"
                        disabled={pausing || !host}
                        onClick={() => void setPaused(true)}
                    >
                        <Pause className="h-4 w-4" aria-hidden="true" />
                        Pause agent
                    </Button>
                )}
                <Button
                    variant="destructive"
                    data-testid="agent-revoke"
                    disabled={revoking}
                    onClick={() => setConfirmRevoke(true)}
                >
                    <Trash2 className="h-4 w-4" />
                    {relayForgot ? "Remove agent" : "Revoke agent"}
                </Button>
            </div>

            <AlertDialog
                open={confirmRevoke}
                onOpenChange={(open) => !revoking && setConfirmRevoke(open)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{`Revoke ${name}?`}</AlertDialogTitle>
                        <AlertDialogDescription>
                            The agent can&apos;t ask for signatures anymore. To
                            use it again, pair it again with cryptex-agent pair.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={revoking}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            data-testid="agent-revoke-confirm"
                            className={buttonVariants({
                                variant: "destructive",
                            })}
                            disabled={revoking}
                            onClick={(event) => {
                                event.preventDefault();
                                void revoke();
                            }}
                        >
                            {revoking ? "Revoking…" : "Revoke agent"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog
                open={editing}
                onOpenChange={(open) => !saving && setEditing(open)}
            >
                <DialogContent className="grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit keys</DialogTitle>
                        <DialogDescription>
                            {`${name} can ask to sign with the keys you pick. It gets the new list the next time it connects.`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="-mx-6 -my-1 min-h-0 overflow-y-auto px-6 py-1">
                        <KeyPicker
                            keys={keys}
                            selected={draft}
                            disabled={saving}
                            onChange={setDraft}
                            title="Keys this agent can use"
                            labelClassName="mt-0"
                        />
                    </div>
                    <div className="space-y-3">
                        {draft.length ? null : (
                            <AgentWarning testId="agent-no-keys">
                                With no keys, this agent can&apos;t sign
                                anything until you add some again.
                            </AgentWarning>
                        )}
                        <DialogFooter>
                            <Button
                                data-testid="agent-keys-save"
                                disabled={saving}
                                onClick={() => void saveKeys()}
                            >
                                {saving ? "Saving…" : "Save keys"}
                            </Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>
        </AgentPanel>
    );
}

/** The main panel frame, like the Shared Links and Security Report views. */
function AgentPanel({
    onBack,
    actions,
    children,
    scrollerRef,
}: {
    onBack: () => void;
    actions?: React.ReactNode;
    children: React.ReactNode;
    scrollerRef?: React.Ref<HTMLDivElement>;
}) {
    return (
        <main
            className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground shadow-2xl"
            data-testid="agent-view"
        >
            <div className="shrink-0 border-b border-border">
                <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-3 sm:px-6 lg:px-8 lg:pt-6">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="-ml-2 shrink-0"
                        aria-label="Back to credentials"
                        title="Back to credentials"
                        onClick={onBack}
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
                        Connected agent
                    </h1>
                    {actions}
                </div>
            </div>
            <ScrollArea className="min-h-0 flex-1" viewportRef={scrollerRef}>
                <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
                    {children}
                </div>
            </ScrollArea>
        </main>
    );
}
