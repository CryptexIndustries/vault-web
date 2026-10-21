import { useCallback, useEffect, useRef, useState } from "react";
import { unlockedTab } from "@/app_lib/unlocked-tab";
import { vaultLog } from "@/utils/logging";
import { vaultTabOwner } from "@/utils/vault-tab-owner";

/** How often a locked tab looks again (a tab that closed sends nothing). */
const RECHECK_MS = 5_000;
/** How long "Use here" waits for the other tab to lock. */
const RELEASE_WAIT_MS = 15_000;

export type UnlockedTabState = {
    /** Another tab has the vault open: show VaultOpenElsewhere. */
    elsewhere: boolean;
    /** Not known yet whether another tab has it open. */
    checking: boolean;
    releasing: boolean;
    releaseFailed: boolean;
    useHere: () => void;
    /** An unlock found the vault open in another tab. */
    showElsewhere: () => void;
};

/** A pending leave (see useUnlockedTab), cancelled by a remount. */
let leaving: ReturnType<typeof setTimeout> | null = null;

function cancelLeave() {
    if (leaving) clearTimeout(leaving);
    leaving = null;
}

/**
 * One unlocked tab per browser (unlocked-tab.ts). While locked, watches for
 * another tab with the vault open; showElsewhere() is for an unlock that
 * couldn't claim the tab. Claiming happens when an unlock starts
 * (vault-tab-owner.ts).
 *
 * While the page is mounted, leaving it is covered whatever was rendered
 * last: Next client-side navigation keeps the vault in memory, so the owner
 * closes what the live store holds (see VaultTabOwner.leave). An immediate
 * remount (React's strict mode) cancels the leave.
 */
export function useUnlockedTab(
    unlocked: boolean,
    discard: () => Promise<void>,
    /** The normal lock path; true once the vault is saved and locked. */
    lock: () => Promise<boolean>,
): UnlockedTabState {
    const tabs = unlockedTab();
    const [elsewhere, setElsewhere] = useState(false);
    const [checking, setChecking] = useState(true);
    const [releasing, setReleasing] = useState(false);
    const [releaseFailed, setReleaseFailed] = useState(false);
    const [recheck, setRecheck] = useState(0);
    const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const discardRef = useRef(discard);
    discardRef.current = discard;
    const lockRef = useRef(lock);
    lockRef.current = lock;

    useEffect(() => {
        if (unlocked || !tabs) {
            setChecking(false);
            return;
        }
        let cancelled = false;
        const check = async () => {
            const open = await tabs.otherTabOpen();
            if (cancelled) return;
            setElsewhere(open);
            setChecking(false);
            if (!open) {
                setReleasing(false);
                if (releaseTimer.current) clearTimeout(releaseTimer.current);
            }
        };
        void check();
        const unsubscribe = tabs.subscribe(() => void check());
        const onVisible = () => {
            if (document.visibilityState === "visible") void check();
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);
        const timer = setInterval(() => void check(), RECHECK_MS);
        return () => {
            cancelled = true;
            unsubscribe();
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", onVisible);
            clearInterval(timer);
        };
    }, [unlocked, tabs, recheck]);

    useEffect(() => {
        // Mounted again right after an unmount: the same page.
        cancelLeave();
        return () => {
            if (releaseTimer.current) clearTimeout(releaseTimer.current);
            // After the current commit, so React's strict-mode remount (or
            // any remount right away) cancels it.
            cancelLeave();
            leaving = setTimeout(() => {
                leaving = null;
                void vaultTabOwner()
                    .leave({
                        lock: () => lockRef.current(),
                        discard: () => discardRef.current(),
                    })
                    .catch((error: unknown) =>
                        vaultLog.error(
                            "Couldn't close the vault on leaving it",
                            {
                                error,
                            },
                        ),
                    );
            }, 0);
        };
    }, []);

    const useHere = useCallback(() => {
        if (!tabs) return;
        setReleasing(true);
        setReleaseFailed(false);
        tabs.requestRelease();
        if (releaseTimer.current) clearTimeout(releaseTimer.current);
        releaseTimer.current = setTimeout(() => {
            setReleasing(false);
            setReleaseFailed(true);
        }, RELEASE_WAIT_MS);
    }, [tabs]);

    const showElsewhere = useCallback(() => {
        setElsewhere(true);
        setRecheck((count) => count + 1);
    }, []);

    return {
        elsewhere,
        checking,
        releasing,
        releaseFailed,
        useHere,
        showElsewhere,
    };
}
