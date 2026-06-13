import { useEffect } from "react";

export const VAULT_IDLE_AUTO_LOCK_MS = 15 * 60 * 1000;
export const VAULT_BACKGROUND_AUTO_LOCK_GRACE_MS = 30 * 1000;

export type VaultAutoLockReason = "idle" | "background" | "pagehide";

export const VAULT_AUTO_LOCK_ACTIVITY_EVENTS = [
    "pointerdown",
    "keydown",
    "wheel",
    "touchstart",
] as const;

type VaultAutoLockCallback = (
    reason: VaultAutoLockReason,
) => void | Promise<void>;

export type StartVaultAutoLockOptions = {
    lock: VaultAutoLockCallback;
    idleMs?: number;
    backgroundGraceMs?: number;
    windowObj?: Window;
    documentObj?: Document;
};

export type VaultAutoLockController = {
    stop: () => void;
    notifyActivity: () => void;
};

const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer) {
        clearTimeout(timer);
    }
};

export function startVaultAutoLock({
    lock,
    idleMs = VAULT_IDLE_AUTO_LOCK_MS,
    backgroundGraceMs = VAULT_BACKGROUND_AUTO_LOCK_GRACE_MS,
    windowObj = window,
    documentObj = document,
}: StartVaultAutoLockOptions): VaultAutoLockController {
    let stopped = false;
    let lockInFlight = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
    let backgroundStartedAt: number | null = null;
    let backgroundReason: VaultAutoLockReason = "background";

    const stopTimers = () => {
        clearTimer(idleTimer);
        clearTimer(backgroundTimer);
        idleTimer = null;
        backgroundTimer = null;
    };

    const scheduleIdleLock = () => {
        clearTimer(idleTimer);
        if (stopped || lockInFlight) return;
        idleTimer = setTimeout(() => {
            void runLock("idle");
        }, idleMs);
    };

    const clearBackgroundLock = () => {
        clearTimer(backgroundTimer);
        backgroundTimer = null;
        backgroundStartedAt = null;
        backgroundReason = "background";
    };

    const scheduleBackgroundLock = (reason: VaultAutoLockReason) => {
        clearTimer(backgroundTimer);
        if (stopped || lockInFlight) return;

        backgroundStartedAt = Date.now();
        backgroundReason = reason;
        backgroundTimer = setTimeout(() => {
            void runLock(reason);
        }, backgroundGraceMs);
    };

    const restartAfterLockAttempt = () => {
        if (stopped) return;

        if (documentObj.visibilityState === "hidden") {
            scheduleBackgroundLock(backgroundReason);
            return;
        }

        clearBackgroundLock();
        scheduleIdleLock();
    };

    const runLock = async (reason: VaultAutoLockReason) => {
        if (stopped || lockInFlight) return;

        lockInFlight = true;
        stopTimers();

        try {
            await lock(reason);
        } finally {
            lockInFlight = false;
            restartAfterLockAttempt();
        }
    };

    const notifyActivity = () => {
        if (documentObj.visibilityState === "hidden") return;
        scheduleIdleLock();
    };

    const handleVisibilityChange = () => {
        if (documentObj.visibilityState === "hidden") {
            scheduleBackgroundLock("background");
            return;
        }

        if (
            backgroundStartedAt != null &&
            Date.now() - backgroundStartedAt >= backgroundGraceMs
        ) {
            void runLock(backgroundReason);
            return;
        }

        clearBackgroundLock();
        scheduleIdleLock();
    };

    const handlePageHide = () => {
        scheduleBackgroundLock("pagehide");
    };

    VAULT_AUTO_LOCK_ACTIVITY_EVENTS.forEach((eventName) => {
        windowObj.addEventListener(eventName, notifyActivity, {
            passive: true,
        });
    });
    documentObj.addEventListener("visibilitychange", handleVisibilityChange);
    windowObj.addEventListener("pagehide", handlePageHide);
    scheduleIdleLock();

    return {
        stop: () => {
            stopped = true;
            stopTimers();
            VAULT_AUTO_LOCK_ACTIVITY_EVENTS.forEach((eventName) => {
                windowObj.removeEventListener(eventName, notifyActivity);
            });
            documentObj.removeEventListener(
                "visibilitychange",
                handleVisibilityChange,
            );
            windowObj.removeEventListener("pagehide", handlePageHide);
        },
        notifyActivity,
    };
}

export function useVaultAutoLock(
    lock: VaultAutoLockCallback,
    options: Omit<StartVaultAutoLockOptions, "lock"> = {},
) {
    useEffect(() => {
        const controller = startVaultAutoLock({ lock, ...options });
        return controller.stop;
    }, [lock, options.idleMs, options.backgroundGraceMs]);
}
