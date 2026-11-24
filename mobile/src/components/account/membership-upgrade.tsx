import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { t as translate } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";

import {
    UnlockedButton as Button,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import {
    type CheckoutTier,
    storeBilling,
    type StorePlan,
    loadStorePlans,
} from "@/app_lib/online-services-billing";
import { colors } from "@/theme";
import { currentPriceList } from "../../../../web/src/lib/price-lists";
import { MembershipBenefits } from "./membership-benefits";
import { PaymentStatus } from "./payment-status";
import { BillingIntervalSelector } from "./billing-interval-selector";
import type { FeedbackAction } from "@/components/snackbar";

export type MembershipUpgradeProps = {
    canUpgrade: boolean;
    refreshing: boolean;
    onMessage: (message: string, recovery?: FeedbackAction) => void;
    onContinue: (tier: CheckoutTier, trial: boolean) => void;
    /** Signup: Continue sets up the account and kit before payment. */
    setup?: boolean;
    /** The store changed the free trial since the plan was last shown. */
    offerTrial?: boolean;
    initialTier?: CheckoutTier;
    trialEligible?: boolean;
};
export function MembershipUpgrade({
    canUpgrade,
    refreshing,
    onMessage,
    onContinue,
    setup = false,
    offerTrial,
    trialEligible = false,
    initialTier = "premiumMonthly",
}: MembershipUpgradeProps) {
    const { t } = useLingui();
    const store = storeBilling();
    const storeBuild = store !== null;
    const appStore = store === "app_store";
    const [plans, setPlans] = useState<StorePlan[]>();
    const [tier, setTier] = useState(initialTier);
    const selectedPlan = plans?.find((plan) => plan.tier === tier);
    const [pricesUnavailable, setPricesUnavailable] = useState(false);
    const [reload, setReload] = useState(0);
    useEffect(() => {
        if (!storeBuild) return;
        let current = true;
        setPlans(undefined);
        setPricesUnavailable(false);
        void loadStorePlans(trialEligible)
            .then((value) => {
                if (current) setPlans(value);
            })
            .catch(() => {
                if (!current) return;
                setPricesUnavailable(true);
                onMessage(
                    appStore
                        ? translate`Could not load App Store prices. Please try again.`
                        : translate`Could not load Google Play prices. Please try again.`,
                    {
                        label: translate`Retry prices`,
                        onPress: () => {
                            if (current) setReload((value) => value + 1);
                        },
                    },
                );
            });
        return () => {
            current = false;
        };
    }, [storeBuild, appStore, onMessage, reload, trialEligible]);
    const savings = (
        Number(currentPriceList.monthly.price) * 12 -
        Number(currentPriceList.yearly.price)
    ).toFixed(2);
    const intervalPlans = storeBuild
        ? Object.fromEntries(
              plans?.map((plan) => [
                  plan.tier,
                  {
                      price: plan.price,
                      caption:
                          plan.tier === "premiumMonthly"
                              ? t`Billed monthly`
                              : t`Billed yearly`,
                  },
              ]) ?? [],
          )
        : {
              premiumMonthly: {
                  price: `€${currentPriceList.monthly.price}`,
                  caption: t`Billed monthly`,
              },
              premiumYearly: {
                  price: `€${currentPriceList.yearly.price}`,
                  caption: t`Save €${savings} a year`,
                  highlight: true,
              },
          };
    const trial = storeBuild ? !!selectedPlan?.trial : trialEligible;
    const fullPrice = intervalPlans[tier]?.price;
    const planPrice = selectedPlan?.price;
    return (
        <View style={{ gap: 22 }}>
            {offerTrial !== undefined && store ? (
                <PaymentStatus
                    compact
                    state="offerChanged"
                    store={store}
                    trial={offerTrial}
                />
            ) : null}
            <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>
                {t`Your vault stays yours. We run the supporting infrastructure and store your encrypted backups.`}
            </Text>
            <BillingIntervalSelector
                value={tier}
                onChange={setTier}
                disabled={refreshing}
                plans={intervalPlans}
                pricePlaceholder={
                    pricesUnavailable
                        ? t({
                              message: "Unavailable",
                              comment:
                                  "Shown in place of a price that could not load",
                          })
                        : t`Loading…`
                }
            />
            <View style={{ gap: 9 }}>
                <Button
                    disabled={
                        refreshing ||
                        !canUpgrade ||
                        (storeBuild && !setup && !plans && !pricesUnavailable)
                    }
                    onPress={() =>
                        storeBuild && !setup && pricesUnavailable
                            ? setReload((value) => value + 1)
                            : onContinue(tier, trial)
                    }
                >
                    {setup
                        ? t`Continue`
                        : trial
                          ? t`Start 14-day free trial`
                          : storeBuild && pricesUnavailable
                            ? t`Retry prices`
                            : storeBuild && !plans
                              ? t`Loading prices…`
                              : tier === "premiumYearly"
                                ? t`Continue with yearly`
                                : t`Continue with monthly`}
                </Button>
                {trial && fullPrice ? (
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 11,
                            lineHeight: 17,
                            textAlign: "center",
                        }}
                    >
                        {tier === "premiumMonthly"
                            ? appStore
                                ? t`Free for 14 days, then ${fullPrice} every month. You're charged when the trial ends unless you cancel at least 24 hours before then in your Apple Account settings. If you cancel by then, you keep access until the trial ends and pay nothing.`
                                : storeBuild
                                  ? t`Free for 14 days, then ${fullPrice} every month. You're charged when the trial ends unless you cancel before then in Google Play Subscriptions. If you cancel during the trial, you keep access until it ends and pay nothing.`
                                  : t`Free for 14 days, then ${fullPrice} every month. You're charged when the trial ends unless you cancel before then. If you cancel during the trial, you keep access until it ends and pay nothing.`
                            : appStore
                              ? t`Free for 14 days, then ${fullPrice} every year. You're charged when the trial ends unless you cancel at least 24 hours before then in your Apple Account settings. If you cancel by then, you keep access until the trial ends and pay nothing.`
                              : storeBuild
                                ? t`Free for 14 days, then ${fullPrice} every year. You're charged when the trial ends unless you cancel before then in Google Play Subscriptions. If you cancel during the trial, you keep access until it ends and pay nothing.`
                                : t`Free for 14 days, then ${fullPrice} every year. You're charged when the trial ends unless you cancel before then. If you cancel during the trial, you keep access until it ends and pay nothing.`}
                    </Text>
                ) : null}
                {setup || !storeBuild || selectedPlan ? (
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 11,
                            lineHeight: 17,
                            textAlign: "center",
                        }}
                    >
                        {setup
                            ? t`No email required. Save your Recovery Kit before payment.`
                            : appStore
                              ? t`Checkout opens in the App Store.`
                              : storeBuild
                                ? t`Checkout opens in Google Play.`
                                : t`VAT included. Checkout opens in your browser.`}
                    </Text>
                ) : null}
                {selectedPlan && !trial ? (
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 11,
                            lineHeight: 17,
                            textAlign: "center",
                        }}
                    >
                        {tier === "premiumMonthly"
                            ? appStore
                                ? t`${planPrice} charged every month. Automatically renews unless canceled at least 24 hours before the period ends. Cancel anytime in your Apple Account settings. Access continues until the end of the paid period.`
                                : t`${planPrice} charged every month. Automatically renews until canceled. Cancel anytime in Google Play Subscriptions. Access continues until the end of the paid period.`
                            : appStore
                              ? t`${planPrice} charged every year. Automatically renews unless canceled at least 24 hours before the period ends. Cancel anytime in your Apple Account settings. Access continues until the end of the paid period.`
                              : t`${planPrice} charged every year. Automatically renews until canceled. Cancel anytime in Google Play Subscriptions. Access continues until the end of the paid period.`}
                    </Text>
                ) : null}
                <View
                    style={{
                        flexDirection: "row",
                        justifyContent: "center",
                        gap: 16,
                    }}
                >
                    {(
                        [
                            [t`Terms of use`, "terms"],
                            [t`Privacy policy`, "privacy"],
                        ] as const
                    ).map(([label, page]) => (
                        <Text
                            key={page}
                            accessibilityRole="link"
                            onPress={() =>
                                void Linking.openURL(
                                    `https://www.cryptex-vault.com/${page}`,
                                )
                            }
                            style={{
                                color: colors.muted,
                                fontSize: 11,
                                lineHeight: 17,
                                textDecorationLine: "underline",
                            }}
                        >
                            {label}
                        </Text>
                    ))}
                </View>
                {!canUpgrade && !refreshing ? (
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 12,
                            lineHeight: 18,
                        }}
                    >
                        {t`An upgrade is available for connected free accounts.`}
                    </Text>
                ) : null}
            </View>
            <MembershipBenefits upgrading />
            <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 17 }}>
                {t`New to Online Services? Start with monthly billing before committing to a year.`}
            </Text>
        </View>
    );
}
