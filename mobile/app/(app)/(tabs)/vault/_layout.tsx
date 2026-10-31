import { Stack } from "expo-router";
import { useLingui } from "@lingui/react/macro";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { colors } from "@/theme";

export default function VaultStackLayout() {
    const { t } = useLingui();
    const reducedMotion = useReducedMotion();
    return (
        <Stack
            screenOptions={{
                headerShown: false,
                animation: reducedMotion ? "none" : "slide_from_right",
                contentStyle: { backgroundColor: colors.background },
            }}
        >
            <Stack.Screen
                name="index"
                options={{ headerShown: false, title: t`Vault` }}
            />
            <Stack.Screen name="[id]" options={{ title: t`Credential` }} />
            <Stack.Screen name="new" options={{ title: t`New credential` }} />
            <Stack.Screen name="edit" options={{ title: t`Edit credential` }} />
            <Stack.Screen name="search" options={{ title: t`Search` }} />
        </Stack>
    );
}
