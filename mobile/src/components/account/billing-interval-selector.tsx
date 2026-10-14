import { Pressable, View, useWindowDimensions } from "react-native";
import { Check } from "lucide-react-native";
import { UnlockedText as Text } from "@/components/unlocked/unlocked-ui";
import type { CheckoutTier } from "@/app_lib/online-services-billing";
import { colors } from "@/theme";

export function BillingIntervalSelector({
    value,
    onChange,
    disabled,
    plans,
    pricePlaceholder = "Loading…",
}: {
    value: CheckoutTier;
    onChange: (tier: CheckoutTier) => void;
    disabled: boolean;
    plans: Partial<Record<CheckoutTier, { price: string; caption?: string }>>;
    pricePlaceholder?: string;
}) {
    const { fontScale, width } = useWindowDimensions();
    const stacked = width < 360 || fontScale > 1.3;
    return (
        <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Billing interval"
            style={{
                flexDirection: "row",
                flexWrap: "wrap",
                padding: 5,
                gap: 5,
                backgroundColor: colors.navigation,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.border,
            }}
        >
            {(["premiumMonthly", "premiumYearly"] as const).map((tier) => {
                const selected = value === tier;
                const annual = tier === "premiumYearly";
                const price = plans[tier]?.price;
                const caption = plans[tier]?.caption;
                const period = annual ? "year" : "month";
                const label = `${annual ? "Yearly" : "Monthly"}, ${price ? `${price} per ${period}` : pricePlaceholder}`;
                return (
                    <Pressable
                        key={tier}
                        accessibilityRole="radio"
                        accessibilityLabel={label}
                        accessibilityState={{
                            checked: selected,
                            disabled: disabled,
                        }}
                        disabled={disabled}
                        onPress={() => onChange(tier)}
                        style={{
                            flex: 1,
                            flexBasis: stacked ? "100%" : undefined,
                            minWidth: 0,
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
                                    flexShrink: 1,
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
                                    flexShrink: 0,
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
                            {price ?? pricePlaceholder}
                            {price ? (
                                <Text
                                    style={{
                                        fontSize: 11,
                                        color: colors.muted,
                                    }}
                                >
                                    {` / ${period}`}
                                </Text>
                            ) : null}
                        </Text>
                        {caption ? (
                            <Text
                                style={{
                                    fontSize: 11,
                                    color: annual
                                        ? colors.primary
                                        : colors.muted,
                                }}
                            >
                                {caption}
                            </Text>
                        ) : null}
                    </Pressable>
                );
            })}
        </View>
    );
}
