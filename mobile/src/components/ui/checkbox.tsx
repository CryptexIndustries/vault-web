import * as React from "react";
import { Pressable, View, type StyleProp, type TextStyle } from "react-native";
import { Check } from "lucide-react-native";

import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { colors, layout } from "@/theme";

type CheckboxProps = {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    label: string;
    disabled?: boolean;
    className?: string;
    labelStyle?: StyleProp<TextStyle>;
};

function Checkbox({
    checked,
    onCheckedChange,
    label,
    disabled = false,
    className,
    labelStyle,
}: CheckboxProps) {
    return (
        <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked, disabled }}
            accessibilityLabel={label}
            disabled={disabled}
            onPress={() => onCheckedChange(!checked)}
            className={cn(
                "min-h-[44px] flex-row items-start gap-3",
                disabled && "opacity-50",
                className,
            )}
            style={{ minHeight: layout.minTouchTarget }}
        >
            <View
                className={cn(
                    "mt-0.5 h-5 w-5 items-center justify-center rounded border",
                    checked
                        ? "border-primary bg-primary"
                        : "border-border bg-secondary/60",
                )}
            >
                {checked ? (
                    <Icon
                        as={Check}
                        size={14}
                        color={colors.foreground}
                        accessibilityElementsHidden
                    />
                ) : null}
            </View>
            <Text style={labelStyle} className="flex-1 text-sm leading-5 text-foreground">
                {label}
            </Text>
        </Pressable>
    );
}

export { Checkbox };
export type { CheckboxProps };
