import { useEffect, useRef } from "react";
import {
    AccessibilityInfo,
    ActivityIndicator,
    Animated,
    Easing,
    Platform,
    View,
} from "react-native";
import {
    AlertCircle,
    Check,
    Clock,
    CreditCard,
    Hourglass,
    ShieldCheck,
    Tag,
    X,
    type LucideIcon,
} from "lucide-react-native";
import { useLingui } from "@lingui/react/macro";

import {
    UnlockedButton as Button,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { CheckoutTier } from "@/app_lib/online-services-billing";
import { cn } from "@/lib/utils";
import { colors } from "@/theme";

export type PaymentStatusState =
    | "opening"
    | "confirming"
    | "confirmed"
    | "canceled"
    | "error"
    | "unconfirmed"
    | "storePending"
    | "offerChanged"
    /** Stripe: the user came back from the browser without a return link. */
    | "returned";

type Tone = "progress" | "success" | "waiting" | "error" | "neutral";
type StepState = "done" | "active" | "waiting" | "idle";
/** A checkout step when it has a state, otherwise a plain detail row. */
type Line = { label: string; value: string; state?: StepState };
type Content = {
    tone: Tone;
    icon: LucideIcon;
    title: string;
    body: string;
    /** Shorter body for the compact card. */
    note?: string;
    lines?: Line[];
    primary?: string;
    secondary?: string;
    /** The compact card offers Check now. */
    check?: boolean;
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

export type PaymentStatusProps = {
    state: PaymentStatusState;
    store: "app_store" | "google_play" | "stripe";
    /** The Account tab's one-line card instead of the sheet panel. */
    compact?: boolean;
    /** The store already had this account's subscription. Stores only. */
    owned?: boolean;
    /** Confirmation is taking longer than usual. */
    slow?: boolean;
    /** The last check could not reach the server. */
    offline?: boolean;
    /** A status check or restore is running. */
    checking?: boolean;
    /** Error: the store's message, and whether trying again can help. */
    message?: string;
    retryable?: boolean;
    /** The plan has, or now has, a free trial. */
    trial?: boolean;
    /** Confirmed: the plan bought, when known, and its next billing or trial end date. */
    tier?: CheckoutTier;
    date?: string | null;
    onPrimary?: () => void;
    onSecondary?: () => void;
};

export function PaymentStatus({
    state,
    store,
    compact = false,
    owned = false,
    slow = false,
    offline = false,
    checking = false,
    message = "",
    retryable = true,
    trial = false,
    tier,
    date,
    onPrimary,
    onSecondary,
}: PaymentStatusProps) {
    const { t } = useLingui();
    const appStore = store === "app_store";
    const stripe = store === "stripe";
    const payment = t({ message: "Payment", comment: "Checkout step" });
    const membership = t`Membership`;
    const paid = {
        label: payment,
        value: owned ? t`Already subscribed` : t`Received`,
        state: "done",
    } as const;

    const contents: Record<PaymentStatusState, Content> = {
        opening: {
            tone: "progress",
            icon: CreditCard,
            title: stripe
                ? t`Waiting for Stripe Checkout`
                : appStore
                  ? t`Waiting for the App Store`
                  : t`Waiting for Google Play`,
            body: stripe
                ? t`Finish paying in your browser. Nothing is charged until you do.`
                : appStore
                  ? t`Confirm your subscription in the App Store window. Nothing is charged until you do.`
                  : t`Confirm your subscription in Google Play. Nothing is charged until you do.`,
            lines: [
                { label: payment, value: t`In progress`, state: "active" },
                { label: membership, value: t`Not started`, state: "idle" },
            ],
        },
        confirming: {
            tone: "progress",
            icon: ShieldCheck,
            title: t`Confirming your membership`,
            body: slow
                ? t`This is taking longer than usual. You can close this screen and we'll keep checking.`
                : t`We're starting your membership. This usually takes a few seconds.`,
            lines: [
                paid,
                { label: membership, value: t`Confirming…`, state: "active" },
            ],
            secondary: t`Close`,
        },
        confirmed: {
            tone: "success",
            icon: Check,
            title: t`Welcome to Online Services`,
            body: t`Managed connections, encrypted backups and share links are ready on this vault.`,
            lines: [
                ...(tier
                    ? [
                          {
                              label: t({
                                  message: "Plan",
                                  comment:
                                      "Row label: the chosen billing interval",
                              }),
                              value:
                                  tier === "premiumYearly"
                                      ? t`Yearly`
                                      : t`Monthly`,
                          },
                      ]
                    : []),
                ...(date
                    ? [
                          {
                              label: trial ? t`Trial ends` : t`Renews`,
                              value: date,
                          },
                      ]
                    : []),
                {
                    label: t({
                        message: "Billing",
                        comment: "Row label: the service that bills the plan",
                    }),
                    // Service names stay in English.
                    value: stripe
                        ? "Stripe"
                        : appStore
                          ? "App Store"
                          : "Google Play",
                },
            ],
            primary: t`Done`,
        },
        canceled: {
            tone: "neutral",
            icon: X,
            title: t`Payment canceled`,
            body: t`Nothing was charged. You can subscribe now or later from the Account tab.`,
            primary: t`Try again`,
            secondary: t`Not now`,
        },
        error: {
            tone: "error",
            icon: AlertCircle,
            title: retryable
                ? t`Payment not completed`
                : t`Subscription belongs to another account`,
            body: message,
            primary: retryable ? t`Try again` : undefined,
            secondary: retryable ? t`Not now` : t`Close`,
        },
        unconfirmed: {
            tone: "waiting",
            icon: Clock,
            title: t`Still confirming`,
            body: owned
                ? appStore
                    ? t`Your App Store account already has a subscription, but we couldn't link it yet.`
                    : t`Your Google Play account already has a subscription, but we couldn't link it yet.`
                : offline
                  ? t`Your payment went through. Connect to the internet so we can confirm it. You won't be charged again.`
                  : t`Your payment went through, but we haven't confirmed it yet. You won't be charged again.`,
            note: owned
                ? t`Subscription found. Waiting for confirmation.`
                : offline
                  ? t`Payment received. Waiting for a connection.`
                  : t`Payment received. Waiting for confirmation.`,
            lines: [
                paid,
                checking
                    ? {
                          label: membership,
                          value: t`Checking…`,
                          state: "active",
                      }
                    : {
                          label: membership,
                          value: offline
                              ? t`Waiting for a connection`
                              : t`Not confirmed yet`,
                          state: "waiting",
                      },
            ],
            primary: owned
                ? appStore
                    ? t`Restore App Store purchases`
                    : t`Restore Google Play purchases`
                : t`Check again`,
            secondary: t`Close`,
            check: true,
        },
        storePending: {
            tone: "waiting",
            icon: Hourglass,
            title: appStore ? t`Waiting for approval` : t`Payment pending`,
            body: appStore
                ? t`The App Store is waiting for this purchase to be approved, for example by a family organizer. Your membership starts once it's approved.`
                : t`Google Play is waiting for your payment to complete. Your membership starts once it's paid.`,
            note: appStore
                ? t`Your membership starts once it's approved.`
                : t`Your membership starts once it's paid.`,
            lines: [
                {
                    label: payment,
                    value: appStore
                        ? t`Awaiting approval`
                        : t`Awaiting payment`,
                    state: "waiting",
                },
                { label: membership, value: t`Not started`, state: "idle" },
            ],
            primary: t`Done`,
            check: true,
        },
        offerChanged: {
            tone: "waiting",
            icon: Tag,
            title: t`Plan terms changed`,
            body: trial
                ? t`This plan now starts with a 14-day free trial. Check the terms and continue.`
                : t`The free trial is no longer available for this plan. Check the price and continue.`,
        },
        returned: {
            tone: checking ? "progress" : "waiting",
            icon: CreditCard,
            title: checking ? t`Checking for your payment` : t`No payment yet`,
            body: checking
                ? t`This only takes a moment.`
                : t`If you finished paying in your browser, it can take a moment to arrive. If you closed checkout, nothing was charged.`,
            lines: [
                checking
                    ? { label: payment, value: t`Checking…`, state: "active" }
                    : {
                          label: payment,
                          value: t`Not found yet`,
                          state: "waiting",
                      },
                { label: membership, value: t`Not started`, state: "idle" },
            ],
            primary: checking ? undefined : t`Check again`,
            secondary: checking ? undefined : t`Open checkout again`,
            check: true,
        },
    };
    const content = contents[state];

    useEffect(() => {
        // Android announces the live region; iOS needs an explicit announcement.
        if (Platform.OS === "ios")
            AccessibilityInfo.announceForAccessibility(content.title);
    }, [content.title]);

    if (compact) {
        return (
            <View className="flex-row items-center gap-3 rounded-[10px] border border-border bg-[#111520] p-3">
                <Emblem
                    key={state}
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
                {content.check ? (
                    <Button
                        size="sm"
                        variant="outline"
                        className="px-3"
                        loading={checking}
                        disabled={checking}
                        onPress={onPrimary}
                    >
                        {t`Check now`}
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
                    key={state}
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
                            loading={checking}
                            loadingLabel={t`Checking…`}
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
