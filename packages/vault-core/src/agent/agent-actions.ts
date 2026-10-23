import type { ConnectedAgent } from "../proto/vault";
import {
    isAllowedRelayUrl,
    type ConnectedAgentChanges,
} from "../vault-utils/connected-agents";
import type { VaultCredential } from "../vault-utils/vault";
import type { GrantedKeyInput } from "./approver-types";
import { revokeOverHttp } from "./relay-client";
import { grantedKeyInputs } from "./vault-agents";

/**
 * What the agent pages of both apps do: tell the agent over its relay and
 * save the change in the vault. Each app passes its runtime and vault writes.
 */

/** Sends the agent its new key list, then saves the grant in the vault. */
export async function updateAgentKeys(
    agent: Pick<ConnectedAgent, "ID" | "Name" | "KeysRevision">,
    credentials: readonly Pick<VaultCredential, "ID" | "Name" | "SSHKey">[],
    deps: {
        sendKeys(
            agentId: string,
            input: {
                agentName: string;
                keys: GrantedKeyInput[];
                revision: number;
            },
        ): Promise<void>;
        changeAgent(
            agentId: string,
            changes: ConnectedAgentChanges,
        ): Promise<boolean>;
    },
): Promise<void> {
    const revision = agent.KeysRevision + 1;
    await deps.sendKeys(agent.ID, {
        agentName: agent.Name,
        revision,
        keys: grantedKeyInputs(credentials),
    });
    const saved = await deps.changeAgent(agent.ID, {
        CredentialIDs: credentials.map((item) => item.ID),
        KeysRevision: revision,
    });
    if (!saved) throw new Error("Couldn't save the keys in the vault");
}

export type RevokeResult = {
    /**
     * The relay removed the agent. False when it couldn't be reached in
     * time or refused, or its address isn't https: the vault is updated
     * anyway, and the approving device removes the agent on the relay when
     * it syncs.
     */
    relayRevoked: boolean;
};

/** How long revokeAgent waits for the relay, in all, after saving. */
export const REVOKE_RELAY_TIMEOUT_MS = 20_000;

class RevokeTimeoutError extends Error {
    constructor() {
        super("The relay didn't answer in time");
    }
}

/** Rejects with RevokeTimeoutError (and aborts) when the deadline passes. */
function beforeDeadline<T>(
    deadline: number,
    run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    const controller = new AbortController();
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => {
                controller.abort();
                reject(new RevokeTimeoutError());
            },
            Math.max(0, deadline - Date.now()),
        );
        run(controller.signal).then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

/**
 * Marks the agent revoked in the vault, then removes it on its relay. The
 * vault write comes first, so a relay that stalls or refuses can't delay
 * the revocation here or its sync to other devices; the relay gets
 * REVOKE_RELAY_TIMEOUT_MS. The approving device stops serving the agent
 * and tells the relay over its connection; any other device, or the
 * approver when that fails, uses the synced revocation key over HTTPS.
 * Throws only when the vault write fails (the relay isn't contacted then).
 */
export async function revokeAgent(
    agent: Pick<
        ConnectedAgent,
        "ID" | "RelayOrigin" | "RevocationSeed" | "AgentSignPublicKey"
    >,
    deps: {
        approvedHere: boolean;
        /** Stops serving the agent here, then removes it on the relay. */
        unregister(agentId: string): Promise<void>;
        hostedRelayUrl: string;
        fetch: typeof fetch;
        markRevoked(agentId: string): Promise<boolean>;
        log?: (message: string, detail?: unknown) => void;
        /** Tests shorten it. */
        relayTimeoutMs?: number;
    },
): Promise<RevokeResult> {
    if (!(await deps.markRevoked(agent.ID)))
        throw new Error("Couldn't save the revocation in the vault");
    const deadline =
        Date.now() + (deps.relayTimeoutMs ?? REVOKE_RELAY_TIMEOUT_MS);
    let relayRevoked = false;
    if (deps.approvedHere) {
        try {
            await beforeDeadline(deadline, () => deps.unregister(agent.ID));
            relayRevoked = true;
        } catch (error) {
            deps.log?.("Couldn't revoke over the relay connection", error);
        }
    }
    const relayUrl = agent.RelayOrigin || deps.hostedRelayUrl;
    // A tampered record must not send the revoke over plain http.
    if (!relayRevoked && isAllowedRelayUrl(relayUrl) && Date.now() < deadline) {
        try {
            const status = await beforeDeadline(deadline, (signal) =>
                revokeOverHttp(
                    relayUrl,
                    agent.RevocationSeed,
                    agent.AgentSignPublicKey,
                    deps.fetch,
                    Date.now(),
                    signal,
                ),
            );
            // 404: the relay doesn't know the agent anymore, which is the goal.
            relayRevoked = status === 204 || status === 404;
            if (!relayRevoked)
                deps.log?.("The relay refused the revoke", { status });
        } catch (error) {
            deps.log?.("Couldn't reach the relay to revoke", error);
        }
    }
    return { relayRevoked };
}

/**
 * Pauses or resumes an agent: every request is refused without asking
 * while paused. Saves the synced flag, so any device can do it, and tells
 * this device's runtime at once when it runs here.
 */
export async function setAgentPaused(
    agentId: string,
    paused: boolean,
    deps: {
        changeAgent(
            agentId: string,
            changes: ConnectedAgentChanges,
        ): Promise<boolean>;
        runtime?: {
            setPaused(agentId: string, paused: boolean): Promise<void>;
            /** The token of the Pause or Resume setPaused just recorded. */
            pauseToken(agentId: string): number | undefined;
            /** That one is saved: the vault decides from now on. */
            pauseSaved(agentId: string, token: number): void;
        };
    },
): Promise<void> {
    const runtime = deps.runtime;
    const recording = runtime?.setPaused(agentId, paused);
    // Read at once: a later Pause or Resume gets its own token.
    const token = runtime?.pauseToken(agentId);
    await recording;
    if (!(await deps.changeAgent(agentId, { Paused: paused })))
        throw new Error(
            paused
                ? "Couldn't pause the agent in the vault"
                : "Couldn't resume the agent in the vault",
        );
    if (token !== undefined) runtime?.pauseSaved(agentId, token);
}
