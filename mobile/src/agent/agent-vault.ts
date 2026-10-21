import type { VaultAccess } from "@cryptex-industries/vault-core/agent/runtime";
import {
    findGrantedKey,
    liveAgent,
    withAgentRecord,
    withNewAgentRecord,
} from "@cryptex-industries/vault-core/agent/vault-agents";
import type { AgentRequestRecord, ConnectedAgent } from "@cryptex-industries/vault-core/proto";
import {
    appendConnectedAgentHistory,
    markConnectedAgentDeleted,
    updateConnectedAgentRecord,
    type ConnectedAgentChanges,
} from "@cryptex-industries/vault-core/vault-utils/connected-agents";
import type { VaultWriteKind } from "@cryptex-industries/vault-core/vault-utils/vault-write-coordinator";

import { isVaultUnlockedAtom, unlockedVaultAtom, vaultStore } from "@/utils/atoms";
import { isAutoLockDue } from "@/utils/session-timeout";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { vaultLockStateAtom } from "@/utils/vault-lock";
import { agentSigningStopped } from "./agent-locking";

/** Replaces one agent record through the app's vault write queue. */
async function updateAgentInVault(
    kind: VaultWriteKind,
    agentId: string,
    update: (record: ConnectedAgent) => Promise<ConnectedAgent>,
): Promise<boolean> {
    const result = await persistVaultMutation(kind, async (current) => ({
        vault: await withAgentRecord(current, agentId, update),
        result: undefined,
    }));
    return result.isOk();
}

export function changeAgent(agentId: string, changes: ConnectedAgentChanges) {
    return updateAgentInVault("agent.update", agentId, (record) =>
        updateConnectedAgentRecord(record, changes),
    );
}

export function revokeAgentInVault(agentId: string) {
    return updateAgentInVault("agent.revoke", agentId, markConnectedAgentDeleted);
}

export async function addAgentToVault(record: ConnectedAgent): Promise<boolean> {
    const result = await persistVaultMutation("agent.pair", (current) => ({
        vault: withNewAgentRecord(current, record),
        result: undefined,
    }));
    return result.isOk();
}

/**
 * Unlocked, the auto-lock deadline hasn't passed and no lock has started
 * since the last unlock: a lock stops signing before it saves and flushes
 * backups, and a failed lock keeps it stopped until the next unlock.
 */
export function canSign() {
    return (
        vaultStore.get(isVaultUnlockedAtom) &&
        !agentSigningStopped() &&
        vaultStore.get(vaultLockStateAtom) === "idle" &&
        !isAutoLockDue()
    );
}

/** One vault write for the entries (the runtime flushes what it queued while locked). */
async function appendHistoryEntries(agentId: string, entries: AgentRequestRecord[]) {
    if (!canSign()) return false;
    if (!liveAgent(vaultStore.get(unlockedVaultAtom), agentId)) return true;
    return updateAgentInVault("agent.history", agentId, (record) =>
        appendConnectedAgentHistory(record, entries),
    );
}

export const mobileVaultAccess: VaultAccess = {
    canSign,
    grantedKey(agentId, publicKey) {
        if (!canSign()) return "locked";
        return findGrantedKey(vaultStore.get(unlockedVaultAtom), agentId, publicKey);
    },
    // The live record, so a stale agent cache can't undo a pause.
    isPaused(agentId) {
        if (!canSign()) return false;
        return !!liveAgent(vaultStore.get(unlockedVaultAtom), agentId)?.Paused;
    },
    // A pairing whose record was saved is kept, also while the cache lags.
    hasAgentRecord(agentId) {
        if (!vaultStore.get(isVaultUnlockedAtom)) return "locked";
        return !!liveAgent(vaultStore.get(unlockedVaultAtom), agentId);
    },
    async appendHistory(agentId: string, entry: AgentRequestRecord) {
        return appendHistoryEntries(agentId, [entry]);
    },
    appendHistoryEntries,
};
