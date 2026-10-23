/**
 * Told first thing when a lock starts, synchronously, before the save and
 * the backup flush (which can wait on the network). The SSH agent approver
 * stops signing and forgets remembered approvals here, and stays stopped
 * even if the lock then fails: signing comes back only with a new unlock.
 * Kept apart from vault-lock.ts so listeners don't pull in its imports.
 */
export type VaultLockListener = { lockStarted(): void };

const lockListeners = new Set<VaultLockListener>();

/**
 * A lock started since the last authenticated unlock. Kept here, with the
 * decrypted session rather than in an agent host, so a host created later
 * (the dashboard mounting again after a failed lock) can't sign either.
 */
let signingStopped = false;

/** No SSH agent signing until the next authenticated unlock. */
export function agentSigningStopped(): boolean {
    return signingStopped;
}

/** Only after an authenticated unlock (the vault was decrypted or created). */
export function resumeAgentSigning() {
    signingStopped = false;
}

export function addVaultLockListener(listener: VaultLockListener) {
    lockListeners.add(listener);
    return () => {
        lockListeners.delete(listener);
    };
}

/** Never throws: a failing listener can't stop the lock. */
export function notifyVaultLockStarted() {
    // First, whether or not any agent host is mounted.
    signingStopped = true;
    for (const listener of lockListeners) {
        try {
            listener.lockStarted();
        } catch (error) {
            console.error("A vault lock listener failed", error);
        }
    }
}
