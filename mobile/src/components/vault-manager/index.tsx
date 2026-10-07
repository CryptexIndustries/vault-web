import { vars } from "nativewind";
import { useCallback, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSetAtom } from "jotai";

import { listVaults } from "@/app_lib/vault-utils/storage";
import { VaultEntryHeader } from "@/components/vault-entry-ui";
import { Screen } from "@/components/screen";
import { Text } from "@/components/ui/text";
import { CreateTab } from "@/components/vault-manager/create-tab";
import { RestoreTab } from "@/components/vault-manager/restore-tab";
import { UnlockTab } from "@/components/vault-manager/unlock-tab";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { cn } from "@/lib/utils";
import { colors } from "@/theme";
import { lockedSnackbarAtom } from "@/utils/locked-snackbar";

export type VaultManagerTab = "unlock" | "create" | "restore";

type VaultManagerProps = {
    tab: VaultManagerTab;
    returnTo?: string;
    restoredGuidance?: boolean;
};

const tabCopy: Record<VaultManagerTab, { title: string; subtitle: string }> = {
    unlock: {
        title: "Unlock vault",
        subtitle: "Unlock a vault saved on this device.",
    },
    create: {
        title: "Create vault",
        subtitle: "Create an encrypted vault. No account required.",
    },
    restore: {
        title: "Restore vault",
        subtitle: "Restore an encrypted Cryptex Vault backup.",
    },
};

/** Renders the create, unlock, or restore screen selected by the route. */
export function VaultManager({
    tab,
    returnTo,
    restoredGuidance = false,
}: VaultManagerProps) {
    const { width, height } = useBreakpoint();
    const [ready, setReady] = useState(false);
    const setSnackbar = useSetAtom(lockedSnackbarAtom);

    const refreshCount = useCallback(async () => {
        try {
            const vaults = await listVaults();
            return vaults.length;
        } catch {
            return 0;
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            void (async () => {
                const count = await refreshCount();
                if (cancelled) return;
                if (tab === "unlock" && count === 0) {
                    router.replace("/(locked)/create" as never);
                    return;
                }
                setReady(true);
            })();
            return () => {
                cancelled = true;
            };
        }, [tab, refreshCount]),
    );

    const showSnackbar = (message: string) => {
        setSnackbar({ message });
    };

    const copy = tabCopy[tab];
    const horizontal = width > height;

    return (
        <Screen
            scroll
            maxWidth="none"
            keyboardAvoiding
            edges={["top", "left", "right"]}
            contentContainerClassName="px-5 pb-8 pt-0"
            style={vars({ "--primary-foreground": "224.21 28.36% 13.14%" })}
        >
            <View
                className={cn(
                    "w-full self-center",
                    horizontal && "flex-row items-start justify-center",
                )}
                style={{ maxWidth: horizontal ? 760 : 460 }}
            >
                <VaultEntryHeader
                    title={copy.title}
                    subtitle={copy.subtitle}
                    showBack={tab !== "unlock"}
                    onBack={() => router.replace("/(locked)/unlock" as never)}
                    className={cn(horizontal && "mr-8 w-[280px]")}
                />

                <View
                    className={cn(
                        "w-full",
                        horizontal && "max-w-[430px] flex-1",
                    )}
                >
                    {!ready ? (
                        <View className="items-center gap-3 py-10">
                            <ActivityIndicator color={colors.primary} />
                            <Text className="text-sm text-muted-foreground">
                                Loading vaults…
                            </Text>
                        </View>
                    ) : (
                        <View className="gap-4">
                            {tab === "unlock" ? (
                                <UnlockTab
                                    onFeedback={showSnackbar}
                                    returnTo={returnTo}
                                    restoredGuidance={restoredGuidance}
                                    onVaultDeleted={() => {
                                        void refreshCount().then((count) => {
                                            if (count === 0) {
                                                router.replace(
                                                    "/(locked)/create" as never,
                                                );
                                            }
                                        });
                                    }}
                                />
                            ) : null}
                            {tab === "create" ? <CreateTab /> : null}
                            {tab === "restore" ? (
                                <RestoreTab
                                    onRestored={() => {
                                        void refreshCount().then((count) => {
                                            if (count > 0) {
                                                router.replace({
                                                    pathname:
                                                        "/(locked)/unlock",
                                                    params: { restored: "1" },
                                                } as never);
                                            }
                                        });
                                    }}
                                />
                            ) : null}
                        </View>
                    )}
                </View>
            </View>
        </Screen>
    );
}
