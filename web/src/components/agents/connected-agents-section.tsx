import { Plus, Settings } from "lucide-react";
import {
    formatAgo,
    keyCount,
} from "@cryptex-industries/vault-core/agent/agent-format";
import { sanitizeDisplayText } from "@cryptex-industries/vault-core/agent/request-check";
import type { ConnectedAgent } from "@cryptex-industries/vault-core/proto";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useConnectedAgents } from "./agent-host-context";
import { AgentGlyph } from "./agent-ui";

/** Second line of a sidebar row. */
function sidebarSubtitle(agent: ConnectedAgent, here: boolean) {
    if (agent.Paused) return "Paused";
    const first = here
        ? keyCount(agent.CredentialIDs.length)
        : `Approver: ${sanitizeDisplayText(agent.ApproverName || "another device")}`;
    const used = agent.LastUsedTimestamp
        ? `used ${formatAgo(agent.LastUsedTimestamp).toLowerCase()}`
        : "not used yet";
    return `${first}, ${used}`;
}

/** "Connected Agents" in the dashboard sidebar, under Linked Devices. */
export function ConnectedAgentsSection({
    activeAgentId,
    onOpenAgent,
    onConnectAgent,
    onOpenRelaySettings,
}: {
    activeAgentId: string | null;
    onOpenAgent: (agentId: string) => void;
    onConnectAgent: () => void;
    onOpenRelaySettings: () => void;
}) {
    const { agents, approvedHere } = useConnectedAgents();
    return (
        <div className="pb-4" data-testid="agent-section">
            <div className="flex items-center justify-between px-2 py-3">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Connected Agents
                </span>
                <TooltipProvider>
                    <div className="flex items-center gap-1">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={onOpenRelaySettings}
                                    aria-label="Agent relay settings"
                                    data-testid="agent-relay-settings"
                                >
                                    <Settings className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Agent relays</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={onConnectAgent}
                                    aria-label="Connect an agent"
                                    data-testid="agent-connect"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Connect an agent</TooltipContent>
                        </Tooltip>
                    </div>
                </TooltipProvider>
            </div>
            {agents.length === 0 ? (
                <p className="px-3 text-xs leading-relaxed text-muted-foreground">
                    Use your SSH keys on a Linux machine without copying them
                    there.
                </p>
            ) : (
                <div className="space-y-1">
                    {agents.map((agent) => {
                        const name = sanitizeDisplayText(agent.Name || "Agent");
                        const active = activeAgentId === agent.ID;
                        return (
                            <button
                                key={agent.ID}
                                type="button"
                                data-testid={`agent-row-${agent.ID}`}
                                aria-current={active ? "page" : undefined}
                                onClick={() => onOpenAgent(agent.ID)}
                                className={cn(
                                    "hover:bg-sidebar-accent grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
                                    active && "bg-muted/60",
                                )}
                            >
                                <AgentGlyph />
                                <span className="min-w-0">
                                    <span
                                        className="block truncate text-sm font-medium text-foreground"
                                        title={name}
                                    >
                                        {name}
                                    </span>
                                    <span className="block truncate text-xs text-muted-foreground">
                                        {sidebarSubtitle(
                                            agent,
                                            approvedHere(agent),
                                        )}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
