import { Tabs, Redirect } from "expo-router";
import { useAtom, useAtomValue } from "jotai";
import { useEffect } from "react";
import { View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { Link2, LockKeyhole, Plus, RotateCcw } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAdaptiveTabScreenOptions } from "@/components/adaptive-tab-bar";
import { isVaultUnlockedAtom } from "@/utils/atoms";
import { useVaultScreenPrivacy } from "@/hooks/use-vault-screen-privacy";
import { colors } from "@/theme";
import { Text } from "@/components/ui/text";
import { lockedSnackbarAtom } from "@/utils/locked-snackbar";

const SNACKBAR_DURATION_MS = 3200;

function LockedNavIcon({
    icon: NavIcon,
    focused,
}: {
    icon: LucideIcon;
    focused: boolean;
}) {
    return (
        <View className="h-[30px] w-12 items-center justify-center">
            <NavIcon
                color={focused ? colors.primary : colors.muted}
                size={20}
                strokeWidth={1.8}
            />
        </View>
    );
}

/** Navigation for unlock, create, restore, and receive-link screens. */
export default function LockedLayout() {
    const unlocked = useAtomValue(isVaultUnlockedAtom);
    const adaptiveScreenOptions = useAdaptiveTabScreenOptions();
    const insets = useSafeAreaInsets();
    const [snackbar, setSnackbar] = useAtom(lockedSnackbarAtom);
    const isRail = adaptiveScreenOptions.tabBarPosition === "left";
    const screenOptions = {
        ...adaptiveScreenOptions,
        tabBarActiveTintColor: colors.foreground,
        tabBarActiveBackgroundColor: isRail ? undefined : colors.secondary,
        tabBarInactiveBackgroundColor: "transparent",
        tabBarStyle: [
            adaptiveScreenOptions.tabBarStyle,
            {
                ...(isRail ? {} : { height: 88, minHeight: 88 }),
                backgroundColor: colors.navigation,
                borderTopColor: colors.border,
                ...(isRail ? {} : { paddingTop: 8, paddingBottom: 3 }),
            },
        ],
        tabBarLabelStyle: [
            adaptiveScreenOptions.tabBarLabelStyle,
            { fontSize: 10, marginTop: 2, marginBottom: 0 },
        ],
        tabBarItemStyle: isRail
            ? adaptiveScreenOptions.tabBarItemStyle
            : {
                  minHeight: 56,
                  paddingVertical: 0,
                  marginHorizontal: 3,
                  marginBottom: Math.max(insets.bottom - 4, 0),
                  borderRadius: 6,
                  overflow: "hidden" as const,
              },
        tabBarIconStyle: { width: 48, height: 30, margin: 0 },
        tabBarHideOnKeyboard: true,
    };

    useEffect(() => {
        if (!snackbar) return;
        const timeout = setTimeout(
            () => setSnackbar(null),
            SNACKBAR_DURATION_MS,
        );
        return () => clearTimeout(timeout);
    }, [setSnackbar, snackbar]);

    useVaultScreenPrivacy(true, "cryptex-vault-first-use");

    if (unlocked) {
        return <Redirect href="/(app)/(tabs)/vault" />;
    }

    return (
        <View className="flex-1">
            <Tabs screenOptions={screenOptions}>
                <Tabs.Screen
                    name="unlock"
                    options={{
                        title: "Unlock",
                        tabBarAccessibilityLabel: "Unlock vault",
                        tabBarIcon: ({ focused }) => (
                            <LockedNavIcon
                                icon={LockKeyhole}
                                focused={focused}
                            />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="create"
                    options={{
                        title: "Create New",
                        tabBarAccessibilityLabel: "Create new vault",
                        tabBarIcon: ({ focused }) => (
                            <LockedNavIcon icon={Plus} focused={focused} />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="restore"
                    options={{
                        title: "Restore",
                        tabBarAccessibilityLabel: "Restore backup",
                        tabBarIcon: ({ focused }) => (
                            <LockedNavIcon
                                icon={RotateCcw}
                                focused={focused}
                            />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="link"
                    options={{
                        title: "Link Vault",
                        tabBarAccessibilityLabel: "Link Vault",
                        tabBarIcon: ({ focused }) => (
                            <LockedNavIcon icon={Link2} focused={focused} />
                        ),
                    }}
                />
                <Tabs.Screen name="manager" options={{ href: null }} />
                <Tabs.Screen name="devices" options={{ href: null }} />
            </Tabs>
            {snackbar ? (
                <View
                    accessible
                    accessibilityLiveRegion="polite"
                    pointerEvents="none"
                    className="absolute left-[18px] right-[18px] rounded-[14px] bg-foreground px-[18px] py-3.5 shadow-lg"
                    style={{
                        bottom: isRail
                            ? Math.max(insets.bottom, 12)
                            : 100,
                        elevation: 8,
                    }}
                >
                    <Text
                        className="text-[13px] leading-5"
                        style={{ color: colors.navigation }}
                    >
                        {snackbar.message}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}
