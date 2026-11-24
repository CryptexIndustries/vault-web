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
import NetInfo from "@react-native-community/netinfo";
import {
    AccountSummary,
    formatAccountDate,
} from "@/components/account/account-summary";
import { MembershipUpgrade } from "@/components/account/membership-upgrade";
import { SubscriptionSignup } from "@/components/account/subscription-signup";
import { InlineNotice } from "@/components/inline-notice";
import { Snackbar, useSnackbar } from "@/components/snackbar";
import {
    PaymentStatus,
    type PaymentStatusProps,
} from "@/components/account/payment-status";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import {
    establishOnlineServicesSession,
    syncOnlineServicesRemoteConfiguration,
} from "@/app_lib/auth-session";
import {
    type CheckoutTier,
    type ConfirmationRun,
    type PlanTerms,
    confirmMembership,
    confirmationSchedules,
    purchaseMembership,
    restoreStorePurchases,
    startConfirmation,
    storeBilling,
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

/** A checkout in progress; run is set while its confirmation loop runs. */
type Payment = Omit<
    PaymentStatusProps,
    "store" | "compact" | "onPrimary" | "onSecondary"
> & { run?: ConfirmationRun };

/** Paid, held by the store, or unknown after Stripe; these outlive the sheet. */
const awaiting = (payment: Payment | null): payment is Payment =>
    payment?.state === "confirming" ||
    payment?.state === "unconfirmed" ||
    payment?.state === "storePending" ||
    payment?.state === "returned";

export default function AccountScreen() {
    const { t, i18n } = useLingui();
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
    const [paymentState, setPaymentState] = useState<{
        scope: string;
        payment: Payment | null;
    }>({ scope: billingScope, payment: null });
    const payment =
        paymentState.scope === billingScope ? paymentState.payment : null;
    const paymentRef = useRef(payment);
    paymentRef.current = payment;
    const setPayment = useCallback(
        (
            next:
                | Payment
                | null
                | ((current: Payment | null) => Payment | null),
        ) => {
            if (
                isSameActiveVaultSession(vaultGeneration) &&
                billingScopeRef.current === billingScope
            )
                setPaymentState((state) => ({
                    scope: billingScope,
                    payment:
                        typeof next === "function"
                            ? next(
                                  state.scope === billingScope
                                      ? state.payment
                                      : null,
                              )
                            : next,
                }));
        },
        [vaultGeneration, billingScope],
    );
    const busyRef = useRef(busy);
    busyRef.current = busy;
    useEffect(() => {
        busyRef.current = false;
        setBusy(false);
        setPlayBillingBusy(false);
        refreshPromiseRef.current = null;
    }, [billingScope, authFeedbackRevision]);
    const automaticRecoveryStartedRef = useRef(false);
    const externalBillingOpenedRef = useRef(false);
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
                billingOutcome: params.billingOutcome ?? "resume",
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
                billingOutcome: params.billingOutcome ?? "resume",
                billingResume: String(Date.now()),
            });
        }, [params.billingOutcome]),
    );

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
        if (awaiting(payment)) {
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
        payment,
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
        if (subscription?.nonFree)
            setPayment((current) =>
                current && !current.run && awaiting(current) ? null : current,
            );
    }, [subscription?.nonFree, setPayment]);

    const store = storeBilling();
    // Feedback changes with the open sheet; reading it late keeps effects from rerunning.
    const showFeedbackRef = useRef(showFeedback);
    showFeedbackRef.current = showFeedback;
    const panelOpenRef = useRef(false);
    panelOpenRef.current =
        (currentSubscriptionSignup && subscriptionSignupOpen) ||
        (accountDetailsOpen && accountSummaryMode === "upgrade");
    const lastPurchaseRef = useRef<{ tier: CheckoutTier; terms: PlanTerms }>(
        undefined,
    );
    const payingRef = useRef(false);
    const pay = async (tier: CheckoutTier, terms: PlanTerms) => {
        if (payingRef.current) return;
        payingRef.current = true;
        lastPurchaseRef.current = { tier, terms };
        const plan = { tier, trial: terms.trial };
        setPayment({ ...plan, state: "opening" });
        try {
            // The store and Stripe calls refuse a changed account themselves.
            const result = await purchaseMembership(tier, terms, () =>
                setPayment({ ...plan, state: "confirming" }),
            );
            // Stripe Checkout opened in the browser; the return link or coming back to the app settles it.
            if (result.ok && !store) externalBillingOpenedRef.current = true;
            else if (result.ok || "pending" in result) {
                const pending = result.ok ? "sync" : result.pending;
                setPayment(
                    pending === "store"
                        ? { ...plan, state: "storePending" }
                        : {
                              ...plan,
                              state: "confirming",
                              owned: pending === "owned",
                              run: startConfirmation(
                                  confirmationSchedules.store,
                                  pending === "owned" ? "always" : "afterFirst",
                              ),
                          },
                );
            } else if ("offerChanged" in result)
                setPayment({
                    state: "offerChanged",
                    trial: result.offerChanged.trial,
                });
            else if ("canceled" in result)
                setPayment({ ...plan, state: "canceled" });
            else
                setPayment({
                    ...plan,
                    state: "error",
                    message: result.message,
                    retryable: result.retryable !== false,
                });
        } finally {
            payingRef.current = false;
        }
    };
    // Without a purchase in this session, go back to the plan.
    const retryPayment = () =>
        lastPurchaseRef.current
            ? void pay(
                  lastPurchaseRef.current.tier,
                  lastPurchaseRef.current.terms,
              )
            : setPayment(null);
    const check = useCallback(
        () =>
            setPayment((current) =>
                current && !current.run
                    ? {
                          ...current,
                          checking: true,
                          run: startConfirmation(
                              confirmationSchedules.once,
                              store ? "always" : "never",
                          ),
                      }
                    : current,
            ),
        [setPayment, store],
    );
    const onRestored = () =>
        setPayment((current) => ({
            tier: current?.tier,
            state: "confirming",
            owned: true,
            run: startConfirmation(confirmationSchedules.store, "afterFirst"),
        }));
    const restore = async () => {
        setPayment((current) => current && { ...current, checking: true });
        const result = await restoreStorePurchases();
        if (result.ok || "pending" in result) onRestored();
        else if ("message" in result)
            setPayment((current) => ({
                tier: current?.tier,
                state: "error",
                message: result.message,
                retryable: result.retryable !== false,
            }));
        else
            setPayment((current) => current && { ...current, checking: false });
    };
    const dropFinishedPayment = () =>
        setPayment((current) => (awaiting(current) ? current : null));
    const onSignupOpenChange = (open: boolean) => {
        if (!open && bound) {
            automaticRecoveryStartedRef.current = true;
            // Resume signup only while the kit is unsaved;
            // after that, Upgrade uses the normal sheet.
            if (signupKitSavedRef.current) setSubscriptionSignupStarted(false);
        } else if (!open) {
            setSubscriptionSignupStarted(false);
        }
        if (!open) dropFinishedPayment();
        setSubscriptionSignupOpen(open);
    };
    const onDetailsOpenChange = (open: boolean) => {
        if (!open) dropFinishedPayment();
        setAccountDetailsOpen(open);
    };
    const closePanel = () => {
        if (subscriptionSignupOpen) onSignupOpenChange(false);
        onDetailsOpenChange(false);
    };

    useEffect(() => {
        if (
            !focused ||
            appState !== "active" ||
            !params.billingOutcome ||
            !bound ||
            !cloudOn
        )
            return;
        const outcome = params.billingOutcome;
        externalBillingOpenedRef.current = false;
        router.setParams({
            billingOutcome: undefined,
            billingReturn: undefined,
            billingResume: undefined,
        });
        if (outcome === "success") {
            if (!panelOpenRef.current) {
                setAccountSummaryMode("upgrade");
                setAccountDetailsOpen(true);
            }
            setPayment((current) => ({
                tier: current?.tier,
                trial: current?.trial,
                state: "confirming",
                run: startConfirmation(confirmationSchedules.stripe, "never"),
            }));
        } else if (outcome === "cancel" && !paymentRef.current)
            showFeedbackRef.current(
                translate`Payment canceled. Nothing was charged.`,
            );
        else if (outcome === "cancel")
            // A late cancel link never overrides a payment being confirmed.
            setPayment((current) =>
                current?.state === "opening" ||
                (current?.state === "returned" && !current.run)
                    ? { ...current, state: "canceled", checking: false }
                    : current,
            );
        else if (paymentRef.current?.state === "opening")
            setPayment(
                (current) =>
                    current && {
                        ...current,
                        state: "returned",
                        checking: true,
                        run: startConfirmation(
                            confirmationSchedules.returned,
                            "never",
                        ),
                    },
            );
        else void handleRefresh();
    }, [
        focused,
        appState,
        params.billingOutcome,
        params.billingReturn,
        params.billingResume,
        bound,
        cloudOn,
        setPayment,
        handleRefresh,
    ]);

    const run = payment?.run;
    const locale = i18n.locale;
    useEffect(() => {
        // Signing out stops the loop; reconnecting resumes it.
        if (!run || !focused || appState !== "active" || !hasSession) return;
        const controller = new AbortController();
        const slow =
            paymentRef.current?.state === "confirming"
                ? setTimeout(
                      () =>
                          setPayment((current) =>
                              current?.run === run
                                  ? { ...current, slow: true }
                                  : current,
                          ),
                      run.startedAt + 20000 - Date.now(),
                  )
                : undefined;
        void confirmMembership(run, controller.signal).then(async (result) => {
            if (!result || controller.signal.aborted) return;
            const { subscription } = result;
            if (!subscription) {
                setPayment((current) =>
                    current?.run === run
                        ? {
                              ...current,
                              state:
                                  current.state === "confirming"
                                      ? "unconfirmed"
                                      : current.state,
                              checking: false,
                              offline: result.offline,
                              run: undefined,
                          }
                        : current,
                );
                return;
            }
            queryUtils.v1.payment.subscription.setData(undefined, subscription);
            await Promise.all([
                queryUtils.v1.payment.subscription.invalidate(undefined, {
                    refetchType: "none",
                }),
                queryUtils.v1.user.configuration.invalidate(),
                queryUtils.v1.payment.customerPortal.invalidate(),
            ]);
            if (controller.signal.aborted) return;
            const trial = subscription.status === "trialing";
            const date = formatAccountDate(
                locale,
                (trial && subscription.trialEndsAt) || subscription.expiresAt,
            );
            const shown = panelOpenRef.current;
            setPayment((current) =>
                current?.run !== run
                    ? current
                    : shown
                      ? { state: "confirmed", tier: current.tier, trial, date }
                      : null,
            );
            if (!shown)
                showFeedbackRef.current(translate`Your membership is active.`);
        });
        return () => {
            controller.abort();
            clearTimeout(slow);
        };
    }, [run, focused, appState, hasSession, setPayment, queryUtils, locale]);

    // Unconfirmed payments check again on return, at most once a minute.
    const lastReturnCheckRef = useRef(0);
    useEffect(() => {
        const current = paymentRef.current;
        if (
            !focused ||
            appState !== "active" ||
            current?.run ||
            !awaiting(current) ||
            current.state === "confirming" ||
            Date.now() - lastReturnCheckRef.current < 60000
        )
            return;
        lastReturnCheckRef.current = Date.now();
        check();
    }, [focused, appState, check]);

    const awaitingConnection =
        payment?.state === "unconfirmed" && !!payment.offline && !payment.run;
    useEffect(() => {
        if (!awaitingConnection) return;
        let connected = true;
        return NetInfo.addEventListener((state) => {
            if (state.isConnected && !connected) check();
            connected = !!state.isConnected;
        });
    }, [awaitingConnection, check]);

    const paymentPanel =
        payment && payment.state !== "offerChanged" ? (
            <PaymentStatus
                {...payment}
                store={store ?? "stripe"}
                onPrimary={
                    payment.state === "canceled" || payment.state === "error"
                        ? retryPayment
                        : payment.state === "returned" ||
                            (payment.state === "unconfirmed" && !payment.owned)
                          ? check
                          : payment.state === "unconfirmed"
                            ? () => void restore()
                            : closePanel
                }
                onSecondary={
                    payment.state === "returned" ? retryPayment : closePanel
                }
            />
        ) : null;
    const paymentCard = awaiting(payment) ? (
        <PaymentStatus
            {...payment}
            compact
            store={store ?? "stripe"}
            onPrimary={check}
        />
    ) : null;

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
        paymentStatus: paymentCard,
        onRestored,
        onMessage: showFeedback,
        onExternalBillingOpened: () => {
            if (
                billingScopeRef.current !== billingScope ||
                authFeedbackLifetime.current.revision !== authFeedbackRevision
            )
                return;
            externalBillingOpenedRef.current = true;
        },
    };

    return (
        <View style={{ flex: 1 }}>
            <UnlockedScreen scroll>
                {currentSubscriptionSignup ? (
                    <SubscriptionSignup
                        key={vaultGeneration}
                        open={subscriptionSignupOpen}
                        payment={payment}
                        paymentPanel={paymentPanel}
                        onPay={(tier, terms) => void pay(tier, terms)}
                        onRecoveryKitSaved={() => {
                            signupKitSavedRef.current = true;
                        }}
                        onOpenChange={onSignupOpenChange}
                    />
                ) : null}
                <Dialog
                    open={accountDetailsOpen}
                    onOpenChange={onDetailsOpenChange}
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
                    dismissible={
                        !playBillingBusy &&
                        !(store && payment?.state === "opening")
                    }
                    scrollResetKey={accountSummaryMode}
                    loading={
                        accountSummaryMode === "membership" &&
                        accountSummaryProps.refreshing
                    }
                    loadingLabel={t`Updating membership…`}
                >
                    {/* The payment panel's own title names the state. */}
                    {accountSummaryMode === "upgrade" && paymentPanel ? null : (
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
                    )}
                    {accountSummaryMode === "upgrade" ? (
                        (paymentPanel ?? (
                            <MembershipUpgrade
                                key={`${billingScope}:${authFeedbackRevision}:${accountDetailsOpen}`}
                                canUpgrade={
                                    hasSession &&
                                    subscription?.nonFree === false
                                }
                                trialEligible={subscription?.trialEligible}
                                offerTrial={
                                    payment?.state === "offerChanged"
                                        ? payment.trial
                                        : undefined
                                }
                                refreshing={accountSummaryProps.refreshing}
                                onMessage={accountSummaryProps.onMessage}
                                onContinue={(tier, trial) =>
                                    void pay(tier, {
                                        trialEligible:
                                            subscription?.trialEligible ??
                                            false,
                                        trial,
                                    })
                                }
                            />
                        ))
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
