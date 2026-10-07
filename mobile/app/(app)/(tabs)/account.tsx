import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { ArrowLeft, Shield, Smartphone, User } from "lucide-react-native";
import { useAtomValue } from "jotai";

import {
    UnlockedButton as Button,
    UnlockedDialogTitle as DialogTitle,
    UnlockedMenuRow,
    UnlockedScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { AccountSummary } from "@/components/account/account-summary";
import { MembershipUpgrade } from "@/components/account/membership-upgrade";
import { SubscriptionSignup } from "@/components/account/subscription-signup";
import { InlineNotice } from "@/components/inline-notice";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import {
    establishOnlineServicesSession,
    syncOnlineServicesRemoteConfiguration,
} from "@/app_lib/auth-session";
import {
    refreshSubscriptionAfterExternalBilling,
    type BillingConfirmation,
} from "@/app_lib/online-services-billing";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";
import {
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesDataAtom,
    onlineServicesStore,
    unlockedVaultAtom,
} from "@/utils/atoms";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { trpcReact } from "@/utils/trpc";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { colors } from "@/theme";

type NoticeTone = "info" | "error" | "loading";

export default function AccountScreen() {
    const focused = useIsFocused();
    const [appState, setAppState] = useState(AppState.currentState);
    const vault = useAtomValue(unlockedVaultAtom);
    const onlineServicesData = useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    });
    const authStatus = useAtomValue(onlineServicesAuthConnectionStatusAtom, {
        store: onlineServicesStore,
    });
    const params = useLocalSearchParams<{
        billingOutcome?: string;
        billingReturn?: string;
        billingResume?: string;
        signup?: string;
    }>();

    const bound = Vault.isOnlineServicesBound(vault);
    const cloudOn = isCloudServicesEnabled();
    const hasSession = !!onlineServicesData?.sessionToken?.length;
    const [accountDetailsOpen, setAccountDetailsOpen] = useState(false);
    const [subscriptionSignupOpen, setSubscriptionSignupOpen] = useState(false);
    const [subscriptionSignupStarted, setSubscriptionSignupStarted] =
        useState(false);
    const signupGenerationRef = useRef(getVaultSessionGeneration());
    const vaultGeneration = getVaultSessionGeneration();
    const currentSubscriptionSignup =
        subscriptionSignupStarted &&
        signupGenerationRef.current === vaultGeneration;
    const [accountSummaryMode, setAccountSummaryMode] = useState<
        "membership" | "details" | "upgrade"
    >("membership");
    const [busy, setBusy] = useState(false);
    const [membershipRefreshError, setMembershipRefreshError] = useState<
        string | null
    >(null);
    const refreshPromiseRef = useRef<Promise<void> | null>(null);
    const [message, setMessage] = useState<{
        tone: NoticeTone;
        text: string;
    } | null>(null);
    const automaticRecoveryStartedRef = useRef(false);
    const externalBillingOpenedRef = useRef(false);
    const externalBillingOutcomeRef = useRef<"success" | "cancel" | "resume">(
        "resume",
    );
    const confirmationRef = useRef<BillingConfirmation | undefined>(undefined);
    const confirmationReturnRef = useRef<string | undefined>(undefined);
    const queryUtils = trpcReact.useUtils();

    useEffect(() => {
        if (!subscriptionSignupStarted || currentSubscriptionSignup) return;
        setSubscriptionSignupStarted(false);
        setSubscriptionSignupOpen(false);
    }, [subscriptionSignupStarted, currentSubscriptionSignup]);

    const {
        data: remoteConfig,
        refetch: refetchConfig,
        isFetching: configFetching,
    } = trpcReact.v1.user.configuration.useQuery(undefined, {
        enabled: cloudOn && hasSession,
    });
    const {
        data: subscription,
        refetch: refetchSubscription,
        isFetching: subscriptionFetching,
    } = trpcReact.v1.payment.subscription.useQuery(undefined, {
        enabled:
            cloudOn &&
            hasSession &&
            !!onlineServicesData?.remoteData &&
            !params.billingOutcome,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });

    useEffect(() => {
        const listener = AppState.addEventListener("change", (state) => {
            setAppState(state);
            if (
                !focused ||
                state !== "active" ||
                !externalBillingOpenedRef.current
            )
                return;
            externalBillingOpenedRef.current = false;
            router.setParams({
                billingOutcome:
                    params.billingOutcome ?? externalBillingOutcomeRef.current,
                billingResume: String(Date.now()),
            });
        });
        return () => listener.remove();
    }, [focused, params.billingOutcome]);

    useFocusEffect(
        useCallback(() => {
            if (
                AppState.currentState !== "active" ||
                !externalBillingOpenedRef.current
            )
                return;
            externalBillingOpenedRef.current = false;
            router.setParams({
                billingOutcome:
                    params.billingOutcome ?? externalBillingOutcomeRef.current,
                billingResume: String(Date.now()),
            });
        }, [params.billingOutcome]),
    );

    const deviceId = vault.OnlineServices?.DeviceId;
    useEffect(() => {
        if (
            !focused ||
            appState !== "active" ||
            !params.billingOutcome ||
            !bound ||
            !cloudOn
        )
            return;
        const outcome =
            params.billingOutcome === "success" ||
            params.billingOutcome === "cancel"
                ? params.billingOutcome
                : "resume";
        const controller = new AbortController();
        const generation = getVaultSessionGeneration();
        const isCurrent = () =>
            !controller.signal.aborted && isSameActiveVaultSession(generation);
        const backgroundListener = AppState.addEventListener(
            "change",
            (state) => {
                if (state !== "active") {
                    controller.abort();
                    externalBillingOpenedRef.current = true;
                    setBusy(false);
                }
            },
        );
        externalBillingOpenedRef.current = false;
        externalBillingOutcomeRef.current = outcome;
        if (confirmationReturnRef.current !== params.billingReturn) {
            confirmationRef.current = undefined;
            confirmationReturnRef.current = params.billingReturn;
        }
        if (
            confirmationRef.current &&
            confirmationRef.current.generation !== generation
        ) {
            confirmationRef.current = undefined;
            router.setParams({
                billingOutcome: undefined,
                billingReturn: undefined,
                billingResume: undefined,
            });
            return () => backgroundListener.remove();
        }
        confirmationRef.current ??= {
            generation,
            deadline: Date.now() + 60000,
            nextPollAt: 0,
            attempts: 0,
            subscription: null,
        };
        setBusy(true);
        setMessage(
            outcome === "success"
                ? { tone: "loading", text: "Confirming membership…" }
                : null,
        );
        void (async () => {
            try {
                const currentSubscription =
                    await refreshSubscriptionAfterExternalBilling(
                        outcome,
                        controller.signal,
                        confirmationRef.current,
                    );
                if (!isCurrent()) return;
                if (!currentSubscription) {
                    setMessage({
                        tone: "info",
                        text: "Membership confirmation is still pending. Reopen Membership shortly to check again.",
                    });
                    return;
                }
                queryUtils.v1.payment.subscription.setData(
                    undefined,
                    currentSubscription,
                );
                await Promise.all([
                    queryUtils.v1.payment.subscription.invalidate(undefined, {
                        refetchType: "none",
                    }),
                    queryUtils.v1.user.configuration.invalidate(),
                    queryUtils.v1.payment.customerPortal.invalidate(),
                ]);
                if (!isCurrent()) return;
                setMessage(
                    outcome === "success" && !currentSubscription.nonFree
                        ? {
                              tone: "info",
                              text: "Membership confirmation is still pending. Reopen Membership shortly to check again.",
                          }
                        : null,
                );
            } catch {
                if (isCurrent())
                    setMessage({
                        tone: "error",
                        text: "Could not refresh membership. Reopen Membership to try again.",
                    });
            } finally {
                if (isCurrent()) {
                    confirmationRef.current = undefined;
                    setBusy(false);
                    router.setParams({
                        billingOutcome: undefined,
                        billingReturn: undefined,
                        billingResume: undefined,
                    });
                }
            }
        })();
        return () => {
            controller.abort();
            backgroundListener.remove();
            setBusy(false);
        };
    }, [
        focused,
        appState,
        params.billingOutcome,
        params.billingReturn,
        params.billingResume,
        bound,
        cloudOn,
        deviceId,
        queryUtils,
    ]);

    const recoveryGenerationNeeded =
        onlineServicesData?.remoteData?.recoveryGenerationNeeded === true;
    useFocusEffect(
        useCallback(() => {
            if (currentSubscriptionSignup || params.signup === "1") return;
            if (!hasSession || !recoveryGenerationNeeded) {
                automaticRecoveryStartedRef.current = false;
                return;
            }
            if (automaticRecoveryStartedRef.current) return;
            automaticRecoveryStartedRef.current = true;
            router.push({
                pathname: "/(app)/account/recovery-kit",
                params: { auto: "1" },
            });
        }, [
            hasSession,
            recoveryGenerationNeeded,
            currentSubscriptionSignup,
            params.signup,
        ]),
    );

    const handleRefresh = useCallback(() => {
        if (refreshPromiseRef.current) return refreshPromiseRef.current;
        if (busy) return Promise.resolve();
        const generation = getVaultSessionGeneration();
        setBusy(true);
        setMembershipRefreshError(null);
        const promise = (async () => {
            try {
                if (Vault.isOnlineServicesBound(vault) && !hasSession) {
                    await establishOnlineServicesSession({
                        deviceId: vault.OnlineServices.DeviceId,
                        privateKeyJWK: vault.OnlineServices.PrivateKeyJWK,
                    });
                }
                if (!isSameActiveVaultSession(generation)) return;
                await syncOnlineServicesRemoteConfiguration();
                if (!isSameActiveVaultSession(generation)) return;
                await Promise.all([
                    refetchConfig({ throwOnError: true }),
                    refetchSubscription({ throwOnError: true }),
                ]);
            } catch (error) {
                if (!isSameActiveVaultSession(generation)) return;
                setMembershipRefreshError(
                    "Could not update your membership. Please try again.",
                );
                setMessage({
                    tone: "error",
                    text:
                        error instanceof Error
                            ? error.message
                            : "Could not reconnect to Online Services.",
                });
            } finally {
                refreshPromiseRef.current = null;
                if (isSameActiveVaultSession(generation)) setBusy(false);
            }
        })();
        refreshPromiseRef.current = promise;
        return promise;
    }, [busy, vault, hasSession, refetchConfig, refetchSubscription]);

    const openMembership = useCallback(() => {
        setMessage(null);
        setAccountSummaryMode("membership");
        setAccountDetailsOpen(true);
        void handleRefresh();
    }, [handleRefresh]);

    const startSubscriptionSignup = useCallback(() => {
        signupGenerationRef.current = getVaultSessionGeneration();
        setSubscriptionSignupStarted(true);
        setSubscriptionSignupOpen(true);
    }, []);

    const openUpgrade = useCallback(() => {
        if (
            currentSubscriptionSignup ||
            (remoteConfig?.root &&
                remoteConfig.recoveryTokenCreatedAt === null &&
                subscription?.nonFree === false)
        ) {
            setAccountDetailsOpen(false);
            startSubscriptionSignup();
            return;
        }
        setMessage(null);
        setMembershipRefreshError(null);
        setAccountSummaryMode("upgrade");
        setAccountDetailsOpen(true);
    }, [
        currentSubscriptionSignup,
        remoteConfig,
        subscription?.nonFree,
        startSubscriptionSignup,
    ]);

    useEffect(() => {
        if (params.signup !== "1") return;
        if (bound && (!remoteConfig || !subscription)) return;
        if (!bound) {
            startSubscriptionSignup();
        } else if (subscription?.nonFree === false) {
            openUpgrade();
        } else {
            openMembership();
        }
        router.setParams({ signup: undefined });
    }, [
        params.signup,
        bound,
        remoteConfig,
        subscription,
        openUpgrade,
        openMembership,
        startSubscriptionSignup,
    ]);

    const accountSummaryProps = {
        tierName: subscription?.productName ?? "Membership unavailable",
        subscriptionStatus: subscription?.status ?? "Status unavailable",
        subscription,
        remoteConfig,
        hasSession,
        deviceId:
            vault.OnlineServices?.DeviceId ?? onlineServicesData?.deviceId,
        userId: vault.OnlineServices?.UserID ?? null,
        onlineServicesBound: bound,
        isConnected: hasSession,
        authStatusDescription: authStatus.statusDescription,
        refreshing: busy || configFetching || subscriptionFetching,
        onRefresh: () => void handleRefresh(),
        onMessage: (text: string) => setMessage({ tone: "error", text }),
        onExternalBillingOpened: () => {
            externalBillingOpenedRef.current = true;
            externalBillingOutcomeRef.current = "resume";
            confirmationRef.current = undefined;
            if (accountSummaryMode === "upgrade") {
                setAccountDetailsOpen(false);
                setAccountSummaryMode("membership");
            }
        },
    };

    return (
        <UnlockedScreen scroll>
            {currentSubscriptionSignup ? (
                <SubscriptionSignup
                    key={vaultGeneration}
                    open={subscriptionSignupOpen}
                    onOpenChange={(open) => {
                        if (!open && bound) {
                            automaticRecoveryStartedRef.current = true;
                        } else if (!open) {
                            setSubscriptionSignupStarted(false);
                        }
                        setSubscriptionSignupOpen(open);
                    }}
                    onExternalBillingOpened={() => {
                        automaticRecoveryStartedRef.current = true;
                        setSubscriptionSignupStarted(false);
                        accountSummaryProps.onExternalBillingOpened();
                    }}
                />
            ) : null}
            <Dialog
                open={accountDetailsOpen}
                onOpenChange={setAccountDetailsOpen}
                placement="bottom"
                scroll
                scrollResetKey={accountSummaryMode}
                loading={
                    accountSummaryMode === "membership" &&
                    accountSummaryProps.refreshing
                }
                loadingLabel="Updating membership…"
            >
                <DialogHeader
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                    }}
                >
                    {accountSummaryMode === "upgrade" ? (
                        <Button
                            variant="ghost"
                            size="icon"
                            accessibilityLabel="Back to membership"
                            onPress={openMembership}
                        >
                            <ArrowLeft size={20} color={colors.foreground} />
                        </Button>
                    ) : null}
                    <DialogTitle>
                        {accountSummaryMode === "membership"
                            ? "Membership"
                            : accountSummaryMode === "upgrade"
                              ? "Online Services"
                              : "Account details"}
                    </DialogTitle>
                </DialogHeader>
                {accountSummaryMode === "membership" &&
                membershipRefreshError &&
                !accountSummaryProps.refreshing ? (
                    <View style={{ gap: 12 }}>
                        <InlineNotice
                            tone="error"
                            message={membershipRefreshError}
                        />
                        <Button
                            variant="outline"
                            onPress={() => {
                                setMessage(null);
                                void handleRefresh();
                            }}
                        >
                            Retry
                        </Button>
                    </View>
                ) : null}
                {accountSummaryMode === "upgrade" ? (
                    <MembershipUpgrade
                        canUpgrade={
                            hasSession && subscription?.nonFree === false
                        }
                        refreshing={accountSummaryProps.refreshing}
                        onMessage={accountSummaryProps.onMessage}
                        onExternalBillingOpened={
                            accountSummaryProps.onExternalBillingOpened
                        }
                    />
                ) : (
                    <AccountSummary
                        {...accountSummaryProps}
                        mode={accountSummaryMode}
                        onOpenUpgrade={openUpgrade}
                    />
                )}
                {accountDetailsOpen && message && !membershipRefreshError ? (
                    <InlineNotice tone={message.tone} message={message.text} />
                ) : null}
            </Dialog>

            {bound && cloudOn ? (
                <AccountSummary
                    {...accountSummaryProps}
                    mode="overview"
                    onOpenMembership={openMembership}
                    onOpenUpgrade={openUpgrade}
                />
            ) : null}

            {bound && cloudOn && !hasSession ? (
                <View style={{ marginTop: 12, gap: 12 }}>
                    <InlineNotice
                        tone={busy ? "loading" : "warning"}
                        message={
                            busy
                                ? "Reconnecting to Online Services…"
                                : "Online Services needs reconnection."
                        }
                    />
                    <Button
                        variant="outline"
                        loading={busy}
                        onPress={() => void handleRefresh()}
                    >
                        Reconnect
                    </Button>
                </View>
            ) : null}

            {!cloudOn ? (
                <Text className="text-sm leading-5 text-muted-foreground">
                    Online Services are unavailable in this app configuration.
                    Your local vault remains available.
                </Text>
            ) : !bound ? (
                <View className="gap-3">
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
                                marginTop: 10,
                                fontSize: 22,
                                fontWeight: "500",
                                letterSpacing: -0.5,
                            }}
                        >
                            Online Services
                        </Text>
                        <Text
                            style={{
                                color: colors.muted,
                                fontSize: 13,
                                lineHeight: 20,
                                marginTop: 6,
                            }}
                        >
                            Add online services when you need them. Your local
                            vault works independently.
                        </Text>
                    </View>
                    <Button onPress={startSubscriptionSignup}>
                        Get Online Services
                    </Button>
                    <Button
                        variant="secondary"
                        onPress={() =>
                            router.push("/(app)/account/auth/recover")
                        }
                    >
                        Recover account
                    </Button>
                </View>
            ) : (
                <View className="gap-4">
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 10,
                            letterSpacing: 1.1,
                            marginTop: 18,
                            marginBottom: 6,
                            textTransform: "uppercase",
                        }}
                    >
                        Your account
                    </Text>
                    <UnlockedMenuRow
                        icon={Shield}
                        title="Recovery & access"
                        subtitle="Recovery Kit and account security"
                        onPress={() => router.push("/(app)/account/security")}
                    />
                    <UnlockedMenuRow
                        icon={Smartphone}
                        title="Online Services devices"
                        subtitle="Account access and vault sync links"
                        onPress={() => router.push("/(app)/(tabs)/devices")}
                    />
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 10,
                            letterSpacing: 1.1,
                            marginTop: 26,
                            marginBottom: 6,
                            textTransform: "uppercase",
                        }}
                    >
                        Account details
                    </Text>
                    <UnlockedMenuRow
                        icon={User}
                        title="Account identifiers"
                        subtitle="User ID and this device"
                        onPress={() => {
                            setAccountSummaryMode("details");
                            setAccountDetailsOpen(true);
                        }}
                    />
                </View>
            )}

            {message && !accountDetailsOpen ? (
                <View className="mt-4">
                    <InlineNotice tone={message.tone} message={message.text} />
                </View>
            ) : null}
        </UnlockedScreen>
    );
}
