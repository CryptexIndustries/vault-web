import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";

import { AccountAuth } from "@/components/account/account-auth";
import { useAccountController } from "@/components/account/account-controller";
import { InlineNotice } from "@/components/inline-notice";
import { UnlockedScreen } from "@/components/unlocked/unlocked-ui";

export default function AccountRecoverScreen() {
    const account = useAccountController();
    const [recovered, setRecovered] = useState(false);
    usePreventRemove(account.mutationBusy, () => {
        Alert.alert(
            "Account recovery in progress",
            "Wait for account recovery to finish before leaving this screen.",
        );
    });
    useEffect(() => {
        if (!recovered || account.mutationBusy) return;
        router.dismissTo("/(app)/(tabs)/account");
    }, [account.mutationBusy, recovered]);

    return (
        <UnlockedScreen scroll taskTitle="Recover account">
            <AccountAuth
                authMode="recover"
                recoverUserId={account.recoverUserId}
                onRecoverUserIdChange={account.setRecoverUserId}
                recoverPhrase={account.recoverPhrase}
                onRecoverPhraseChange={account.setRecoverPhrase}
                onRegister={() => undefined}
                onRecover={() => {
                    void account.handleRecover().then((succeeded) => {
                        if (succeeded) setRecovered(true);
                    });
                }}
                registerPending={account.registerPending}
                recoverPending={account.recoverPending}
                busy={account.mutationBusy}
            />
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
