import { useState } from "react";
import { Tabs } from "expo-router";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { UnlockedTabBar } from "@/components/unlocked/unlocked-ui";
import { AddItemSheet } from "@/components/vault/add-item-sheet";
import { colors } from "@/theme";

export default function UnlockedTabsLayout() {
    const reducedMotion = useReducedMotion();
    const [addDirectoryId, setAddDirectoryId] = useState<string | null>(null);

    return (
        <>
            <Tabs
                initialRouteName="vault"
                backBehavior="history"
                tabBar={(props) => (
                    <UnlockedTabBar {...props} onAdd={setAddDirectoryId} />
                )}
                screenOptions={{
                    headerShown: false,
                    animation: reducedMotion ? "none" : "fade",
                    sceneStyle: { backgroundColor: colors.background },
                    headerStyle: { backgroundColor: colors.background },
                    headerTintColor: colors.primary,
                    headerTitleStyle: {
                        color: colors.foreground,
                        fontFamily: "sans-serif",
                        fontWeight: "600",
                    },
                    headerShadowVisible: false,
                }}
            >
                <Tabs.Screen
                    name="vault"
                    options={{
                        title: "Vault",
                        tabBarAccessibilityLabel: "Vault",
                    }}
                />
                <Tabs.Screen
                    name="account"
                    options={{
                        title: "Account",
                        tabBarAccessibilityLabel: "Account",
                    }}
                />
                <Tabs.Screen
                    name="devices"
                    options={{
                        title: "Devices",
                        tabBarAccessibilityLabel: "Devices",
                    }}
                />
                <Tabs.Screen
                    name="settings"
                    options={{
                        title: "More",
                        tabBarAccessibilityLabel: "More",
                    }}
                />
            </Tabs>
            <AddItemSheet
                open={addDirectoryId !== null}
                onOpenChange={(open) => !open && setAddDirectoryId(null)}
                directoryId={addDirectoryId ?? ""}
            />
        </>
    );
}
