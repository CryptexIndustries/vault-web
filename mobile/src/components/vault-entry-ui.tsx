import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, ShieldCheck } from "lucide-react-native";
import {
    Pressable,
    View,
    type PressableProps,
    type ViewProps,
} from "react-native";

import { BrandIcon } from "@/components/brand";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { colors } from "@/theme";

type VaultEntryHeaderProps = ViewProps & {
    title: string;
    subtitle: string;
    showBack?: boolean;
    onBack?: () => void;
};

/** Brand and title header for locked-vault screens. */
export function VaultEntryHeader({
    title,
    subtitle,
    showBack = false,
    onBack,
    className,
    ...props
}: VaultEntryHeaderProps) {
    return (
        <View className={cn("mb-[37px]", className)} {...props}>
            <View className="-mx-5 mb-6 h-16 flex-row items-center gap-2.5 border-b border-border px-5">
                {showBack ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Back to unlock"
                        className="-ml-3 h-12 w-12 items-center justify-center rounded-full"
                        onPress={onBack}
                    >
                        <Icon
                            as={ArrowLeft}
                            size={22}
                            color={colors.foreground}
                        />
                    </Pressable>
                ) : null}
                <BrandIcon size={31} />
                <View className="flex-1 flex-row items-baseline gap-1.5">
                    <Text className="font-semibold text-[13px] tracking-[1.7px] text-foreground">
                        CRYPTEX
                    </Text>
                    <Text className="font-semibold text-[13px] tracking-[1.7px] text-primary">
                        VAULT
                    </Text>
                </View>
            </View>
            <View className="border-b border-border pb-6">
                <Text
                    accessibilityRole="header"
                    className="font-semibold text-[35px] leading-[40px] tracking-[-1.3px] text-foreground"
                >
                    {title}
                </Text>
                <Text className="mt-2 text-sm leading-5 text-muted-foreground">
                    {subtitle}
                </Text>
            </View>
        </View>
    );
}

export function VaultEntrySteps({
    labels,
    current,
}: {
    labels: string[];
    current: number;
}) {
    return (
        <View className="mb-[30px]" accessibilityRole="progressbar">
            <View className="mb-3 flex-row justify-between">
                <Text className="font-mono text-[10px] uppercase tracking-[1.3px] text-muted-foreground">
                    {labels[Math.min(current, labels.length - 1)]}
                </Text>
                <Text className="font-mono text-[10px] uppercase tracking-[1.3px] text-muted-foreground">
                    {String(Math.min(current + 1, labels.length)).padStart(
                        2,
                        "0",
                    )}{" "}
                    / {String(labels.length).padStart(2, "0")}
                </Text>
            </View>
            <View className="flex-row gap-1.5">
                {labels.map((label, index) => (
                    <View
                        key={label}
                        className={cn(
                            "h-0.5 flex-1 bg-border",
                            index <= current && "bg-primary",
                        )}
                    />
                ))}
            </View>
        </View>
    );
}

type VaultEntryActionProps = Omit<ButtonProps, "children"> & {
    leading?: LucideIcon;
    showArrow?: boolean;
    children: ReactNode;
};

export function VaultEntryAction({
    leading,
    showArrow = true,
    children,
    className,
    variant = "default",
    ...props
}: VaultEntryActionProps) {
    return (
        <Button
            variant={variant}
            className={cn(
                "h-[54px] min-h-[54px] rounded-md px-[18px]",
                className,
            )}
            {...props}
        >
            <View className="w-full flex-row items-center">
                {leading ? (
                    <Icon
                        as={leading}
                        size={19}
                        color={
                            variant === "default"
                                ? colors.navigation
                                : colors.foreground
                        }
                    />
                ) : null}
                <Text
                    className={cn(
                        "flex-1 text-sm font-semibold",
                        (leading || !showArrow) && "text-center",
                        variant === "default"
                            ? "text-primary-foreground"
                            : "text-foreground",
                    )}
                >
                    {children}
                </Text>
                {showArrow ? (
                    <Icon
                        as={ArrowUpRight}
                        size={20}
                        color={
                            variant === "default"
                                ? colors.navigation
                                : colors.foreground
                        }
                    />
                ) : leading ? (
                    <View className="h-[19px] w-[19px]" />
                ) : null}
            </View>
        </Button>
    );
}

export function VaultEntryNotice({
    children,
    className,
}: ViewProps & { children: ReactNode }) {
    return (
        <View
            className={cn(
                "border-l-2 border-muted-foreground py-0.5 pl-[13px]",
                className,
            )}
        >
            <Text className="text-xs leading-[18px] text-muted-foreground">
                {children}
            </Text>
        </View>
    );
}

export function VaultEntryAssurance({
    children,
    className,
}: ViewProps & { children: ReactNode }) {
    return (
        <View
            className={cn(
                "mt-6 flex-row items-center justify-center gap-2",
                className,
            )}
        >
            <Icon
                as={ShieldCheck}
                size={15}
                className="text-muted-foreground"
            />
            <Text className="text-[11px] text-muted-foreground">
                {children}
            </Text>
        </View>
    );
}

export function VaultEntryTextButton({
    children,
    className,
    ...props
}: Omit<PressableProps, "children"> & { children: ReactNode }) {
    return (
        <Pressable
            accessibilityRole="button"
            className={cn(
                "min-h-[44px] items-center justify-center",
                className,
            )}
            {...props}
        >
            <Text className="font-medium text-[13px] text-primary">
                {children}
            </Text>
        </Pressable>
    );
}

export function VaultEntryFieldError({ message }: { message?: string }) {
    if (!message) return null;
    return (
        <Text
            accessibilityRole="alert"
            className="mt-1.5 text-xs leading-4 text-primary"
        >
            {message}
        </Text>
    );
}
