import { autoLockThresholdMs } from "@/utils/auto-lock-policy";
import { getCachedAutoLockMinutes } from "@/utils/auto-lock-settings";

let active = false;
let minutes = getCachedAutoLockMinutes();
let lastInteractionAt = Date.now();
let backgroundedAt: number | null = null;
let lastInteractionMonotonic = monotonicNow();
let backgroundedMonotonic: number | null = null;
const listeners = new Set<() => void>();

function changed(): void {
    for (const listener of listeners) listener();
}

export function subscribeVaultTimeoutChanges(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function monotonicNow(): number {
    const value = globalThis.performance?.now?.();
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : Date.now();
}

export function startVaultTimeoutSession(now = Date.now()): void {
    active = true;
    minutes = getCachedAutoLockMinutes();
    lastInteractionAt = now;
    backgroundedAt = null;
    lastInteractionMonotonic = monotonicNow();
    backgroundedMonotonic = null;
    changed();
}

export function stopVaultTimeoutSession(): void {
    active = false;
    backgroundedAt = null;
    backgroundedMonotonic = null;
    changed();
}

export function isVaultTimeoutSessionActive(): boolean {
    return active;
}

export function setVaultTimeoutMinutes(value: number): void {
    minutes = value;
    changed();
}

export function getVaultLastInteractionAt(): number {
    return lastInteractionAt;
}

export function noteVaultInteraction(now = Date.now()): void {
    if (!active || isAutoLockDue(now)) return;
    lastInteractionAt = now;
    lastInteractionMonotonic = monotonicNow();
    changed();
}

export function noteVaultBackgrounded(now = Date.now()): void {
    if (active && backgroundedAt == null) {
        backgroundedAt = now;
        backgroundedMonotonic = monotonicNow();
        changed();
    }
}

export function noteVaultForegrounded(now = Date.now()): void {
    if (!active || isAutoLockDue(now)) return;
    backgroundedAt = null;
    backgroundedMonotonic = null;
    lastInteractionAt = now;
    lastInteractionMonotonic = monotonicNow();
    changed();
}

export function isAutoLockDue(now = Date.now()): boolean {
    if (!active) return false;
    const thresholdMs = autoLockThresholdMs(minutes);
    if (thresholdMs == null) return false;
    const since = backgroundedAt ?? lastInteractionAt;
    const monotonicSince = backgroundedMonotonic ?? lastInteractionMonotonic;
    return now - since >= thresholdMs || monotonicNow() - monotonicSince >= thresholdMs;
}

export function vaultTimeoutRemainingMs(now = Date.now()): number | null {
    if (!active) return null;
    const thresholdMs = autoLockThresholdMs(minutes);
    if (thresholdMs == null) return null;
    const since = backgroundedAt ?? lastInteractionAt;
    const monotonicSince = backgroundedMonotonic ?? lastInteractionMonotonic;
    const elapsed = Math.max(now - since, monotonicNow() - monotonicSince);
    return Math.max(0, thresholdMs - elapsed);
}
