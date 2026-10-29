import { Alert, View } from "react-native";
import { router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useLingui } from "@lingui/react/macro";

import { AccountSecurity } from "@/components/account/account-security";
import { useAccountController } from "@/components/account/account-controller";
import { InlineNotice } from "@/components/inline-notice";
import {
    UnlockedScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";

export default function AccountSecurityScreen() {
    const { t } = useLingui();
    const account = useAccountController();
    usePreventRemove(
        account.mutationBusy ||
            account.genRecoveryPending ||
            account.rotateRecoveryPending,
        () => {
            Alert.alert(
                t`Account update in progress`,
                t`Wait for the account update to finish before leaving this screen.`,
            );
        },
    );

    return (
        <UnlockedScreen scroll taskTitle={t`Recovery & access`}>
            {account.bound ? (
                <AccountSecurity
                    isRoot={account.isRoot}
                    onlineServicesBound={account.bound}
                    busy={account.mutationBusy}
                    recoveryPhraseAlreadyOnServer={
                        account.recoveryPhraseAlreadyOnServer
                    }
                    genRecoveryPending={account.genRecoveryPending}
                    rotateRecoveryPending={account.rotateRecoveryPending}
                    onGenerateRecovery={() => {
                        void account
                            .handleGenerateRecovery()
                            .then((created) => {
                                if (created) {
                                    router.push("/(app)/account/recovery-kit");
                                }
                            });
                    }}
                    onRotateRecovery={account.openRotateRecovery}
                    onRemoveLocalBinding={account.openRemoveLocalBinding}
                    onDeleteAccount={account.openDeleteAccount}
                />
            ) : (
                <Text className="text-sm leading-5 text-muted-foreground">
                    {t`This vault is no longer connected to Online Services.`}
                </Text>
            )}
            {account.message ? (
                <View className="mt-4">
                    <InlineNotice
                        tone={account.message.tone}
                        message={account.message.text}
                    />
                </View>
            ) : null}
        </UnlockedScreen>
    );
}
