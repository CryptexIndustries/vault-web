import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";

import { useAccountController } from "@/components/account/account-controller";
import { RecoveryKitDialog } from "@/components/account/recovery-kit-dialog";
import { InlineNotice } from "@/components/inline-notice";
import { UnlockedScreen } from "@/components/unlocked/unlocked-ui";

export default function AccountRecoveryKitScreen() {
    const { auto } = useLocalSearchParams<{ auto?: string }>();
    const account = useAccountController();
    const { genRecoveryPending, handleGenerateRecovery, recoveryKit } = account;
    const autoGenerationStartedRef = useRef(false);
    const clearRecoveryKitRef = useRef(account.clearRecoveryKit);
    const [allowRemove, setAllowRemove] = useState(false);
    const [autoGenerating, setAutoGenerating] = useState(false);
    const [exitDestination, setExitDestination] = useState<
        "account" | "back" | null
    >(null);

    clearRecoveryKitRef.current = account.clearRecoveryKit;
    useEffect(
        () => () => {
            clearRecoveryKitRef.current();
        },
        [],
    );

    useEffect(() => {
        if (
            auto !== "1" ||
            recoveryKit ||
            genRecoveryPending ||
            autoGenerationStartedRef.current
        ) {
            return;
        }
        autoGenerationStartedRef.current = true;
        setAutoGenerating(true);
        void handleGenerateRecovery().finally(() => {
            setAutoGenerating(false);
        });
    }, [auto, genRecoveryPending, handleGenerateRecovery, recoveryKit]);

    const guardNavigation =
        !allowRemove &&
        (!!recoveryKit ||
            genRecoveryPending ||
            autoGenerating ||
            (auto === "1" && !account.message));
    usePreventRemove(guardNavigation, () => {
        Alert.alert(
            "Save your Recovery Kit",
            "Copy or save the kit and finish this step before leaving.",
        );
    });

    useEffect(() => {
        if (!allowRemove || !exitDestination) return;
        if (exitDestination === "account") {
            router.dismissTo("/(app)/(tabs)/account");
        } else {
            router.back();
        }
    }, [allowRemove, exitDestination]);

    const finish = () => {
        setAllowRemove(true);
        setExitDestination(
            account.recoveryKitFromRegistration ? "account" : "back",
        );
    };

    return (
        <UnlockedScreen scroll taskTitle="Account Recovery Kit">
            {recoveryKit ? (
                <RecoveryKitDialog open kit={recoveryKit} onComplete={finish} />
            ) : genRecoveryPending ||
              autoGenerating ||
              (auto === "1" && !account.message) ? (
                <InlineNotice
                    tone="loading"
                    message="Creating your Recovery Kit…"
                />
            ) : (
                <InlineNotice
                    tone={account.message?.tone ?? "info"}
                    message={
                        account.message?.text ??
                        "No Recovery Kit is available to display."
                    }
                />
            )}
            {recoveryKit && account.message ? (
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
