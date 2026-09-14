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

export {
    buildDeviceRelationshipMap,
    formatRelativeAccountDate,
    formatSyncId,
} from "./device-topology";
export type { AccountDialogProps } from "./types";

type AccountVaultMutation = (currentVault: Vault) => Vault | Promise<Vault>;

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

    const { data: subscription } = trpcReact.v1.payment.subscription.useQuery(
        undefined,
        {
            enabled: open && hasSession && !!onlineServicesData?.remoteData,
        },
    );

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

    const handleRegister = async () => {
        if (!registerCaptcha.trim()) {
            toast.error("Complete the captcha.");
            return;
        }
        try {
            const { publicKey, privateKey } = await generateKeyPair();
            const pub = publicKeyJwkToString(publicKey);
            const priv = privateKeyJwkToString(privateKey);

            const { deviceId: serverDeviceId, userId } =
                await registerMut.mutateAsync({
                    publicKeyJWK: pub,
                    captchaToken: registerCaptcha,
                });

            if (
                await persistAccountMutation((currentVault) => {
                    const next = Object.assign(new Vault(), currentVault);
                    Vault.bindOnlineServices(
                        next,
                        new OnlineServices(serverDeviceId, userId, pub, priv),
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
                setRegisterCaptcha("");
                try {
                    const recovery = await genRecoveryMut.mutateAsync();
                    await refetchConfig();
                    showRecoveryKit(
                        {
                            userId: recovery.userId,
                            recoveryPhrase: recovery.token,
                        },
                        { fromRegistration: true },
                    );
                } catch (recoveryError) {
                    onlineServicesLog.error(
                        "Recovery phrase generation failed after registration",
                        { error: recoveryError },
                    );
                    toast.success(
                        "Account registered. Generate a recovery phrase in Security.",
                    );
                }
            }
        } catch (e) {
            onlineServicesLog.error(
                "Online Services account registration failed",
                { error: e },
            );
            toast.error(
                e instanceof Error ? e.message : "Registration failed.",
            );
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
    ) => {
        try {
            const res =
                mode === "rotate"
                    ? await rotateRecoveryMut.mutateAsync()
                    : await genRecoveryMut.mutateAsync();
            if (mode === "rotate") setRotateRecoveryOpen(false);
            showRecoveryKit({
                userId: res.userId,
                recoveryPhrase: res.token,
            });
            await Promise.all([
                syncOnlineServicesRemoteConfiguration(),
                refetchConfig(),
            ]);
        } catch (e) {
            toast.error(
                e instanceof Error
                    ? e.message
                    : mode === "rotate"
                      ? "Could not rotate the Recovery Kit."
                      : "Could not generate a Recovery Kit.",
            );
        }
    };

    useEffect(() => {
        if (!hasSession || !recoveryGenerationNeeded) {
            recoveryGenerationStartedRef.current = false;
            return;
        }
        if (recoveryKitOpen || recoveryGenerationStartedRef.current) {
            return;
        }
        recoveryGenerationStartedRef.current = true;
        void createRecoveryPackage();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasSession, recoveryGenerationNeeded, recoveryKitOpen]);

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
            <Dialog open={open} onOpenChange={onOpenChange}>
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
                                {onlineServicesBound ? (
                                    <AccountSummary
                                        tierName={tierName}
                                        subscriptionStatus={subscriptionStatus}
                                        subscription={subscription}
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
                                    />
                                ) : (
                                    <AccountAuth
                                        authMode={authMode}
                                        onAuthModeChange={setAuthMode}
                                        registerCaptcha={registerCaptcha}
                                        onRegisterCaptcha={setRegisterCaptcha}
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
