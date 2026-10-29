import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { ArrowLeft, Shield, Smartphone, User } from "lucide-react-native";
import { useAtomValue } from "jotai";
import { t as translate } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";

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
import { Snackbar, useSnackbar } from "@/components/snackbar";
import { BillingPendingNotice } from "@/components/account/billing-pending-notice";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import {
    establishOnlineServicesSession,
    syncOnlineServicesRemoteConfiguration,
} from "@/app_lib/auth-session";
import {
    refreshSubscriptionAfterExternalBilling,
    checkStorePurchaseStatus,
    isGooglePlayBuild,
    type BillingConfirmation,
} from "@/app_lib/online-services-billing";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";
import {
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesAuthStatusLabel,
    onlineServicesDataAtom,
    onlineServicesStore,
    unlockedVaultAtom,
} from "@/utils/atoms";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { trpcReact } from "@/utils/trpc";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { colors } from "@/theme";

export default function AccountScreen() {
    const { t } = useLingui();
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
    const signupOwnerRef = useRef<string | undefined>(undefined);
    const signupKitSavedRef = useRef(false);
    const boundUserId = vault.OnlineServices?.UserID;
    if (subscriptionSignupStarted && !signupOwnerRef.current && boundUserId)
        signupOwnerRef.current = boundUserId;
    const vaultGeneration = getVaultSessionGeneration();
    const currentSubscriptionSignup =
        subscriptionSignupStarted &&
        signupGenerationRef.current === vaultGeneration &&
        (!signupOwnerRef.current || signupOwnerRef.current === boundUserId);
    const [accountSummaryMode, setAccountSummaryMode] = useState<
        "membership" | "details" | "upgrade"
    >("membership");
    const [busy, setBusy] = useState(false);
    const [playBillingBusy, setPlayBillingBusy] = useState(false);
    const refreshPromiseRef = useRef<Promise<void> | null>(null);
    const billingScope = `${vaultGeneration}:${vault.OnlineServices?.UserID ?? "unbound"}:${vault.OnlineServices?.DeviceId ?? ""}`;
    const billingScopeRef = useRef(billingScope);
    billingScopeRef.current = billingScope;
    const authFeedbackLifetime = useRef({ connected: hasSession, revision: 0 });
    if (authFeedbackLifetime.current.connected && !hasSession)
        authFeedbackLifetime.current.revision++;
    authFeedbackLifetime.current.connected = hasSession;
    const authFeedbackRevision = authFeedbackLifetime.current.revision;
    const {
        feedback: billingFeedback,
        show: showFeedback,
        dismiss: dismissFeedback,
    } = useSnackbar(
        `${billingScope}:${authFeedbackRevision}:${accountSummaryMode}:${accountDetailsOpen}`,
        focused && !subscriptionSignupOpen,
    );
    const [pendingState, setPendingState] = useState({
        scope: billingScope,
        pending: false,
    });
    const billingPending =
        pendingState.scope === billingScope && pendingState.pending;
    const setBillingPending = useCallback(
        (pending: boolean) => {
            if (
                isSameActiveVaultSession(vaultGeneration) &&
                billingScopeRef.current === billingScope
            )
                setPendingState({ scope: billingScope, pending });
        },
        [vaultGeneration, billingScope],
    );
    const recordPendingBilling = useCallback(
        (pending: boolean) => {
            if (pending) setBillingPending(true);
        },
        [setBillingPending],
    );
    const statusCheckInFlight = useRef<symbol | null>(null);
    const busyRef = useRef(busy);
    busyRef.current = busy;
    useEffect(() => {
        busyRef.current = false;
        setBusy(false);
        setPlayBillingBusy(false);
        refreshPromiseRef.current = null;
        statusCheckInFlight.current = null;
    }, [billingScope, authFeedbackRevision]);
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
        const scope = billingScope;
        const authRevision = authFeedbackLifetime.current.revision;
        const isCurrent = () =>
            !controller.signal.aborted &&
            isSameActiveVaultSession(generation) &&
            billingScopeRef.current === scope &&
            authFeedbackLifetime.current.revision === authRevision;
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
        dismissFeedback();
        if (outcome === "success") setBillingPending(true);
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
                    if (outcome === "success") setBillingPending(true);
                    else if (outcome !== "cancel")
                        showFeedback(
                            translate`Could not refresh membership. Please try again.`,
                            {
                                label: translate`Check status`,
                                onPress: () =>
                                    router.setParams({
                                        billingOutcome: "resume",
                                        billingReturn: String(Date.now()),
                                    }),
                            },
                        );
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
                if (currentSubscription.nonFree) setBillingPending(false);
                else if (outcome === "success") setBillingPending(true);
            } catch {
                if (isCurrent() && outcome !== "cancel")
                    showFeedback(
                        translate`Could not refresh membership. Please try again.`,
                        {
                            label: translate`Check status`,
                            onPress: () =>
                                router.setParams({
                                    billingOutcome: outcome,
                                    billingReturn: String(Date.now()),
                                }),
                        },
                    );
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
        billingScope,
        dismissFeedback,
        showFeedback,
        setBillingPending,
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
        if (busyRef.current) return Promise.resolve();
        const generation = getVaultSessionGeneration();
        const scope = billingScope;
        const authRevision = authFeedbackLifetime.current.revision;
        const isCurrent = () =>
            isSameActiveVaultSession(generation) &&
            billingScopeRef.current === scope &&
            authFeedbackLifetime.current.revision === authRevision;
        if (!isCurrent()) return Promise.resolve();
        dismissFeedback();
        setBusy(true);
        const promise: Promise<void> = Promise.resolve().then(async () => {
            try {
                if (Vault.isOnlineServicesBound(vault) && !hasSession) {
                    await establishOnlineServicesSession({
                        deviceId: vault.OnlineServices.DeviceId,
                        privateKeyJWK: vault.OnlineServices.PrivateKeyJWK,
                    });
                }
                if (!isCurrent()) return;
                await syncOnlineServicesRemoteConfiguration();
                if (!isCurrent()) return;
                await Promise.all([
                    refetchConfig({ throwOnError: true }),
                    refetchSubscription({ throwOnError: true }),
                ]);
            } catch {
                if (!isCurrent()) return;
                showFeedback(
                    translate`Could not update your membership. Please try again.`,
                    {
                        label: translate`Retry`,
                        onPress: () => {
                            void handleRefresh();
                        },
                    },
                );
            } finally {
                if (refreshPromiseRef.current === promise)
                    refreshPromiseRef.current = null;
                if (isCurrent()) setBusy(false);
            }
        });
        refreshPromiseRef.current = promise;
        return promise;
    }, [
        billingScope,
        vault,
        hasSession,
        refetchConfig,
        refetchSubscription,
        dismissFeedback,
        showFeedback,
    ]);

    const openMembership = useCallback(() => {
        dismissFeedback();
        setAccountSummaryMode("membership");
        setAccountDetailsOpen(true);
    }, [dismissFeedback]);

    const membershipRefreshKeyRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        const key =
            accountDetailsOpen && accountSummaryMode === "membership"
                ? billingScope
                : undefined;
        if (membershipRefreshKeyRef.current === key) return;
        membershipRefreshKeyRef.current = key;
        if (key) void handleRefresh();
    }, [accountDetailsOpen, accountSummaryMode, billingScope, handleRefresh]);

    const startSubscriptionSignup = useCallback(() => {
        signupGenerationRef.current = getVaultSessionGeneration();
        signupOwnerRef.current = vault.OnlineServices?.UserID;
        signupKitSavedRef.current = false;
        setSubscriptionSignupStarted(true);
        setSubscriptionSignupOpen(true);
    }, [vault]);

    const openUpgrade = useCallback(() => {
        if (billingPending) {
            setAccountSummaryMode("membership");
            setAccountDetailsOpen(true);
            return;
        }
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
        dismissFeedback();
        setAccountSummaryMode("upgrade");
        setAccountDetailsOpen(true);
    }, [
        billingPending,
        currentSubscriptionSignup,
        remoteConfig,
        subscription?.nonFree,
        startSubscriptionSignup,
        dismissFeedback,
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

    useEffect(() => {
        if (subscription?.nonFree) setBillingPending(false);
    }, [subscription?.nonFree, setBillingPending]);

    const checkPendingBilling = async () => {
        if (busy || statusCheckInFlight.current || !focused) return;
        const generation = getVaultSessionGeneration();
        const report = showFeedback;
        const scope = billingScope;
        const authRevision = authFeedbackLifetime.current.revision;
        const isCurrent = () =>
            isSameActiveVaultSession(generation) &&
            billingScopeRef.current === scope &&
            authFeedbackLifetime.current.revision === authRevision;
        const request = Symbol();
        statusCheckInFlight.current = request;
        dismissFeedback();
        try {
            if (isGooglePlayBuild()) {
                setBusy(true);
                const result = await checkStorePurchaseStatus();
                if (!isCurrent()) return;
                if (!result.ok) {
                    if (!result.pending)
                        report(result.message, {
                            label: t`Check status`,
                            onPress: checkPendingBilling,
                        });
                    return;
                }
            }
            router.setParams({
                billingOutcome: "success",
                billingReturn: String(Date.now()),
            });
        } catch {
            if (isCurrent())
                report(
                    t`Could not check your subscription. Please try again.`,
                    {
                        label: t`Check status`,
                        onPress: checkPendingBilling,
                    },
                );
        } finally {
            if (statusCheckInFlight.current === request)
                statusCheckInFlight.current = null;
            if (isCurrent()) setBusy(false);
        }
    };

    const accountSummaryProps = {
        tierName: subscription?.productName ?? t`Membership unavailable`,
        subscriptionStatus: subscription?.status ?? "Status unavailable",
        subscription,
        remoteConfig,
        hasSession,
        deviceId:
            vault.OnlineServices?.DeviceId ?? onlineServicesData?.deviceId,
        userId: vault.OnlineServices?.UserID ?? null,
        onlineServicesBound: bound,
        isConnected: hasSession,
        // Failures carry their own message; other labels follow the current language.
        authStatusDescription:
            authStatus.status === "FAILED"
                ? authStatus.statusDescription
                : onlineServicesAuthStatusLabel(authStatus.status),
        refreshing: busy || configFetching || subscriptionFetching,
        onRefresh: () => void handleRefresh(),
        onBillingBusyChange: (value: boolean) => {
            if (
                billingScopeRef.current !== billingScope ||
                authFeedbackLifetime.current.revision !== authFeedbackRevision
            )
                return;
            if (value) dismissFeedback();
            setPlayBillingBusy(value);
        },
        pendingConfirmation: billingPending,
        onPendingChange: recordPendingBilling,
        onMessage: showFeedback,
        onExternalBillingOpened: (
            outcome: "success" | "resume" | "external" = "external",
        ) => {
            if (
                billingScopeRef.current !== billingScope ||
                authFeedbackLifetime.current.revision !== authFeedbackRevision
            )
                return;
            externalBillingOpenedRef.current = outcome === "external";
            externalBillingOutcomeRef.current = "resume";
            if (outcome !== "external")
                router.setParams({
                    billingOutcome: outcome,
                    billingReturn: String(Date.now()),
                });
            confirmationRef.current = undefined;
            if (accountSummaryMode === "upgrade") {
                setAccountDetailsOpen(false);
                setAccountSummaryMode("membership");
            }
        },
    };

    return (
        <View style={{ flex: 1 }}>
            <UnlockedScreen scroll>
                {currentSubscriptionSignup ? (
                    <SubscriptionSignup
                        key={vaultGeneration}
                        open={subscriptionSignupOpen}
                        pendingConfirmation={billingPending}
                        onPendingChange={recordPendingBilling}
                        onRecoveryKitSaved={() => {
                            signupKitSavedRef.current = true;
                        }}
                        onOpenChange={(open) => {
                            if (!open && bound) {
                                automaticRecoveryStartedRef.current = true;
                                // Resume signup only while the kit is unsaved;
                                // after that, Upgrade uses the normal sheet.
                                if (signupKitSavedRef.current)
                                    setSubscriptionSignupStarted(false);
                            } else if (!open) {
                                setSubscriptionSignupStarted(false);
                            }
                            setSubscriptionSignupOpen(open);
                        }}
                        onExternalBillingOpened={(outcome) => {
                            if (
                                billingScopeRef.current !== billingScope ||
                                authFeedbackLifetime.current.revision !==
                                    authFeedbackRevision
                            )
                                return;
                            automaticRecoveryStartedRef.current = true;
                            setSubscriptionSignupStarted(false);
                            accountSummaryProps.onExternalBillingOpened(
                                outcome,
                            );
                        }}
                    />
                ) : null}
                <Dialog
                    open={accountDetailsOpen}
                    onOpenChange={setAccountDetailsOpen}
                    placement="bottom"
                    footer={
                        accountDetailsOpen ? (
                            <Snackbar
                                feedback={billingFeedback}
                                onDismiss={dismissFeedback}
                                floating={false}
                            />
                        ) : null
                    }
                    scroll
                    dismissible={!playBillingBusy}
                    scrollResetKey={accountSummaryMode}
                    loading={
                        accountSummaryMode === "membership" &&
                        accountSummaryProps.refreshing
                    }
                    loadingLabel={
                        billingPending
                            ? t`Confirming your subscription…`
                            : t`Updating membership…`
                    }
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
                                disabled={playBillingBusy}
                                accessibilityLabel={t`Back to membership`}
                                onPress={openMembership}
                            >
                                <ArrowLeft
                                    size={20}
                                    color={colors.foreground}
                                />
                            </Button>
                        ) : null}
                        <DialogTitle>
                            {accountSummaryMode === "membership"
                                ? t`Membership`
                                : accountSummaryMode === "upgrade"
                                  ? "Online Services"
                                  : t`Account details`}
                        </DialogTitle>
                    </DialogHeader>
                    {accountDetailsOpen &&
                    accountSummaryMode === "membership" &&
                    billingPending ? (
                        <BillingPendingNotice
                            busy={busy}
                            onCheckStatus={() => void checkPendingBilling()}
                        />
                    ) : null}
                    {accountSummaryMode === "upgrade" ? (
                        <MembershipUpgrade
                            key={`${billingScope}:${authFeedbackRevision}:${accountDetailsOpen}`}
                            onBillingBusyChange={
                                accountSummaryProps.onBillingBusyChange
                            }
                            canUpgrade={
                                hasSession &&
                                subscription?.nonFree === false &&
                                !billingPending
                            }
                            trialEligible={subscription?.trialEligible}
                            pendingConfirmation={billingPending}
                            onPendingChange={recordPendingBilling}
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
                                    ? t`Reconnecting to Online Services…`
                                    : t`Online Services needs reconnection.`
                            }
                        />
                        <Button
                            variant="outline"
                            loading={busy}
                            onPress={() => void handleRefresh()}
                        >
                            {t({
                                message: "Reconnect",
                                comment: "Button: reconnect to Online Services",
                            })}
                        </Button>
                    </View>
                ) : null}

                {!cloudOn ? (
                    <Text className="text-sm leading-5 text-muted-foreground">
                        {t`Online Services are unavailable in this app configuration. Your local vault remains available.`}
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
                                {/* i18n-ignore: product name */}
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
                                {t`Add online services when you need them. Your local vault works independently.`}
                            </Text>
                        </View>
                        <Button onPress={startSubscriptionSignup}>
                            {t`Get Online Services`}
                        </Button>
                        <Button
                            variant="secondary"
                            onPress={() =>
                                router.push("/(app)/account/auth/recover")
                            }
                        >
                            {t`Recover account`}
                        </Button>
                        <View
                            className="gap-3"
                            style={{
                                marginTop: 18,
                                paddingTop: 22,
                                borderTopWidth: 1,
                                borderTopColor: colors.border,
                            }}
                        >
                            <Text
                                style={{
                                    color: colors.muted,
                                    fontSize: 10,
                                    letterSpacing: 1.1,
                                    textTransform: "uppercase",
                                }}
                            >
                                {t`Already set up on another device?`}
                            </Text>
                            <Text
                                style={{
                                    color: colors.muted,
                                    fontSize: 13,
                                    lineHeight: 20,
                                }}
                            >
                                {t`You don't need a second account. Link this vault to that device instead.`}
                            </Text>
                            <Button
                                variant="secondary"
                                onPress={() => router.push("/link-receive")}
                            >
                                {t`Use invitation`}
                            </Button>
                        </View>
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
                            {t`Your account`}
                        </Text>
                        <UnlockedMenuRow
                            icon={Shield}
                            title={t`Recovery & access`}
                            subtitle={t`Recovery Kit and account security`}
                            onPress={() =>
                                router.push("/(app)/account/security")
                            }
                        />
                        <UnlockedMenuRow
                            icon={Smartphone}
                            title={t`Online Services devices`}
                            subtitle={t`Account access and vault sync links`}
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
                            {t`Account details`}
                        </Text>
                        <UnlockedMenuRow
                            icon={User}
                            title={t`Account identifiers`}
                            subtitle={t`User ID and this device`}
                            onPress={() => {
                                setAccountSummaryMode("details");
                                setAccountDetailsOpen(true);
                            }}
                        />
                    </View>
                )}

                {billingPending &&
                !accountDetailsOpen &&
                !subscriptionSignupOpen ? (
                    <BillingPendingNotice
                        busy={busy}
                        onCheckStatus={() => void checkPendingBilling()}
                    />
                ) : null}
            </UnlockedScreen>
            {!accountDetailsOpen && !subscriptionSignupOpen ? (
                <Snackbar
                    feedback={billingFeedback}
                    onDismiss={dismissFeedback}
                />
            ) : null}
        </View>
    );
}
