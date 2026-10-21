// Counts lock attempts. Bumped synchronously when a lock starts, before the
// save, so secret work begun earlier stops even while the save is running or
// after a failed lock that leaves the vault open. Kept apart from
// vault-session.ts so the clipboard and tests that mock the session see it.
let lockEpoch = 0;

export const getVaultLockEpoch = (): number => lockEpoch;

/** Called first thing in every lock path. */
export const markVaultLockStarted = (): void => {
    lockEpoch += 1;
};
