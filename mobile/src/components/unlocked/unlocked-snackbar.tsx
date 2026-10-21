import { useCallback, useEffect } from "react";
import { View } from "react-native";
import { atom, useAtom, useSetAtom } from "jotai";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { UnlockedText } from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

const SNACKBAR_DURATION_MS = 3200;

const unlockedSnackbarAtom = atom<{ message: string; id: number } | null>(null);

/** Shows a short notice for transient failures such as a copy or share. */
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

    useEffect(() => {
        if (!snackbar) return;
        const timeout = setTimeout(
            () => setSnackbar(null),
            SNACKBAR_DURATION_MS,
        );
        return () => clearTimeout(timeout);
    }, [setSnackbar, snackbar]);

    if (!snackbar) return null;
    return (
        <View
            accessible
            accessibilityLiveRegion="polite"
            pointerEvents="none"
            style={{
                position: "absolute",
                left: 18,
                right: 18,
                bottom: insets.bottom + 90,
                borderRadius: 14,
                paddingHorizontal: 18,
                paddingVertical: 14,
                backgroundColor: colors.foreground,
                elevation: 8,
            }}
        >
            <UnlockedText
                style={{
                    color: colors.navigation,
                    fontSize: 13,
                    lineHeight: 20,
                }}
            >
                {snackbar.message}
            </UnlockedText>
        </View>
    );
}
