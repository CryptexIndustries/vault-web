"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useAtomValue, useSetAtom } from "jotai/react";
import { toast } from "sonner";
import { Turnstile } from "@marsidev/react-turnstile";
import { Copy, Loader2, User } from "lucide-react";

import { env } from "@/env/client.mjs";
import {
    establishPremiumSession,
    syncOnlineServicesRemoteConfiguration,
} from "@/app_lib/auth-session";
import {
    generateKeyPair,
    privateKeyJwkToString,
    publicKeyJwkToString,
} from "@/app_lib/vault-utils/passkey";
import {
    type LinkedDevice,
    LinkedDevices,
    OnlineServices,
    Vault,
} from "@/app_lib/vault-utils/vault";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesAuthenticationStatus,
    onlineServicesDataAtom,
    onlineServicesStore,
    setOnlineServicesData,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    unlockedVaultWriteOnlyAtom,
} from "@/utils/atoms";
import {
    MISSING_VAULT_SECRET_ERROR,
    saveVaultWithSessionSecret,
} from "@/utils/vault-session";
import { trpcReact } from "@/utils/trpc";
import {
    openCustomerPortal,
    navigateToCheckout,
} from "@/app_lib/online-services";
import { onlineServicesLog } from "@/utils/logging";

const DevicesConstellation = dynamic(
    () =>
        import("./device-tab").then((m) => ({
            default: m.DevicesConstellation,
        })),
    {
        ssr: false,
        loading: () => (
            <div className="grid h-[26rem] place-items-center rounded-xl border bg-card text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
            </div>
        ),
    },
);

export type AccountDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

type AccountDialogTab =
    | "auth"
    | "overview"
    | "danger"
    | "devices-constellation";

function useSaveVault() {
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);

    return useCallback(
        async (next: Vault) => {
            if (!vaultMetadata) {
                toast.error("Vault metadata is unavailable.");
                return false;
            }
            setUnlockedVault(next);
            const res = await saveVaultWithSessionSecret(vaultMetadata, next);
            if (res.isErr()) {
                if (res.error === "VAULT_SECRET_NOT_FOUND") {
                    toast.error(MISSING_VAULT_SECRET_ERROR);
                } else {
                    toast.error("Failed to save vault.");
                }
                return false;
            }
            return true;
        },
        [setUnlockedVault, vaultMetadata],
    );
}

function formatAccountDate(value?: Date | string | null) {
    if (!value) return "-";
    return new Date(value).toLocaleDateString();
}

export function formatRelativeAccountDate(
    value?: Date | string | number | null,
) {
    if (!value) return "-";
    const timestamp = new Date(value).getTime();
    const diffMs = Date.now() - timestamp;
    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (Number.isNaN(timestamp)) return "-";
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

export function formatSyncId(syncId?: string | null) {
    if (!syncId) return "No sync ID";
    if (syncId.length <= 18) return syncId;
    return `${syncId.slice(0, 8)}...${syncId.slice(-6)}`;
}

function inferAccountDeviceKind(name: string) {
    const normalized = name.toLowerCase();
    if (/iphone|android|phone|pixel/.test(normalized)) return "Mobile";
    if (/ipad|tablet/.test(normalized)) return "Tablet";
    if (/chrome|firefox|safari|edge|browser/.test(normalized)) return "Browser";
    return "Desktop";
}

type DeviceTopologyDevice = {
    id: string;
    createdAt: Date;
    lastSeen: Date | null;
    purpose: "web" | "mobile" | "browser" | "cli";
    root: boolean;
    current: boolean;
};

type DeviceTopologyRelationship = {
    syncId: string;
    fromDeviceId: string;
    toDeviceId: string;
    createdAt: Date;
};

type DeviceTopology = {
    devices: DeviceTopologyDevice[];
    relationships: DeviceTopologyRelationship[];
};

export function buildDeviceRelationshipMap(
    topology: DeviceTopology | undefined,
    localDevices: LinkedDevice[],
    currentDeviceId?: string | null,
) {
    const localBySyncId = new Map(
        localDevices
            .filter((device) => !!device.SyncID)
            .map((device) => [device.SyncID, device]),
    );
    const relationshipsByDeviceId = new Map<
        string,
        DeviceTopologyRelationship[]
    >();

    for (const relationship of topology?.relationships ?? []) {
        for (const id of [relationship.fromDeviceId, relationship.toDeviceId]) {
            relationshipsByDeviceId.set(id, [
                ...(relationshipsByDeviceId.get(id) ?? []),
                relationship,
            ]);
        }
    }

    const devices = topology?.devices ?? [];
    const current =
        devices.find((device) => device.current) ??
        devices.find((device) => device.id === currentDeviceId) ??
        devices.find((device) => device.root) ??
        devices[0];

    const serverSyncIds = new Set(
        (topology?.relationships ?? []).map((r) => r.syncId),
    );
    const orphanLocalDevices = localDevices.filter(
        (device) =>
            !!device.SyncID &&
            !serverSyncIds.has(device.SyncID) &&
            LinkedDevices.isUsingOnlineServices(device),
    );

    const nodes = devices.map((device) => {
        const relationships = relationshipsByDeviceId.get(device.id) ?? [];
        const preferredRelationship =
            relationships.find((relationship) =>
                localBySyncId.has(relationship.syncId),
            ) ?? relationships[0];
        const localDevice = preferredRelationship
            ? localBySyncId.get(preferredRelationship.syncId)
            : undefined;
        const isCurrent = device.current || device.id === currentDeviceId;
        const syncIds = relationships.map(
            (relationship) => relationship.syncId,
        );

        return {
            ...device,
            displayName: isCurrent
                ? (localDevice?.Name ?? "This device")
                : (localDevice?.Name ?? "Unknown device"),
            deviceKind: inferAccountDeviceKind(localDevice?.Name ?? ""),
            localDevice,
            matched: !!localDevice,
            current: isCurrent,
            syncIds,
            lastActivity:
                localDevice?.LastSync ??
                localDevice?.LinkedAtTimestamp ??
                device.lastSeen ??
                device.createdAt,
        };
    });

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const relationships = (topology?.relationships ?? []).map(
        (relationship) => ({
            ...relationship,
            localDevice: localBySyncId.get(relationship.syncId),
            from: nodeById.get(relationship.fromDeviceId),
            to: nodeById.get(relationship.toDeviceId),
        }),
    );

    const orphanGhosts = orphanLocalDevices.map((device) => ({
        id: `orphan:${device.ID}`,
        syncId: device.SyncID,
        displayName: device.Name || "Unknown device",
        deviceKind: inferAccountDeviceKind(device.Name ?? ""),
        localDevice: device,
        lastActivity: device.LastSync ?? device.LinkedAtTimestamp,
    }));

    return {
        nodes,
        relationships,
        orphanGhosts,
        currentDeviceId: current?.id ?? null,
        rootCount: nodes.filter((node) => node.root).length,
    };
}

export function AccountDialog({ open, onOpenChange }: AccountDialogProps) {
    const vault = useAtomValue(unlockedVaultAtom);
    const onlineServicesData = useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    });
    const saveVault = useSaveVault();

    const [registerCaptcha, setRegisterCaptcha] = useState("");
    const [recoverCaptcha, setRecoverCaptcha] = useState("");
    const [recoverUserId, setRecoverUserId] = useState("");
    const [recoverPhrase, setRecoverPhrase] = useState("");
    const [removeLocalBindingOpen, setRemoveLocalBindingOpen] = useState(false);
    const [removeLocalBindingPending, setRemoveLocalBindingPending] =
        useState(false);
    /** Plaintext phrase for the generation just completed in this dialog session. */
    const [recoveryPhraseToCopy, setRecoveryPhraseToCopy] = useState<
        string | null
    >(null);
    const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
    const [deleteAccountPending, setDeleteAccountPending] = useState(false);

    const passkeyBound = Vault.isOnlineServicesBound(vault);
    const [accountTab, setAccountTab] = useState<AccountDialogTab>(
        passkeyBound ? "overview" : "auth",
    );
    const activeAccountTab: AccountDialogTab = passkeyBound
        ? accountTab === "auth"
            ? "overview"
            : accountTab
        : "auth";

    const registerMut = trpcReact.v1.auth.register.useMutation();
    const recoverMut = trpcReact.v1.auth.recover.useMutation();
    const deleteUserMut = trpcReact.v1.user.delete.useMutation();
    const genRecoveryMut =
        trpcReact.v1.user.generateRecoveryToken.useMutation();
    const clearRecoveryMut = trpcReact.v1.user.clearRecoveryToken.useMutation();

    const hasSession = !!onlineServicesData?.sessionToken?.length;

    useEffect(() => {
        if (!open) {
            setRecoveryPhraseToCopy(null);
        }
    }, [open]);

    useEffect(() => {
        setAccountTab(activeAccountTab);
    }, [activeAccountTab]);

    const { data: remoteConfig, refetch: refetchConfig } =
        trpcReact.v1.user.configuration.useQuery(undefined, {
            enabled: open && hasSession,
        });

    const recoveryPhraseAlreadyOnServer =
        !!remoteConfig?.recoveryTokenCreatedAt;

    const { data: subscription } = trpcReact.v1.payment.subscription.useQuery(
        undefined,
        { enabled: open && hasSession && !!onlineServicesData?.remoteData },
    );

    const { data: portalUrl } = trpcReact.v1.payment.customerPortal.useQuery(
        undefined,
        { enabled: open && hasSession && !!onlineServicesData?.remoteData },
    );

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

    const copyRecoveryPhrase = useCallback(async (phrase: string) => {
        try {
            await navigator.clipboard.writeText(phrase);
            toast.success("Recovery phrase copied.");
        } catch {
            toast.error("Could not copy to clipboard.");
        }
    }, []);

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
                toast.success("Account registered and signed in.");
                setRegisterCaptcha("");
            }
        } catch (e) {
            onlineServicesLog.error("Online Services account registration failed", {
                error: e,
            });
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
        try {
            const { publicKey, privateKey } = await generateKeyPair();
            const pub = publicKeyJwkToString(publicKey);
            const priv = privateKeyJwkToString(privateKey);

            const { deviceId: serverDeviceId } = await recoverMut.mutateAsync({
                userId: recoverUserId.trim(),
                recoveryPhrase: recoverPhrase.trim(),
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

    /**
     * Clears passkey material stored in the vault and local session state.
     * Does not call the server - use when the account is missing, or sign-in fails.
     */
    const handleRemoveLocalBinding = async () => {
        setRemoveLocalBindingPending(true);
        try {
            onlineServicesStore.set(onlineServicesDataAtom, null);
            onlineServicesStore.set(
                onlineServicesAuthConnectionStatusAtom,
                onlineServicesAuthenticationStatus.disconnected(),
            );

            const next = Object.assign(new Vault(), vault);
            Vault.unbindOnlineServices(next);

            if (await saveVault(next)) {
                toast.success(
                    "Local account binding removed from this vault. You can register again or recover with a phrase if you still have server access.",
                );
                setRemoveLocalBindingOpen(false);
            }
        } catch (e) {
            onlineServicesLog.error("Failed to remove local Online Services binding", {
                deviceId: vault.OnlineServices?.DeviceId,
                error: e,
            });
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
        setDeleteAccountPending(true);
        try {
            await deleteUserMut.mutateAsync();
            const next = Object.assign(new Vault(), vault);
            Vault.unbindOnlineServices(next);
            if (await saveVault(next)) {
                onlineServicesStore.set(onlineServicesDataAtom, null);
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

    const busy =
        registerMut.isPending ||
        recoverMut.isPending ||
        deleteUserMut.isPending ||
        removeLocalBindingPending;

    const tierName =
        subscription?.productName ?? (hasSession ? "STANDARD" : "-");
    const subscriptionStatus = subscription?.status ?? "No active subscription";
    const linkedDeviceCount = subscription?.resourceStatus.linkedDevices ?? 0;
    const linkedDeviceLimit = remoteConfig?.maxLinks ?? 0;
    const canLinkDevices = !!remoteConfig?.canLink && linkedDeviceLimit > 0;
    const tierAccessLoaded = !!remoteConfig;
    const unavailablePerkLabel = tierAccessLoaded ? "Upgrade" : "Checking";
    const unavailablePerkDetail = tierAccessLoaded
        ? "Upgrade to unlock this perk."
        : "Checking tier access.";
    const billingDateLabel = subscription?.cancelAtPeriodEnd
        ? "Expires"
        : "Next billing";
    const billingDate = formatAccountDate(subscription?.expiresAt);
    const tierPerks = [
        {
            label: "Online Services sync",
            included: !!remoteConfig?.canLink,
            detail: remoteConfig?.canLink
                ? "Zero-hassle encrypted synchronization."
                : unavailablePerkDetail,
        },
        {
            label: "Linked devices",
            included: canLinkDevices,
            detail: canLinkDevices
                ? `${linkedDeviceCount} of ${linkedDeviceLimit} linked devices used.`
                : unavailablePerkDetail,
        },
        {
            label: "Root device promotion",
            included: !!remoteConfig?.canPromoteDevices,
            detail: remoteConfig?.canPromoteDevices
                ? "Promote trusted devices to manage account recovery and links."
                : unavailablePerkDetail,
        },
        {
            label: "Always-connected access",
            included: !!remoteConfig?.alwaysConnected,
            detail: remoteConfig?.alwaysConnected
                ? "Keeps Online Services available for this vault."
                : unavailablePerkDetail,
        },
        {
            label: "Feature voting",
            included: !!remoteConfig?.canFeatureVote,
            detail: remoteConfig?.canFeatureVote
                ? "Vote on upcoming Cryptex Vault features."
                : unavailablePerkDetail,
        },
        {
            label: "Unlimited credentials",
            included: true,
            detail: "Store as many vault entries as you need.",
        },
        {
            label: "Unlimited vaults",
            included: true,
            detail: "Create and use multiple secure vaults.",
        },
        {
            label: "Encrypted backups",
            included: true,
            detail: "Create encrypted backups for your vault data.",
        },
    ];
    const currentServerDeviceId =
        vault.OnlineServices?.DeviceId ?? onlineServicesData?.deviceId;
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

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="grid max-h-[min(90vh,100dvh)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-4xl">
                    <DialogHeader className="border-b border-border px-6 py-4">
                        <DialogTitle className="flex items-center gap-2">
                            <User className="h-5 w-5" />
                            Account & Online Services
                        </DialogTitle>
                        <DialogDescription>
                            This dialog allows you to register, recover, or sign
                            in to Cryptex Vault Online Services.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-4">
                        <Tabs
                            value={activeAccountTab}
                            onValueChange={(value) =>
                                setAccountTab(value as AccountDialogTab)
                            }
                            className="w-full"
                        >
                            <TabsList
                                className={`mb-4 flex h-auto min-h-9 w-full flex-wrap gap-1 ${
                                    passkeyBound ? "" : "grid grid-cols-1"
                                } [&>*]:min-w-0`}
                            >
                                {passkeyBound ? (
                                    <TabsTrigger value="overview">
                                        Overview
                                    </TabsTrigger>
                                ) : null}
                                {!passkeyBound ? (
                                    <TabsTrigger value="auth">
                                        Sign in
                                    </TabsTrigger>
                                ) : null}
                                {passkeyBound ? (
                                    <TabsTrigger value="devices-constellation">
                                        Devices
                                    </TabsTrigger>
                                ) : null}
                                {passkeyBound ? (
                                    <TabsTrigger value="danger">
                                        Danger
                                    </TabsTrigger>
                                ) : null}
                            </TabsList>

                            <TabsContent value="overview" className="space-y-5">
                                <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base font-semibold">
                                            {tierName} benefits
                                        </h3>
                                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                            {subscriptionStatus}
                                        </span>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        Your current tier controls sync,
                                        linking, device permissions, and
                                        billing. Included perks are shown first
                                        so you know what you can use right now.
                                    </p>
                                </div>

                                <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)]">
                                    <div className="space-y-3">
                                        {tierPerks.map((perk) => (
                                            <div
                                                key={perk.label}
                                                className="flex items-start justify-between gap-3 rounded-md border p-3"
                                            >
                                                <div className="min-w-0 space-y-1">
                                                    <p className="text-sm font-medium">
                                                        {perk.label}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {perk.detail}
                                                    </p>
                                                </div>
                                                <span
                                                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                                                        perk.included
                                                            ? "bg-primary/10 text-primary"
                                                            : "bg-muted text-muted-foreground"
                                                    }`}
                                                >
                                                    {perk.included
                                                        ? "Included"
                                                        : unavailablePerkLabel}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="space-y-3">
                                        <div className="rounded-lg border p-4">
                                            <div className="mb-3 flex items-center justify-between gap-2">
                                                <h4 className="text-sm font-medium">
                                                    Account
                                                </h4>
                                                <span className="text-xs text-muted-foreground">
                                                    {onlineServicesData?.sessionToken
                                                        ? "Connected"
                                                        : "No session"}
                                                </span>
                                            </div>
                                            <div className="space-y-3 text-sm">
                                                <div>
                                                    <Label className="text-xs text-muted-foreground">
                                                        Device ID
                                                    </Label>
                                                    <p className="break-all font-mono text-xs">
                                                        {vault.OnlineServices
                                                            ?.DeviceId ??
                                                            onlineServicesData?.deviceId ??
                                                            "-"}
                                                    </p>
                                                </div>
                                                <div className="flex justify-between gap-3">
                                                    <span className="text-muted-foreground">
                                                        Vault binding
                                                    </span>
                                                    <span className="text-right font-medium">
                                                        {passkeyBound
                                                            ? "Passkey stored"
                                                            : "Not registered"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between gap-3">
                                                    <span className="text-muted-foreground">
                                                        Root device
                                                    </span>
                                                    <span className="font-medium">
                                                        {remoteConfig?.root
                                                            ? "Yes"
                                                            : "No"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between gap-3">
                                                    <span className="text-muted-foreground">
                                                        Recovery phrase
                                                    </span>
                                                    <span className="font-medium">
                                                        {remoteConfig?.recoveryTokenCreatedAt
                                                            ? "Backed up"
                                                            : "Not backed up"}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="rounded-lg border p-4">
                                            <div className="mb-3 flex items-center justify-between gap-2">
                                                <h4 className="text-sm font-medium">
                                                    Billing
                                                </h4>
                                                <span className="text-xs text-muted-foreground">
                                                    {subscription?.productName ??
                                                        "-"}
                                                </span>
                                            </div>
                                            {subscription ? (
                                                <div className="space-y-3 text-sm">
                                                    <div className="flex justify-between gap-3">
                                                        <span className="text-muted-foreground">
                                                            Status
                                                        </span>
                                                        <span className="font-medium">
                                                            {subscription.status ??
                                                                "-"}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between gap-3">
                                                        <span className="text-muted-foreground">
                                                            {billingDateLabel}
                                                        </span>
                                                        <span className="font-medium">
                                                            {billingDate}
                                                        </span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="text-sm text-muted-foreground">
                                                    Sign in to view
                                                    subscription.
                                                </p>
                                            )}
                                            <div className="mt-4 flex flex-wrap gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        void navigateToCheckout()
                                                    }
                                                    disabled={!hasSession}
                                                >
                                                    Upgrade
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        void openCustomerPortal()
                                                    }
                                                    disabled={!portalUrl}
                                                >
                                                    Manage billing
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="auth" className="space-y-6">
                                {!passkeyBound ? (
                                    <div className="space-y-3">
                                        <h3 className="text-sm font-medium">
                                            Create account
                                        </h3>
                                        <p className="text-xs text-muted-foreground">
                                            Generates a P-256 key pair stored
                                            only in this vault.
                                        </p>
                                        <Turnstile
                                            siteKey={
                                                env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
                                            }
                                            onSuccess={setRegisterCaptcha}
                                        />
                                        <Button
                                            onClick={() =>
                                                void handleRegister()
                                            }
                                            disabled={busy || !registerCaptcha}
                                        >
                                            {registerMut.isPending ? (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : null}
                                            Register & sign in
                                        </Button>
                                    </div>
                                ) : null}

                                <Separator />

                                <div className="space-y-3">
                                    <h3 className="text-sm font-medium">
                                        Recover with phrase
                                    </h3>
                                    <div className="space-y-2">
                                        <Label htmlFor="recover-user">
                                            User ID
                                        </Label>
                                        <Input
                                            id="recover-user"
                                            value={recoverUserId}
                                            onChange={(e) =>
                                                setRecoverUserId(e.target.value)
                                            }
                                            placeholder="user id"
                                            autoComplete="off"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="recover-phrase">
                                            Recovery phrase
                                        </Label>
                                        <Input
                                            id="recover-phrase"
                                            value={recoverPhrase}
                                            onChange={(e) =>
                                                setRecoverPhrase(e.target.value)
                                            }
                                            placeholder="BIP39 phrase"
                                            autoComplete="off"
                                        />
                                    </div>
                                    <Turnstile
                                        siteKey={
                                            env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
                                        }
                                        onSuccess={setRecoverCaptcha}
                                    />
                                    <Button
                                        variant="secondary"
                                        onClick={() => void handleRecover()}
                                        disabled={busy || !recoverCaptcha}
                                    >
                                        {recoverMut.isPending ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : null}
                                        Recover account
                                    </Button>
                                </div>
                            </TabsContent>

                            <TabsContent
                                value="devices-constellation"
                                className="space-y-4"
                            >
                                {!remoteConfig?.root ? (
                                    <p className="text-sm text-muted-foreground">
                                        Only the root device can manage linked
                                        devices.
                                    </p>
                                ) : !linkedDeviceTopology?.devices.length ? (
                                    <p className="text-sm text-muted-foreground">
                                        No devices loaded.
                                    </p>
                                ) : (
                                    <DevicesConstellation
                                        map={deviceRelationshipMap}
                                        canPromote={
                                            !!remoteConfig.canPromoteDevices
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
                                )}
                            </TabsContent>

                            <TabsContent value="danger" className="space-y-4">
                                <div className="space-y-2">
                                    <h3 className="text-sm font-medium">
                                        Recovery phrase
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        Generates a recovery phrase stored server-side (hashed)
                                        to recover your Online Services account (subscription).
                                        You can only generate one until it is cleared.
                                    </p>
                                    {recoveryPhraseAlreadyOnServer &&
                                    !recoveryPhraseToCopy ? (
                                        <p className="text-xs text-muted-foreground">
                                            A recovery phrase is already on
                                            file. Clear it below before
                                            generating a new one.
                                        </p>
                                    ) : null}
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                !remoteConfig?.root ||
                                                genRecoveryMut.isPending ||
                                                recoveryPhraseAlreadyOnServer
                                            }
                                            onClick={async () => {
                                                try {
                                                    const res =
                                                        await genRecoveryMut.mutateAsync();
                                                    setRecoveryPhraseToCopy(
                                                        res.token,
                                                    );
                                                    toast.success(
                                                        "Recovery phrase created. Copy it below and store it safely.",
                                                    );
                                                    await refetchConfig();
                                                } catch (e) {
                                                    toast.error(
                                                        e instanceof Error
                                                            ? e.message
                                                            : "Failed",
                                                    );
                                                }
                                            }}
                                        >
                                            Generate
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                !remoteConfig?.root ||
                                                clearRecoveryMut.isPending
                                            }
                                            onClick={async () => {
                                                try {
                                                    await clearRecoveryMut.mutateAsync();
                                                    setRecoveryPhraseToCopy(
                                                        null,
                                                    );
                                                    toast.success(
                                                        "Recovery phrase cleared.",
                                                    );
                                                    await refetchConfig();
                                                } catch (e) {
                                                    toast.error(
                                                        e instanceof Error
                                                            ? e.message
                                                            : "Failed",
                                                    );
                                                }
                                            }}
                                        >
                                            Clear
                                        </Button>
                                    </div>
                                    {recoveryPhraseToCopy ? (
                                        <Alert className="mt-3 border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100">
                                            <AlertTitle className="text-amber-950 dark:text-amber-50">
                                                Save this phrase now
                                            </AlertTitle>
                                            <AlertDescription className="space-y-3 text-amber-950/90 dark:text-amber-50/90">
                                                <p>
                                                    This is the only time it is
                                                    shown in plain text. Anyone
                                                    with this phrase can recover
                                                    your Online Services account (subscription).
                                                </p>
                                                <Textarea
                                                    readOnly
                                                    value={recoveryPhraseToCopy}
                                                    className="font-mono text-xs"
                                                    rows={4}
                                                    aria-label="Recovery phrase"
                                                />
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="secondary"
                                                    className="gap-2"
                                                    onClick={() =>
                                                        void copyRecoveryPhrase(
                                                            recoveryPhraseToCopy,
                                                        )
                                                    }
                                                >
                                                    <Copy className="h-4 w-4" />
                                                    Copy phrase
                                                </Button>
                                            </AlertDescription>
                                        </Alert>
                                    ) : null}
                                </div>

                                <Separator />

                                <div className="space-y-2">
                                    <h3 className="text-sm font-medium">
                                        Remove local account binding
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        Clears passkey credentials stored in
                                        this vault and signs out locally. Use if
                                        the server account no longer exists or
                                        you cannot sign in. This does not delete
                                        the server account or change linked
                                        devices.
                                    </p>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={!passkeyBound || busy}
                                        onClick={() => {
                                            setRemoveLocalBindingOpen(true);
                                            setRecoveryPhraseToCopy(null);
                                        }}
                                    >
                                        Remove local binding…
                                    </Button>
                                </div>

                                <Separator />

                                <div className="space-y-2">
                                    <h3 className="text-sm font-medium text-destructive">
                                        Delete account
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        Permanently removes the server account.
                                        Root device only.
                                    </p>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        disabled={!remoteConfig?.root || busy}
                                        onClick={() =>
                                            setDeleteAccountOpen(true)
                                        }
                                    >
                                        Delete account
                                    </Button>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>

                    <DialogFooter className="border-t border-border px-6 py-3">
                        <Button
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                        >
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
                            This removes the passkey keys stored in this vault
                            and clears your local session. You can do this even
                            if the server account cannot be reached or no longer
                            exists. It does not delete a server-side account.
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
                            {removeLocalBindingPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
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
                        <AlertDialogTitle>
                            Delete account?
                        </AlertDialogTitle>
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
                            {deleteAccountPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Delete account
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
