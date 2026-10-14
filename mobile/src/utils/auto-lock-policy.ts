/** Pure auto-lock timing/state helpers (no React / storage). */

export const DEFAULT_AUTO_LOCK_MINUTES = 5;
export const AUTO_LOCK_MINUTE_OPTIONS = [0, 1, 5, 15, 30, 60, 240, 480] as const;
const INTERACTION_THROTTLE_MS = 1_000;

export function parseAutoLockMinutes(raw: string | null | undefined): number {
    if (raw == null || raw === "") return DEFAULT_AUTO_LOCK_MINUTES;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_AUTO_LOCK_MINUTES;
    return n;
}

/** `null` means inactivity auto-lock disabled (explicit lock still allowed). */
export function autoLockThresholdMs(minutes: number): number | null {
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return minutes * 60_000;
}

/** Clamp clock skew / future timestamps so elapsed never goes negative. */
export function elapsedMs(fromMs: number, toMs: number): number {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
    return Math.max(0, toMs - fromMs);
}

/**
 * Remaining delay until a foreground idle lock, or `null` when disabled.
 * When already past threshold, returns `0` (lock ASAP).
 */
export function nextForegroundIdleDelayMs(
    lastInteractionAtMs: number,
    nowMs: number,
    thresholdMs: number | null,
): number | null {
    if (thresholdMs == null) return null;
    return Math.max(0, thresholdMs - elapsedMs(lastInteractionAtMs, nowMs));
}

/**
 * Whether a new interaction timestamp should replace the previous one.
 * Throttles high-frequency touch streams without dropping the first event.
 */
export function shouldAcceptInteractionTimestamp(
    lastAcceptedAtMs: number,
    candidateMs: number,
    throttleMs: number = INTERACTION_THROTTLE_MS,
): boolean {
    if (!Number.isFinite(candidateMs)) return false;
    if (!Number.isFinite(lastAcceptedAtMs)) return true;
    return elapsedMs(lastAcceptedAtMs, candidateMs) >= throttleMs;
}
