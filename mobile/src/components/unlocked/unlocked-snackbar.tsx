import { useCallback } from "react";
import { atom, useAtom, useSetAtom } from "jotai";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Snackbar } from "@/components/snackbar";

const unlockedSnackbarAtom = atom<{ message: string; id: number } | null>(null);

/**
 * Shows a short notice in the app's snackbar. It lives above the screens, so
 * a notice survives navigating, e.g. "Connected" on the agent page.
 */
export function useUnlockedSnackbar() {
    const setSnackbar = useSetAtom(unlockedSnackbarAtom);
    return useCallback(
        (message: string) => setSnackbar({ message, id: Date.now() }),
        [setSnackbar],
    );
}

export function UnlockedSnackbar() {
    const insets = useSafeAreaInsets();
    const [snackbar, setSnackbar] = useAtom(unlockedSnackbarAtom);
    const dismiss = useCallback(() => setSnackbar(null), [setSnackbar]);
    // Clear of the footer buttons on task screens.
    return (
        <Snackbar
            feedback={snackbar}
            onDismiss={dismiss}
            bottomOffset={insets.bottom + 90}
        />
    );
}
