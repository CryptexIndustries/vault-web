import { useCallback, useEffect, useRef } from "react";

import {
    captureVaultSession,
    isVaultSessionCurrent,
} from "@/utils/vault-session";

/**
 * Work that ends by handing a secret to something outside this process: the
 * share sheet, the clipboard, an Android credential request. Start it before
 * the first await and check current() after every await and right before the
 * hand-off. A lock that starts in between (even one followed by an unlock),
 * a session change or cancel() makes it stale for good.
 */
export type SecretRelease = {
    current(): boolean;
    /** For teardown, such as the screen that started the work unmounting. */
    cancel(): void;
};

export function startSecretRelease(): SecretRelease {
    const session = captureVaultSession();
    let cancelled = false;
    return {
        current: () => !cancelled && isVaultSessionCurrent(session),
        cancel: () => {
            cancelled = true;
        },
    };
}

/**
 * One release at a time for a screen: each start cancels the one before it,
 * and unmounting cancels the last.
 */
export function useSecretRelease(): () => SecretRelease {
    const latest = useRef<SecretRelease | null>(null);
    useEffect(() => () => latest.current?.cancel(), []);
    return useCallback(() => {
        latest.current?.cancel();
        latest.current = startSecretRelease();
        return latest.current;
    }, []);
}
