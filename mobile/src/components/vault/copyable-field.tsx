import { useState } from "react";
import { View } from "react-native";
import { Copy, Eye, EyeOff, ExternalLink } from "lucide-react-native";

import { IconButton } from "@/components/icon-button";
import { UnlockedText as Text } from "@/components/unlocked/unlocked-ui";
import { copySecretToClipboard } from "@/utils/clipboard";
import { colors } from "@/theme";
import { cn } from "@/lib/utils";

type CopyableFieldProps = {
    label: string;
    value: string;
    secret?: boolean;
    onOpenUrl?: () => void;
    className?: string;
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
}: CopyableFieldProps) {
    const [revealed, setRevealed] = useState(false);
    const [copied, setCopied] = useState(false);

    if (!value) return null;

    const display = secret && !revealed ? "••••••••••••" : value;
    const hiddenFromA11y = secret && !revealed;

    const handleCopy = async () => {
        const ok = await copySecretToClipboard(value);
        if (!ok) return;
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
                        secret && "font-mono",
                        secret && !revealed && "tracking-[0.2em]",
                    )}
                    selectable={revealed || !secret}
                    accessibilityLabel={
                        hiddenFromA11y
                            ? `${label}. Hidden. Reveal to hear value.`
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
                        label={revealed ? `Hide ${label}` : `Reveal ${label}`}
                        onPress={() => setRevealed((v) => !v)}
                    />
                ) : null}
                {onOpenUrl ? (
                    <IconButton
                        icon={ExternalLink}
                        label={`Open ${label}`}
                        onPress={onOpenUrl}
                    />
                ) : null}
                <IconButton
                    icon={Copy}
                    label={`Copy ${label}`}
                    color={copied ? colors.primary : colors.muted}
                    onPress={() => void handleCopy()}
                />
            </View>
        </View>
    );
}
