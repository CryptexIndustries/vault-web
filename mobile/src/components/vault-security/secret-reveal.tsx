import { useEffect, useState } from "react";
import { AppState, Pressable, View } from "react-native";

import { copySecretToClipboard } from "@/utils/clipboard";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Checkbox } from "@/components/ui/checkbox";
import {
    UnlockedCheckbox,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

type SecretRevealProps = {
    label: string;
    value: string;
    helper?: string;
    /** Require written-down ack before parent can proceed. */
    requireAck?: boolean;
    ackLabel?: string;
    acknowledged?: boolean;
    onAcknowledgedChange?: (value: boolean) => void;
    /** Show newly generated material immediately in acknowledgement flows. */
    defaultRevealed?: boolean;
    alwaysShowAcknowledgement?: boolean;
    /** Use the unlocked task layout without the legacy surrounding card. */
    flat?: boolean;
};

/**
 * Secrets stay out of the a11y tree until the user explicitly reveals them.
 */
export function SecretReveal({
    label,
    value,
    helper,
    requireAck = false,
    ackLabel = "I have written this down",
    acknowledged = false,
    onAcknowledgedChange,
    defaultRevealed = false,
    alwaysShowAcknowledgement = false,
    flat = false,
}: SecretRevealProps) {
    const [revealed, setRevealed] = useState(defaultRevealed);

    useEffect(() => {
        const subscription = AppState.addEventListener("change", (state) => {
            if (state !== "active") setRevealed(false);
        });
        return () => subscription.remove();
    }, []);

    if (flat) {
        return (
            <View style={{ gap: 12 }}>
                <View
                    style={{
                        minHeight: 32,
                        flexDirection: "row",
                        justifyContent: "flex-end",
                        gap: 6,
                    }}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                            revealed ? `Hide ${label}` : `Reveal ${label}`
                        }
                        onPress={() => setRevealed((current) => !current)}
                        style={{
                            minHeight: 32,
                            justifyContent: "center",
                            paddingHorizontal: 8,
                        }}
                    >
                        <UnlockedText style={{ fontSize: 13 }}>
                            {revealed ? "Hide" : "Reveal"}
                        </UnlockedText>
                    </Pressable>
                    {revealed ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Copy ${label}`}
                            onPress={() => void copySecretToClipboard(value)}
                            style={{
                                minHeight: 32,
                                justifyContent: "center",
                                paddingHorizontal: 8,
                            }}
                        >
                            <UnlockedText style={{ fontSize: 13 }}>
                                Copy
                            </UnlockedText>
                        </Pressable>
                    ) : null}
                </View>
                <UnlockedText
                    selectable={revealed}
                    importantForAccessibility={revealed ? "auto" : "no"}
                    accessibilityElementsHidden={!revealed}
                    accessible={revealed}
                    style={{
                        minHeight: 88,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 6,
                        backgroundColor: colors.navigation,
                        padding: 18,
                        color: revealed ? colors.foreground : colors.muted,
                        fontFamily: "monospace",
                        fontSize: 14,
                        lineHeight: 25,
                        letterSpacing: revealed ? 0 : 4,
                    }}
                >
                    {revealed ? value : "••••••••••••••••"}
                </UnlockedText>
                {helper ? (
                    <UnlockedText
                        style={{ color: colors.muted, fontSize: 12 }}
                    >
                        {helper}
                    </UnlockedText>
                ) : null}
                {requireAck &&
                (revealed || alwaysShowAcknowledgement) ? (
                    <UnlockedCheckbox
                        checked={acknowledged}
                        onCheckedChange={(next) =>
                            onAcknowledgedChange?.(next)
                        }
                        label={ackLabel}
                        labelStyle={{ fontSize: 13, lineHeight: 20 }}
                    />
                ) : null}
            </View>
        );
    }

    return (
        <View
            className={
                "gap-2 rounded-md border border-border bg-secondary/40 p-3"
            }
        >
            <View
                className={
                    "flex-row items-center justify-between gap-2"
                }
            >
                <Text className="flex-1 text-sm font-medium text-foreground">
                    {label}
                </Text>
                <View className="flex-row gap-1">
                    <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => setRevealed((v) => !v)}
                        accessibilityLabel={
                            revealed ? `Hide ${label}` : `Reveal ${label}`
                        }
                    >
                        {revealed ? "Hide" : "Reveal"}
                    </Button>
                    {revealed ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            onPress={() => void copySecretToClipboard(value)}
                            accessibilityLabel={`Copy ${label}`}
                        >
                            Copy
                        </Button>
                    ) : null}
                </View>
            </View>

            {revealed ? (
                <Text
                    selectable
                    className={
                        "rounded-md bg-background p-2 font-mono text-xs text-foreground"
                    }
                >
                    {value}
                </Text>
            ) : (
                <Text
                    importantForAccessibility="no"
                    accessibilityElementsHidden
                    accessible={false}
                    className={
                        "rounded-md bg-background p-2 font-mono text-xs text-muted-foreground"
                    }
                >
                    ••••••••••••••••
                </Text>
            )}

            {helper ? (
                <Text className="text-xs text-muted-foreground">{helper}</Text>
            ) : null}

            {requireAck && (revealed || alwaysShowAcknowledgement) ? (
                <Checkbox
                    checked={acknowledged}
                    onCheckedChange={(v) => onAcknowledgedChange?.(v)}
                    label={ackLabel}
                />
            ) : null}
        </View>
    );
}
