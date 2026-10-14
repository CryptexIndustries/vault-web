import type { ComponentProps } from "react";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { colors } from "@/theme";

type TabScreenOptions = Exclude<
    ComponentProps<typeof Tabs>["screenOptions"],
    undefined | ((props: never) => unknown)
>;

/** Compact tablet landscape rail width (dp). */
const TABLET_RAIL_WIDTH = 116;

/**
 * Shared Tabs options: bottom tabs on phones in either orientation, compact
 * left rail when the shortest viewport side identifies a real tablet.
 */
export function useAdaptiveTabScreenOptions(
    overrides?: TabScreenOptions,
): TabScreenOptions {
    const { isTablet } = useBreakpoint();
    const reducedMotion = useReducedMotion();
    const insets = useSafeAreaInsets();

    return {
        headerShown: false,
        tabBarPosition: isTablet ? "left" : "bottom",
        tabBarLabelPosition: isTablet ? "beside-icon" : "below-icon",
        tabBarActiveTintColor: isTablet ? colors.foreground : colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: isTablet
            ? {
                  width: TABLET_RAIL_WIDTH,
                  backgroundColor: colors.navigation,
                  borderTopWidth: 0,
                  borderRightWidth: 1,
                  borderRightColor: colors.border,
                  paddingTop: Math.max(insets.top, 12),
                  paddingBottom: Math.max(insets.bottom, 8),
                  paddingLeft: Math.max(insets.left, 0),
                  paddingRight: 0,
              }
            : {
                  backgroundColor: colors.background,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                  minHeight: 52,
              },
        tabBarItemStyle: isTablet
            ? {
                  minHeight: 44,
                  paddingVertical: 7,
                  paddingHorizontal: 2,
              }
            : {
                  minHeight: 44,
              },
        tabBarLabelStyle: isTablet
            ? {
                  fontFamily: "Oxanium_500Medium",
                  fontSize: 10,
                  fontWeight: "500",
                  marginLeft: 1,
              }
            : {
                  fontFamily: "Oxanium_500Medium",
                  fontSize: 11,
                  fontWeight: "500",
              },
        sceneStyle: { backgroundColor: colors.background },
        animation: reducedMotion ? "none" : "shift",
        ...overrides,
    };
}
