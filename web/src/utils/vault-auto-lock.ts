import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect } from "react";

export const VAULT_IDLE_AUTO_LOCK_MS = 15 * 60 * 1000;

export const VAULT_AUTO_LOCK_TIMEOUT_OPTIONS = [
    { value: 1 * 60 * 1000, label: "1 minute" },
    { value: 5 * 60 * 1000, label: "5 minutes" },
    { value: VAULT_IDLE_AUTO_LOCK_MS, label: "15 minutes" },
    { value: 30 * 60 * 1000, label: "30 minutes" },
    { value: 60 * 60 * 1000, label: "1 hour" },
    { value: 4 * 60 * 60 * 1000, label: "4 hours" },
    { value: 8 * 60 * 60 * 1000, label: "8 hours" },
] as const;

const storedVaultAutoLockTimeoutAtom = atomWithStorage<unknown>(
    "cryptex-vault-auto-lock-timeout-ms",
    VAULT_IDLE_AUTO_LOCK_MS,
);

const normalizeVaultAutoLockTimeout = (value: unknown) =>
    VAULT_AUTO_LOCK_TIMEOUT_OPTIONS.find((option) => option.value === value)
        ?.value ?? VAULT_IDLE_AUTO_LOCK_MS;

export const vaultAutoLockTimeoutAtom = atom(
    (get) => normalizeVaultAutoLockTimeout(get(storedVaultAutoLockTimeoutAtom)),
    (_get, set, value: number) =>
        set(
            storedVaultAutoLockTimeoutAtom,
            normalizeVaultAutoLockTimeout(value),
        ),
);

export type VaultAutoLockReason = "idle";

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
    windowObj = window,
    documentObj = document,
}: StartVaultAutoLockOptions): VaultAutoLockController {
    let stopped = false;
    let lockInFlight = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const stopTimers = () => {
        clearTimer(idleTimer);
        idleTimer = null;
    };

    const scheduleIdleLock = () => {
        clearTimer(idleTimer);
        if (stopped || lockInFlight) return;
        idleTimer = setTimeout(() => {
            void runLock("idle");
        }, idleMs);
    };

    const runLock = async (reason: VaultAutoLockReason) => {
        if (stopped || lockInFlight) return;

        lockInFlight = true;
        stopTimers();

        try {
            await lock(reason);
        } finally {
            lockInFlight = false;
            if (!stopped) {
                scheduleIdleLock();
            }
        }
    };

    const notifyActivity = () => {
        if (documentObj.visibilityState === "hidden") return;
        scheduleIdleLock();
    };

    VAULT_AUTO_LOCK_ACTIVITY_EVENTS.forEach((eventName) => {
        windowObj.addEventListener(eventName, notifyActivity, {
            passive: true,
        });
    });
    scheduleIdleLock();

    return {
        stop: () => {
            stopped = true;
            stopTimers();
            VAULT_AUTO_LOCK_ACTIVITY_EVENTS.forEach((eventName) => {
                windowObj.removeEventListener(eventName, notifyActivity);
            });
        },
        notifyActivity,
    };
}

export function useVaultAutoLock(
    lock: VaultAutoLockCallback,
    options: Omit<StartVaultAutoLockOptions, "lock"> = {},
) {
    const { idleMs, windowObj, documentObj } = options;

    useEffect(() => {
        const controller = startVaultAutoLock({
            lock,
            idleMs,
            windowObj,
            documentObj,
        });
        return controller.stop;
    }, [lock, idleMs, windowObj, documentObj]);
}
