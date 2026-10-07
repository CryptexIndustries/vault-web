import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";

import { Check } from "lucide-react-native";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { colors } from "@/theme";
import { AdvancedDisclosure } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { VaultEntryAction } from "@/components/vault-entry-ui";

export type LinkProgressItem = {
    key: string;
    title: string;
    detail: string;
    state: "pending" | "active" | "completed" | "error";
};

export type LinkActivityEntry = {
    id: number;
    elapsedSeconds: number;
    message: string;
    type: "debug" | "info" | "error";
};

export type LinkFailure = {
    message: string;
    technical: string;
};

export function LinkActivityLog({
    activity,
}: {
    activity: LinkActivityEntry[];
}) {
    return (
        <AdvancedDisclosure
            ruled
            title={`Activity log (${activity.length} event${activity.length === 1 ? "" : "s"})`}
            description="Events reported by this linking attempt"
        >
            <View className="border-y border-border">
                {activity.length === 0 ? (
                    <Text className="py-3 font-mono text-xs text-muted-foreground">
                        Waiting for the first event…
                    </Text>
                ) : (
                    activity.map((entry) => (
                        <View
                            key={entry.id}
                            className="flex-row border-b border-border py-2 last:border-b-0"
                        >
                            <Text className="mr-2 font-mono text-[11px] text-primary">
                                +{String(entry.elapsedSeconds).padStart(2, "0")}
                                s
                            </Text>
                            <Text
                                selectable
                                className="flex-1 font-mono text-[11px] leading-[18px] text-muted-foreground"
                            >
                                {entry.message}
                            </Text>
                        </View>
                    ))
                )}
            </View>
        </AdvancedDisclosure>
    );
}

function MovingBlocks() {
    const reducedMotion = useReducedMotion();
    const values = useRef([
        new Animated.Value(0),
        new Animated.Value(0),
        new Animated.Value(0),
    ]).current;

    useEffect(() => {
        if (reducedMotion) {
            values.forEach((value) => value.setValue(0.55));
            return;
        }
        const animation = Animated.loop(
            Animated.stagger(
                140,
                values.map((value) =>
                    Animated.sequence([
                        Animated.timing(value, {
                            toValue: 1,
                            duration: 360,
                            easing: Easing.inOut(Easing.quad),
                            useNativeDriver: true,
                        }),
                        Animated.timing(value, {
                            toValue: 0,
                            duration: 360,
                            easing: Easing.inOut(Easing.quad),
                            useNativeDriver: true,
                        }),
                    ]),
                ),
            ),
        );
        animation.start();
        return () => animation.stop();
    }, [reducedMotion, values]);

    return (
        <View
            className="mr-3 flex-row gap-1"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            {values.map((value, index) => (
                <Animated.View
                    key={index}
                    className="h-2 w-2 rounded-[2px] bg-primary"
                    style={{
                        opacity: value.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.3, 1],
                        }),
                        transform: [
                            {
                                translateX: value.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0, 4],
                                }),
                            },
                        ],
                    }}
                />
            ))}
        </View>
    );
}

function LinkingTimelineRow({
    item,
    index,
    last,
}: {
    item: {
        key: string;
        title: string;
        detail?: string;
        state: LinkProgressItem["state"];
    };
    index: number;
    last: boolean;
}) {
    const reducedMotion = useReducedMotion();
    const complete = item.state === "completed";
    const active = item.state === "active";
    const failed = item.state === "error";
    const completion = useRef(new Animated.Value(complete ? 1 : 0)).current;
    const brightness = useRef(
        new Animated.Value(active || complete ? 1 : 0),
    ).current;

    useEffect(() => {
        const completionTarget = complete ? 1 : 0;
        const brightnessTarget = active || complete ? 1 : 0;
        if (reducedMotion) {
            completion.setValue(completionTarget);
            brightness.setValue(brightnessTarget);
            return;
        }
        const animation = Animated.parallel([
            Animated.timing(completion, {
                toValue: completionTarget,
                duration: 260,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(brightness, {
                toValue: brightnessTarget,
                duration: 220,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            }),
        ]);
        animation.start();
        return () => animation.stop();
    }, [active, brightness, complete, completion, reducedMotion]);

    return (
        <View className="min-h-[60px] flex-row">
            <View className="mr-3 items-center">
                <Animated.View
                    className={cn(
                        "h-8 w-8 items-center justify-center rounded-md border border-border bg-background",
                        active && "border-primary",
                        complete && "border-success",
                        failed && "border-primary",
                    )}
                    style={
                        active
                            ? {
                                  shadowColor: colors.primary,
                                  shadowOpacity: 0.2,
                                  shadowRadius: 8,
                                  transform: [
                                      {
                                          scale: brightness.interpolate({
                                              inputRange: [0, 1],
                                              outputRange: [0.96, 1],
                                          }),
                                      },
                                  ],
                              }
                            : undefined
                    }
                >
                    <Animated.View
                        className="absolute"
                        style={{ opacity: completion }}
                    >
                        <Icon as={Check} size={16} color={colors.success} />
                    </Animated.View>
                    <Animated.View
                        style={{
                            opacity: complete
                                ? completion.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [1, 0],
                                  })
                                : 1,
                        }}
                    >
                        <Text
                            className={cn(
                                "font-mono text-[11px] text-muted-foreground",
                                active && "text-primary",
                                failed && "text-primary",
                            )}
                        >
                            {failed ? "!" : String(index + 1).padStart(2, "0")}
                        </Text>
                    </Animated.View>
                </Animated.View>
                {!last ? (
                    <View className="relative w-px flex-1 overflow-hidden bg-border">
                        <Animated.View
                            className="absolute inset-0 bg-primary"
                            style={{
                                opacity: completion,
                                transformOrigin: "top",
                                transform: [{ scaleY: completion }],
                            }}
                        />
                    </View>
                ) : null}
            </View>
            <Animated.View
                className="flex-1 pb-4 pt-1.5"
                style={{
                    opacity: failed
                        ? 1
                        : brightness.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.58, 1],
                          }),
                }}
            >
                <Text
                    className={cn(
                        "text-[13px] text-foreground",
                        active && "font-semibold",
                        failed && "font-semibold text-primary",
                    )}
                >
                    {item.title}
                </Text>
                {item.detail && (active || failed) ? (
                    <Text className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        {item.detail}
                    </Text>
                ) : null}
            </Animated.View>
        </View>
    );
}

export function LinkingProgress({
    items,
    status,
    activity,
    failure,
    onCancel,
    onRetry,
    onUseNewInvitation,
}: {
    items: LinkProgressItem[];
    status: string;
    activity: LinkActivityEntry[];
    failure: LinkFailure | null;
    onCancel: () => void;
    onRetry: () => void;
    onUseNewInvitation: () => void;
}) {
    return (
        <View className="gap-3">
            <View
                className="min-h-[44px] flex-row items-center border-l-2 border-primary pl-3"
                accessibilityLiveRegion="polite"
            >
                {!failure ? <MovingBlocks /> : null}
                <Text className="flex-1 text-[13px] leading-5 text-muted-foreground">
                    {failure?.message ?? status}
                </Text>
            </View>

            <View accessibilityLabel="Linking progress">
                {items.map((item, index) => (
                    <LinkingTimelineRow
                        key={item.key}
                        item={item}
                        index={index}
                        last={index === items.length - 1}
                    />
                ))}
            </View>

            {failure ? (
                <View className="gap-3 border-l-2 border-primary bg-secondary px-4 py-3">
                    <Text className="font-semibold text-foreground">
                        The received vault has not been saved.
                    </Text>
                    <AdvancedDisclosure ruled title="Inspect error">
                        <Text
                            selectable
                            className="font-mono text-xs leading-5 text-primary"
                        >
                            {failure.technical}
                        </Text>
                    </AdvancedDisclosure>
                    <VaultEntryAction onPress={onRetry}>
                        Try again
                    </VaultEntryAction>
                    <Button variant="outline" onPress={onUseNewInvitation}>
                        Use a new invitation
                    </Button>
                </View>
            ) : null}

            <LinkActivityLog activity={activity} />

            {!failure ? (
                <Button variant="secondary" onPress={onCancel}>
                    Cancel linking
                </Button>
            ) : null}
        </View>
    );
}
