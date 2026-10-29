import * as React from "react";
import { Pressable, View, type ViewProps } from "react-native";
import { ChevronDown, ChevronRight, Minus, Plus } from "lucide-react-native";
import { useLingui } from "@lingui/react/macro";

import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

type AdvancedDisclosureProps = ViewProps & {
    title?: string;
    description?: string;
    defaultOpen?: boolean;
    className?: string;
    ruled?: boolean;
};

function AdvancedDisclosure({
    title: titleProp,
    description,
    defaultOpen = false,
    className,
    ruled = false,
    children,
    ...props
}: AdvancedDisclosureProps) {
    const { t } = useLingui();
    const title =
        titleProp ??
        t({
            message: "Advanced",
            comment: "Expandable section of extra options",
        });
    const [open, setOpen] = React.useState(defaultOpen);
    return (
        <View className={cn("gap-2", className)} {...props}>
            <Pressable
                onPress={() => setOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={
                    open ? t`${title}. Collapse` : t`${title}. Expand`
                }
                className={cn(
                    "min-h-[44px] flex-row items-center justify-between border border-border",
                    ruled
                        ? "min-h-[54px] rounded-none border-x-0 bg-transparent px-0"
                        : "rounded-md bg-secondary/50 px-3",
                )}
            >
                <View className="flex-1 pr-2">
                    <Text className="font-medium text-sm text-foreground">
                        {title}
                    </Text>
                    {description ? (
                        <Text className="text-xs text-muted-foreground">
                            {description}
                        </Text>
                    ) : null}
                </View>
                <Icon
                    as={
                        ruled
                            ? open
                                ? Minus
                                : Plus
                            : open
                              ? ChevronDown
                              : ChevronRight
                    }
                    size={ruled ? 20 : 18}
                    className="text-muted-foreground"
                    accessibilityElementsHidden
                />
            </Pressable>
            {open ? <View className="gap-3 px-0.5">{children}</View> : null}
        </View>
    );
}

export { AdvancedDisclosure };
