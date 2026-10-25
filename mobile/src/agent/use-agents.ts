import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import type { AgentIdentity } from "@cryptex-industries/vault-core/agent/envelope";
import type { ConnectedAgent } from "@cryptex-industries/vault-core/proto";
import { isApprovedHere } from "@cryptex-industries/vault-core/agent/vault-agents";
import { visibleConnectedAgents } from "@cryptex-industries/vault-core/vault-utils/connected-agents";

import { unlockedVaultAtom } from "@/utils/atoms";
import { agentRuntime } from "./agent-app";
import { useAgentRuntimeVersion } from "./agent-runtime-bridge";
import { loadApproverIdentity } from "./agent-storage";

/** This device's approver identity, once loaded from secure storage. */
function useApproverIdentity(): AgentIdentity | null {
    const [identity, setIdentity] = useState<AgentIdentity | null>(null);
    useEffect(() => {
        let cancelled = false;
        void loadApproverIdentity()
            .then((value) => {
                if (!cancelled) setIdentity(value);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);
    return identity;
}

/**
 * The vault's connected agents, newest first, and which this device
 * approves: the synced record names this phone and this phone paired it
 * (its device-local list), so a record from another device can't claim it.
 */
export function useConnectedAgents() {
    const vault = useAtomValue(unlockedVaultAtom);
    const identity = useApproverIdentity();
    // Re-renders when the runtime's local list or relay state changes.
    useAgentRuntimeVersion();
    const agents = useMemo(
        () => visibleConnectedAgents(vault.ConnectedAgents ?? []),
        [vault.ConnectedAgents],
    );
    const approvedHere = (agent: ConnectedAgent) =>
        isApprovedHere(agent, identity) &&
        agentRuntime.approvesLocally(agent.ID);
    /** Devices list subtitle when something needs attention, else null. */
    const statusLabel = (agent: ConnectedAgent) =>
        approvedHere(agent) && agentRuntime.relayForgot(agent.ID)
            ? "The relay no longer knows this agent"
            : agent.Paused
              ? "Paused"
              : null;
    return { agents, approvedHere, statusLabel };
}
