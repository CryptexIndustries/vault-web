"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai/react";
import { toast } from "sonner";
import { User } from "lucide-react";

import {
    establishPremiumSession,
    logoutOnlineServicesSession,
    syncOnlineServicesRemoteConfiguration,
} from "@/app_lib/auth-session";
import {
    finalizeCheckoutCompletion,
    refreshCheckoutTrpcCaches,
} from "@/app_lib/online-services";
import {
    generateKeyPair,
    parseJwkFromString,
    privateKeyJwkToString,
    publicKeyJwkToString,
    signChallenge,
} from "@cryptex-industries/vault-core/vault-utils/device-signing-key";
import {
    OnlineServices,
    Vault,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesAuthenticationStatus,
    onlineServicesDataAtom,
    onlineServicesStore,
    setOnlineServicesData,
    unlockedVaultAtom,
} from "@/utils/atoms";
import { trpcReact } from "@/utils/trpc";
import { onlineServicesLog } from "@/utils/logging";
import { MISSING_VAULT_SECRET_ERROR } from "@/utils/vault-session";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { AccountAuth } from "./account-auth";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { removeLocalDeviceRecords } from "../use-device-actions";
import { AccountDevices } from "./account-devices";
import { AccountSecurity } from "./account-security";
import { AccountSummary } from "./account-summary";
import { buildDeviceRelationshipMap } from "./device-topology";
import { RecoveryKitDialog, type RecoveryKitData } from "./recovery-kit-dialog";
import {
    RECOVERY_PHRASE_WORD_COUNT,
    countRecoveryPhraseWords,
    joinRecoveryPhrase,
    splitRecoveryPhraseIntoSlots,
} from "./recovery-kit-utils";
import type { AccountDialogProps, AccountDialogTab, AuthMode } from "./types";
import { useOnlineServicesData } from "@/app_lib/use-online-services-data";
import { PurchaseRegistrationGate } from "@/utils/purchase-onboarding";

export {
    buildDeviceRelationshipMap,
    formatRelativeAccountDate,
    formatSyncId,
} from "./device-topology";
export type { AccountDialogProps } from "./types";

type AccountVaultMutation = (currentVault: Vault) => Vault | Promise<Vault>;
type RegistrationKeyPair = { publicKey: string; privateKey: string };
type PendingRegistration = {
    deviceId: string;
    userId: string;
    publicKey: string;
    privateKey: string;
    bound: boolean;
};

async function persistAccountMutation(mutate: AccountVaultMutation) {
    const result = await persistVaultMutation(
        "vault.account",
        async (currentVault) => ({
            vault: await mutate(currentVault),
            result: undefined,
        }),
    );
    if (result.isOk()) return true;

    if (result.error === "VAULT_DEK_NOT_FOUND") {
        toast.error(MISSING_VAULT_SECRET_ERROR);
    } else if (result.error === "VAULT_METADATA_MISSING") {
        toast.error("Vault metadata is unavailable.");
    } else {
        toast.error("Failed to save vault.");
    }
    return false;
}

export function AccountDialog({
    open,
    onOpenChange,
    purchasePlan,
    onPurchaseConsumed,
    onRegistered,
    deviceControls,
    deviceRequest,
}: AccountDialogProps) {
    const vault = useAtomValue(unlockedVaultAtom);
    const onlineServicesData = useOnlineServicesData();
    const onlineServicesBound = Vault.isOnlineServicesBound(vault);
    const hasSession =
        isCloudServicesEnabled() && !!onlineServicesData?.sessionToken?.length;

    const [accountTab, setAccountTab] = useState<AccountDialogTab>("account");
    const [devicesExpanded, setDevicesExpanded] = useState(false);
    useEffect(() => {
        if (open && deviceRequest)
            setAccountTab(deviceRequest.tab ?? "devices");
    }, [open, deviceRequest]);
    useEffect(() => {
        if (!open) setDevicesExpanded(false);
    }, [open]);
    const [authMode, setAuthMode] = useState<AuthMode>("register");
    const [registerCaptcha, setRegisterCaptcha] = useState("");
    const [registerChallengeKey, setRegisterChallengeKey] = useState(0);
    const [registrationRetryRequired, setRegistrationRetryRequired] =
        useState(false);
    const [registrationSetupError, setRegistrationSetupError] = useState(false);
    const [registrationSetupPending, setRegistrationSetupPending] =
        useState(false);
    const [recoveryRetryNeeded, setRecoveryRetryNeeded] = useState(false);
    const [purchaseRecovery, setPurchaseRecovery] = useState<
        "existing" | "needed" | "saved"
    >("existing");
    const [recoverCaptcha, setRecoverCaptcha] = useState("");
    const [recoverUserId, setRecoverUserId] = useState("");
    const [recoverPhrase, setRecoverPhrase] = useState("");
    const [removeLocalBindingOpen, setRemoveLocalBindingOpen] = useState(false);
    const [removeLocalBindingPending, setRemoveLocalBindingPending] =
        useState(false);
    const [recoveryKit, setRecoveryKit] = useState<RecoveryKitData | null>(
        null,
    );
    const [recoveryKitOpen, setRecoveryKitOpen] = useState(false);
    const [recoveryKitFromRegistration, setRecoveryKitFromRegistration] =
        useState(false);
    const [rotateRecoveryOpen, setRotateRecoveryOpen] = useState(false);
    const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
    const [deleteAccountPending, setDeleteAccountPending] = useState(false);

    const registerMut = trpcReact.v1.auth.register.useMutation();
    const recoverMut = trpcReact.v1.auth.recover.useMutation();
    const deleteUserMut = trpcReact.v1.user.delete.useMutation();
    const deleteChallengeMut = trpcReact.v1.user.deleteChallenge.useMutation();
    const genRecoveryMut =
        trpcReact.v1.user.generateRecoveryToken.useMutation();
    const rotateRecoveryMut =
        trpcReact.v1.user.rotateRecoveryToken.useMutation();

    const checkoutFinalizeAbortRef = useRef<AbortController | null>(null);
    const recoveryGenerationStartedRef = useRef(false);
    const recoveryOperationInFlightRef = useRef(false);
    const registrationGateRef = useRef(new PurchaseRegistrationGate());
    const bindingInFlightRef = useRef(false);
    const purchaseActiveRef = useRef(false);
    const registrationKeyPairRef = useRef<RegistrationKeyPair | null>(null);
    const pendingRegistrationRef = useRef<PendingRegistration | null>(null);

    useEffect(() => {
        purchaseActiveRef.current = !!(open && purchasePlan);
        if (open && purchasePlan) registrationGateRef.current.activate();
    }, [open, purchasePlan]);

    const changeOpen = (nextOpen: boolean) => {
        if (!nextOpen) {
            purchaseActiveRef.current = false;
            registrationGateRef.current.cancel();
        }
        onOpenChange(nextOpen);
    };

    useEffect(() => {
        if (!open) {
            checkoutFinalizeAbortRef.current?.abort();
            checkoutFinalizeAbortRef.current = null;
            setRecoveryKit(null);
            setRecoveryKitOpen(false);
            setRecoveryKitFromRegistration(false);
        }
    }, [open]);

    const showRecoveryKit = (
        data: RecoveryKitData,
        options?: { fromRegistration?: boolean },
    ) => {
        setRecoveryKit(data);
        setRecoveryKitOpen(true);
        setRecoveryKitFromRegistration(options?.fromRegistration ?? false);
    };

    const completeRecoveryKit = () => {
        setRecoveryKitOpen(false);
        setRecoveryKit(null);
        if (recoveryKitFromRegistration) {
            toast.success("Account registered. Recovery Kit saved.");
            setRecoveryKitFromRegistration(false);
            if (purchaseActiveRef.current) setPurchaseRecovery("saved");
        }
    };

    const recoveryGenerationNeeded =
        onlineServicesData?.remoteData?.recoveryGenerationNeeded === true;

    const {
        data: remoteConfig,
        refetch: refetchConfig,
        isFetching: configLoading,
        isError: configError,
    } = trpcReact.v1.user.configuration.useQuery(undefined, {
        enabled: hasSession && open,
    });

    const recoveryPhraseAlreadyOnServer =
        remoteConfig !== undefined
            ? !!remoteConfig.recoveryTokenCreatedAt
            : !!onlineServicesData?.remoteData?.recoveryTokenCreatedAt;

    const {
        data: subscription,
        isFetchedAfterMount: subscriptionFetchedAfterMount,
        isFetching: subscriptionFetching,
        isError: subscriptionError,
    } = trpcReact.v1.payment.subscription.useQuery(undefined, {
        enabled: open && hasSession && !!onlineServicesData?.remoteData,
        refetchOnMount: "always",
    });

    const trpcUtils = trpcReact.useUtils();

    const {
        data: linkedDeviceTopology,
        refetch: refetchDeviceTopology,
        isFetching: topologyLoading,
        isError: topologyError,
        isSuccess: topologySuccess,
    } = trpcReact.v1.device.topology.useQuery(undefined, {
        enabled:
            open &&
            hasSession &&
            !!remoteConfig?.root &&
            !!onlineServicesData?.remoteData,
    });

    const removeDevice = trpcReact.v1.device.remove.useMutation({
        onMutate: (input) => ({
            localIds:
                deviceRelationshipMap.nodes
                    .find((n) => n.serverId === input.id)
                    ?.localDevices.map((d) => d.ID) ?? [],
        }),
        onSuccess: async (_, _input, context) => {
            // Keep the pre-request matches even if topology refreshes while removal is pending.
            const ids = context?.localIds ?? [];
            try {
                if (ids.length) await removeLocalDeviceRecords(ids);
                toast.success("Device removed from Online Services.");
            } catch (error) {
                toast.error(
                    `Account device removed. ${error instanceof Error ? error.message : "Remove the remaining saved links from device details."}`,
                );
            } finally {
                await Promise.all([
                    trpcUtils.v1.device.invalidate(),
                    trpcUtils.v1.payment.subscription.invalidate(),
                ]);
            }
        },
        onError: (error) =>
            toast.error(
                error.message || "Could not remove the account device.",
            ),
    });
    const setRootDevice = trpcReact.v1.device.setRoot.useMutation({
        onSuccess: async () => {
            try {
                await Promise.all([
                    trpcUtils.v1.device.invalidate(),
                    syncOnlineServicesRemoteConfiguration(),
                    refetchConfig(),
                ]);
                toast.success("Root access updated.");
            } catch {
                toast.error(
                    "Root access changed, but account information could not be refreshed. Refresh to verify the current permissions.",
                );
            }
        },
        onError: (error) =>
            toast.error(error.message || "Could not update root access."),
    });

    const persistSessionAndRefresh = async () => {
        await syncOnlineServicesRemoteConfiguration();
        await refetchConfig();
    };

    const finishRegistration = async () => {
        const binding = pendingRegistrationRef.current;
        if (!binding) return;
        if (bindingInFlightRef.current) return;
        bindingInFlightRef.current = true;
        setRegistrationSetupPending(true);
        try {
            if (!binding.bound) {
                const saved = await persistAccountMutation((currentVault) => {
                    const next = Object.assign(new Vault(), currentVault);
                    Vault.bindOnlineServices(
                        next,
                        new OnlineServices(
                            binding.deviceId,
                            binding.userId,
                            binding.publicKey,
                            binding.privateKey,
                        ),
                    );
                    return next;
                });
                if (!saved) {
                    setRegistrationSetupError(true);
                    return;
                }
                binding.bound = true;
                onRegistered();
            }
            setOnlineServicesData({
                deviceId: binding.deviceId,
                sessionToken: null,
                sessionExpiresAt: null,
                remoteData: null,
            });
            await establishPremiumSession({
                deviceId: binding.deviceId,
                privateKeyJWK: binding.privateKey,
            });
            await persistSessionAndRefresh();
            pendingRegistrationRef.current = null;
            setRegistrationSetupError(false);
            if (purchasePlan && !purchaseActiveRef.current) return;
            await createRecoveryPackage("generate", "registration");
        } catch (error) {
            setRegistrationSetupError(true);
            onlineServicesLog.error("Could not finish account setup", {
                error,
            });
            toast.error(
                "Account created, but setup did not finish. Retry account setup.",
            );
        } finally {
            bindingInFlightRef.current = false;
            setRegistrationSetupPending(false);
        }
    };

    const handleRegister = async (captchaToken = registerCaptcha) => {
        if (onlineServicesBound) return;
        if (!captchaToken.trim()) {
            toast.error("Complete the captcha.");
            return;
        }
        if (!registrationGateRef.current.start(captchaToken, !!purchasePlan))
            return;
        setRegisterCaptcha("");
        try {
            // Reuse the public key so the API's unique constraint rejects a
            // retry if the first request succeeded but its response was lost.
            let keys = registrationKeyPairRef.current;
            if (!keys) {
                const { publicKey, privateKey } = await generateKeyPair();
                keys = {
                    publicKey: publicKeyJwkToString(publicKey),
                    privateKey: privateKeyJwkToString(privateKey),
                };
                registrationKeyPairRef.current = keys;
            }

            const { deviceId: serverDeviceId, userId } =
                await registerMut.mutateAsync({
                    publicKeyJWK: keys.publicKey,
                    captchaToken,
                });
            registrationGateRef.current.markRegistered();
            if (purchasePlan) setPurchaseRecovery("needed");
            pendingRegistrationRef.current = {
                deviceId: serverDeviceId,
                userId,
                publicKey: keys.publicKey,
                privateKey: keys.privateKey,
                bound: false,
            };
            registrationKeyPairRef.current = null;
            await finishRegistration();
        } catch (e) {
            onlineServicesLog.error(
                "Online Services account registration failed",
                { error: e },
            );
            toast.error(
                e instanceof Error ? e.message : "Registration failed.",
            );
            if (purchasePlan && purchaseActiveRef.current) {
                setRegistrationRetryRequired(true);
            } else if (!purchasePlan) {
                setRegisterChallengeKey((key) => key + 1);
            }
        } finally {
            registrationGateRef.current.finish();
        }
    };

    const handleRecover = async () => {
        if (!recoverCaptcha.trim()) {
            toast.error("Complete the captcha.");
            return;
        }
        if (!recoverUserId.trim() || !recoverPhrase.trim()) {
            toast.error("User ID and recovery phrase are required.");
            return;
        }
        const normalizedPhrase = joinRecoveryPhrase(
            splitRecoveryPhraseIntoSlots(recoverPhrase),
        );
        if (
            countRecoveryPhraseWords(normalizedPhrase) !==
            RECOVERY_PHRASE_WORD_COUNT
        ) {
            toast.error(
                `Recovery phrase must be exactly ${RECOVERY_PHRASE_WORD_COUNT} words.`,
            );
            return;
        }
        try {
            const { publicKey, privateKey } = await generateKeyPair();
            const pub = publicKeyJwkToString(publicKey);
            const priv = privateKeyJwkToString(privateKey);

            const { deviceId: serverDeviceId } = await recoverMut.mutateAsync({
                userId: recoverUserId.trim(),
                recoveryPhrase: normalizedPhrase,
                newPublicKeyJWK: pub,
                captchaToken: recoverCaptcha,
            });

            if (
                await persistAccountMutation((currentVault) => {
                    const next = Object.assign(new Vault(), currentVault);
                    Vault.bindOnlineServices(
                        next,
                        new OnlineServices(
                            serverDeviceId,
                            recoverUserId,
                            pub,
                            priv,
                        ),
                    );
                    return next;
                })
            ) {
                setOnlineServicesData({
                    deviceId: serverDeviceId,
                    sessionToken: null,
                    sessionExpiresAt: null,
                    remoteData: null,
                });
                await establishPremiumSession({
                    deviceId: serverDeviceId,
                    privateKeyJWK: priv,
                });
                await persistSessionAndRefresh();
                toast.success("Account recovered. Sign-in refreshed.");
                setRecoverCaptcha("");
                setRecoverPhrase("");
            }
        } catch (e) {
            onlineServicesLog.error("Online Services account recovery failed", {
                userId: recoverUserId.trim(),
                error: e,
            });
            toast.error(e instanceof Error ? e.message : "Recovery failed.");
        }
    };

    const handleRemoveLocalBinding = async () => {
        setRemoveLocalBindingPending(true);
        try {
            await logoutOnlineServicesSession();

            if (
                await persistAccountMutation((currentVault) => {
                    const next = Object.assign(new Vault(), currentVault);
                    Vault.unbindOnlineServices(next);
                    return next;
                })
            ) {
                toast.success(
                    "Local account binding removed. You can register again or recover with a phrase.",
                );
                setRemoveLocalBindingOpen(false);
            }
        } catch (e) {
            onlineServicesLog.error(
                "Failed to remove local Online Services binding",
                {
                    deviceId: vault.OnlineServices?.DeviceId,
                    error: e,
                },
            );
            toast.error(
                e instanceof Error
                    ? e.message
                    : "Failed to remove local binding.",
            );
        } finally {
            setRemoveLocalBindingPending(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (!remoteConfig?.root) {
            toast.error("Only the root device can delete the account.");
            return;
        }
        if (!Vault.isOnlineServicesBound(vault)) {
            toast.error("Online Services binding required.");
            return;
        }

        setDeleteAccountPending(true);
        try {
            const challenge = await deleteChallengeMut.mutateAsync();
            const challengeBytes = Uint8Array.fromBase64(challenge.challenge);
            const signature = await signChallenge(
                parseJwkFromString(vault.OnlineServices.PrivateKeyJWK),
                challengeBytes,
            );

            await deleteUserMut.mutateAsync({
                challengeId: challenge.challengeId,
                signature,
            });

            if (
                await persistAccountMutation((currentVault) => {
                    const next = Object.assign(new Vault(), currentVault);
                    Vault.unbindOnlineServices(next);
                    return next;
                })
            ) {
                onlineServicesStore.set(onlineServicesDataAtom, null);
                onlineServicesStore.set(
                    onlineServicesAuthConnectionStatusAtom,
                    onlineServicesAuthenticationStatus.disconnected(),
                );
                toast.success("Account deleted.");
                setDeleteAccountOpen(false);
                onOpenChange(false);
            }
        } catch (e) {
            onlineServicesLog.error("Online Services account deletion failed", {
                deviceId: vault.OnlineServices?.DeviceId,
                root: remoteConfig?.root ?? false,
                error: e,
            });
            toast.error(e instanceof Error ? e.message : "Delete failed.");
        } finally {
            setDeleteAccountPending(false);
        }
    };

    const createRecoveryPackage = async (
        mode: "generate" | "rotate" = "generate",
        origin: "account" | "registration" = "account",
    ) => {
        if (recoveryOperationInFlightRef.current) return;
        recoveryOperationInFlightRef.current = true;
        try {
            const res =
                mode === "rotate"
                    ? await rotateRecoveryMut.mutateAsync()
                    : await genRecoveryMut.mutateAsync();
            if (mode === "rotate") setRotateRecoveryOpen(false);
            setRecoveryRetryNeeded(false);
            showRecoveryKit(
                { userId: res.userId, recoveryPhrase: res.token },
                { fromRegistration: origin === "registration" },
            );
            void Promise.all([
                syncOnlineServicesRemoteConfiguration(),
                refetchConfig(),
            ]).catch((error) =>
                onlineServicesLog.error("Could not refresh recovery status", {
                    error,
                }),
            );
        } catch (e) {
            if (
                origin === "registration" &&
                purchasePlan &&
                purchaseActiveRef.current
            ) {
                setRecoveryRetryNeeded(true);
                toast.error("Account created. Recovery Kit generation failed.");
            } else if (origin === "registration") {
                toast.success(
                    "Account registered. Generate a recovery phrase in Security.",
                );
            } else {
                toast.error(
                    e instanceof Error
                        ? e.message
                        : mode === "rotate"
                          ? "Could not rotate the Recovery Kit."
                          : "Could not generate a Recovery Kit.",
                );
            }
        } finally {
            recoveryOperationInFlightRef.current = false;
        }
    };

    useEffect(() => {
        if (
            !open ||
            !hasSession ||
            !recoveryGenerationNeeded ||
            !!purchasePlan ||
            purchaseRecovery !== "existing"
        ) {
            recoveryGenerationStartedRef.current = false;
            return;
        }
        if (recoveryKitOpen || recoveryGenerationStartedRef.current) {
            return;
        }
        recoveryGenerationStartedRef.current = true;
        void createRecoveryPackage();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        open,
        hasSession,
        recoveryGenerationNeeded,
        recoveryKitOpen,
        purchasePlan,
        purchaseRecovery,
    ]);

    const busy =
        registerMut.isPending ||
        recoverMut.isPending ||
        deleteUserMut.isPending ||
        deleteChallengeMut.isPending ||
        removeLocalBindingPending;

    const tierName = subscription?.nonFree ? "Online Services" : "Free";
    const subscriptionStatus = subscription?.status ?? "No active subscription";
    const currentServerDeviceId =
        vault.OnlineServices?.DeviceId ?? onlineServicesData?.deviceId;
    const userId = vault.OnlineServices?.UserID ?? null;
    const isConnected = hasSession;
    const isRoot = hasSession && !!remoteConfig?.root;

    const deviceRelationshipMap = useMemo(
        () =>
            buildDeviceRelationshipMap(
                isRoot &&
                    linkedDeviceTopology?.devices.some(
                        (d) => d.id === currentServerDeviceId,
                    )
                    ? linkedDeviceTopology
                    : undefined,
                vault.LinkedDevices?.Devices ?? [],
                currentServerDeviceId,
                {
                    topologyVerified:
                        isRoot &&
                        topologySuccess &&
                        !topologyError &&
                        !topologyLoading,
                    currentRoot: isRoot,
                },
            ),
        [
            currentServerDeviceId,
            isRoot,
            topologySuccess,
            topologyError,
            topologyLoading,
            linkedDeviceTopology,
            vault.LinkedDevices?.Devices,
        ],
    );

    const isDevicesTab = accountTab === "devices";

    const handleCheckoutComplete = async () => {
        checkoutFinalizeAbortRef.current?.abort();
        const controller = new AbortController();
        checkoutFinalizeAbortRef.current = controller;

        await finalizeCheckoutCompletion({
            signal: controller.signal,
            onSynced: async () => {
                await refreshCheckoutTrpcCaches(trpcUtils);
            },
        });
    };

    return (
        <>
            <Dialog open={open} onOpenChange={changeOpen}>
                <DialogContent
                    className={cn(
                        "grid max-h-[min(90vh,100dvh)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0",
                        isDevicesTab
                            ? devicesExpanded
                                ? "h-[95dvh] w-[96vw] max-w-none sm:max-w-none"
                                : "h-[90dvh] sm:max-w-5xl"
                            : "sm:max-w-2xl",
                    )}
                >
                    <DialogHeader className="border-b border-border px-6 py-4">
                        <DialogTitle className="flex items-center gap-2">
                            <User className="h-5 w-5" />
                            Account
                        </DialogTitle>
                        <DialogDescription>
                            {onlineServicesBound
                                ? "Manage your Online Services plan, devices, and security."
                                : "Sign in to Online Services for sync and billing."}
                        </DialogDescription>
                    </DialogHeader>

                    <div
                        className={cn(
                            "min-h-0 overflow-y-auto overscroll-contain px-6 py-4",
                            isDevicesTab && "lg:overflow-hidden",
                        )}
                    >
                        <Tabs
                            value={accountTab}
                            onValueChange={(value) =>
                                setAccountTab(value as AccountDialogTab)
                            }
                            className={cn(
                                "w-full",
                                isDevicesTab &&
                                    "flex min-h-0 flex-col lg:h-full",
                            )}
                        >
                            <TabsList className="mb-4 grid h-auto min-h-9 w-full shrink-0 grid-cols-3">
                                <TabsTrigger
                                    value="account"
                                    disabled={!isCloudServicesEnabled()}
                                >
                                    Account
                                </TabsTrigger>
                                <TabsTrigger value="devices">
                                    Devices
                                </TabsTrigger>
                                <TabsTrigger
                                    value="security"
                                    disabled={!onlineServicesBound}
                                >
                                    Security
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="account">
                                {registrationSetupError &&
                                    pendingRegistrationRef.current && (
                                        <div className="mb-4 space-y-2 rounded-md border border-amber-500 p-3 text-sm">
                                            <p>
                                                Your Online Services account was
                                                created, but setup didn&apos;t
                                                finish. You can keep using this
                                                vault.
                                            </p>
                                            <Button
                                                onClick={() =>
                                                    void finishRegistration()
                                                }
                                                disabled={
                                                    registrationSetupPending
                                                }
                                            >
                                                Retry account setup
                                            </Button>
                                        </div>
                                    )}
                                {onlineServicesBound ? (
                                    <>
                                        {recoveryRetryNeeded &&
                                            purchasePlan && (
                                                <div className="mb-4 space-y-2 rounded-md border border-amber-500 p-3 text-sm">
                                                    <p>
                                                        We couldn&apos;t
                                                        generate your Recovery
                                                        Kit. Retry and save it
                                                        before checkout.
                                                    </p>
                                                    <Button
                                                        onClick={() =>
                                                            void createRecoveryPackage(
                                                                "generate",
                                                                "registration",
                                                            )
                                                        }
                                                        disabled={
                                                            genRecoveryMut.isPending
                                                        }
                                                    >
                                                        Retry Recovery Kit
                                                    </Button>
                                                </div>
                                            )}
                                        <AccountSummary
                                            tierName={tierName}
                                            subscriptionStatus={
                                                subscriptionStatus
                                            }
                                            subscription={subscription}
                                            subscriptionReady={
                                                subscriptionFetchedAfterMount &&
                                                !subscriptionFetching &&
                                                !subscriptionError
                                            }
                                            remoteConfig={remoteConfig}
                                            hasSession={hasSession}
                                            deviceId={currentServerDeviceId}
                                            userId={userId}
                                            onlineServicesBound={
                                                onlineServicesBound
                                            }
                                            isConnected={isConnected}
                                            onCheckoutComplete={() =>
                                                void handleCheckoutComplete()
                                            }
                                            checkoutPlan={
                                                purchaseRecovery === "needed"
                                                    ? null
                                                    : purchasePlan
                                            }
                                            checkoutBlocked={
                                                !!purchasePlan &&
                                                purchaseRecovery === "needed"
                                            }
                                            onPurchaseHandled={
                                                onPurchaseConsumed
                                            }
                                        />
                                    </>
                                ) : pendingRegistrationRef.current ? null : (
                                    <AccountAuth
                                        authMode={authMode}
                                        onAuthModeChange={setAuthMode}
                                        registerCaptcha={registerCaptcha}
                                        onRegisterCaptcha={(token) => {
                                            if (purchasePlan) {
                                                if (
                                                    token &&
                                                    purchaseActiveRef.current &&
                                                    registrationGateRef.current.canAutoRegister()
                                                ) {
                                                    void handleRegister(token);
                                                }
                                            } else {
                                                setRegisterCaptcha(token);
                                            }
                                        }}
                                        recoverCaptcha={recoverCaptcha}
                                        onRecoverCaptcha={setRecoverCaptcha}
                                        recoverUserId={recoverUserId}
                                        onRecoverUserIdChange={setRecoverUserId}
                                        recoverPhrase={recoverPhrase}
                                        onRecoverPhraseChange={setRecoverPhrase}
                                        onRegister={() => void handleRegister()}
                                        onRecover={() => void handleRecover()}
                                        registerPending={registerMut.isPending}
                                        recoverPending={recoverMut.isPending}
                                        busy={busy}
                                        purchaseAutoRegister={!!purchasePlan}
                                        registrationRetryRequired={
                                            registrationRetryRequired
                                        }
                                        registerChallengeKey={
                                            registerChallengeKey
                                        }
                                        onRetryRegistration={() => {
                                            setRegistrationRetryRequired(false);
                                            if (
                                                registrationGateRef.current.retryWithFreshVerification()
                                            ) {
                                                setRegisterChallengeKey(
                                                    (key) => key + 1,
                                                );
                                            }
                                        }}
                                    />
                                )}
                            </TabsContent>

                            <TabsContent
                                value="devices"
                                className="min-h-0 lg:flex-1"
                            >
                                <AccountDevices
                                    map={deviceRelationshipMap}
                                    controls={deviceControls}
                                    selectedLocalId={deviceRequest?.localId}
                                    selectionToken={deviceRequest?.token}
                                    requestedSection={deviceRequest?.section}
                                    isRoot={isRoot}
                                    canPromote={
                                        !!remoteConfig?.canPromoteDevices
                                    }
                                    busy={
                                        removeDevice.isPending ||
                                        setRootDevice.isPending
                                    }
                                    loading={configLoading || topologyLoading}
                                    error={configError || topologyError}
                                    hasSession={hasSession}
                                    onRefresh={() => {
                                        void refetchConfig();
                                        if (isRoot)
                                            void refetchDeviceTopology();
                                    }}
                                    expanded={devicesExpanded}
                                    onExpand={() =>
                                        setDevicesExpanded((v) => !v)
                                    }
                                    onRemove={async (id) => {
                                        if (isRoot)
                                            await removeDevice.mutateAsync({
                                                id,
                                            });
                                    }}
                                    onToggleRoot={async (id, root) => {
                                        if (isRoot)
                                            await setRootDevice.mutateAsync({
                                                id,
                                                root,
                                            });
                                    }}
                                />
                            </TabsContent>

                            <TabsContent value="security">
                                <AccountSecurity
                                    isRoot={isRoot}
                                    onlineServicesBound={onlineServicesBound}
                                    busy={busy}
                                    recoveryPhraseAlreadyOnServer={
                                        recoveryPhraseAlreadyOnServer
                                    }
                                    genRecoveryPending={
                                        genRecoveryMut.isPending
                                    }
                                    rotateRecoveryPending={
                                        rotateRecoveryMut.isPending
                                    }
                                    onGenerateRecovery={() =>
                                        void createRecoveryPackage()
                                    }
                                    onRotateRecovery={() =>
                                        setRotateRecoveryOpen(true)
                                    }
                                    onRemoveLocalBinding={() => {
                                        setRemoveLocalBindingOpen(true);
                                    }}
                                    onDeleteAccount={() =>
                                        setDeleteAccountOpen(true)
                                    }
                                />
                            </TabsContent>
                        </Tabs>
                    </div>
                </DialogContent>
            </Dialog>

            <RecoveryKitDialog
                key={
                    recoveryKit
                        ? `${recoveryKit.userId}:${recoveryKit.recoveryPhrase}`
                        : "recovery-kit-closed"
                }
                open={recoveryKitOpen}
                kit={recoveryKit}
                onComplete={completeRecoveryKit}
            />

            <AlertDialog
                open={rotateRecoveryOpen}
                onOpenChange={setRotateRecoveryOpen}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Rotate recovery package?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This invalidates every previous Recovery Kit and any
                            active backup recovery session. You must save the
                            new package before continuing.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel
                            disabled={rotateRecoveryMut.isPending}
                        >
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            variant="destructive"
                            disabled={rotateRecoveryMut.isPending}
                            onClick={() => void createRecoveryPackage("rotate")}
                        >
                            Rotate package
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={removeLocalBindingOpen}
                onOpenChange={setRemoveLocalBindingOpen}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Remove local account binding?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This removes the device signing keys stored in this
                            vault and clears your local session. It does not
                            delete a server-side account.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={removeLocalBindingPending}>
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            variant="destructive"
                            disabled={removeLocalBindingPending}
                            onClick={() => void handleRemoveLocalBinding()}
                        >
                            Remove binding
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={deleteAccountOpen}
                onOpenChange={setDeleteAccountOpen}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete account?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This permanently removes the server account. Root
                            device only. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteAccountPending}>
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            variant="destructive"
                            disabled={deleteAccountPending}
                            onClick={() => void handleDeleteAccount()}
                        >
                            Delete account
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
