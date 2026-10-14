import * as React from "react";
import { Pressable, type PressableProps } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { buttonVariants, buttonTextVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { colors, layout } from "@/theme";

type IconButtonProps = Omit<PressableProps, "children"> & {
    icon: LucideIcon;
    label: string;
    size?: number;
    color?: string;
    className?: string;
    variant?: "ghost" | "outline" | "secondary" | "destructive";
};

function IconButton({
    icon,
    label,
    size = 20,
    color = colors.foreground,
    className,
    variant = "ghost",
    disabled,
    ...props
}: IconButtonProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={disabled}
            className={cn(
                "items-center justify-center rounded-md",
                variant === "outline" && "border border-border bg-background",
                variant === "secondary" && "bg-secondary",
                variant === "ghost" && "active:bg-accent/20",
                variant === "destructive" && buttonVariants({ variant: "destructive", size: "icon" }),
                disabled && "opacity-50",
                className,
            )}
            style={{
                minWidth: layout.minTouchTarget,
                minHeight: layout.minTouchTarget,
            }}
            {...props}
        >
            <Icon
                as={icon}
                size={size}
                color={variant === "destructive" ? undefined : color}
                className={variant === "destructive" ? buttonTextVariants({ variant: "destructive" }) : undefined}
                accessibilityElementsHidden
            />
        </Pressable>
    );
}

export { IconButton };
export type { IconButtonProps };
