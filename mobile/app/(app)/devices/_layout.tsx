import { Stack } from "expo-router";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { colors } from "@/theme";

export default function DevicesStackLayout() {
    const reducedMotion = useReducedMotion();
    return (
        <Stack
            screenOptions={{
                headerShown: false,
                animation: reducedMotion ? "none" : "slide_from_right",
                contentStyle: { backgroundColor: colors.background },
            }}
        />
    );
}
