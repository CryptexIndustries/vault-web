import { Stack } from "expo-router";

import { SecurityReportProvider } from "@/components/security-report-provider";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { colors } from "@/theme";

export default function SecurityReportLayout() {
    const reducedMotion = useReducedMotion();
    return (
        <SecurityReportProvider>
            <Stack
                screenOptions={{
                    headerShown: false,
                    animation: reducedMotion ? "none" : "slide_from_right",
                    contentStyle: { backgroundColor: colors.background },
                }}
            />
        </SecurityReportProvider>
    );
}
