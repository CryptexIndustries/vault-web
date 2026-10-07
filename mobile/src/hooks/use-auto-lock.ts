import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { router } from "expo-router";
import { useAtomValue, useSetAtom } from "jotai";

import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    vaultStore,
} from "@/utils/atoms";
import {
    autoLockThresholdMs,
    nextForegroundIdleDelayMs,
    shouldAcceptInteractionTimestamp,
} from "@/utils/auto-lock-policy";
import {
    AUTO_LOCK_KEY,
    getCachedAutoLockMinutes,
    loadAutoLockMinutes,
    subscribeAutoLockMinutes,
} from "@/utils/auto-lock-settings";
import { lockUnlockedVault } from "@/utils/vault-lock";
import { androidCredentials } from "@/utils/android-credentials";
import { buildAndroidProviderCredentials } from "@/utils/android-provider-credentials";
import {
    getVaultLastInteractionAt,
    isAutoLockDue,
    isVaultTimeoutSessionActive,
    noteVaultBackgrounded,
    noteVaultForegrounded,
    noteVaultInteraction,
    setVaultTimeoutMinutes,
    startVaultTimeoutSession,
    vaultTimeoutRemainingMs,
} from "@/utils/session-timeout";

export { AUTO_LOCK_KEY };
export {
    DEFAULT_AUTO_LOCK_MINUTES,
    AUTO_LOCK_MINUTE_OPTIONS,
} from "@/utils/auto-lock-policy";
export { saveAutoLockMinutes } from "@/utils/auto-lock-settings";

export { isAutoLockDue } from "@/utils/session-timeout";

/**
 * Auto-lock while vault unlocked:
 * - Foreground: lock after configurable idle (no interaction).
 * - Background: native provider access expires at the configured deadline;
 *   JavaScript paths reject access by the same deadline and lock on resume.
 * - `0` disables inactivity/background timers; explicit lock still works.
 *
 * Interaction timestamps stay in memory (throttled). No AsyncStorage on touch.
 */
export function useAutoLock(enabled = true, returnTo?: string): {
    onInteraction: () => void;
    resumeAfterFailedLock: () => void;
} {
    const metadata = useAtomValue(unlockedVaultMetadataAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);

    const minutesRef = useRef(getCachedAutoLockMinutes());
    const lastInteractionAtRef = useRef(getVaultLastInteractionAt());
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lockingRef = useRef(false);
    const mountedRef = useRef(true);

    const clearIdleTimer = useCallback(() => {
        if (idleTimerRef.current != null) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
    }, []);

    const runLock = useCallback(async () => {
        if (!enabled || lockingRef.current || !mountedRef.current) return;
        lockingRef.current = true;
        clearIdleTimer();
        try {
            const result = await lockUnlockedVault({
                unlockedVaultMetadata: vaultStore.get(
                    unlockedVaultMetadataAtom,
                ),
                setUnlockedVault: async (val) => {
                    const current = vaultStore.get(unlockedVaultAtom);
                    const next =
                        typeof val === "function" ? await val(current) : val;
                    setUnlockedVault(
                        next instanceof Vault ? next : new Vault(),
                    );
                },
                setUnlockedVaultMetadata,
            });
            if (result.isOk() && mountedRef.current) {
                const pendingRequest = androidCredentials.getPendingRequest();
                router.replace(pendingRequest
                    ? { pathname: "/(locked)/unlock", params: { returnTo: "/credential-request" } }
                    : returnTo ? { pathname: "/(locked)/unlock", params: { returnTo } }
                    : "/(locked)/unlock");
            }
        } finally {
            lockingRef.current = false;
        }
    }, [clearIdleTimer, enabled, returnTo, setUnlockedVault, setUnlockedVaultMetadata]);

    const scheduleForegroundIdle = useCallback(() => {
        clearIdleTimer();
        if (!enabled || !mountedRef.current || !metadata) return;
        if (appStateRef.current !== "active") return;

        const thresholdMs = autoLockThresholdMs(minutesRef.current);
        const delayMs = nextForegroundIdleDelayMs(
            lastInteractionAtRef.current,
            Date.now(),
            thresholdMs,
        );
        if (delayMs == null) return;
        const remainingMs = vaultTimeoutRemainingMs();

        idleTimerRef.current = setTimeout(() => {
            idleTimerRef.current = null;
            if (isAutoLockDue()) void runLock();
            else scheduleForegroundIdle();
        }, Math.min(delayMs, remainingMs ?? delayMs));
    }, [clearIdleTimer, enabled, metadata, runLock]);

    const onInteraction = useCallback(() => {
        if (!enabled || !metadata) return;
        if (appStateRef.current !== "active") return;
        const now = Date.now();
        if (isAutoLockDue(now)) {
            void runLock();
            return;
        }
        if (
            !shouldAcceptInteractionTimestamp(lastInteractionAtRef.current, now)
        ) {
            return;
        }
        lastInteractionAtRef.current = now;
        noteVaultInteraction(now);
        androidCredentials.refreshProviderSession(minutesRef.current);
        scheduleForegroundIdle();
    }, [enabled, metadata, runLock, scheduleForegroundIdle]);

    const resumeAfterFailedLock = useCallback(() => {
        if (!enabled || !metadata || appStateRef.current !== "active") return;
        const now = Date.now();
        startVaultTimeoutSession(now);
        setVaultTimeoutMinutes(minutesRef.current);
        lastInteractionAtRef.current = now;
        // Only the explicit "Keep editing" choice may reopen a native cache
        // that expired while the automatic lock save failed.
        androidCredentials.clearProviderCredentials();
        androidCredentials.setProviderCredentials(
            buildAndroidProviderCredentials(
                vaultStore.get(unlockedVaultAtom).Credentials,
            ),
            minutesRef.current,
        );
        scheduleForegroundIdle();
    }, [enabled, metadata, scheduleForegroundIdle]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            clearIdleTimer();
        };
    }, [clearIdleTimer]);

    useEffect(() => {
        if (!metadata || !enabled) {
            clearIdleTimer();
            return;
        }

        let cancelled = false;

        // Unlock normally starts the session when the DEK is installed. The
        // fallback covers an already-unlocked shell restored by navigation.
        if (!isVaultTimeoutSessionActive()) startVaultTimeoutSession();
        if (AppState.currentState !== "active")
            noteVaultBackgrounded();
        lastInteractionAtRef.current = getVaultLastInteractionAt();

        void (async () => {
            const minutes = await loadAutoLockMinutes();
            if (cancelled || !mountedRef.current) return;
            minutesRef.current = minutes;
            setVaultTimeoutMinutes(minutes);
            if (isAutoLockDue()) {
                void runLock();
                return;
            }
            if (AppState.currentState === "active")
                androidCredentials.resumeProviderSession(minutes);
            else
                androidCredentials.backgroundProviderSession(minutes);
            if (AppState.currentState === "active") {
                scheduleForegroundIdle();
            }
        })();

        const unsubscribe = subscribeAutoLockMinutes((minutes) => {
            minutesRef.current = minutes;
            setVaultTimeoutMinutes(minutes);
            if (isAutoLockDue()) {
                void runLock();
                return;
            }
            if (appStateRef.current === "active")
                androidCredentials.refreshProviderSession(minutes);
            else
                androidCredentials.backgroundProviderSession(minutes);
            if (appStateRef.current === "active") {
                scheduleForegroundIdle();
            }
        });

        const onAppState = (next: AppStateStatus) => {
            const prev = appStateRef.current;
            appStateRef.current = next;

            if (next === "active") {
                androidCredentials.expireSensitiveClipboard();
                if (isAutoLockDue()) {
                    void runLock();
                    return;
                }

                // Fresh idle window after a short background stint.
                noteVaultForegrounded();
                lastInteractionAtRef.current = getVaultLastInteractionAt();
                androidCredentials.resumeProviderSession(minutesRef.current);
                scheduleForegroundIdle();
                return;
            }

            if (prev === "active") {
                clearIdleTimer();
                noteVaultBackgrounded();
                androidCredentials.backgroundProviderSession(minutesRef.current);
            }
        };

        const sub = AppState.addEventListener("change", onAppState);

        return () => {
            cancelled = true;
            unsubscribe();
            sub.remove();
            clearIdleTimer();
        };
    }, [metadata, enabled, clearIdleTimer, runLock, scheduleForegroundIdle]);

    return { onInteraction, resumeAfterFailedLock };
}
