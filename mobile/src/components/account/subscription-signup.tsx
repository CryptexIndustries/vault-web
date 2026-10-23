import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { usePreventRemove } from "expo-router/react-navigation";

import { UnlockedDialogTitle as DialogTitle } from "@/components/unlocked/unlocked-ui";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Snackbar, useSnackbar } from "@/components/snackbar";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";
import {
    type CheckoutTier,
    purchaseMembership,
    isGooglePlayBuild,
    checkStorePurchaseStatus,
} from "@/app_lib/online-services-billing";
import {
    unlockedVaultAtom,
    vaultStore,
    onlineServicesDataAtom,
    onlineServicesStore,
} from "@/utils/atoms";
import {
    AccountControllerProvider,
    useAccountController,
} from "./account-controller";
import { MembershipUpgrade } from "./membership-upgrade";
import { RecoveryKitDialog } from "./recovery-kit-dialog";
import { BillingPendingNotice } from "./billing-pending-notice";

type SubscriptionSignupProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    pendingConfirmation?: boolean;
    onPendingChange?: (pending: boolean) => void;
    /** The user confirmed the Recovery Kit; closing now ends signup. */
    onRecoveryKitSaved?: () => void;
    onExternalBillingOpened: (
        outcome?: "success" | "resume" | "external",
    ) => void;
};

export function SubscriptionSignup(props: SubscriptionSignupProps) {
    return (
        <AccountControllerProvider>
            <SubscriptionSignupSheet {...props} />
        </AccountControllerProvider>
    );
}

function SubscriptionSignupSheet({
    open,
    onOpenChange,
    onExternalBillingOpened,
    pendingConfirmation,
    onPendingChange,
    onRecoveryKitSaved,
}: SubscriptionSignupProps) {
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
    const [localPending, setLocalPending] = useState(
        pendingConfirmation ?? false,
    );
    const paymentPending = !!pendingConfirmation || localPending;
    const paymentPendingRef = useRef(paymentPending);
    paymentPendingRef.current = paymentPending;
    useEffect(() => {
        if (pendingConfirmation !== undefined) {
            paymentPendingRef.current = pendingConfirmation;
            setLocalPending(pendingConfirmation);
        }
    }, [pendingConfirmation]);
    const paymentLifetime = useRef({
        open,
        kit: account.recoveryKit,
        connected: account.hasSession,
        revision: 0,
    });
    const previousLifetime = paymentLifetime.current;
    paymentLifetime.current = {
        open,
        kit: account.recoveryKit,
        connected: account.hasSession,
        revision:
            previousLifetime.revision +
            Number(
                previousLifetime.open !== open ||
                    previousLifetime.kit !== account.recoveryKit ||
                    (previousLifetime.connected && !account.hasSession),
            ),
    };
    const retryPayment = useRef<(checking?: boolean) => Promise<void>>(
        async () => {},
    );
    const [checkoutBusy, setCheckoutBusy] = useState(false);
    const [kitSaved, setKitSaved] = useState(false);
    const savingKit = !!account.recoveryKit && !kitSaved;
    const loading = account.mutationBusy || checkoutBusy;

    usePreventRemove(open && (loading || savingKit), () => {
        Alert.alert(
            "Save your Recovery Kit",
            "Complete account setup and save your kit before leaving.",
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
        showFeedback("Could not set up Online Services. Please try again.");
        account.setMessage(null);
    }, [account, showFeedback]);

    const continueToPayment = async (checking = false) => {
        if (
            !mounted.current ||
            !open ||
            pendingRef.current ||
            (!checking && paymentPendingRef.current) ||
            !account.recoveryKit
        )
            return;
        pendingRef.current = true;
        dismissFeedback();
        const generation = getVaultSessionGeneration();
        const revision = paymentLifetime.current.revision;
        const binding = vaultStore.get(unlockedVaultAtom).OnlineServices;
        const userId = binding?.UserID;
        const deviceId = binding?.DeviceId;
        const isCurrent = () => {
            const current = vaultStore.get(unlockedVaultAtom).OnlineServices;
            return (
                mounted.current &&
                paymentLifetime.current.revision === revision &&
                isSameActiveVaultSession(generation) &&
                current?.UserID === userId &&
                current?.DeviceId === deviceId &&
                !!onlineServicesStore.get(onlineServicesDataAtom)?.sessionToken
                    ?.length
            );
        };
        const markPending = (pending: boolean) => {
            paymentPendingRef.current = pending;
            setLocalPending(pending);
            onPendingChange?.(pending);
        };
        const recovery = {
            label: checking ? "Check status" : "Retry",
            onPress: () => {
                if (isCurrent()) return retryPayment.current(checking);
            },
        };
        setKitSaved(true);
        onRecoveryKitSaved?.();
        setCheckoutBusy(true);
        account.setMessage(null);
        try {
            const confirmed = account.subscription?.nonFree === true;
            const result = confirmed
                ? { ok: true as const }
                : checking
                  ? await checkStorePurchaseStatus()
                  : await purchaseMembership(checkoutTierRef.current, {
                        trialEligible,
                        trial: checkoutTrialRef.current,
                    });
            if (!isCurrent()) return;
            if (!result.ok) {
                if (result.offerChanged) {
                    // Retrying buys the new terms the message describes.
                    checkoutTrialRef.current = result.offerChanged.trial;
                    showFeedback(
                        result.offerChanged.trial
                            ? "This plan now starts with a 14-day free trial. Retry to start it."
                            : "The free trial is no longer available for this plan. Retry to subscribe at the full price.",
                        recovery,
                    );
                } else if (result.pending) markPending(true);
                else if (!result.canceled)
                    showFeedback(
                        result.message,
                        result.retryable === false ? undefined : recovery,
                    );
                return;
            }
            const play = isGooglePlayBuild();
            if (play) markPending(!checking && !confirmed);
            account.clearRecoveryKit();
            onExternalBillingOpened(play || confirmed ? "success" : undefined);
            onOpenChange(false);
        } catch {
            if (isCurrent())
                showFeedback(
                    checking
                        ? "Could not check your subscription. Please try again."
                        : "Could not open secure payment. Please try again.",
                    recovery,
                );
        } finally {
            pendingRef.current = false;
            if (mounted.current) setCheckoutBusy(false);
        }
    };
    retryPayment.current = continueToPayment;

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            dismissible={!loading && !savingKit}
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
            scrollResetKey={account.recoveryKit ? "recovery-kit" : "plan"}
            loading={loading}
            loadingLabel={
                checkoutBusy
                    ? paymentPending
                        ? "Checking your subscription…"
                        : "Opening secure payment…"
                    : account.genRecoveryPending
                      ? "Creating your Recovery Kit…"
                      : "Setting up Online Services…"
            }
        >
            <DialogHeader>
                <DialogTitle>
                    {account.recoveryKit
                        ? "Save your Recovery Kit"
                        : "Online Services"}
                </DialogTitle>
            </DialogHeader>
            {account.recoveryKit ? (
                <>
                    <RecoveryKitDialog
                        open
                        kit={account.recoveryKit}
                        continueToPayment
                        completionDisabled={paymentPending}
                        onComplete={() => void continueToPayment()}
                    />
                    {paymentPending ? (
                        <BillingPendingNotice
                            busy={loading}
                            onCheckStatus={() => void continueToPayment(true)}
                        />
                    ) : null}
                </>
            ) : (
                <MembershipUpgrade
                    canUpgrade
                    trialEligible={trialEligible}
                    initialTier={checkoutTierRef.current}
                    refreshing={account.mutationBusy}
                    onContinue={createAccount}
                    onMessage={showFeedback}
                    onExternalBillingOpened={onExternalBillingOpened}
                />
            )}
        </Dialog>
    );
}
