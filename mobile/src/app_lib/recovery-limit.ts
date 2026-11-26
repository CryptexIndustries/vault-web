/**
 * Mirrors the server's AUTH_RECOVER limit, a sliding window per client IP. The
 * server counts a request before it checks the human check or the Kit, so every
 * attempt counts. Refused requests don't, and a refusal carries no retry time.
 */
export const RECOVERY_ATTEMPTS = 3;
export const RECOVERY_WINDOW_HOURS = 2;
