import { useMemo } from "react";
import { View } from "react-native";

import {
    isWeakPasswordScore,
    PASSWORD_STRENGTH_LABELS,
    scorePassword,
} from "@cryptex-industries/vault-core/vault-utils/password-strength";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { colors } from "@/theme";

const SCORE_COLORS = [
    colors.destructive,
    "#f97316",
    "#f59e0b",
    colors.success,
    "#16a34a",
] as const;

type PasswordStrengthMeterProps = {
    password: string;
    showSuggestions?: boolean;
    className?: string;
    compact?: boolean;
};

export function PasswordStrengthMeter({
    password,
    showSuggestions = true,
    className,
    compact = false,
}: PasswordStrengthMeterProps) {
    const result = useMemo(() => scorePassword(password), [password]);

    if (compact) {
        return (
            <View
                className={cn(
                    "mt-2 h-[3px] overflow-hidden bg-border",
                    className,
                )}
                accessibilityLiveRegion="polite"
                accessibilityLabel={
                    result
                        ? `Password strength: ${PASSWORD_STRENGTH_LABELS[result.score]}`
                        : "Password strength"
                }
            >
                <View
                    className="h-full bg-primary"
                    style={{
                        width: result
                            ? `${((result.score + 1) / 5) * 100}%`
                            : "0%",
                    }}
                />
            </View>
        );
    }

    if (!result) return null;

    const { score, feedback } = result;
    const weak = isWeakPasswordScore(score);
    const label =
        PASSWORD_STRENGTH_LABELS[score] ?? PASSWORD_STRENGTH_LABELS[0];
    const warning = feedback.warning?.trim();
    const suggestions = feedback.suggestions
        .map((item) => item.trim())
        .filter(Boolean);

    return (
        <View
            className={cn("mt-2 gap-1.5", className)}
            accessibilityLiveRegion="polite"
            accessibilityLabel={`Password strength: ${label}`}
        >
            <View className="flex-row items-center gap-2">
                <View className="h-1.5 flex-1 flex-row gap-1">
                    {SCORE_COLORS.map((color, index) => (
                        <View
                            key={index}
                            className="flex-1 rounded-full"
                            style={{
                                backgroundColor:
                                    index <= score ? color : colors.border,
                            }}
                        />
                    ))}
                </View>
                <Text
                    className={cn(
                        "shrink-0 text-xs font-medium",
                        weak ? "text-destructive" : "text-muted-foreground",
                    )}
                >
                    {label}
                </Text>
            </View>
            {weak ? (
                <Text className="text-xs leading-4 text-destructive">
                    This password may be easy to guess offline if someone
                    obtains your vault backup or sync data.
                </Text>
            ) : null}
            {warning && showSuggestions ? (
                <Text className="text-xs text-muted-foreground">{warning}</Text>
            ) : null}
            {showSuggestions && suggestions.length > 0
                ? suggestions.map((suggestion) => (
                      <Text
                          key={suggestion}
                          className="text-xs text-muted-foreground"
                      >
                          {suggestion}
                      </Text>
                  ))
                : null}
        </View>
    );
}
