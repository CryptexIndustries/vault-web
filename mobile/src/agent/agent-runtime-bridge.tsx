import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useAtomValue } from "jotai";

import {
    isVaultUnlockedAtom,
    onlineServicesDataAtom,
    onlineServicesStore,
    unlockedVaultAtom,
} from "@/utils/atoms";
import { vaultLog } from "@/utils/logging";
import {
    agentRuntime,
    APPROVAL_PUSH_RETRY_MS,
    reviewFromNotification,
    showWantedApproval,
    syncAgentCache,
} from "./agent-app";
import { notificationActions } from "./notification-actions";
import { resumeAgentSigning } from "./agent-locking";

/** Re-renders when the runtime's requests or agents change. */
export function useAgentRuntimeVersion() {
    return useSyncExternalStore(
        (listener) => agentRuntime.subscribe(listener),
        () => agentRuntime.getVersion(),
    );
}

/**
 * Mounted at the root, locked or not: starts the approver runtime, keeps the
 * agent cache outside the vault in step with the vault's records, and
 * handles notification taps.
 */
export function AgentRuntimeBridge() {
    const unlocked = useAtomValue(isVaultUnlockedAtom);
    const vault = useAtomValue(unlockedVaultAtom);
    const wasUnlocked = useRef(false);
    const sessionToken = useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    })?.sessionToken;

    // Online Services signs in after unlock; that is when a relay pass can be renewed.
    useEffect(() => {
        if (unlocked && sessionToken) agentRuntime.refreshRelays();
    }, [unlocked, sessionToken]);

    useEffect(() => {
        void agentRuntime.reload().catch((error: unknown) =>
            vaultLog.warn("Couldn't start the SSH agent approver", {
                error,
            }),
        );
        // Listen first, then take what came in before (cold starts). The
        // headless task may have started listening already; Review taps
        // that came in meanwhile run now.
        const stopReviews = notificationActions.setReviewHandler(
            reviewFromNotification,
        );
        notificationActions.listen();
        let retry: ReturnType<typeof setTimeout> | undefined;
        const appState = AppState.addEventListener("change", (state) => {
            if (state === "active") notificationActions.drain();
            // Leaving the app turns waiting requests into notifications again.
            agentRuntime.route();
            if (state === "active") {
                showWantedApproval();
                clearTimeout(retry);
                retry = setTimeout(
                    showWantedApproval,
                    APPROVAL_PUSH_RETRY_MS + 100,
                );
            }
        });
        return () => {
            stopReviews();
            appState.remove();
            clearTimeout(retry);
        };
    }, []);

    // The cache follows the vault while it's unlocked.
    useEffect(() => {
        if (!unlocked) return;
        syncAgentCache().catch((error: unknown) =>
            vaultLog.warn("Couldn't update the SSH agent list", { error }),
        );
    }, [unlocked, vault]);

    useEffect(() => {
        if (unlocked && !wasUnlocked.current) {
            // A new vault session: signing stopped by the last lock resumes.
            resumeAgentSigning();
            void agentRuntime.onVaultUnlocked();
        }
        if (!unlocked && wasUnlocked.current) agentRuntime.route();
        wasUnlocked.current = unlocked;
    }, [unlocked]);

    return null;
}
