import { type ReactNode } from "react";
import { View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useAtomValue } from "jotai";

import { isVaultUnlockedAtom } from "@/utils/atoms";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useAutoLock } from "@/hooks/use-auto-lock";
import { useVaultScreenPrivacy } from "@/hooks/use-vault-screen-privacy";
import { SyncControllerProvider } from "@/components/sync-controller-provider";
import { VaultLockScreen } from "@/components/unlocked/unlocked-ui";
import { UnlockedConfirmationProvider } from "@/components/unlocked/confirmation-sheet";
import { vaultLockStateAtom } from "@/utils/vault-lock";
import { colors } from "@/theme";

export const unstable_settings = {
    anchor: "(tabs)",
};

/**
 * Unlocked shell: screen privacy + auto-lock interaction capture at the root.
 * Touch capture returns false so child controls keep receiving events.
 */
function UnlockedShell({ children }: { children: ReactNode }) {
    const lockState = useAtomValue(vaultLockStateAtom);
    const isFocused = useIsFocused();
    useVaultScreenPrivacy(true);
    const { onInteraction, resumeAfterFailedLock } = useAutoLock(isFocused);
    return (
        <View
            style={{ flex: 1 }}
            onStartShouldSetResponderCapture={() => {
                onInteraction();
                return false;
            }}
        >
            {lockState === "idle" ? (
                <UnlockedConfirmationProvider>
                    {children}
                </UnlockedConfirmationProvider>
            ) : (
                <VaultLockScreen onContinueEditing={resumeAfterFailedLock} />
            )}
        </View>
    );
}

export default function AppLayout() {
    const reducedMotion = useReducedMotion();
    const unlocked = useAtomValue(isVaultUnlockedAtom);
    if (!unlocked) {
        return <Redirect href="/(locked)/unlock" />;
    }

    return (
        <SyncControllerProvider>
            <UnlockedShell>
                <Stack
                    screenOptions={{
                        headerShown: false,
                        animation: reducedMotion ? "none" : "slide_from_right",
                        contentStyle: { backgroundColor: colors.background },
                    }}
                >
                    <Stack.Screen
                        name="(tabs)"
                        options={{ animation: "none" }}
                    />
                </Stack>
            </UnlockedShell>
        </SyncControllerProvider>
    );
}
