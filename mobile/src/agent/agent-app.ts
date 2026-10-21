import { AppState, Platform } from "react-native";
import { router } from "expo-router";
import { Approver } from "@cryptex-industries/vault-core/agent/approver";
import type {
    RelayTarget,
    WebSocketLike,
} from "@cryptex-industries/vault-core/agent/approver-types";
import { AgentRuntime } from "@cryptex-industries/vault-core/agent/runtime";
import {
    agentCacheFromVault,
    relayKeyOf,
} from "@cryptex-industries/vault-core/agent/vault-agents";
import { signSSH } from "@cryptex-industries/vault-core/vault-utils/ssh-sign";

import { env } from "@/env";
import { trpc } from "@/utils/trpc";
import { vaultLog } from "@/utils/logging";
import { hasOnlineServicesSession } from "@/app_lib/share-links";
import { isVaultUnlockedAtom, unlockedVaultAtom, vaultStore } from "@/utils/atoms";
import { agentService } from "./agent-service";
import {
    loadAgentCache,
    loadApproverIdentity,
    loadCustomRelays,
    loadRelayPass,
    localApprovals,
    saveAgentCache,
    saveRelayPass,
} from "./agent-storage";
import { mobileVaultAccess } from "./agent-vault";
import { issueApprovalToken } from "./approval-screen";
import { deniedRequests } from "./denied-requests";
import { registerAgentLocking } from "./agent-locking";
import { rememberedApprovals } from "./remembered-approvals";

/** Renew the hosted relay pass when less than this is left. */
const PASS_RENEW_MS = 24 * 60 * 60 * 1000;

export function approverDeviceName(): string {
    const name = agentService.deviceName()?.trim();
    if (name) return name;
    const constants = Platform.constants as { Model?: string };
    return constants.Model?.trim() || "Android phone";
}

let passRequest: Promise<string | null> | null = null;

/**
 * The hosted relay pass, renewed while the vault is unlocked (Online
 * Services signs out on lock) and cached outside the vault for the locked
 * hours in between.
 */
async function getRelayPass(relay: RelayTarget): Promise<string | null> {
    if (relay.kind !== "hosted") return null;
    const identity = await loadApproverIdentity();
    const key = relayKeyOf(identity);
    const stored = await loadRelayPass();
    const usable = stored && stored.key === key && stored.expiresAt > Date.now() ? stored : null;
    if (usable && usable.expiresAt - Date.now() > PASS_RENEW_MS) return usable.pass;
    if (!vaultStore.get(isVaultUnlockedAtom) || !hasOnlineServicesSession())
        return usable?.pass ?? null;
    passRequest ??= (async () => {
        try {
            const fresh = await trpc.v1.relay.pass.mutate({ key });
            await saveRelayPass({ pass: fresh.pass, expiresAt: fresh.expiresAt, key });
            return fresh.pass;
        } catch (error) {
            vaultLog.warn("Couldn't renew the relay pass", { error });
            return usable?.pass ?? null;
        } finally {
            passRequest = null;
        }
    })();
    return passRequest;
}

export const agentRuntime = new AgentRuntime({
    createApprover: (host) => new Approver(host),
    loadIdentity: loadApproverIdentity,
    deviceName: approverDeviceName,
    loadAgentCache,
    loadCustomRelays,
    localApprovals,
    hostedRelayUrl: env.RELAY_URL,
    getPass: getRelayPass,
    vault: mobileVaultAccess,
    sign: signSSH,
    ui: {
        isForeground: () => AppState.currentState === "active",
        // A request denied from its notification before it arrived is
        // refused by notification-actions.ts; don't show it meanwhile.
        openRequest: (id) => {
            if (!deniedRequests.has(id)) openApproval(id);
        },
        showNotification: (id, agentName, vaultLocked) => {
            if (!deniedRequests.has(id))
                agentService.showRequest(id, agentName, vaultLocked);
        },
        cancelNotification: (id) => agentService.cancelRequest(id),
        // Foreground while locked: the unlock screen after Review.
        showsUnlock: () => AppState.currentState === "active",
    },
    service: {
        start: () => {
            if (!agentService.isRunning()) agentService.start();
        },
        stop: () => {
            if (agentService.isRunning()) agentService.stop();
        },
    },
    remembered: rememberedApprovals,
    openWebSocket: (url, protocols) =>
        new WebSocket(url, protocols) as unknown as WebSocketLike,
    fetch: (...args) => fetch(...args),
    log: (message, detail) => vaultLog.info(`Agent: ${message}`, { detail }),
});

// The vault lock stops signing first (vault-lock.ts).
registerAgentLocking(agentRuntime);

let cacheSync: Promise<unknown> = Promise.resolve();
// A cache write whose runtime reload hasn't succeeded yet. The next sync
// reloads even when the cache already matches the vault.
let reloadOwed = false;

/**
 * Brings the agent cache (what the runtime serves, readable while locked)
 * in line with the unlocked vault's records, and reloads the runtime if it
 * changed or an earlier reload failed. One at a time. Rejects if the write
 * or the reload fails.
 *
 * The projection comes from the vault as it is after each wait, never from
 * before one: a sync that started before a Pause must not write or reload
 * the unpaused record. If the vault changes while the cache is written, it
 * writes again before reloading.
 */
export function syncAgentCache(): Promise<void> {
    const run = cacheSync.then(async () => {
        const identity = await loadApproverIdentity();
        let stored = JSON.stringify(await loadAgentCache());
        for (;;) {
            if (!vaultStore.get(isVaultUnlockedAtom)) return;
            const next = agentCacheFromVault(vaultStore.get(unlockedVaultAtom), identity);
            const text = JSON.stringify(next);
            if (text === stored) break;
            reloadOwed = true;
            await saveAgentCache(next);
            stored = text;
        }
        if (!reloadOwed) return;
        await agentRuntime.reload();
        reloadOwed = false;
    });
    cacheSync = run.catch(() => undefined);
    return run;
}

let lastReview = { id: "", at: 0 };

/** Review on a notification (the UI handles these; see notification-actions.ts). */
export function reviewFromNotification(requestId: string) {
    // Android can report one Review tap more than once (new intent and resume).
    const now = Date.now();
    if (lastReview.id === requestId && now - lastReview.at < 3_000) return;
    lastReview = { id: requestId, at: now };
    // Locked: unlock first. The request opens after whichever unlock comes
    // next, so backing out of this one loses nothing.
    if (!agentRuntime.review(requestId)) router.navigate("/(locked)/unlock");
}

/**
 * The approval screen; the runtime only asks for it while unlocked. The
 * token tells the screen the app opened it (see approval-screen.ts).
 */
function openApproval(requestId: string) {
    if (agentRuntime.isShowing(requestId)) return;
    router.push({
        pathname: "/(app)/agent-request",
        params: { id: requestId, token: issueApprovalToken() },
    });
}
