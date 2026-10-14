import {
    createContext,
    type ReactNode,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";
import { router } from "expo-router";
import { useAtomValue } from "jotai";

import {
    establishOnlineServicesSession,
    logoutOnlineServicesSession,
    syncOnlineServicesRemoteConfiguration,
} from "@/app_lib/auth-session";
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
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesAuthenticationStatus,
    onlineServicesDataAtom,
    onlineServicesStore,
    setOnlineServicesData,
    unlockedVaultAtom,
    vaultStore,
} from "@/utils/atoms";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { persistVaultMutation } from "@/utils/vault-mutations";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
    MISSING_VAULT_SECRET_ERROR,
} from "@/utils/vault-session";
import { onlineServicesLog } from "@/utils/logging";
import { trpcReact } from "@/utils/trpc";
import {
    Dialog,
    DialogDescription,
    DialogFooter,
    DialogHeader,
} from "@/components/ui/dialog";
import {
    UnlockedButton as Button,
    UnlockedDialogTitle as DialogTitle,
} from "@/components/unlocked/unlocked-ui";
import { useTurnstileTokenRequest } from "./turnstile-challenge";
import {
    RECOVERY_PHRASE_WORD_COUNT,
    countRecoveryPhraseWords,
    joinRecoveryPhrase,
    splitRecoveryPhraseIntoSlots,
} from "@ui/lib/recovery-kit-utils";
import type { RecoveryKitData } from "./types";

const DEVICE_PURPOSE = "mobile" as const;

type AccountMessage = {
    tone: "error";
    text: string;
};

type AccountVaultMutation = (currentVault: Vault) => Vault | Promise<Vault>;

function assertAccountVaultSession(generation: number): void {
    if (!isSameActiveVaultSession(generation)) {
        throw new Error(MISSING_VAULT_SECRET_ERROR);
    }
}

async function persistAccountMutation(
    mutate: AccountVaultMutation,
): Promise<{ ok: true } | { ok: false; message: string }> {
    const result = await persistVaultMutation(
        "vault.account",
        async (currentVault) => ({
            vault: await mutate(currentVault),
            result: undefined,
        }),
    );
    if (result.isOk()) return { ok: true };
    if (result.error === "VAULT_DEK_NOT_FOUND") {
        return { ok: false, message: MISSING_VAULT_SECRET_ERROR };
    }
    if (result.error === "VAULT_METADATA_MISSING") {
        return { ok: false, message: "Vault metadata is unavailable." };
    }
    return { ok: false, message: "Failed to save vault." };
}

async function rollbackFailedRegistrationBinding(options: {
    generation: number;
    deviceId: string;
    privateKeyJWK: string;
    deleteChallenge: () => Promise<{ challengeId: string; challenge: string }>;
    deleteUser: (input: {
        challengeId: string;
        signature: string;
    }) => Promise<boolean>;
}): Promise<void> {
    if (!isSameActiveVaultSession(options.generation)) return;
    try {
        await establishOnlineServicesSession({
            deviceId: options.deviceId,
            privateKeyJWK: options.privateKeyJWK,
        });
        if (!isSameActiveVaultSession(options.generation)) return;
        const challenge = await options.deleteChallenge();
        if (!isSameActiveVaultSession(options.generation)) return;
        const signature = await signChallenge(
            parseJwkFromString(options.privateKeyJWK),
            Uint8Array.fromBase64(challenge.challenge),
        );
        if (!isSameActiveVaultSession(options.generation)) return;
        await options.deleteUser({
            challengeId: challenge.challengeId,
            signature,
        });
    } catch (error) {
        onlineServicesLog.error(
            "Remote rollback after failed vault bind incomplete",
            { error },
        );
    } finally {
        if (isSameActiveVaultSession(options.generation)) {
            onlineServicesStore.set(onlineServicesDataAtom, null);
            onlineServicesStore.set(
                onlineServicesAuthConnectionStatusAtom,
                onlineServicesAuthenticationStatus.disconnected(),
            );
        }
    }
}

function useCreateAccountController() {
    const vault = useAtomValue(unlockedVaultAtom);
    const onlineServicesData = useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    });
    const authStatus = useAtomValue(onlineServicesAuthConnectionStatusAtom, {
        store: onlineServicesStore,
    });
    const bound = Vault.isOnlineServicesBound(vault);
    const cloudOn = isCloudServicesEnabled();
    const hasSession = !!onlineServicesData?.sessionToken?.length;

    const [recoverUserId, setRecoverUserId] = useState("");
    const [recoverPhrase, setRecoverPhrase] = useState("");
    const [busy, setBusy] = useState(false);
    const registrationPendingRef = useRef(false);
    const [message, setMessage] = useState<AccountMessage | null>(null);
    const [removeLocalBindingOpen, setRemoveLocalBindingOpen] = useState(false);
    const [removeLocalBindingPending, setRemoveLocalBindingPending] =
        useState(false);
    const [recoveryKit, setRecoveryKit] = useState<RecoveryKitData | null>(
        null,
    );
    const [recoveryKitFromRegistration, setRecoveryKitFromRegistration] =
        useState(false);
    const [rotateRecoveryOpen, setRotateRecoveryOpen] = useState(false);
    const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
    const [deleteAccountPending, setDeleteAccountPending] = useState(false);
    const [accountExitPending, setAccountExitPending] = useState(false);

    const { requestToken, dialog: turnstileDialog } =
        useTurnstileTokenRequest();
    const registerMut = trpcReact.v1.auth.register.useMutation();
    const recoverMut = trpcReact.v1.auth.recover.useMutation();
    const deleteUserMut = trpcReact.v1.user.delete.useMutation();
    const deleteChallengeMut = trpcReact.v1.user.deleteChallenge.useMutation();
    const genRecoveryMut =
        trpcReact.v1.user.generateRecoveryToken.useMutation();
    const rotateRecoveryMut =
        trpcReact.v1.user.rotateRecoveryToken.useMutation();

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
        enabled: cloudOn && hasSession && !!onlineServicesData?.remoteData,
    });
    const refreshAccountConfiguration = async () => {
        await syncOnlineServicesRemoteConfiguration();
        await Promise.all([refetchConfig(), refetchSubscription()]);
    };

    const handleRegister = async (): Promise<"recovery-kit" | undefined> => {
        if (registrationPendingRef.current) return;
        if (recoveryKit) return "recovery-kit";
        if (!cloudOn) {
            setMessage({
                tone: "error",
                text: "Online Services are disabled in this app.",
            });
            return;
        }
        registrationPendingRef.current = true;
        const generation = getVaultSessionGeneration();
        const assertCurrent = () => {
            if (!isSameActiveVaultSession(generation)) {
                throw new Error("Unlock your vault again to continue setup.");
            }
        };
        setBusy(true);
        setMessage(null);
        let captchaToken: string | null = null;
        try {
            const currentVault = vaultStore.get(unlockedVaultAtom);
            let binding = currentVault.OnlineServices;
            if (!Vault.isOnlineServicesBound(currentVault)) {
                captchaToken = await requestToken("auth_register");
                if (captchaToken == null) {
                    return;
                }
                assertCurrent();
                const { publicKey, privateKey } = await generateKeyPair();
                assertCurrent();
                const publicKeyJWK = publicKeyJwkToString(publicKey);
                const privateKeyJWK = privateKeyJwkToString(privateKey);
                const { deviceId, userId } = await registerMut.mutateAsync({
                    publicKeyJWK,
                    captchaToken,
                });
                captchaToken = null;
                binding = new OnlineServices(
                    deviceId,
                    userId,
                    publicKeyJWK,
                    privateKeyJWK,
                );
                const registeredBinding = binding;
                const persisted = isSameActiveVaultSession(generation)
                    ? await persistAccountMutation((currentVault) => {
                          const next = Object.assign(new Vault(), currentVault);
                          Vault.bindOnlineServices(next, registeredBinding);
                          return next;
                      })
                    : { ok: false as const, message: "Vault session expired." };
                if (!persisted.ok) {
                    await rollbackFailedRegistrationBinding({
                        generation,
                        deviceId,
                        privateKeyJWK,
                        deleteChallenge: () => deleteChallengeMut.mutateAsync(),
                        deleteUser: (input) => deleteUserMut.mutateAsync(input),
                    });
                    setMessage({
                        tone: "error",
                        text: `${persisted.message} Remote registration was rolled back when possible.`,
                    });
                    return;
                }
                assertCurrent();
                setOnlineServicesData({
                    deviceId,
                    sessionToken: null,
                    sessionExpiresAt: null,
                    remoteData: null,
                });
            }
            if (!binding) throw new Error("Account setup could not be saved.");
            await establishOnlineServicesSession({
                deviceId: binding.DeviceId,
                privateKeyJWK: binding.PrivateKeyJWK,
            });
            assertCurrent();
            await refreshAccountConfiguration();
            assertCurrent();
            const recovery = await genRecoveryMut.mutateAsync();
            assertCurrent();
            setRecoveryKit({
                userId: recovery.userId,
                recoveryPhrase: recovery.token,
            });
            setRecoveryKitFromRegistration(true);
            void Promise.all([
                syncOnlineServicesRemoteConfiguration(),
                refetchConfig(),
            ]).catch((error) => {
                onlineServicesLog.error(
                    "Account configuration refresh failed after Recovery Kit creation",
                    { error },
                );
            });
            return "recovery-kit";
        } catch (error) {
            onlineServicesLog.error(
                "Online Services account registration failed",
                { error, purpose: DEVICE_PURPOSE },
            );
            setMessage({
                tone: "error",
                text:
                    error instanceof Error
                        ? error.message
                        : "Registration failed.",
            });
        } finally {
            captchaToken = null;
            registrationPendingRef.current = false;
            setBusy(false);
        }
    };

    const handleRecover = async (): Promise<boolean> => {
        const generation = getVaultSessionGeneration();
        if (!cloudOn) {
            setMessage({
                tone: "error",
                text: "Online Services are disabled in this app.",
            });
            return false;
        }
        const userId = recoverUserId.trim();
        if (!userId || !recoverPhrase.trim()) {
            setMessage({
                tone: "error",
                text: "User ID and recovery phrase are required.",
            });
            return false;
        }
        const normalizedPhrase = joinRecoveryPhrase(
            splitRecoveryPhraseIntoSlots(recoverPhrase),
        );
        if (
            countRecoveryPhraseWords(normalizedPhrase) !==
            RECOVERY_PHRASE_WORD_COUNT
        ) {
            setMessage({
                tone: "error",
                text: `Recovery phrase must be exactly ${RECOVERY_PHRASE_WORD_COUNT} words.`,
            });
            return false;
        }
        setBusy(true);
        setMessage(null);
        let captchaToken: string | null = null;
        try {
            assertAccountVaultSession(generation);
            captchaToken = await requestToken("auth_recover");
            if (captchaToken == null) {
                return false;
            }
            assertAccountVaultSession(generation);
            const { publicKey, privateKey } = await generateKeyPair();
            assertAccountVaultSession(generation);
            const publicKeyJWK = publicKeyJwkToString(publicKey);
            const privateKeyJWK = privateKeyJwkToString(privateKey);
            const { deviceId } = await recoverMut.mutateAsync({
                userId,
                recoveryPhrase: normalizedPhrase,
                newPublicKeyJWK: publicKeyJWK,
                captchaToken,
            });
            assertAccountVaultSession(generation);
            captchaToken = "";
            setRecoverPhrase("");
            const persisted = await persistAccountMutation((currentVault) => {
                const next = Object.assign(new Vault(), currentVault);
                Vault.bindOnlineServices(
                    next,
                    new OnlineServices(
                        deviceId,
                        userId,
                        publicKeyJWK,
                        privateKeyJWK,
                    ),
                );
                return next;
            });
            assertAccountVaultSession(generation);
            if (!persisted.ok) {
                setMessage({ tone: "error", text: persisted.message });
                return false;
            }
            setOnlineServicesData({
                deviceId,
                sessionToken: null,
                sessionExpiresAt: null,
                remoteData: null,
            });
            await establishOnlineServicesSession({ deviceId, privateKeyJWK });
            assertAccountVaultSession(generation);
            await refreshAccountConfiguration();
            assertAccountVaultSession(generation);
            return true;
        } catch (error) {
            onlineServicesLog.error("Online Services account recovery failed", {
                error,
            });
            setMessage({
                tone: "error",
                text:
                    error instanceof Error ? error.message : "Recovery failed.",
            });
            return false;
        } finally {
            captchaToken = null;
            setRecoverPhrase("");
            setBusy(false);
        }
    };

    const handleGenerateRecovery = async (): Promise<boolean> => {
        const generation = getVaultSessionGeneration();
        setMessage(null);
        try {
            assertAccountVaultSession(generation);
            const result = await genRecoveryMut.mutateAsync();
            assertAccountVaultSession(generation);
            setRecoveryKit({
                userId: result.userId,
                recoveryPhrase: result.token,
            });
            setRecoveryKitFromRegistration(false);
            await Promise.all([
                syncOnlineServicesRemoteConfiguration(),
                refetchConfig(),
            ]);
            assertAccountVaultSession(generation);
            return true;
        } catch (error) {
            setMessage({
                tone: "error",
                text: error instanceof Error ? error.message : "Failed",
            });
            return false;
        }
    };

    const handleRotateRecovery = async () => {
        const generation = getVaultSessionGeneration();
        setMessage(null);
        try {
            assertAccountVaultSession(generation);
            const result = await rotateRecoveryMut.mutateAsync();
            assertAccountVaultSession(generation);
            setRecoveryKit({
                userId: result.userId,
                recoveryPhrase: result.token,
            });
            setRecoveryKitFromRegistration(false);
            setRotateRecoveryOpen(false);
            await Promise.all([
                syncOnlineServicesRemoteConfiguration(),
                refetchConfig(),
            ]);
            assertAccountVaultSession(generation);
            router.push("/(app)/account/recovery-kit");
        } catch (error) {
            setMessage({
                tone: "error",
                text: error instanceof Error ? error.message : "Failed",
            });
        }
    };

    const handleRefresh = async () => {
        setBusy(true);
        setMessage(null);
        try {
            if (Vault.isOnlineServicesBound(vault) && !hasSession) {
                await establishOnlineServicesSession({
                    deviceId: vault.OnlineServices.DeviceId,
                    privateKeyJWK: vault.OnlineServices.PrivateKeyJWK,
                });
            }
            await refreshAccountConfiguration();
        } catch (error) {
            setMessage({
                tone: "error",
                text:
                    error instanceof Error ? error.message : "Refresh failed.",
            });
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        if (
            !accountExitPending ||
            removeLocalBindingPending ||
            deleteAccountPending ||
            deleteUserMut.isPending ||
            deleteChallengeMut.isPending
        ) {
            return;
        }
        setAccountExitPending(false);
        router.dismissTo("/(app)/(tabs)/account");
    }, [
        accountExitPending,
        deleteAccountPending,
        deleteChallengeMut.isPending,
        deleteUserMut.isPending,
        removeLocalBindingPending,
    ]);

    const handleRemoveLocalBinding = async () => {
        const generation = getVaultSessionGeneration();
        setRemoveLocalBindingPending(true);
        try {
            assertAccountVaultSession(generation);
            await logoutOnlineServicesSession();
            assertAccountVaultSession(generation);
            const persisted = await persistAccountMutation((currentVault) => {
                const next = Object.assign(new Vault(), currentVault);
                Vault.unbindOnlineServices(next);
                return next;
            });
            assertAccountVaultSession(generation);
            if (!persisted.ok) {
                setMessage({ tone: "error", text: persisted.message });
                return;
            }
            setRemoveLocalBindingOpen(false);
            setAccountExitPending(true);
        } catch (error) {
            onlineServicesLog.error(
                "Failed to remove local Online Services binding",
                { error },
            );
            setMessage({
                tone: "error",
                text:
                    error instanceof Error
                        ? error.message
                        : "Failed to remove local binding.",
            });
        } finally {
            setRemoveLocalBindingPending(false);
        }
    };

    const handleDeleteAccount = async () => {
        const generation = getVaultSessionGeneration();
        if (!remoteConfig?.root) {
            setMessage({
                tone: "error",
                text: "Only the root device can delete the account.",
            });
            return;
        }
        if (!Vault.isOnlineServicesBound(vault)) {
            setMessage({
                tone: "error",
                text: "Online Services binding required.",
            });
            return;
        }
        setDeleteAccountPending(true);
        try {
            assertAccountVaultSession(generation);
            const challenge = await deleteChallengeMut.mutateAsync();
            assertAccountVaultSession(generation);
            const signature = await signChallenge(
                parseJwkFromString(vault.OnlineServices.PrivateKeyJWK),
                Uint8Array.fromBase64(challenge.challenge),
            );
            assertAccountVaultSession(generation);
            await deleteUserMut.mutateAsync({
                challengeId: challenge.challengeId,
                signature,
            });
            assertAccountVaultSession(generation);
            const persisted = await persistAccountMutation((currentVault) => {
                const next = Object.assign(new Vault(), currentVault);
                Vault.unbindOnlineServices(next);
                return next;
            });
            assertAccountVaultSession(generation);
            if (!persisted.ok) {
                setMessage({ tone: "error", text: persisted.message });
                return;
            }
            onlineServicesStore.set(onlineServicesDataAtom, null);
            onlineServicesStore.set(
                onlineServicesAuthConnectionStatusAtom,
                onlineServicesAuthenticationStatus.disconnected(),
            );
            setDeleteAccountOpen(false);
            setAccountExitPending(true);
        } catch (error) {
            onlineServicesLog.error("Online Services account deletion failed", {
                error,
            });
            setMessage({
                tone: "error",
                text: error instanceof Error ? error.message : "Delete failed.",
            });
        } finally {
            setDeleteAccountPending(false);
        }
    };

    const mutationBusy =
        registerMut.isPending ||
        recoverMut.isPending ||
        deleteUserMut.isPending ||
        deleteChallengeMut.isPending ||
        removeLocalBindingPending ||
        busy;

    return {
        authStatus,
        bound,
        cloudOn,
        hasSession,
        remoteConfig,
        subscription,
        isRoot: !!remoteConfig?.root,
        recoveryPhraseAlreadyOnServer: !!remoteConfig?.recoveryTokenCreatedAt,
        recoverUserId,
        setRecoverUserId,
        recoverPhrase,
        setRecoverPhrase,
        message,
        setMessage,
        mutationBusy,
        registerPending: registerMut.isPending,
        recoverPending: recoverMut.isPending,
        genRecoveryPending: genRecoveryMut.isPending,
        rotateRecoveryPending: rotateRecoveryMut.isPending,
        recoveryKit,
        recoveryKitFromRegistration,
        clearRecoveryKit: () => {
            setRecoveryKit(null);
            setRecoveryKitFromRegistration(false);
        },
        handleRegister,
        handleRecover,
        handleGenerateRecovery,
        handleRefresh,
        openRemoveLocalBinding: () => setRemoveLocalBindingOpen(true),
        openRotateRecovery: () => setRotateRecoveryOpen(true),
        openDeleteAccount: () => setDeleteAccountOpen(true),
        turnstileDialog,
        dialogs: (
            <>
                <Dialog
                    open={rotateRecoveryOpen}
                    placement="bottom"
                    onOpenChange={setRotateRecoveryOpen}
                >
                    <DialogHeader>
                        <DialogTitle>Rotate Recovery Kit?</DialogTitle>
                        <DialogDescription>
                            This immediately replaces the current recovery
                            phrase. Existing Recovery Kits will stop working.
                            The new kit is shown once.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="secondary"
                            disabled={rotateRecoveryMut.isPending}
                            onPress={() => setRotateRecoveryOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            loading={rotateRecoveryMut.isPending}
                            onPress={() => void handleRotateRecovery()}
                        >
                            Rotate kit
                        </Button>
                    </DialogFooter>
                </Dialog>
                <Dialog
                    open={removeLocalBindingOpen}
                    dismissible={!removeLocalBindingPending}
                    placement="bottom"
                    onOpenChange={setRemoveLocalBindingOpen}
                >
                    <DialogHeader>
                        <DialogTitle>Disconnect this device?</DialogTitle>
                        <DialogDescription>
                            This vault will forget its saved Online Services
                            access. Your local vault and online account will
                            remain. To reconnect this vault, you’ll need your
                            Recovery Kit or an invitation from a linked device.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="secondary"
                            disabled={removeLocalBindingPending}
                            onPress={() => setRemoveLocalBindingOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            loading={removeLocalBindingPending}
                            onPress={() => void handleRemoveLocalBinding()}
                        >
                            Disconnect device
                        </Button>
                    </DialogFooter>
                </Dialog>
                <Dialog
                    open={deleteAccountOpen}
                    placement="bottom"
                    onOpenChange={setDeleteAccountOpen}
                >
                    <DialogHeader>
                        <DialogTitle>Delete account?</DialogTitle>
                        <DialogDescription>
                            This permanently removes the server account. Root
                            device only. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="secondary"
                            disabled={deleteAccountPending}
                            onPress={() => setDeleteAccountOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            loading={deleteAccountPending}
                            onPress={() => void handleDeleteAccount()}
                        >
                            Delete account
                        </Button>
                    </DialogFooter>
                </Dialog>
            </>
        ),
        configFetching,
        subscriptionFetching,
    };
}

type AccountController = Omit<
    ReturnType<typeof useCreateAccountController>,
    "dialogs" | "turnstileDialog"
>;
const AccountControllerContext = createContext<AccountController | null>(null);

export function AccountControllerProvider({
    children,
}: {
    children: ReactNode;
}) {
    const { dialogs, turnstileDialog, ...controller } =
        useCreateAccountController();
    return (
        <AccountControllerContext.Provider value={controller}>
            {children}
            {turnstileDialog}
            {dialogs}
        </AccountControllerContext.Provider>
    );
}

export function useAccountController(): AccountController {
    const controller = useContext(AccountControllerContext);
    if (!controller) {
        throw new Error(
            "useAccountController must be used inside AccountControllerProvider.",
        );
    }
    return controller;
}
