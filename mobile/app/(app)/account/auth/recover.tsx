import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useLingui } from "@lingui/react/macro";

import { AccountAuth } from "@/components/account/account-auth";
import { useAccountController } from "@/components/account/account-controller";
import {
    RecoveryStatus,
    type RecoveryStatusState,
} from "@/components/account/recovery-status";
import { StepHeader } from "@/components/account/step-header";
import type { RecoveryOutcome } from "@/components/account/types";
import { UnlockedScreen } from "@/components/unlocked/unlocked-ui";

type Stage = "kit" | "check" | RecoveryStatusState;

export default function AccountRecoverScreen() {
    const { t } = useLingui();
    const account = useAccountController();
    const [stage, setStage] = useState<Stage>("kit");
    const [outcome, setOutcome] = useState<RecoveryOutcome | null>(null);
    const { cancelHumanCheck, setRecoverPhrase } = account;
    // Leaving before a failed save succeeds would lose the recovered account.
    usePreventRemove(
        stage === "recovering" ||
            stage === "connecting" ||
            stage === "saveFailed",
        () => {
            Alert.alert(
                t`Account recovery in progress`,
                t`Wait for account recovery to finish before leaving this screen.`,
            );
        },
    );
    useEffect(
        () => () => {
            cancelHumanCheck();
            setRecoverPhrase("");
        },
        [cancelHumanCheck, setRecoverPhrase],
    );

    // Null means another attempt is running; it owns the screen.
    const settle = (next: RecoveryOutcome | null) => {
        if (!next) return;
        setOutcome(next);
        setStage(next.state === "invalid" ? "kit" : next.state);
    };
    const recover = async () => settle(await account.handleRecover(setStage));
    const saveAgain = async () => {
        setStage("connecting");
        settle(await account.retryRecoverySave());
    };
    const toAccount = () => router.dismissTo("/(app)/(tabs)/account");
    const editKit = () => setStage("kit");
    // Confirm and the retry states start recovery.
    const primary: Partial<Record<RecoveryStatusState, () => void>> = {
        recovered: toAccount,
        kitMissing: () =>
            router.replace({
                pathname: "/(app)/account/recovery-kit",
                params: { auto: "1" },
            }),
        notConnected: toAccount,
        rateLimited: toAccount,
        saveFailed: () => void saveAgain(),
        rejected: editKit,
    };
    const step = (label: string, index: number) => (
        <StepHeader label={label} step={index} total={3} />
    );

    return (
        <UnlockedScreen scroll taskTitle={t`Recover account`}>
            {stage === "kit" ? (
                <>
                    {step(
                        t({
                            message: "Enter kit",
                            comment: "Step label above the Recovery Kit form",
                        }),
                        1,
                    )}
                    <AccountAuth
                        authMode="recover"
                        recoverUserId={account.recoverUserId}
                        onRecoverUserIdChange={(value) => {
                            account.setMessage(null);
                            account.setRecoverUserId(value);
                        }}
                        recoverPhrase={account.recoverPhrase}
                        onRecoverPhraseChange={(value) => {
                            account.setMessage(null);
                            account.setRecoverPhrase(value);
                        }}
                        onRegister={() => undefined}
                        onRecover={() => {
                            if (account.checkRecoverForm()) setStage("confirm");
                        }}
                        registerPending={account.registerPending}
                        recoverPending={account.recoverPending}
                        busy={account.mutationBusy}
                        error={account.message?.text}
                    />
                </>
            ) : (
                <>
                    {stage === "recovered" || stage === "kitMissing"
                        ? null
                        : stage === "confirm"
                          ? step(
                                t({
                                    message: "Confirm",
                                    comment: "Step label",
                                }),
                                2,
                            )
                          : step(
                                t({
                                    message: "Recover",
                                    comment: "Step label",
                                }),
                                3,
                            )}
                    {/* The human check sits in the screen, so no modal has to present over a closing one. */}
                    {stage === "check" ? (
                        account.humanCheck
                    ) : (
                        <RecoveryStatus
                            state={stage}
                            outcome={outcome}
                            onPrimary={primary[stage] ?? (() => void recover())}
                            onSecondary={
                                stage === "kitMissing"
                                    ? toAccount
                                    : stage === "rateLimited"
                                      ? () => void recover()
                                      : editKit
                            }
                        />
                    )}
                </>
            )}
        </UnlockedScreen>
    );
}
