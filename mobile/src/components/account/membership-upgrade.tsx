import { useState } from "react";
import { Pressable, View } from "react-native";
import { Check } from "lucide-react-native";

import {
    UnlockedButton as Button,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import {
    type CheckoutTier,
    openCheckoutExternal,
} from "@/app_lib/online-services-billing";
import { colors } from "@/theme";
import { currentPriceList } from "../../../../web/src/lib/price-lists";
import { MembershipBenefits } from "./membership-benefits";

export function MembershipUpgrade({
    canUpgrade,
    refreshing,
    onMessage,
    onExternalBillingOpened,
    onContinue,
    initialTier = "premiumMonthly",
}: {
    canUpgrade: boolean;
    refreshing: boolean;
    onMessage: (message: string) => void;
    onExternalBillingOpened: () => void;
    onContinue?: (tier: CheckoutTier) => Promise<void>;
    initialTier?: CheckoutTier;
}) {
    const [checkoutTier, setCheckoutTier] = useState<CheckoutTier>(initialTier);
    const [billingBusy, setBillingBusy] = useState(false);
    const yearly = checkoutTier === "premiumYearly";
    const savings = (
        Number(currentPriceList.monthly.price) * 12 -
        Number(currentPriceList.yearly.price)
    ).toFixed(2);

    const handleCheckout = async () => {
        if (!canUpgrade || refreshing || billingBusy) return;
        setBillingBusy(true);
        try {
            if (onContinue) {
                await onContinue(checkoutTier);
                return;
            }
            const result = await openCheckoutExternal(checkoutTier);
            if (!result.ok) onMessage(result.message);
            else onExternalBillingOpened();
        } finally {
            setBillingBusy(false);
        }
    };

    return (
        <View style={{ gap: 22 }}>
            <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>
                Your vault stays yours. We run the supporting infrastructure and
                store your encrypted backups.
            </Text>
            <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Billing interval"
                style={{
                    flexDirection: "row",
                    padding: 5,
                    gap: 5,
                    backgroundColor: colors.navigation,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                }}
            >
                {(["premiumMonthly", "premiumYearly"] as const).map((tier) => {
                    const selected = checkoutTier === tier;
                    const annual = tier === "premiumYearly";
                    return (
                        <Pressable
                            key={tier}
                            accessibilityRole="radio"
                            accessibilityLabel={`${annual ? "Yearly" : "Monthly"}, €${annual ? currentPriceList.yearly.price : currentPriceList.monthly.price} per ${annual ? "year" : "month"}`}
                            accessibilityState={{
                                checked: selected,
                                disabled: billingBusy || refreshing,
                            }}
                            disabled={billingBusy || refreshing}
                            onPress={() => setCheckoutTier(tier)}
                            style={{
                                flex: 1,
                                minHeight: 110,
                                padding: 13,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: selected
                                    ? colors.primary
                                    : "transparent",
                                backgroundColor: selected
                                    ? colors.secondary
                                    : "transparent",
                                gap: 8,
                            }}
                        >
                            <View
                                style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: 13,
                                        fontWeight: "600",
                                        color: selected
                                            ? colors.foreground
                                            : colors.muted,
                                    }}
                                >
                                    {annual ? "Yearly" : "Monthly"}
                                </Text>
                                <View
                                    style={{
                                        width: 18,
                                        height: 18,
                                        borderRadius: 9,
                                        borderWidth: 1,
                                        borderColor: selected
                                            ? colors.primary
                                            : colors.border,
                                        backgroundColor: selected
                                            ? colors.primary
                                            : "transparent",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    {selected ? (
                                        <Check
                                            size={12}
                                            color={colors.navigation}
                                        />
                                    ) : null}
                                </View>
                            </View>
                            <Text
                                style={{
                                    fontSize: 22,
                                    fontWeight: "500",
                                    letterSpacing: -0.5,
                                }}
                            >
                                €
                                {annual
                                    ? currentPriceList.yearly.price
                                    : currentPriceList.monthly.price}
                                <Text
                                    style={{
                                        fontSize: 11,
                                        color: colors.muted,
                                    }}
                                >
                                    {annual ? " / year" : " / month"}
                                </Text>
                            </Text>
                            <Text
                                style={{
                                    fontSize: 11,
                                    color: annual
                                        ? colors.primary
                                        : colors.muted,
                                }}
                            >
                                {annual
                                    ? `Save €${savings} a year`
                                    : "Billed monthly"}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
            <View style={{ gap: 9 }}>
                <Button
                    disabled={!canUpgrade || refreshing}
                    loading={billingBusy}
                    onPress={() => void handleCheckout()}
                >
                    {onContinue
                        ? "Continue"
                        : yearly
                          ? "Continue with yearly"
                          : "Continue with monthly"}
                </Button>
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
                        : "VAT included. Checkout opens in your browser."}
                </Text>
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
            <MembershipBenefits upgrading />
            <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 17 }}>
                New to Online Services? Start with monthly billing before
                committing to a year.
            </Text>
        </View>
    );
}
