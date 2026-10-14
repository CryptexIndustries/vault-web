import { View } from "react-native";
import { Check } from "lucide-react-native";

import {
    UnlockedButton,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

export type LinkResultRow = {
    label: string;
    value: string;
};

/** Finished linking: one confirmation, the facts that matter, one way out. */
export function LinkResult({
    title,
    description,
    rows,
    actionLabel,
    onAction,
}: {
    title: string;
    description: string;
    rows: LinkResultRow[];
    actionLabel: string;
    onAction: () => void;
}) {
    return (
        <View className="gap-6">
            <View
                accessible
                accessibilityLiveRegion="polite"
                className="items-center gap-3 pt-4"
            >
                <View
                    style={{
                        width: 56,
                        height: 56,
                        borderRadius: 28,
                        borderWidth: 1.5,
                        borderColor: colors.success,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Check size={26} color={colors.success} strokeWidth={2} />
                </View>
                <UnlockedText
                    style={{
                        fontSize: 22,
                        fontWeight: "500",
                        letterSpacing: -0.5,
                        textAlign: "center",
                    }}
                >
                    {title}
                </UnlockedText>
                <UnlockedText className="text-center text-[13px] leading-5 text-muted-foreground">
                    {description}
                </UnlockedText>
            </View>
            {rows.length ? (
                <View className="border-t border-border">
                    {rows.map((row) => (
                        <View
                            key={row.label}
                            className="min-h-[52px] flex-row items-center justify-between gap-5 border-b border-border"
                        >
                            <UnlockedText className="text-[13px] text-muted-foreground">
                                {row.label}
                            </UnlockedText>
                            <UnlockedText className="max-w-[60%] text-right text-[13px] text-foreground">
                                {row.value}
                            </UnlockedText>
                        </View>
                    ))}
                </View>
            ) : null}
            <UnlockedButton onPress={onAction}>{actionLabel}</UnlockedButton>
        </View>
    );
}
