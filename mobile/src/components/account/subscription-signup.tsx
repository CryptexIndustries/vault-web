import { useRef, useState } from "react";
import { Alert } from "react-native";
import { usePreventRemove } from "expo-router/react-navigation";

import { UnlockedDialogTitle as DialogTitle } from "@/components/unlocked/unlocked-ui";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { InlineNotice } from "@/components/inline-notice";
import {
    type CheckoutTier,
    openCheckoutExternal,
} from "@/app_lib/online-services-billing";
import {
    AccountControllerProvider,
    useAccountController,
} from "./account-controller";
import { MembershipUpgrade } from "./membership-upgrade";
import { RecoveryKitDialog } from "./recovery-kit-dialog";

type SubscriptionSignupProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onExternalBillingOpened: () => void;
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
}: SubscriptionSignupProps) {
    const account = useAccountController();
    const checkoutTierRef = useRef<CheckoutTier>("premiumMonthly");
    const pendingRef = useRef(false);
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

    const createAccount = async (tier: CheckoutTier) => {
        if (pendingRef.current) return;
        pendingRef.current = true;
        checkoutTierRef.current = tier;
        try {
            await account.handleRegister();
        } finally {
            pendingRef.current = false;
        }
    };

    const continueToPayment = async () => {
        if (pendingRef.current || !account.recoveryKit) return;
        pendingRef.current = true;
        setKitSaved(true);
        setCheckoutBusy(true);
        account.setMessage(null);
        try {
            const result = await openCheckoutExternal(checkoutTierRef.current);
            if (!result.ok) {
                account.setMessage({ tone: "error", text: result.message });
                return;
            }
            account.clearRecoveryKit();
            onExternalBillingOpened();
            onOpenChange(false);
        } finally {
            pendingRef.current = false;
            setCheckoutBusy(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            dismissible={!loading && !savingKit}
            placement="bottom"
            scroll
            scrollResetKey={account.recoveryKit ? "recovery-kit" : "plan"}
            loading={loading}
            loadingLabel={
                checkoutBusy
                    ? "Opening secure payment…"
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
                <RecoveryKitDialog
                    open
                    kit={account.recoveryKit}
                    continueToPayment
                    onComplete={() => void continueToPayment()}
                />
            ) : (
                <MembershipUpgrade
                    canUpgrade
                    initialTier={checkoutTierRef.current}
                    refreshing={account.mutationBusy}
                    onContinue={createAccount}
                    onMessage={(text) =>
                        account.setMessage({ tone: "error", text })
                    }
                    onExternalBillingOpened={onExternalBillingOpened}
                />
            )}
            {account.message ? (
                <InlineNotice
                    tone={account.message.tone}
                    message={account.message.text}
                />
            ) : null}
        </Dialog>
    );
}
