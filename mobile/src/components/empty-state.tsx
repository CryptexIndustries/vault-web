import * as React from "react";
import { View, type ViewProps } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { colors } from "@/theme";

type EmptyStateProps = ViewProps & {
    icon?: LucideIcon;
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
    className?: string;
};

function EmptyState({
    icon: IconComponent,
    title,
    description,
    actionLabel,
    onAction,
    className,
    ...props
}: EmptyStateProps) {
    return (
        <View
            accessibilityRole="summary"
            className={cn(
                "items-center justify-center rounded-xl bg-primary/10 px-6 py-10",
                className,
            )}
            {...props}
        >
            {IconComponent ? (
                <View className="mb-3 rounded-full bg-secondary p-3">
                    <Icon
                        as={IconComponent}
                        size={28}
                        color={colors.muted}
                        accessibilityElementsHidden
                    />
                </View>
            ) : null}
            <Text className="text-center text-base font-semibold text-foreground">
                {title}
            </Text>
            {description ? (
                <Text className="mt-1.5 text-center text-sm leading-5 text-muted-foreground">
                    {description}
                </Text>
            ) : null}
            {actionLabel && onAction ? (
                <Button className="mt-5 min-h-[44px]" onPress={onAction}>
                    {actionLabel}
                </Button>
            ) : null}
        </View>
    );
}

export { EmptyState };
export type { EmptyStateProps };
