import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { Alert } from "react-native";
import { usePreventRemove } from "expo-router/react-navigation";
import { useLingui } from "@lingui/react/macro";

import { UnlockedDialogTitle as DialogTitle } from "@/components/unlocked/unlocked-ui";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Snackbar, useSnackbar } from "@/components/snackbar";
import { getVaultSessionGeneration } from "@/utils/vault-session";
import {
    type CheckoutTier,
    type PlanTerms,
    storeBilling,
} from "@/app_lib/online-services-billing";
import { unlockedVaultAtom, vaultStore } from "@/utils/atoms";
import {
    AccountControllerProvider,
    useAccountController,
} from "./account-controller";
import { MembershipUpgrade } from "./membership-upgrade";
import type { PaymentStatusProps } from "./payment-status";
import { RecoveryKitDialog } from "./recovery-kit-dialog";
import { StepHeader } from "./step-header";

type SubscriptionSignupProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The user confirmed the Recovery Kit; closing now ends signup. */
    onRecoveryKitSaved?: () => void;
    payment: Pick<PaymentStatusProps, "state" | "trial"> | null;
    /** The payment step, shown in place of the plan and kit. */
    paymentPanel: ReactNode;
    onPay: (tier: CheckoutTier, terms: PlanTerms) => void;
};

export function SubscriptionSignup(props: SubscriptionSignupProps) {
    return (
        <AccountControllerProvider humanCheckDialog>
            <SubscriptionSignupSheet {...props} />
        </AccountControllerProvider>
    );
}

function SubscriptionSignupSheet({
    open,
    onOpenChange,
    onRecoveryKitSaved,
    payment,
    paymentPanel,
    onPay,
}: SubscriptionSignupProps) {
    const { t } = useLingui();
    const account = useAccountController();
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const {
        feedback: billingFeedback,
        show: showFeedback,
        dismiss: dismissFeedback,
    } = useSnackbar(getVaultSessionGeneration(), open);
    const checkoutTierRef = useRef<CheckoutTier>("premiumMonthly");
    const checkoutTrialRef = useRef(false);
    // Until the subscription loads, only an account created here counts as new.
    const [createdHere, setCreatedHere] = useState(false);
    const trialEligible =
        account.subscription?.trialEligible ?? (!account.bound || createdHere);
    const pendingRef = useRef(false);
    const [kitSaved, setKitSaved] = useState(false);
    const savingKit = !!account.recoveryKit && !kitSaved;
    const loading = account.mutationBusy;
    const store = storeBilling();
    const storeOpening = !!store && payment?.state === "opening";

    usePreventRemove(open && (loading || savingKit || storeOpening), () => {
        if (storeOpening)
            Alert.alert(
                t`Payment in progress`,
                store === "app_store"
                    ? t`Finish or cancel the payment in the App Store first.`
                    : t`Finish or cancel the payment in Google Play first.`,
            );
        else
            Alert.alert(
                t`Save your Recovery Kit`,
                t`Complete account setup and save your kit before leaving.`,
            );
    });

    const createAccount = useCallback(
        async (tier: CheckoutTier, trial: boolean) => {
            if (pendingRef.current) return;
            pendingRef.current = true;
            dismissFeedback();
            checkoutTierRef.current = tier;
            checkoutTrialRef.current = trial;
            const wasBound = account.bound;
            try {
                await account.handleRegister();
            } finally {
                if (
                    mounted.current &&
                    !wasBound &&
                    vaultStore.get(unlockedVaultAtom).OnlineServices?.UserID
                )
                    setCreatedHere(true);
                pendingRef.current = false;
            }
        },
        [account, dismissFeedback],
    );

    useEffect(() => {
        if (!account.message) return;
        showFeedback(t`Could not set up Online Services. Please try again.`);
        account.setMessage(null);
    }, [account, showFeedback, t]);

    const pay = (tier: CheckoutTier, trial: boolean) =>
        onPay(tier, { trialEligible, trial });
    const continueToPayment = () => {
        setKitSaved(true);
        onRecoveryKitSaved?.();
        account.clearRecoveryKit();
        pay(checkoutTierRef.current, checkoutTrialRef.current);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            dismissible={!loading && !savingKit && !storeOpening}
            placement="bottom"
            footer={
                open ? (
                    <Snackbar
                        feedback={billingFeedback}
                        onDismiss={dismissFeedback}
                        floating={false}
                    />
                ) : null
            }
            scroll
            scrollResetKey={
                paymentPanel
                    ? "payment"
                    : account.recoveryKit
                      ? "recovery-kit"
                      : "plan"
            }
            loading={loading}
            loadingLabel={
                account.genRecoveryPending
                    ? t`Creating your Recovery Kit…`
                    : t`Setting up Online Services…`
            }
        >
            {/* The payment panel's own title names the state. */}
            {paymentPanel ? null : (
                <DialogHeader>
                    <DialogTitle>
                        {account.recoveryKit
                            ? t`Save your Recovery Kit`
                            : "Online Services"}
                    </DialogTitle>
                </DialogHeader>
            )}
            {account.humanCheck}
            {paymentPanel ? (
                <>
                    {payment?.state !== "confirmed" ? (
                        <StepHeader
                            label={t({
                                message: "Payment",
                                comment: "Checkout step",
                            })}
                            step={3}
                            total={3}
                        />
                    ) : null}
                    {paymentPanel}
                </>
            ) : account.recoveryKit ? (
                <RecoveryKitDialog
                    open
                    kit={account.recoveryKit}
                    continueToPayment
                    onComplete={continueToPayment}
                />
            ) : (
                <>
                    <StepHeader
                        label={t({
                            message: "Choose plan",
                            comment: "Step label above the plan picker",
                        })}
                        step={1}
                        total={3}
                    />
                    <MembershipUpgrade
                        canUpgrade
                        setup={!kitSaved}
                        offerTrial={
                            payment?.state === "offerChanged"
                                ? payment.trial
                                : undefined
                        }
                        trialEligible={trialEligible}
                        initialTier={checkoutTierRef.current}
                        refreshing={account.mutationBusy}
                        onContinue={
                            kitSaved
                                ? pay
                                : (tier, trial) =>
                                      void createAccount(tier, trial)
                        }
                        onMessage={showFeedback}
                    />
                </>
            )}
        </Dialog>
    );
}
