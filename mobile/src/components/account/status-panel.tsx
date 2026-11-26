import { useEffect, useRef } from "react";
import {
    AccessibilityInfo,
    ActivityIndicator,
    Animated,
    Easing,
    Platform,
    View,
} from "react-native";
import { Check, Clock, type LucideIcon } from "lucide-react-native";

import {
    UnlockedButton as Button,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { colors } from "@/theme";

/** Only a failure is red. */
type Tone = "progress" | "success" | "waiting" | "error" | "neutral";
type StepState = "done" | "active" | "waiting" | "idle";
/** A step when it has a state, otherwise a plain detail row. */
type StatusLine = { label: string; value: string; state?: StepState };
export type StatusContent = {
    tone: Tone;
    icon: LucideIcon;
    title: string;
    body: string;
    /** Shorter body for the compact card. */
    note?: string;
    lines?: StatusLine[];
    primary?: string;
    secondary?: string;
    /** The compact card's one action, such as Check now. */
    action?: string;
};

const tints: Record<Tone, string> = {
    progress: colors.foreground,
    success: colors.success,
    waiting: colors.foreground,
    error: colors.destructive,
    neutral: colors.muted,
};

const valueColors: Record<StepState, string> = {
    done: colors.success,
    active: colors.foreground,
    waiting: colors.foreground,
    idle: colors.muted,
};

/** A full status panel, or a compact card. */
export function StatusPanel({
    content,
    compact = false,
    busy = false,
    busyLabel,
    onPrimary,
    onSecondary,
}: {
    content: StatusContent;
    compact?: boolean;
    /** The primary action, or the compact action, is running. */
    busy?: boolean;
    busyLabel?: string;
    onPrimary?: () => void;
    onSecondary?: () => void;
}) {
    useEffect(() => {
        // Android announces the live region; iOS needs an explicit announcement.
        if (Platform.OS === "ios")
            AccessibilityInfo.announceForAccessibility(content.title);
    }, [content.title]);

    if (compact) {
        return (
            <View className="flex-row items-center gap-3 rounded-[10px] border border-border bg-[#111520] p-3">
                <Emblem
                    key={content.title}
                    tone={content.tone}
                    icon={content.icon}
                    size={40}
                />
                <View
                    accessible
                    accessibilityLiveRegion="polite"
                    className="flex-1 gap-0.5"
                >
                    <Text className="font-medium text-sm">{content.title}</Text>
                    <Text className="text-xs leading-[18px] text-muted-foreground">
                        {content.note ?? content.body}
                    </Text>
                </View>
                {content.action ? (
                    <Button
                        size="sm"
                        variant="outline"
                        className="px-3"
                        loading={busy}
                        disabled={busy}
                        onPress={onPrimary}
                    >
                        {content.action}
                    </Button>
                ) : null}
            </View>
        );
    }

    return (
        <View className="gap-6 pt-4">
            <View
                accessible
                accessibilityLiveRegion="polite"
                className="items-center gap-3"
            >
                <Emblem
                    key={content.title}
                    tone={content.tone}
                    icon={content.icon}
                    size={64}
                    halo
                />
                <Text
                    className="mt-2 text-center"
                    style={{
                        fontSize: 22,
                        fontWeight: "500",
                        letterSpacing: -0.5,
                    }}
                >
                    {content.title}
                </Text>
                <Text className="text-center text-sm leading-[21px] text-muted-foreground">
                    {content.body}
                </Text>
            </View>
            {content.lines ? (
                <View className="rounded-[10px] border border-border bg-[#111520] px-4">
                    {content.lines.map((line, index) => (
                        <View
                            key={line.label}
                            className={cn(
                                "min-h-[52px] flex-row items-center gap-3",
                                index > 0 && "border-t border-border",
                            )}
                        >
                            {line.state ? (
                                <StepMark state={line.state} />
                            ) : null}
                            <Text
                                className={cn(
                                    "flex-1 text-[13px]",
                                    !line.state && "text-muted-foreground",
                                )}
                            >
                                {line.label}
                            </Text>
                            <Text
                                className="max-w-[60%] text-right text-[13px]"
                                style={{
                                    color: line.state
                                        ? valueColors[line.state]
                                        : colors.foreground,
                                }}
                            >
                                {line.value}
                            </Text>
                        </View>
                    ))}
                </View>
            ) : null}
            {content.primary || content.secondary ? (
                <View className="gap-[9px]">
                    {content.primary ? (
                        <Button
                            loading={busy}
                            loadingLabel={busyLabel}
                            onPress={onPrimary}
                        >
                            {content.primary}
                        </Button>
                    ) : null}
                    {content.secondary ? (
                        <Button variant="outline" onPress={onSecondary}>
                            {content.secondary}
                        </Button>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

/** The state icon in a tinted disc; progress adds a turning arc, others ease in. */
function Emblem({
    tone,
    icon: Icon,
    size,
    halo = false,
}: {
    tone: Tone;
    icon: LucideIcon;
    size: number;
    halo?: boolean;
}) {
    const reducedMotion = useReducedMotion();
    const tint = tints[tone];
    const spinning = tone === "progress" && !reducedMotion;
    const turn = useRef(new Animated.Value(0)).current;
    const enter = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;

    useEffect(() => {
        if (reducedMotion) return;
        const animation = Animated.parallel([
            Animated.timing(enter, {
                toValue: 1,
                duration: 280,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            ...(spinning
                ? [
                      Animated.loop(
                          Animated.timing(turn, {
                              toValue: 1,
                              duration: 1100,
                              easing: Easing.linear,
                              useNativeDriver: true,
                          }),
                      ),
                  ]
                : []),
        ]);
        animation.start();
        return () => animation.stop();
    }, [enter, turn, spinning, reducedMotion]);

    const disc = {
        width: size,
        height: size,
        borderRadius: size / 2,
    };
    return (
        <Animated.View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
                alignItems: "center",
                justifyContent: "center",
                opacity: enter,
                transform: [
                    {
                        scale: enter.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.8, 1],
                        }),
                    },
                ],
            }}
        >
            {halo ? (
                <View
                    style={{
                        position: "absolute",
                        width: size + 24,
                        height: size + 24,
                        borderRadius: (size + 24) / 2,
                        borderWidth: 1,
                        borderColor: `${tint}1f`,
                    }}
                />
            ) : null}
            <View
                style={[
                    disc,
                    {
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: `${tint}1a`,
                        borderWidth: 1.5,
                        borderColor: `${tint}${spinning ? "26" : "40"}`,
                    },
                ]}
            >
                <Icon size={size * 0.42} color={tint} strokeWidth={2} />
            </View>
            {spinning ? (
                <Animated.View
                    style={[
                        disc,
                        {
                            position: "absolute",
                            borderWidth: 1.5,
                            borderColor: "transparent",
                            borderTopColor: colors.primary,
                            transform: [
                                {
                                    rotate: turn.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: ["0deg", "360deg"],
                                    }),
                                },
                            ],
                        },
                    ]}
                />
            ) : null}
        </Animated.View>
    );
}

function StepMark({ state }: { state: StepState }) {
    return (
        <View className="h-5 w-5 items-center justify-center">
            {state === "done" ? (
                <View
                    className="h-5 w-5 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${colors.success}26` }}
                >
                    <Check size={12} color={colors.success} strokeWidth={3} />
                </View>
            ) : state === "active" ? (
                <ActivityIndicator size="small" color={colors.foreground} />
            ) : state === "waiting" ? (
                <Clock size={16} color={colors.muted} />
            ) : (
                <View
                    className="h-2.5 w-2.5 rounded-full border"
                    style={{ borderColor: colors.muted }}
                />
            )}
        </View>
    );
}
