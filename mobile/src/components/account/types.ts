export type AuthMode = "register" | "recover";

export type RecoveryKitData = {
    userId: string;
    recoveryPhrase: string;
};

/** How an account recovery attempt ended. */
export type RecoveryOutcome =
    | {
          state:
              | "recovered"
              /** Recovered, and the account has no Recovery Kit left. */
              | "kitMissing"
              /** Saved to this vault, but signing in failed. */
              | "notConnected"
              /** The server spent the Kit, but this vault has not saved the account. */
              | "saveFailed"
              /** The Kit as entered fails the form checks. */
              | "invalid"
              | "checkIncomplete"
              | "rejected"
              | "unreachable";
      }
    /** Refused for too many attempts; until is the latest it can last. */
    | { state: "rateLimited"; until: number }
    /** Stopped on this device before the Kit was sent. */
    | { state: "failed"; cause: "vault" | "device"; detail?: string };
