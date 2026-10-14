import * as React from "react";
import { Pressable, View, type ViewProps } from "react-native";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { layout } from "@/theme";

type Segment<T extends string> = {
    value: T;
    label: string;
    disabled?: boolean;
    accessibilityLabel?: string;
};

type SegmentedControlProps<T extends string> = ViewProps & {
    segments: Segment<T>[];
    value: T;
    onChange: (value: T) => void;
    appearance?: "filled" | "underline";
    className?: string;
};

function SegmentedControl<T extends string>({
    segments,
    value,
    onChange,
    appearance = "filled",
    className,
    ...props
}: SegmentedControlProps<T>) {
    return (
        <View
            accessibilityRole="tablist"
            className={cn(
                "flex-row",
                appearance === "filled" &&
                    "rounded-lg border border-border bg-secondary/80 p-1",
                appearance === "underline" && "border-b border-border",
                className,
            )}
            {...props}
        >
            {segments.map((segment) => {
                const selected = segment.value === value;
                return (
                    <Pressable
                        key={segment.value}
                        accessibilityRole="tab"
                        accessibilityState={{
                            selected,
                            disabled: !!segment.disabled,
                        }}
                        accessibilityLabel={
                            segment.accessibilityLabel ?? segment.label
                        }
                        disabled={segment.disabled}
                        onPress={() => onChange(segment.value)}
                        className={cn(
                            "min-h-[44px] flex-1 items-center justify-center px-2",
                            appearance !== "underline" && "rounded-md",
                            selected &&
                                appearance === "filled" &&
                                "bg-primary",
                            selected &&
                                appearance === "underline" &&
                                "border-b-2 border-primary",
                            segment.disabled && "opacity-40",
                        )}
                        style={{ minHeight: layout.minTouchTarget }}
                    >
                        <Text
                            className={cn(
                                "text-sm font-medium",
                                selected
                                    ? appearance === "underline"
                                        ? "text-foreground"
                                        : "text-primary-foreground"
                                    : "text-muted-foreground",
                            )}
                            numberOfLines={1}
                        >
                            {segment.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

export { SegmentedControl };
export type { Segment, SegmentedControlProps };
