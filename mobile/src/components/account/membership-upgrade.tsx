import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import {
    UnlockedButton as Button,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import {
    type CheckoutTier,
    purchaseMembership,
    isGooglePlayBuild,
    type StorePlan,
    loadStorePlans,
    checkStorePurchaseStatus,
} from "@/app_lib/online-services-billing";
import { colors } from "@/theme";
import { currentPriceList } from "../../../../web/src/lib/price-lists";
import { BillingPendingNotice } from "./billing-pending-notice";
import { MembershipBenefits } from "./membership-benefits";
import { BillingIntervalSelector } from "./billing-interval-selector";
import type { FeedbackAction } from "@/components/snackbar";

export type MembershipUpgradeProps = {
    canUpgrade: boolean;
    refreshing: boolean;
    onMessage: (message: string, recovery?: FeedbackAction) => void;
    onExternalBillingOpened: (
        outcome?: "success" | "resume" | "external",
    ) => void;
    onContinue?: (tier: CheckoutTier) => Promise<void>;
    initialTier?: CheckoutTier;
    onBillingBusyChange?: (busy: boolean) => void;
    pendingConfirmation?: boolean;
    onPendingChange?: (pending: boolean) => void;
};
export function MembershipUpgrade({
    canUpgrade,
    refreshing,
    onMessage,
    onExternalBillingOpened,
    onContinue,
    onBillingBusyChange,
    pendingConfirmation,
    onPendingChange,
    initialTier = "premiumMonthly",
}: MembershipUpgradeProps) {
    const play = isGooglePlayBuild();
    const mounted = useRef(true);
    const feedbackLifetime = useRef(onMessage);
    feedbackLifetime.current = onMessage;
    const inFlight = useRef(false);
    const retryBilling = useRef<(checking?: boolean) => Promise<void>>(
        async () => {},
    );
    const [plans, setPlans] = useState<StorePlan[]>();
    const [tier, setTier] = useState(initialTier);
    const selectedPlan = plans?.find((plan) => plan.tier === tier);
    const [busy, setBusy] = useState(false);
    const [localPending, setPending] = useState(false);
    const pending = !!pendingConfirmation || localPending;
    const pendingRef = useRef(pending);
    pendingRef.current = pending;
    useEffect(() => {
        if (pendingConfirmation !== undefined) {
            pendingRef.current = pendingConfirmation;
            setPending(pendingConfirmation);
        }
    }, [pendingConfirmation]);
    const [pricesUnavailable, setPricesUnavailable] = useState(false);
    const [reload, setReload] = useState(0);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        if (!play) return;
        let current = true;
        setPlans(undefined);
        setPricesUnavailable(false);
        void loadStorePlans()
            .then((value) => {
                if (current) setPlans(value);
            })
            .catch(() => {
                if (!current) return;
                setPricesUnavailable(true);
                onMessage(
                    "Could not load Google Play prices. Please try again.",
                    {
                        label: "Retry prices",
                        onPress: () => {
                            if (current && mounted.current)
                                setReload((value) => value + 1);
                        },
                    },
                );
            });
        return () => {
            current = false;
        };
    }, [play, onMessage, reload]);
    const savings = (
        Number(currentPriceList.monthly.price) * 12 -
        Number(currentPriceList.yearly.price)
    ).toFixed(2);
    const intervalPlans = play
        ? Object.fromEntries(
              plans?.map((plan) => [
                  plan.tier,
                  {
                      price: plan.price,
                      caption:
                          plan.tier === "premiumMonthly"
                              ? "Billed monthly"
                              : "Billed yearly",
                  },
              ]) ?? [],
          )
        : {
              premiumMonthly: {
                  price: `€${currentPriceList.monthly.price}`,
                  caption: "Billed monthly",
              },
              premiumYearly: {
                  price: `€${currentPriceList.yearly.price}`,
                  caption: `Save €${savings} a year`,
              },
          };
    const disabled = busy || refreshing;
    const submit = async (checking = false) => {
        if (
            !mounted.current ||
            disabled ||
            inFlight.current ||
            (!checking &&
                (pendingRef.current ||
                    !canUpgrade ||
                    (play && !onContinue && !plans)))
        )
            return;
        inFlight.current = true;
        setBusy(true);
        onBillingBusyChange?.(true);
        const isCurrent = () =>
            mounted.current && feedbackLifetime.current === onMessage;
        const recovery = {
            label: checking ? "Check status" : "Retry",
            onPress: () => {
                if (isCurrent()) return retryBilling.current(checking);
            },
        };
        try {
            if (onContinue) {
                await onContinue(tier);
                return;
            }
            const result = checking
                ? await checkStorePurchaseStatus()
                : await purchaseMembership(tier);
            if (!isCurrent()) return;
            if (!play) {
                if (result.ok) onExternalBillingOpened();
                else
                    onMessage(
                        result.message,
                        result.retryable === false ? undefined : recovery,
                    );
            } else if (result.ok) {
                // A completed store payment still waits for authoritative membership.
                pendingRef.current = !checking;
                setPending(!checking);
                onPendingChange?.(!checking);
                onExternalBillingOpened("success");
            } else if (result.pending) {
                pendingRef.current = true;
                setPending(true);
                onPendingChange?.(true);
            } else if (!result.canceled)
                onMessage(
                    result.message,
                    result.retryable === false ? undefined : recovery,
                );
        } catch {
            if (isCurrent())
                onMessage(
                    play
                        ? "Could not complete billing. Please try again."
                        : "Could not open checkout. Please try again.",
                    recovery,
                );
        } finally {
            inFlight.current = false;
            if (mounted.current) setBusy(false);
            if (isCurrent()) onBillingBusyChange?.(false);
        }
    };
    retryBilling.current = submit;
    return (
        <View style={{ gap: 22 }}>
            <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>
                Your vault stays yours. We run the supporting infrastructure and
                store your encrypted backups.
            </Text>
            <BillingIntervalSelector
                value={tier}
                onChange={setTier}
                disabled={disabled || pending}
                plans={intervalPlans}
                pricePlaceholder={
                    pricesUnavailable ? "Unavailable" : "Loading…"
                }
            />
            {pending ? (
                <BillingPendingNotice
                    busy={busy || refreshing}
                    onCheckStatus={() => void submit(true)}
                />
            ) : (
                <View style={{ gap: 9 }}>
                    <Button
                        loading={busy}
                        disabled={
                            disabled ||
                            !canUpgrade ||
                            (play &&
                                !onContinue &&
                                !plans &&
                                !pricesUnavailable)
                        }
                        onPress={() =>
                            play && !onContinue && pricesUnavailable
                                ? setReload((value) => value + 1)
                                : void submit()
                        }
                    >
                        {onContinue
                            ? "Continue"
                            : play && pricesUnavailable
                              ? "Retry prices"
                              : play && !plans
                                ? "Loading prices…"
                                : tier === "premiumYearly"
                                  ? "Continue with yearly"
                                  : "Continue with monthly"}
                    </Button>
                    {onContinue || !play || selectedPlan ? (
                        <Text
                            style={{
                                color: colors.muted,
                                fontSize: 11,
                                lineHeight: 17,
                                textAlign: "center",
                            }}
                        >
                            {onContinue
                                ? "No email required. Save your Recovery Kit before payment."
                                : play
                                  ? "Checkout opens in Google Play."
                                  : "VAT included. Checkout opens in your browser."}
                        </Text>
                    ) : null}
                    {selectedPlan ? (
                        <Text
                            style={{
                                color: colors.muted,
                                fontSize: 11,
                                lineHeight: 17,
                                textAlign: "center",
                            }}
                        >
                            {`${selectedPlan.price} charged every ${tier === "premiumMonthly" ? "month" : "year"}. Automatically renews until canceled. Cancel anytime in Google Play Subscriptions. Access continues until the end of the paid period.`}
                        </Text>
                    ) : null}
                    {!canUpgrade && !refreshing ? (
                        <Text
                            style={{
                                color: colors.muted,
                                fontSize: 12,
                                lineHeight: 18,
                            }}
                        >
                            An upgrade is available for connected free accounts.
                        </Text>
                    ) : null}
                </View>
            )}
            <MembershipBenefits upgrading />
            <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 17 }}>
                New to Online Services? Start with monthly billing before
                committing to a year.
            </Text>
        </View>
    );
}
