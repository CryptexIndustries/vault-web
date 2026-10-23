/**
 * Stops SSH agent signing when the vault starts to lock, before the save
 * and the backup flush, and keeps it stopped until the next unlock, even
 * when the lock fails and the vault stays open. Kept apart from the runtime
 * so vault-lock.ts needn't import it; agent-app.ts registers the runtime.
 */

type Locking = { setLocking(locking: boolean): void };

let target: Locking | null = null;
let stopped = false;

export function registerAgentLocking(runtime: Locking) {
    target = runtime;
}

/**
 * Synchronous. Refuses signing from here on (canSign() reads the flag) and
 * tells the runtime, which clears its remembered approvals.
 */
export function stopAgentSigning() {
    stopped = true;
    target?.setLocking(true);
}

export function agentSigningStopped(): boolean {
    return stopped;
}

/** On unlock; the runtime resets its own flag in onVaultUnlocked(). */
export function resumeAgentSigning() {
    stopped = false;
}
