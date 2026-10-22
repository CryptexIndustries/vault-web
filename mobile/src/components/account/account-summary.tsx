import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import {
    UnlockedButton as Button,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { copyTextToClipboard } from "@/utils/clipboard";
import {
    isGooglePlayBuild,
    restoreStorePurchases,
    openBillingManagement,
    billingManagement,
} from "@/app_lib/online-services-billing";
import { colors } from "@/theme";
import type { FeedbackAction } from "@/components/snackbar";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";
import {
    MembershipBenefits,
    type MembershipAccess,
} from "./membership-benefits";

type RemoteConfig = MembershipAccess & {
    root?: boolean;
    canLink?: boolean;
    canPromoteDevices?: boolean;
    maxLinks?: number;
    recoveryTokenCreatedAt?: Date | string | null;
};

type Subscription = {
    productName?: string | null;
    status?: string | null;
    cancelAtPeriodEnd?: boolean | null;
    expiresAt?: Date | string | null;
    trialEndsAt?: Date | string | null;
    nonFree?: boolean;
    provider?: "stripe" | "google_play" | "app_store" | null;
    resourceStatus?: { linkedDevices?: number };
};

type AccountSummaryProps = {
    mode?: "overview" | "membership" | "details" | "all";
    onOpenMembership?: () => void;
    onOpenUpgrade?: () => void;
    tierName: string;
    subscriptionStatus: string;
    subscription: Subscription | null | undefined;
    remoteConfig: RemoteConfig | null | undefined;
    hasSession: boolean;
    deviceId: string | null | undefined;
    userId: string | null | undefined;
    onlineServicesBound: boolean;
    isConnected: boolean;
    authStatusDescription: string;
    refreshing: boolean;
    onRefresh: () => void;
    onMessage: (message: string, action?: FeedbackAction) => void;
    onExternalBillingOpened: (
        outcome?: "success" | "resume" | "external",
    ) => void;
    onBillingBusyChange?: (busy: boolean) => void;
    pendingConfirmation: boolean;
    onPendingChange: (pending: boolean) => void;
};

function formatAccountDate(value?: Date | string | null) {
    if (!value) return null;
    const date = new Date(value);
    // Numeric dates read differently across regions.
    return Number.isNaN(date.getTime())
        ? null
        : date.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
          });
}

function formatDisplayName(value: string) {
    if (
        !value ||
        (!/^[A-Z0-9 _-]+$/.test(value) && !/^[a-z0-9 _-]+$/.test(value))
    )
        return value;
    const normalized = value.replace(/[_-]+/g, " ").toLowerCase();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function Detail({
    label,
    value,
    mono = false,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <View
            style={{
                minHeight: 52,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 20,
                paddingVertical: 16,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
            <Text
                selectable={mono}
                style={{
                    fontSize: 13,
                    maxWidth: "65%",
                    textAlign: "right",
                    fontFamily: mono ? "monospace" : undefined,
                }}
            >
                {value}
            </Text>
        </View>
    );
}

export function AccountSummary({
    mode = "all",
    onOpenMembership,
    onOpenUpgrade,
    tierName,
    subscriptionStatus,
    subscription,
    remoteConfig,
    hasSession,
    deviceId,
    userId,
    onlineServicesBound,
    refreshing,
    onRefresh,
    onMessage,
    onExternalBillingOpened,
    onBillingBusyChange,
    pendingConfirmation,
    onPendingChange,
}: AccountSummaryProps) {
    const billingInFlight = useRef(false);
    const accountScope = `${userId ?? ""}:${deviceId ?? ""}`;
    const accountScopeRef = useRef(accountScope);
    accountScopeRef.current = accountScope;
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const [billingBusy, setBillingBusy] = useState(false);
    const pending = pendingConfirmation;
    const pendingRef = useRef(pending);
    useEffect(() => {
        pendingRef.current = pendingConfirmation;
    }, [accountScope, pendingConfirmation]);
    const linkedDeviceCount = subscription?.resourceStatus?.linkedDevices;
    const linkedDeviceLimit = remoteConfig?.maxLinks;
    const usage =
        linkedDeviceCount != null &&
        Number.isFinite(linkedDeviceCount) &&
        linkedDeviceCount >= 0
            ? linkedDeviceLimit != null &&
              Number.isFinite(linkedDeviceLimit) &&
              linkedDeviceLimit > 0
                ? `${linkedDeviceCount} of ${linkedDeviceLimit} linked devices`
                : `${linkedDeviceCount} linked device${linkedDeviceCount === 1 ? "" : "s"}`
            : "Usage unavailable";
    const trialing = subscriptionStatus.toLowerCase() === "trialing";
    const billingDateLabel = subscription?.cancelAtPeriodEnd
        ? trialing
            ? "Access ends"
            : "Expires"
        : trialing
          ? "Trial ends"
          : "Renews";
    const management = billingManagement(subscription?.provider);
    const canManageBilling =
        hasSession && !!subscription?.nonFree && management !== null;
    const billedElsewhere =
        hasSession && !!subscription?.nonFree && management === null
            ? subscription.provider === "app_store"
                ? "Billed through the App Store"
                : "Billed outside Google Play"
            : null;
    const managementCaption =
        management === "google_play"
            ? "Manage or cancel in Google Play Subscriptions"
            : "Billing opens in your browser";
    const canUpgrade =
        hasSession && subscription?.nonFree === false && !pending;
    const displayTierName = subscription
        ? subscription.nonFree
            ? "Online Services"
            : "Free"
        : formatDisplayName(tierName);
    const status = subscriptionStatus.toLowerCase();
    const billingWarning =
        status === "past_due" || status === "unpaid"
            ? "Your payment needs attention. Open Manage billing to review it."
            : status === "canceled" || status === "cancelled"
              ? "Your subscription has ended."
              : status === "paused"
                ? "Your subscription is paused."
                : trialing
                  ? subscription?.cancelAtPeriodEnd
                      ? "Free trial canceled. You won't be charged."
                      : "Free trial. You'll be charged when it ends unless you cancel before then."
                  : null;

    const handleBilling = async (
        operation: "manage" | "restore" = "manage",
    ) => {
        if (
            !mounted.current ||
            billingInFlight.current ||
            refreshing ||
            !hasSession ||
            accountScopeRef.current !== accountScope
        )
            return;
        if (operation === "restore" && pendingRef.current) return;
        billingInFlight.current = true;
        const generation = getVaultSessionGeneration();
        const scope = accountScope;
        const isCurrent = () =>
            mounted.current &&
            isSameActiveVaultSession(generation) &&
            accountScopeRef.current === scope;
        setBillingBusy(true);
        onBillingBusyChange?.(true);
        try {
            const result = await (operation === "restore"
                ? restoreStorePurchases()
                : openBillingManagement(
                      operation === "manage" && subscription?.nonFree
                          ? management
                          : undefined,
                  ));
            if (!isCurrent()) return;
            if (!result.ok) {
                if ("canceled" in result && result.canceled) return;
                if ("pending" in result && result.pending) {
                    pendingRef.current = true;
                    onPendingChange(true);
                } else
                    onMessage(
                        result.message,
                        "retryable" in result && result.retryable === false
                            ? undefined
                            : {
                                  label: "Retry",
                                  onPress: () => {
                                      if (isCurrent())
                                          return handleBillingRef.current(
                                              operation,
                                          );
                                  },
                              },
                    );
            } else {
                if (operation === "restore") {
                    pendingRef.current = true;
                    onPendingChange(true);
                }
                onExternalBillingOpened(
                    operation === "manage" ? "external" : "resume",
                );
            }
        } catch {
            if (isCurrent())
                onMessage("Could not complete billing. Please try again.", {
                    label: "Retry",
                    onPress: () => {
                        if (isCurrent())
                            return handleBillingRef.current(operation);
                    },
                });
        } finally {
            billingInFlight.current = false;
            if (isCurrent()) {
                setBillingBusy(false);
                onBillingBusyChange?.(false);
            }
        }
    };
    const handleBillingRef = useRef(handleBilling);
    handleBillingRef.current = handleBilling;
    const restoreButton =
        isGooglePlayBuild() && hasSession ? (
            <View style={{ gap: 8 }}>
                {!pending ? (
                    <Button
                        variant="outline"
                        loading={billingBusy}
                        disabled={refreshing}
                        onPress={() => void handleBilling("restore")}
                    >
                        Restore Google Play purchases
                    </Button>
                ) : null}
                {!subscription?.nonFree ? (
                    <Button
                        variant="ghost"
                        disabled={billingBusy || refreshing}
                        onPress={() => void handleBilling()}
                    >
                        Manage Google Play subscriptions
                    </Button>
                ) : null}
            </View>
        ) : null;
    const billingDate = formatAccountDate(
        (trialing && subscription?.trialEndsAt) || subscription?.expiresAt,
    );

    if (mode === "overview") {
        return (
            <View
                style={{
                    paddingBottom: 24,
                    marginBottom: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                }}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        subscription
                            ? `${displayTierName} membership, view details`
                            : "View membership details"
                    }
                    onPress={onOpenMembership}
                    android_ripple={{ color: colors.border }}
                    style={{ paddingVertical: 12, minHeight: 72 }}
                >
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 16,
                        }}
                    >
                        <View style={{ flex: 1 }}>
                            <Text
                                style={{
                                    color: colors.muted,
                                    fontSize: 10,
                                    letterSpacing: 1.1,
                                }}
                            >
                                {!hasSession && subscription
                                    ? "LAST KNOWN MEMBERSHIP"
                                    : "CURRENT MEMBERSHIP"}
                            </Text>
                            <Text
                                style={{
                                    marginTop: 8,
                                    fontSize: subscription ? 28 : 20,
                                    lineHeight: 34,
                                    fontWeight: "500",
                                    letterSpacing: -0.6,
                                }}
                            >
                                {subscription
                                    ? displayTierName
                                    : refreshing
                                      ? "Loading membership…"
                                      : hasSession
                                        ? "Membership unavailable"
                                        : "Reconnect to view membership"}
                            </Text>
                        </View>
                        {!subscription && refreshing ? (
                            <ActivityIndicator color={colors.muted} />
                        ) : (
                            <ChevronRight size={20} color={colors.muted} />
                        )}
                    </View>
                    {subscription ? (
                        <View style={{ marginTop: 12, gap: 5 }}>
                            <Text
                                style={{
                                    color: colors.muted,
                                    fontSize: 13,
                                    lineHeight: 20,
                                }}
                            >
                                {usage}
                            </Text>
                            {subscription.nonFree && billingDate !== null ? (
                                <Text
                                    style={{
                                        color: colors.muted,
                                        fontSize: 12,
                                        lineHeight: 18,
                                    }}
                                >
                                    {billingDateLabel} {billingDate}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}
                </Pressable>
                {restoreButton}
                {canManageBilling || canUpgrade ? (
                    <View style={{ marginTop: 8, gap: 8 }}>
                        <Button
                            variant={canUpgrade ? "default" : "outline"}
                            disabled={refreshing}
                            loading={billingBusy}
                            onPress={
                                canUpgrade
                                    ? onOpenUpgrade
                                    : () => void handleBilling()
                            }
                        >
                            {canUpgrade
                                ? "Upgrade membership"
                                : "Manage billing"}
                        </Button>
                        {canManageBilling ? (
                            <Text
                                style={{
                                    color: colors.muted,
                                    fontSize: 11,
                                    lineHeight: 16,
                                    textAlign: "center",
                                }}
                            >
                                {managementCaption}
                            </Text>
                        ) : null}
                    </View>
                ) : billedElsewhere ? (
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 11,
                            lineHeight: 16,
                            marginTop: 8,
                            textAlign: "center",
                        }}
                    >
                        {billedElsewhere}
                    </Text>
                ) : hasSession && !subscription && !refreshing ? (
                    <Button
                        variant="outline"
                        className="mt-3"
                        onPress={onOpenMembership}
                    >
                        View membership
                    </Button>
                ) : null}
            </View>
        );
    }

    if (mode === "details") {
        return (
            <View>
                <Detail label="User ID" value={userId ?? "Unavailable"} mono />
                {userId ? (
                    <Button
                        className="my-4"
                        variant="secondary"
                        onPress={() => void copyTextToClipboard(userId)}
                    >
                        Copy user ID
                    </Button>
                ) : null}
                <Detail
                    label="Device ID"
                    value={deviceId ?? "Unavailable"}
                    mono
                />
                <Detail
                    label="Account role"
                    value={
                        remoteConfig?.root
                            ? "Administrator device"
                            : "Member device"
                    }
                />
                <Detail
                    label="This vault"
                    value={
                        onlineServicesBound
                            ? "Connected to Online Services"
                            : "Not connected"
                    }
                />
                <View
                    style={{
                        borderLeftWidth: 2,
                        borderLeftColor: colors.muted,
                        paddingLeft: 13,
                        marginVertical: 20,
                    }}
                >
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 12,
                            lineHeight: 18,
                        }}
                    >
                        Your User ID and account recovery phrase are both needed
                        to recover your Online Services account.
                    </Text>
                </View>
            </View>
        );
    }

    if (!subscription) {
        return (
            <View style={{ gap: 16 }}>
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 14,
                        lineHeight: 22,
                    }}
                >
                    {refreshing
                        ? "Loading membership…"
                        : hasSession
                          ? "Membership unavailable."
                          : "Reconnect to view your membership details."}
                </Text>
                {restoreButton}
                {!hasSession ? (
                    <Button
                        variant="outline"
                        loading={refreshing}
                        onPress={onRefresh}
                    >
                        Reconnect
                    </Button>
                ) : null}
            </View>
        );
    }

    return (
        <View>
            <View
                style={{
                    paddingBottom: 22,
                    marginBottom: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                }}
            >
                <Text
                    style={{
                        fontSize: 22,
                        fontWeight: "500",
                        letterSpacing: -0.5,
                    }}
                >
                    {displayTierName}
                </Text>
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 13,
                        lineHeight: 20,
                        marginTop: 6,
                    }}
                >
                    {subscription.nonFree
                        ? "Managed services for your connected devices."
                        : "Your vault essentials, free forever."}
                </Text>
            </View>
            <Detail label="Usage" value={usage} />
            {subscription.nonFree && billingDate !== null ? (
                <Detail label={billingDateLabel} value={billingDate} />
            ) : null}
            {billingWarning ? (
                <Text
                    style={{
                        color: colors.primary,
                        fontSize: 12,
                        lineHeight: 18,
                        marginTop: 16,
                    }}
                >
                    {billingWarning}
                </Text>
            ) : null}
            {canManageBilling || canUpgrade ? (
                <View style={{ marginTop: 20, gap: 9 }}>
                    <Button
                        variant={canUpgrade ? "default" : "outline"}
                        disabled={refreshing}
                        loading={billingBusy}
                        onPress={
                            canUpgrade
                                ? onOpenUpgrade
                                : () => void handleBilling()
                        }
                    >
                        {canUpgrade ? "Upgrade" : "Manage billing"}
                    </Button>
                    {canManageBilling ? (
                        <Text
                            style={{
                                color: colors.muted,
                                fontSize: 11,
                                lineHeight: 17,
                                textAlign: "center",
                            }}
                        >
                            {managementCaption}. Your membership updates when
                            you return.
                        </Text>
                    ) : null}
                </View>
            ) : null}
            {billedElsewhere ? (
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 12,
                        lineHeight: 18,
                        marginTop: 20,
                        textAlign: "center",
                    }}
                >
                    {billedElsewhere}
                </Text>
            ) : null}
            {restoreButton ? (
                <View style={{ marginTop: 16 }}>{restoreButton}</View>
            ) : null}
            <View style={{ marginTop: 28 }}>
                <MembershipBenefits access={remoteConfig} />
            </View>
        </View>
    );
}
