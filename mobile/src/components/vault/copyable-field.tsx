import { useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { Copy, Eye, EyeOff, ExternalLink } from "lucide-react-native";
import { useLingui } from "@lingui/react/macro";

import { IconButton } from "@/components/icon-button";
import {
    UnlockedButton as Button,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { copySecretToClipboard, copyTextToClipboard } from "@/utils/clipboard";
import { colors } from "@/theme";
import { cn } from "@/lib/utils";

type CopyableFieldProps = {
    label: string;
    value: string;
    secret?: boolean;
    onOpenUrl?: () => void;
    className?: string;
    /** Public values such as an SSH public key skip the clipboard clearing. */
    publicValue?: boolean;
    monospace?: boolean;
    numberOfLines?: number;
    /** Extra icon buttons shown before Copy. */
    actions?: ReactNode;
    /** Runs when copying fails, for example to show a snackbar. */
    onCopyFailed?: () => void;
    /** A value that is still loading or failed to load keeps its row. */
    status?: "loading" | { error: string; onRetry: () => void };
};

/**
 * Credential field row. Secrets stay hidden from a11y until revealed.
 */
export function CopyableField({
    label,
    value,
    secret = false,
    onOpenUrl,
    className,
    publicValue = false,
    monospace = false,
    numberOfLines,
    actions,
    onCopyFailed,
    status,
}: CopyableFieldProps) {
    const { t } = useLingui();
    const [revealed, setRevealed] = useState(false);
    const [copied, setCopied] = useState(false);

    if (status) {
        return (
            <View
                className={cn(
                    "mb-3 min-h-[81px] flex-row items-center overflow-hidden rounded-lg border border-border bg-secondary px-4 py-3",
                    className,
                )}
            >
                <View className="min-w-0 flex-1">
                    <Text className="mb-2 text-xs text-muted-foreground">
                        {label}
                    </Text>
                    {status === "loading" ? (
                        <View
                            className="flex-row items-center gap-2"
                            accessibilityLabel={t`${label}. Loading.`}
                        >
                            <ActivityIndicator
                                size="small"
                                color={colors.muted}
                            />
                            <Text className="text-sm text-muted-foreground">
                                {t`Loading…`}
                            </Text>
                        </View>
                    ) : (
                        <Text
                            accessibilityRole="alert"
                            className="text-sm leading-5 text-destructive"
                        >
                            {status.error}
                        </Text>
                    )}
                </View>
                <View className="flex-row items-center gap-0.5">
                    {actions}
                    {status === "loading" ? null : (
                        <Button
                            size="sm"
                            variant="secondary"
                            onPress={status.onRetry}
                            accessibilityLabel={t({
                                message: `Try loading ${label} again`,
                                comment:
                                    "Field name such as Password or Username",
                            })}
                        >
                            {t`Try again`}
                        </Button>
                    )}
                </View>
            </View>
        );
    }

    if (!value) return null;

    const display = secret && !revealed ? "••••••••••••" : value;
    const hiddenFromA11y = secret && !revealed;

    const handleCopy = async () => {
        const ok = publicValue
            ? await copyTextToClipboard(value)
            : await copySecretToClipboard(value);
        if (!ok) {
            onCopyFailed?.();
            return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <View
            className={cn(
                "mb-3 min-h-[81px] flex-row items-center overflow-hidden rounded-lg border border-border bg-secondary px-4 py-3",
                className,
            )}
        >
            <View className="min-w-0 flex-1">
                <Text className="mb-2 text-xs text-muted-foreground">
                    {label}
                </Text>
                <Text
                    className={cn(
                        "text-sm leading-5 text-foreground",
                        (secret || monospace) && "font-mono",
                        monospace && "text-xs",
                        secret && !revealed && "tracking-[0.2em]",
                    )}
                    selectable={revealed || !secret}
                    numberOfLines={hiddenFromA11y ? 1 : numberOfLines}
                    accessibilityLabel={
                        hiddenFromA11y
                            ? t`${label}. Hidden. Reveal to hear value.`
                            : undefined
                    }
                    importantForAccessibility={
                        hiddenFromA11y ? "no-hide-descendants" : "auto"
                    }
                >
                    {display}
                </Text>
            </View>
            <View className="flex-row items-center gap-0.5">
                {secret ? (
                    <IconButton
                        icon={revealed ? EyeOff : Eye}
                        label={
                            revealed
                                ? t({
                                      message: `Hide ${label}`,
                                      comment:
                                          "Field name such as Password or Username",
                                  })
                                : t({
                                      message: `Reveal ${label}`,
                                      comment:
                                          "Field name such as Password or Username",
                                  })
                        }
                        onPress={() => setRevealed((v) => !v)}
                    />
                ) : null}
                {actions}
                {onOpenUrl ? (
                    <IconButton
                        icon={ExternalLink}
                        label={t({
                            message: `Open ${label}`,
                            comment: "Field name such as Password or Username",
                        })}
                        onPress={onOpenUrl}
                    />
                ) : null}
                <IconButton
                    icon={Copy}
                    label={t({
                        message: `Copy ${label}`,
                        comment: "Field name such as Password or Username",
                    })}
                    color={copied ? colors.primary : colors.muted}
                    onPress={() => void handleCopy()}
                />
            </View>
        </View>
    );
}
