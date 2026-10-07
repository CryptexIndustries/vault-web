import { Stack } from "expo-router";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { colors } from "@/theme";

export default function VaultStackLayout() {
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
                options={{ headerShown: false, title: "Vault" }}
            />
            <Stack.Screen name="[id]" options={{ title: "Credential" }} />
            <Stack.Screen name="new" options={{ title: "New credential" }} />
            <Stack.Screen name="edit" options={{ title: "Edit credential" }} />
            <Stack.Screen name="search" options={{ title: "Search" }} />
        </Stack>
    );
}
