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
} from "@/app_lib/vault-utils/device-signing-key";
import { OnlineServices, Vault } from "@/app_lib/vault-utils/vault";
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

import { AccountAuth } from "./account-auth";
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
import { useSaveVault } from "./use-save-vault";

export {
    buildDeviceRelationshipMap,
    formatRelativeAccountDate,
    formatSyncId,
} from "./device-topology";
export type { AccountDialogProps } from "./types";

export function AccountDialog({ open, onOpenChange }: AccountDialogProps) {
    const vault = useAtomValue(unlockedVaultAtom);
    const onlineServicesData = useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    });
    const saveVault = useSaveVault();

    const onlineServicesBound = Vault.isOnlineServicesBound(vault);
    const hasSession = !!onlineServicesData?.sessionToken?.length;

    const [accountTab, setAccountTab] = useState<AccountDialogTab>("account");
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
    const [clearRecoveryOpen, setClearRecoveryOpen] = useState(false);
    const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
    const [deleteAccountPending, setDeleteAccountPending] = useState(false);

    const registerMut = trpcReact.v1.auth.register.useMutation();
    const recoverMut = trpcReact.v1.auth.recover.useMutation();
    const deleteUserMut = trpcReact.v1.user.delete.useMutation();
    const deleteChallengeMut = trpcReact.v1.user.deleteChallenge.useMutation();
    const genRecoveryMut =
        trpcReact.v1.user.generateRecoveryToken.useMutation();
    const clearRecoveryMut = trpcReact.v1.user.clearRecoveryToken.useMutation();

    const checkoutFinalizeAbortRef = useRef<AbortController | null>(null);

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

    const { data: remoteConfig, refetch: refetchConfig } =
        trpcReact.v1.user.configuration.useQuery(undefined, {
            enabled: open && hasSession,
        });

    const recoveryPhraseAlreadyOnServer =
        !!remoteConfig?.recoveryTokenCreatedAt;

    const { data: subscription, refetch: refetchSubscription } =
        trpcReact.v1.payment.subscription.useQuery(undefined, {
            enabled: open && hasSession && !!onlineServicesData?.remoteData,
        });

    const trpcUtils = trpcReact.useUtils();

    const { data: linkedDeviceTopology, refetch: refetchDeviceTopology } =
        trpcReact.v1.device.topology.useQuery(undefined, {
            enabled:
                open &&
                hasSession &&
                !!remoteConfig?.root &&
                !!onlineServicesData?.remoteData,
        });

    const removeDevice = trpcReact.v1.device.remove.useMutation({
        onSuccess: () => {
            void refetchDeviceTopology();
            toast.success("Device removed.");
        },
    });

    const setRootDevice = trpcReact.v1.device.setRoot.useMutation({
        onSuccess: async () => {
            void refetchDeviceTopology();
            await syncOnlineServicesRemoteConfiguration();
            void refetchConfig();
            toast.success("Updated root device.");
        },
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

            const next = Object.assign(new Vault(), vault);
            Vault.bindOnlineServices(
                next,
                new OnlineServices(serverDeviceId, userId, pub, priv),
            );

            if (await saveVault(next)) {
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

            const next = Object.assign(new Vault(), vault);
            Vault.bindOnlineServices(
                next,
                new OnlineServices(serverDeviceId, recoverUserId, pub, priv),
            );

            if (await saveVault(next)) {
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

            const next = Object.assign(new Vault(), vault);
            Vault.unbindOnlineServices(next);

            if (await saveVault(next)) {
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

            const next = Object.assign(new Vault(), vault);
            Vault.unbindOnlineServices(next);
            if (await saveVault(next)) {
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

    const handleGenerateRecovery = async () => {
        try {
            const res = await genRecoveryMut.mutateAsync();
            await refetchConfig();
            showRecoveryKit({
                userId: res.userId,
                recoveryPhrase: res.token,
            });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
        }
    };

    const handleClearRecovery = async () => {
        try {
            await clearRecoveryMut.mutateAsync();
            toast.success("Recovery phrase cleared.");
            await refetchConfig();
            setClearRecoveryOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
        }
    };

    const busy =
        registerMut.isPending ||
        recoverMut.isPending ||
        deleteUserMut.isPending ||
        deleteChallengeMut.isPending ||
        removeLocalBindingPending;

    const tierName =
        subscription?.productName ?? (hasSession ? "STANDARD" : "Free");
    const subscriptionStatus = subscription?.status ?? "No active subscription";
    const currentServerDeviceId =
        vault.OnlineServices?.DeviceId ?? onlineServicesData?.deviceId;
    const userId = vault.OnlineServices?.UserID ?? null;
    const isConnected = hasSession;
    const isRoot = !!remoteConfig?.root;

    const deviceRelationshipMap = useMemo(
        () =>
            buildDeviceRelationshipMap(
                linkedDeviceTopology,
                vault.LinkedDevices?.Devices ?? [],
                currentServerDeviceId,
            ),
        [
            currentServerDeviceId,
            linkedDeviceTopology,
            vault.LinkedDevices?.Devices,
        ],
    );

    const isDevicesTab = onlineServicesBound && accountTab === "devices";

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
                        isDevicesTab ? "sm:max-w-4xl" : "sm:max-w-2xl",
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

                    <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-4">
                        {onlineServicesBound ? (
                            <Tabs
                                value={accountTab}
                                onValueChange={(value) =>
                                    setAccountTab(value as AccountDialogTab)
                                }
                                className="w-full"
                            >
                                <TabsList className="mb-4 grid h-auto min-h-9 w-full grid-cols-3">
                                    <TabsTrigger value="account">
                                        Account
                                    </TabsTrigger>
                                    <TabsTrigger value="devices">
                                        Devices
                                    </TabsTrigger>
                                    <TabsTrigger value="security">
                                        Security
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="account">
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
                                </TabsContent>

                                <TabsContent value="devices">
                                    <AccountDevices
                                        hasDevices={
                                            !!linkedDeviceTopology?.devices
                                                .length
                                        }
                                        deviceRelationshipMap={
                                            deviceRelationshipMap
                                        }
                                        isRoot={isRoot}
                                        canPromote={
                                            !!remoteConfig?.canPromoteDevices
                                        }
                                        removing={removeDevice.isPending}
                                        promoting={setRootDevice.isPending}
                                        onRemove={(id) =>
                                            removeDevice.mutate({ id })
                                        }
                                        onToggleRoot={(id, root) =>
                                            setRootDevice.mutate({ id, root })
                                        }
                                    />
                                </TabsContent>

                                <TabsContent value="security">
                                    <AccountSecurity
                                        isRoot={isRoot}
                                        onlineServicesBound={
                                            onlineServicesBound
                                        }
                                        busy={busy}
                                        recoveryPhraseAlreadyOnServer={
                                            recoveryPhraseAlreadyOnServer
                                        }
                                        genRecoveryPending={
                                            genRecoveryMut.isPending
                                        }
                                        clearRecoveryPending={
                                            clearRecoveryMut.isPending
                                        }
                                        onGenerateRecovery={() =>
                                            void handleGenerateRecovery()
                                        }
                                        onClearRecovery={() =>
                                            setClearRecoveryOpen(true)
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
                open={clearRecoveryOpen}
                onOpenChange={setClearRecoveryOpen}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Clear recovery phrase?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This removes the phrase stored on the server. Any
                            printed or saved Recovery Kit with the old phrase
                            will stop working. You can generate a new phrase
                            afterward.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel
                            disabled={clearRecoveryMut.isPending}
                        >
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            variant="destructive"
                            disabled={clearRecoveryMut.isPending}
                            onClick={() => void handleClearRecovery()}
                        >
                            Clear phrase
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
