import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import {
    ActivityIndicator,
    Pressable,
    type PressableProps,
} from "react-native";

import { cn } from "@/lib/utils";
import { colors, layout } from "@/theme";

import { Text, TextClassContext } from "./text";

const buttonVariants = cva(
    "flex-row items-center justify-center gap-2 rounded-md",
    {
        variants: {
            variant: {
                default: "bg-primary active:bg-primary/90",
                secondary: "bg-secondary active:bg-secondary/80",
                outline: "border border-input bg-background active:bg-accent/20",
                ghost: "active:bg-accent/20",
                destructive:
                    "border border-[#895466] bg-[#30212c] active:bg-[#492b38]",
            },
            size: {
                default: "min-h-[44px] h-11 px-4 py-2",
                sm: "min-h-[36px] h-9 rounded-md px-3",
                lg: "min-h-[48px] h-12 rounded-md px-6",
                icon: "h-11 w-11 min-h-[44px] min-w-[44px] p-0",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
);

const buttonTextVariants = cva("font-sans text-sm font-medium", {
    variants: {
        variant: {
            default: "text-primary-foreground",
            secondary: "text-secondary-foreground",
            outline: "text-foreground",
            ghost: "text-foreground",
            destructive: "text-[#ff9ba8]",
        },
        size: {
            default: "",
            sm: "text-xs",
            lg: "text-base",
            icon: "",
        },
    },
    defaultVariants: {
        variant: "default",
        size: "default",
    },
});

type ButtonProps = PressableProps &
    VariantProps<typeof buttonVariants> & {
        loading?: boolean;
        textClassName?: string;
    };

function Button({
    className,
    variant,
    size,
    loading = false,
    disabled,
    children,
    textClassName,
    ...props
}: ButtonProps) {
    const isDisabled = disabled || loading;
    const textClasses = cn(buttonTextVariants({ variant, size }), textClassName);

    const content =
        typeof children === "string" || typeof children === "number" ? (
            <Text className={textClasses}>{children}</Text>
        ) : (
            children
        );

    return (
        <TextClassContext.Provider value={textClasses}>
            <Pressable
                className={cn(
                    buttonVariants({ variant, size }),
                    isDisabled && "opacity-50",
                    className,
                )}
                style={{ minHeight: size === "sm" ? 36 : layout.minTouchTarget }}
                accessibilityRole="button"
                disabled={isDisabled}
                {...props}
            >
                {loading ? (
                    <ActivityIndicator size="small" color={colors.foreground} />
                ) : (
                    content
                )}
            </Pressable>
        </TextClassContext.Provider>
    );
}

export { Button, buttonTextVariants, buttonVariants };
export type { ButtonProps };
