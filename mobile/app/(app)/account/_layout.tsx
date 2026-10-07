import { Stack } from "expo-router";

import { AccountControllerProvider } from "@/components/account/account-controller";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { colors } from "@/theme";

export default function AccountTaskLayout() {
    const reducedMotion = useReducedMotion();
    return (
        <AccountControllerProvider>
            <Stack
                screenOptions={{
                    headerShown: false,
                    animation: reducedMotion ? "none" : "slide_from_right",
                    contentStyle: { backgroundColor: colors.background },
                }}
            >
                <Stack.Screen name="security" />
                <Stack.Screen name="devices/index" />
                <Stack.Screen name="auth/register" />
                <Stack.Screen name="auth/recover" />
                <Stack.Screen
                    name="recovery-kit"
                    options={{ gestureEnabled: false }}
                />
            </Stack>
        </AccountControllerProvider>
    );
}
