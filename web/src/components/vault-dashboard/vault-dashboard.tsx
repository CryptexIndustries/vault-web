import {
    establishPremiumSession,
    syncOnlineServicesRemoteConfiguration,
} from "@/app_lib/auth-session";
import {
    LinkedDevice,
    LinkedDevices,
    STUNServerConfiguration,
    SignalingServerConfiguration,
    TURNServerConfiguration,
    Vault,
    VaultCredential,
    calculateTOTP,
    deleteCredential,
} from "@/app_lib/vault-utils/vault";
import { LogInspectorDialog } from "@/components/dialog/log-inspector";
import {
    WarningDialog,
    type WarningDialogShowFn,
} from "@/components/dialog/warning";
import { Button } from "@/components/ui/button";
import { PasswordGeneratorDialog } from "@/components/ui/password-generator";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
    clearOnlineServicesSession,
    linkedDevicesAtom,
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesAuthenticationStatus,
    onlineServicesDataAtom,
    onlineServicesStore,
    setOnlineServicesData,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    unlockedVaultWriteOnlyAtom,
    vaultCredentialsAtom,
    vaultGet,
} from "@/utils/atoms";
import {
    onlineServicesLog,
    signalingLog,
    uiLog,
    vaultLog,
    vaultLogger,
    webrtcLog,
} from "@/utils/logging";
import {
    MISSING_VAULT_SECRET_ERROR,
    clearVaultSecretFromSession,
    getVaultSecretFromSession,
    saveVaultWithSessionSecret,
} from "@/utils/vault-session";
import { useAtomValue, useSetAtom } from "jotai/react";
import { Menu } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SyncConnectionController, VaultOperations } from "src/app_lib/synchronization";
import { AccountDialog } from "./account-dialog";
import { CredentialDetail } from "./credential-detail";
import { CredentialsList } from "./credentials-list";
import {
    DeviceSidebar,
    type DeviceConfigurationDraft,
    type DeviceConnectionStatus,
} from "./device-sidebar";
import { EditDrawer } from "./edit-drawer";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import type { VaultSignalingConfig } from "./link";
import { VaultSettingsDialog } from "./vault-settings-dialog";
import { VaultMetadata } from "src/app_lib/vault-utils/storage";
import * as VaultUtilTypes from "@/app_lib/proto/vault";
import {
    type SCCEvent,
    type SignalingEventData,
    SignalingStatus,
    SyncConnectionControllerEventType,
    type WebRTCEventDataPayload,
    WebRTCMessageEventType,
    WebRTCStatus,
} from "src/app_lib/synchronization-utils";

const DESKTOP_BREAKPOINT = 1024; // lg breakpoint

// Global sync connection controller will be created in the component
let GlobalSyncConnectionController: SyncConnectionController;

const createVaultOperations = (setUnlockedVault: (vault: Vault | ((prev: Vault) => Vault)) => void, vaultMetadata: VaultMetadata | null): VaultOperations => {
    return {
        getItemVersionVectors: async () => {
            return vaultGet().Credentials.map(c => ({
                ID: c.ID,
                Hash: c.Hash,
                Version: c.Version,
                DateModifiedTimestamp: c.DateModifiedTimestamp,
                Deleted: c.Deleted,
            }));
        },
        getItemCredentials: async (itemIDs: string[]) => vaultGet().Credentials.filter(c => itemIDs.includes(c.ID)),
        updateCredentials: async (credentials: VaultUtilTypes.Credential[]) => {
            const currentVault = vaultGet();
            const credentialsMap = new Map(
                currentVault.Credentials.map((credential) => [credential.ID, credential]),
            );

            // Update existing credentials and append missing ones without mutating state in place.
            for (const credential of credentials) {
                credentialsMap.set(credential.ID, credential);
            }

            const updatedVault = Object.assign(
                Object.create(Object.getPrototypeOf(currentVault)),
                currentVault,
                {
                    Credentials: Array.from(credentialsMap.values()),
                },
            );

            setUnlockedVault(updatedVault);

            const toastId = toast.loading("Updating vault data...");

            try {
                // Trigger the vault's save function (this might not be needed when the auto-save feature is implemented)
                const vaultSecretRes = getVaultSecretFromSession();
                if (vaultSecretRes.isErr()) {
                    uiLog.error("Failed to save vault data after synchronization. Failed to retrieve the encryption secret.", {
                        error: vaultSecretRes.error,
                    });
                    toast.error("Failed to save vault data after synchronization. Please check the logs for more information.", {
                        id: toastId,
                    });
                    return;
                }

                if (vaultMetadata) {
                    await vaultMetadata.save(updatedVault, vaultSecretRes.value);
                }

                toast.success("Vault data saved.", {
                    id: toastId,
                    duration: 3000,
                });
            } catch (e) {
                uiLog.error("An error occurred while saving vault data after synchronization.", {
                    error: e,
                });
                toast.error(
                    "An error occurred while saving the vault data after synchronization. Please check the logs for more information.",
                    {
                        id: toastId,
                        duration: 3000,
                    });
            }
        },
        getSynchronizationConfig: async () => vaultGet().LinkedDevices,
    };
};

// Create sync connection controller with vault operations
const createSyncConnectionController = (setUnlockedVault: (vault: Vault | ((prev: Vault) => Vault)) => void, vaultMetadata: VaultMetadata | null) => {
    return new SyncConnectionController(createVaultOperations(setUnlockedVault, vaultMetadata));
};

function getDeviceLastSyncDate(device: LinkedDevice): Date | null {
    return device.LastSync ? new Date(device.LastSync) : null;
}

function getDeviceConnectionStatus(
    device: LinkedDevice,
    syncConnectionController: SyncConnectionController,
): DeviceConnectionStatus {
    return {
        signalingServerStatus: syncConnectionController.getSignalingStatus(
            device.SignalingServerID,
        ),
        webRTCStatus: syncConnectionController.getWebRTCStatus(device.ID),
        lastSync: getDeviceLastSyncDate(device),
    };
}

function buildDeviceConnectionStatuses(
    devices: LinkedDevice[],
    syncConnectionController: SyncConnectionController,
    previousStatuses: Record<string, DeviceConnectionStatus> = {},
) {
    return devices.reduce<Record<string, DeviceConnectionStatus>>(
        (statuses, device) => {
            const previousStatus = previousStatuses[device.ID];
            statuses[device.ID] = {
                signalingServerStatus:
                    previousStatus?.signalingServerStatus ??
                    syncConnectionController.getSignalingStatus(
                        device.SignalingServerID,
                    ),
                webRTCStatus:
                    previousStatus?.webRTCStatus ??
                    syncConnectionController.getWebRTCStatus(device.ID),
                lastSync:
                    getDeviceLastSyncDate(device) ??
                    previousStatus?.lastSync ??
                    null,
            };
            return statuses;
        },
        {},
    );
}

function useDeviceConnectionLifecycle(
    devices: LinkedDevice[],
    syncConnectionController: SyncConnectionController,
) {
    const [deviceConnectionStatuses, setDeviceConnectionStatuses] = useState<
        Record<string, DeviceConnectionStatus>
    >(() => buildDeviceConnectionStatuses(devices, syncConnectionController));

    useEffect(() => {
        setDeviceConnectionStatuses((previousStatuses) =>
            buildDeviceConnectionStatuses(
                devices,
                syncConnectionController,
                previousStatuses,
            ),
        );
    }, [devices, syncConnectionController]);

    useEffect(() => {
        const timeoutIDs: ReturnType<typeof setTimeout>[] = [];
        const signalingHandlerIDs: Array<{
            serverID: string;
            handlerID: string;
        }> = [];

        const mergeDeviceConnectionStatus = (
            device: LinkedDevice,
            status: Partial<DeviceConnectionStatus>,
        ) => {
            setDeviceConnectionStatuses((previousStatuses) => ({
                ...previousStatuses,
                [device.ID]: {
                    ...(previousStatuses[device.ID] ??
                        getDeviceConnectionStatus(device, syncConnectionController)),
                    ...status,
                },
            }));
        };

        devices.forEach((device) => {
            const syncSignalingEventHandler = (
                event: SCCEvent<SignalingEventData>,
            ) => {
                signalingLog.debug("Received sync signaling event", {
                    deviceId: device.ID,
                    deviceName: device.Name,
                    signalingServerId: device.SignalingServerID,
                    eventType: SyncConnectionControllerEventType[event.type],
                    status: SignalingStatus[event.data.connectionState],
                });
                mergeDeviceConnectionStatus(device, {
                    signalingServerStatus: event.data.connectionState,
                });

                const currentWebRTCStatus =
                    syncConnectionController.getWebRTCStatus(device.ID);
                const webRTCConnectedOrConnecting =
                    currentWebRTCStatus === WebRTCStatus.Connected ||
                    currentWebRTCStatus === WebRTCStatus.Connecting;

                if (
                    device.AutoConnect &&
                    event.data.connectionState === SignalingStatus.Connected &&
                    webRTCConnectedOrConnecting
                ) {
                    void syncConnectionController.connectDevice(device.ID);
                }
            };

            const syncWebRTCEventHandler = (event: WebRTCEventDataPayload) => {
                webrtcLog.debug("Received sync WebRTC event", {
                    deviceId: device.ID,
                    deviceName: device.Name,
                    eventType: SyncConnectionControllerEventType[event.type],
                    status:
                        event.type ===
                        SyncConnectionControllerEventType.ConnectionStatus
                            ? WebRTCStatus[event.connectionState]
                            : undefined,
                    messageEvent:
                        event.type ===
                        SyncConnectionControllerEventType.SynchronizationMessage
                            ? WebRTCMessageEventType[event.event]
                            : undefined,
                });

                if (
                    event.type ===
                        SyncConnectionControllerEventType.SynchronizationMessage &&
                    event.event === WebRTCMessageEventType.Synchronized
                ) {
                    device.updateLastSync();
                    mergeDeviceConnectionStatus(device, {
                        lastSync: getDeviceLastSyncDate(device),
                    });
                }

                if (
                    event.type ===
                        SyncConnectionControllerEventType.SynchronizationMessage &&
                    event.event === WebRTCMessageEventType.Error
                ) {
                    // TODO: Surface synchronization errors in the sidebar status.
                }

                if (
                    event.type ===
                    SyncConnectionControllerEventType.ConnectionStatus
                ) {
                    mergeDeviceConnectionStatus(device, {
                        webRTCStatus: event.connectionState,
                    });

                    if (
                        device.SyncTimeout &&
                        event.connectionState === WebRTCStatus.Connected
                    ) {
                        const period =
                            Math.abs(device.SyncTimeoutPeriod) * 1000;
                        webrtcLog.debug("Sync timeout scheduled", {
                            deviceId: device.ID,
                            deviceName: device.Name,
                            timeoutMs: period,
                        });
                        const timeoutID = setTimeout(() => {
                            void syncConnectionController.disconnectDevice(
                                device,
                            );
                            webrtcLog.info("Sync timeout expired, disconnecting device", {
                                deviceId: device.ID,
                                deviceName: device.Name,
                                timeoutMs: period,
                            });
                        }, period);
                        timeoutIDs.push(timeoutID);
                    } else if (
                        event.connectionState === WebRTCStatus.Disconnected ||
                        event.connectionState === WebRTCStatus.Failed
                    ) {
                        if (device.AutoConnect) {
                            void syncConnectionController.disconnectDevice(
                                device,
                            );
                            void syncConnectionController.connectDevice(
                                device.ID,
                            );
                        }
                    }
                }
            };

            const handlerID =
                syncConnectionController.registerSyncSignalingHandler(
                    device.SignalingServerID,
                    syncSignalingEventHandler,
                );

            if (!handlerID) {
                signalingLog.error("Failed to register sync signaling handler", {
                    deviceId: device.ID,
                    deviceName: device.Name,
                    signalingServerId: device.SignalingServerID,
                });
                return;
            }

            signalingHandlerIDs.push({
                serverID: device.SignalingServerID,
                handlerID,
            });

            syncConnectionController.registerSyncWebRTCHandler(
                device.ID,
                syncWebRTCEventHandler,
            );

            if (device.AutoConnect) {
                void syncConnectionController.connectDevice(device.ID);
            }
        });

        const lastSyncRefreshIntervalID = setInterval(() => {
            setDeviceConnectionStatuses((previousStatuses) =>
                buildDeviceConnectionStatuses(
                    devices,
                    syncConnectionController,
                    previousStatuses,
                ),
            );
        }, 60000);

        return () => {
            signalingHandlerIDs.forEach(({ serverID, handlerID }) => {
                syncConnectionController.removeSyncSignalingHandler(
                    serverID,
                    handlerID,
                );
            });

            devices.forEach((device) => {
                syncConnectionController.removeSyncWebRTCHandler(device.ID);
                void syncConnectionController.disconnectDevice(device);
            });

            timeoutIDs.forEach(clearTimeout);
            clearInterval(lastSyncRefreshIntervalID);
        };
    }, [devices, syncConnectionController]);

    return deviceConnectionStatuses;
}

function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(false);

    useEffect(() => {
        const checkDesktop = () =>
            setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
        checkDesktop();
        window.addEventListener("resize", checkDesktop);
        return () => window.removeEventListener("resize", checkDesktop);
    }, []);

    return isDesktop;
}

export function VaultDashboard() {
    const isDesktop = useIsDesktop();
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    /** Session + remote flags live in `onlineServicesStore` (same store tRPC / auth-session use). */
    const onlineServicesData = useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    });
    const unlockedVaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const vaultCredentials = useAtomValue(vaultCredentialsAtom);
    const linkedDevices = useAtomValue(linkedDevicesAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);
    const setVaultCredentials = useSetAtom(vaultCredentialsAtom);
    // const setLinkedDevices = useSetAtom(linkedDevicesAtom);
    const unlockedVaultName = unlockedVaultMetadata?.Name?.trim() || "Vault";
    const unlockedVaultDescription = unlockedVaultMetadata?.Description?.trim();

    const credentials = vaultCredentials.filter((c) => !c.Deleted);
    // const devices = linkedDevices;
    const vaultSignalingConfig: VaultSignalingConfig = {
        stunServers: unlockedVault.LinkedDevices.STUNServers,
        turnServers: unlockedVault.LinkedDevices.TURNServers,
        signalingServers: unlockedVault.LinkedDevices.SignalingServers,
    };

    const [selectedCredential, setSelectedCredential] =
        useState<VaultCredential | null>(null);
    const [editingCredential, setEditingCredential] =
        useState<VaultCredential | null>(null);
    const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [isPasswordGeneratorOpen, setIsPasswordGeneratorOpen] =
        useState(false);
    const [isVaultSettingsOpen, setIsVaultSettingsOpen] = useState(false);
    const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false);
    const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] =
        useState(false);
    const [searchFocusRequestToken, setSearchFocusRequestToken] = useState(0);
    const [filteredCredentials, setFilteredCredentials] =
        useState<VaultCredential[]>(credentials);
    const showWarningDialogFnRef = useRef<WarningDialogShowFn | null>(null);
    const showLogInspectorDialogRef = useRef<(() => void) | null>(null);
    const pendingKeySequenceRef = useRef<string | null>(null);
    const pendingKeyTimeoutRef = useRef<number | null>(null);

    if (!GlobalSyncConnectionController) {
        GlobalSyncConnectionController = createSyncConnectionController(setUnlockedVault, unlockedVaultMetadata);
        GlobalSyncConnectionController.init();
    }

    const deviceConnectionStatuses = useDeviceConnectionLifecycle(
        linkedDevices,
        GlobalSyncConnectionController,
    );

    useEffect(() => {
        if (!selectedCredential) return;

        const fresh = credentials.find((c) => c.ID === selectedCredential.ID);
        if (!fresh) {
            setSelectedCredential(null);
            setIsDetailOpen(false);
            return;
        }

        setSelectedCredential(fresh);
    }, [credentials, selectedCredential]);

    const handleSelectCredential = useCallback(
        (credential: VaultCredential) => {
            setSelectedCredential(
                Object.assign(new VaultCredential(), credential),
            );
            setIsDetailOpen(true);
        },
        [],
    );

    const handleEditCredential = useCallback((credential: VaultCredential) => {
        setEditingCredential(credential);
        setIsEditDrawerOpen(true);
    }, []);

    const handleAddNew = useCallback(() => {
        setEditingCredential(null);
        setIsEditDrawerOpen(true);
    }, []);

    const handleSaveCredential = useCallback(
        async (savedCredential: VaultCredential) => {
            const toastId = toast.loading("Saving vault...");

            const updatedVault = Object.assign(new Vault(), unlockedVault);
            updatedVault.Credentials = [...vaultCredentials];

            const existingIndex = updatedVault.Credentials.findIndex(
                (c) => c.ID === savedCredential.ID,
            );

            if (existingIndex >= 0) {
                updatedVault.Credentials[existingIndex] = savedCredential;
            } else {
                updatedVault.Credentials.push(savedCredential);
            }

            setVaultCredentials(updatedVault.Credentials);

            if (selectedCredential?.ID === savedCredential.ID) {
                setSelectedCredential(savedCredential);
            }
            setEditingCredential(null);

            setUnlockedVault(updatedVault);

            if (!unlockedVaultMetadata) {
                toast.error("Vault metadata is unavailable.");
                return;
            }

            const saveRes = await saveVaultWithSessionSecret(
                unlockedVaultMetadata,
                updatedVault,
            );
            if (saveRes.isErr()) {
                if (saveRes.error === "VAULT_SECRET_NOT_FOUND") {
                    toast.error(
                        "Failed to save vault. Vault encryption secret is missing.",
                        {
                            id: toastId,
                        },
                    );
                    return;
                }

                toast.error(
                    "Failed to save vault. There is a high possibility of data loss!",
                    {
                        id: toastId,
                    },
                );
                return;
            }

            toast.success("Vault saved.", {
                id: toastId,
                duration: 3000,
            });
        },
        [
            selectedCredential,
            setUnlockedVault,
            setVaultCredentials,
            unlockedVault,
            vaultCredentials,
            unlockedVaultMetadata,
        ],
    );

    // const handleSyncDevice = useCallback(
    //     (deviceId: string) => {
    //         setLinkedDevices((prev) =>
    //             prev.map((device) => {
    //                 if (device.ID !== deviceId) return device;
    //                 const updated = Object.assign(new LinkedDevice(), device);
    //                 updated.updateLastSync();
    //                 return updated;
    //             }),
    //         );
    //     },
    //     [setLinkedDevices],
    // );

    const handleSaveSignalingConfig = useCallback(
        async (config: VaultSignalingConfig) => {
            if (!unlockedVaultMetadata) {
                throw new Error("Vault metadata is unavailable.");
            }

            const toastId = toast.loading("Saving signaling configuration...");
            const updatedVault = Object.assign(new Vault(), unlockedVault);
            const updatedLinkedDevices = LinkedDevices.fromGeneric(
                updatedVault.LinkedDevices,
            );

            updatedLinkedDevices.STUNServers = config.stunServers.map(
                (server) =>
                    Object.assign(new STUNServerConfiguration(), server),
            );
            updatedLinkedDevices.TURNServers = config.turnServers.map(
                (server) =>
                    Object.assign(new TURNServerConfiguration(), server),
            );
            updatedLinkedDevices.SignalingServers = config.signalingServers.map(
                (server) =>
                    Object.assign(new SignalingServerConfiguration(), server),
            );

            updatedVault.LinkedDevices = updatedLinkedDevices;

            const saveRes = await saveVaultWithSessionSecret(
                unlockedVaultMetadata,
                updatedVault,
            );
            if (saveRes.isErr()) {
                const message =
                    saveRes.error === "VAULT_SECRET_NOT_FOUND"
                        ? "Failed to save signaling configuration. Vault encryption secret is missing."
                        : "Failed to save signaling configuration.";
                toast.error(message, { id: toastId });
                throw new Error(message);
            }

            setUnlockedVault(updatedVault);
            toast.success("Signaling configuration saved.", {
                id: toastId,
                duration: 3000,
            });
        },
        [setUnlockedVault, unlockedVault, unlockedVaultMetadata],
    );

    const handleSaveDeviceConfig = useCallback(
        async (config: DeviceConfigurationDraft) => {
            if (!unlockedVaultMetadata) {
                throw new Error("Vault metadata is unavailable.");
            }

            const toastId = toast.loading("Saving device configuration...");
            const updatedVault = Object.assign(new Vault(), unlockedVault);
            const updatedLinkedDevices = LinkedDevices.fromGeneric(
                updatedVault.LinkedDevices,
            );
            const deviceExists = updatedLinkedDevices.Devices.some(
                (device) => device.ID === config.ID,
            );

            if (!deviceExists) {
                const message = "Device is no longer linked.";
                toast.error(message, { id: toastId });
                throw new Error(message);
            }

            updatedLinkedDevices.Devices = updatedLinkedDevices.Devices.map(
                (device) => {
                    if (device.ID !== config.ID) return device;
                    return Object.assign(new LinkedDevice(), device, {
                        Name: config.Name,
                        AutoConnect: config.AutoConnect,
                        SyncTimeout: config.SyncTimeout,
                        SyncTimeoutPeriod: config.SyncTimeoutPeriod,
                    });
                },
            );
            updatedVault.LinkedDevices = updatedLinkedDevices;

            const saveRes = await saveVaultWithSessionSecret(
                unlockedVaultMetadata,
                updatedVault,
            );
            if (saveRes.isErr()) {
                const message =
                    saveRes.error === "VAULT_SECRET_NOT_FOUND"
                        ? "Failed to save device configuration. Vault encryption secret is missing."
                        : "Failed to save device configuration.";
                toast.error(message, { id: toastId });
                throw new Error(message);
            }

            setUnlockedVault(updatedVault);
            toast.success("Device configuration saved.", {
                id: toastId,
                duration: 3000,
            });
        },
        [setUnlockedVault, unlockedVault, unlockedVaultMetadata],
    );

    const handleCloseDetail = useCallback(() => {
        setSelectedCredential(null);
        setIsDetailOpen(false);
    }, []);

    const handleCopyUsername = useCallback((credential: VaultCredential) => {
        navigator.clipboard.writeText(credential.Username);
        toast.info("Copied username to clipboard.");
    }, []);

    const handleCopyPassword = useCallback((credential: VaultCredential) => {
        navigator.clipboard.writeText(credential.Password);
        toast.info("Copied password to clipboard.");
    }, []);

    const handleCopyTOTP = useCallback((credential: VaultCredential) => {
        if (!credential.TOTP) return;
        const data = calculateTOTP(credential.TOTP);

        navigator.clipboard.writeText(data.code);
        toast.info(
            `Copied OTP to clipboard; ${data.timeRemaining} seconds left`,
            {
                duration: 3000,
                id: "copy-otp",
            },
        );
    }, []);

    const handleOpenCredentialUrl = useCallback(
        (credential: VaultCredential) => {
            if (!credential.URL || !URL.canParse(credential.URL)) {
                toast.error("Credential URL is invalid.");
                return;
            }

            const url = new URL(credential.URL);
            if (url.protocol !== "https:") {
                url.protocol = "https:";
            }

            const urlString = url.toString();
            showWarningDialogFnRef.current?.(
                `You are about to visit "${urlString}"`,
                () => {
                    window.open(urlString, "_blank", "noopener,noreferrer");
                },
                () => {
                    // No-op
                },
                "Open URL",
            );
        },
        [],
    );

    const handleDeleteCredential = useCallback(
        (credential: VaultCredential) => {
            if (!unlockedVaultMetadata) {
                toast.error("Vault metadata is unavailable.");
                return;
            }

            showWarningDialogFnRef.current?.(
                `You are about to remove the "${credential.Name}" credential.`,
                async () => {
                    const toastId = toast.loading("Removing credential...");

                    try {
                        const updatedVault = Object.assign(
                            new Vault(),
                            unlockedVault,
                        );
                        const deleted = await deleteCredential(
                            [...updatedVault.Credentials],
                            credential.ID,
                        );

                        if (deleted.isErr()) {
                            toast.error(
                                "Failed to remove credential. Could not find the credential to delete.",
                                { id: toastId },
                            );
                            return;
                        }

                        updatedVault.Credentials = deleted.value;
                        setVaultCredentials(deleted.value);
                        setUnlockedVault(updatedVault);

                        const saveRes = await saveVaultWithSessionSecret(
                            unlockedVaultMetadata,
                            updatedVault,
                        );
                        if (saveRes.isErr()) {
                            if (saveRes.error === "VAULT_SECRET_NOT_FOUND") {
                                toast.error(
                                    "Failed to remove credential. Vault encryption secret is missing.",
                                    { id: toastId },
                                );
                                return;
                            }

                            toast.error(
                                "Failed to remove credential. Failed to save the vault.",
                                { id: toastId },
                            );
                            return;
                        }

                        toast.success("Credential removed.", {
                            id: toastId,
                            duration: 3000,
                        });
                    } catch (error) {
                        vaultLog.error("Failed to remove credential", {
                            credentialId: credential.ID,
                            credentialName: credential.Name,
                            error,
                        });
                        toast.error(
                            "Failed to remove credential. Failed to save the vault.",
                            { id: toastId },
                        );
                    }
                },
                () => {
                    // No-op
                },
                "Remove credential",
            );
        },
        [
            setUnlockedVault,
            setVaultCredentials,
            unlockedVault,
            unlockedVaultMetadata,
        ],
    );

    const handleOpenVaultSettings = useCallback(() => {
        setIsVaultSettingsOpen(true);
    }, []);

    const handleOpenAccountDialog = useCallback(() => {
        setIsAccountDialogOpen(true);
    }, []);

    const passkeyBound = Vault.isOnlineServicesBound(unlockedVault);
    const hasOnlineAuth = !!onlineServicesData?.sessionToken?.length;

    const accountButtonLabel = (() => {
        if (!passkeyBound) return "Sign up";
        if (!hasOnlineAuth) return "Sign in";
        return "Connected";
    })();

    const accountButtonClassName = cn(
        "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/70 mb-1 h-9 w-full justify-start gap-2 rounded-md text-xs transition-all",
        hasOnlineAuth &&
            passkeyBound &&
            "text-emerald-700 dark:text-emerald-400",
    );

    const ensureSession = useCallback(async () => {
        let cancelled = false;

        const vaultOs = unlockedVault.OnlineServices;
        if (!vaultOs) {
            return;
        }

        const data = onlineServicesStore.get(onlineServicesDataAtom);
        if (data?.sessionToken?.length && data.deviceId !== vaultOs.DeviceId) {
            setOnlineServicesData(null);
            onlineServicesStore.set(
                onlineServicesAuthConnectionStatusAtom,
                onlineServicesAuthenticationStatus.disconnected(),
            );
        } else if (data?.sessionToken?.length && data.deviceId === vaultOs.DeviceId) {
            // Get out, we're already signed in and the device id matches
            return;
        }

        try {
            await establishPremiumSession({
                deviceId: vaultOs.DeviceId,
                privateKeyJWK: vaultOs.PrivateKeyJWK,
            });
            if (cancelled) return;
            await syncOnlineServicesRemoteConfiguration();
        } catch (e) {
            onlineServicesLog.error("Failed to establish Online Services session", {
                deviceId: vaultOs.DeviceId,
                error: e,
            });
            toast.error(
                "Could not sign in to Online Services. Open Account to retry.",
            );
        }

        return () => {
            cancelled = true;
        };
    }, [unlockedVault.OnlineServices]);

    useEffect(() => {
        void (async () => {
            await ensureSession();
        })();
    }, [ensureSession]);

    const handleOpenPasswordGenerator = useCallback(() => {
        setIsPasswordGeneratorOpen(true);
    }, []);

    const handleLockVault = useCallback(async () => {
        if (!unlockedVaultMetadata) {
            toast.error("Vault metadata is unavailable.");
            return;
        }

        const toastId = toast.loading("Securing vault...");

        const saveRes = await saveVaultWithSessionSecret(
            unlockedVaultMetadata,
            unlockedVault,
        );
        if (saveRes.isErr()) {
            if (saveRes.error === "VAULT_SECRET_NOT_FOUND") {
                toast.error(MISSING_VAULT_SECRET_ERROR, { id: toastId });
                return;
            }

            toast.error(
                "Failed to save vault. There is a high possibility of data loss!",
                {
                    id: toastId,
                },
            );
            return;
        }

        try {
            clearVaultSecretFromSession();

            onlineServicesStore.set(
                onlineServicesAuthConnectionStatusAtom,
                onlineServicesAuthenticationStatus.disconnected(),
            );
            clearOnlineServicesSession();
            setUnlockedVaultMetadata(null);
            await setUnlockedVault(async () => new Vault());
            vaultLogger.clearAll();

            toast.success("Vault secured.", { id: toastId, duration: 3000 });
        } catch (error) {
            vaultLog.error("Failed to lock vault", { error });
            toast.error(
                "Failed to lock vault. There is a high possibility of data loss!",
                {
                    id: toastId,
                },
            );
        }
    }, [
        setUnlockedVault,
        setUnlockedVaultMetadata,
        unlockedVault,
        unlockedVaultMetadata,
    ]);

    const showWarningDialog = useCallback(
        (...args: Parameters<WarningDialogShowFn>) => {
            showWarningDialogFnRef.current?.(...args);
        },
        [showWarningDialogFnRef],
    );

    const lockVaultConfirm = useCallback(() => {
        showWarningDialogFnRef.current?.(
            "Are you sure you want to lock the vault?",
            handleLockVault,
            () => {
                // No-op
            },
            "Lock Vault",
            "This will lock the vault and prevent anyone from accessing it.",
            5,
        );
    }, [handleLockVault]);

    const handleFilteredCredentialsChange = useCallback(
        (nextFilteredCredentials: VaultCredential[]) => {
            setFilteredCredentials((prev) => {
                if (prev.length !== nextFilteredCredentials.length) {
                    return nextFilteredCredentials;
                }

                const hasChanged = prev.some(
                    (credential, index) =>
                        credential.ID !== nextFilteredCredentials[index]?.ID,
                );
                return hasChanged ? nextFilteredCredentials : prev;
            });
        },
        [],
    );

    const clearPendingKeySequence = useCallback(() => {
        pendingKeySequenceRef.current = null;
        if (pendingKeyTimeoutRef.current !== null) {
            window.clearTimeout(pendingKeyTimeoutRef.current);
            pendingKeyTimeoutRef.current = null;
        }
    }, []);

    const selectCredentialAtIndex = useCallback(
        (index: number) => {
            const credential = filteredCredentials[index];
            if (!credential) return;
            handleSelectCredential(credential);
        },
        [filteredCredentials, handleSelectCredential],
    );

    const moveSelection = useCallback(
        (delta: number) => {
            if (filteredCredentials.length === 0) return;

            if (!selectedCredential) {
                const fallbackIndex =
                    delta > 0 ? 0 : filteredCredentials.length - 1;
                selectCredentialAtIndex(fallbackIndex);
                return;
            }

            const currentIndex = filteredCredentials.findIndex(
                (credential) => credential.ID === selectedCredential.ID,
            );
            if (currentIndex < 0) {
                const fallbackIndex =
                    delta > 0 ? 0 : filteredCredentials.length - 1;
                selectCredentialAtIndex(fallbackIndex);
                return;
            }

            const nextIndex = Math.max(
                0,
                Math.min(filteredCredentials.length - 1, currentIndex + delta),
            );
            selectCredentialAtIndex(nextIndex);
        },
        [filteredCredentials, selectCredentialAtIndex, selectedCredential],
    );

    useEffect(() => {
        if (filteredCredentials.length === 0) {
            setSelectedCredential(null);
            setIsDetailOpen(false);
            return;
        }

        if (!selectedCredential) return;
        const selectedStillVisible = filteredCredentials.some(
            (credential) => credential.ID === selectedCredential.ID,
        );
        if (!selectedStillVisible) {
            selectCredentialAtIndex(0);
        }
    }, [filteredCredentials, selectCredentialAtIndex, selectedCredential]);

    useEffect(() => {
        const isTypingElement = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return false;
            return Boolean(
                target.closest(
                    'input, textarea, select, [contenteditable="true"], [role="textbox"]',
                ),
            );
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.defaultPrevented ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey
            ) {
                return;
            }

            const hasBlockingOverlay =
                isEditDrawerOpen ||
                isSidebarOpen ||
                isVaultSettingsOpen ||
                isAccountDialogOpen ||
                isPasswordGeneratorOpen;
            if (hasBlockingOverlay) return;

            if (isTypingElement(event.target)) return;

            if (event.key === "?") {
                event.preventDefault();
                setIsKeyboardShortcutsOpen(true);
                clearPendingKeySequence();
                return;
            }

            if (isKeyboardShortcutsOpen) return;

            if (event.key === "/") {
                event.preventDefault();
                setSearchFocusRequestToken((prev) => prev + 1);
                clearPendingKeySequence();
                return;
            }

            if (event.key === "j") {
                event.preventDefault();
                moveSelection(1);
                clearPendingKeySequence();
                return;
            }

            if (event.key === "k") {
                event.preventDefault();
                moveSelection(-1);
                clearPendingKeySequence();
                return;
            }

            if (event.key === "G") {
                event.preventDefault();
                selectCredentialAtIndex(filteredCredentials.length - 1);
                clearPendingKeySequence();
                return;
            }

            if (event.key === "g") {
                event.preventDefault();
                if (pendingKeySequenceRef.current === "g") {
                    selectCredentialAtIndex(0);
                    clearPendingKeySequence();
                    return;
                }

                pendingKeySequenceRef.current = "g";
                if (pendingKeyTimeoutRef.current !== null) {
                    window.clearTimeout(pendingKeyTimeoutRef.current);
                }
                pendingKeyTimeoutRef.current = window.setTimeout(() => {
                    clearPendingKeySequence();
                }, 450);
                return;
            }

            if (event.key === "Enter" || event.key === "o") {
                if (!selectedCredential) return;
                event.preventDefault();
                setIsDetailOpen(true);
                clearPendingKeySequence();
                return;
            }

            clearPendingKeySequence();
        };

        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            clearPendingKeySequence();
        };
    }, [
        clearPendingKeySequence,
        filteredCredentials.length,
        isAccountDialogOpen,
        isEditDrawerOpen,
        isKeyboardShortcutsOpen,
        isPasswordGeneratorOpen,
        isSidebarOpen,
        isVaultSettingsOpen,
        moveSelection,
        selectCredentialAtIndex,
        selectedCredential,
    ]);

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            {/* Mobile Header */}
            <div className="fixed left-0 right-0 top-0 z-40 flex items-center justify-between border-b border-border bg-background p-2 sm:p-3 lg:hidden">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsSidebarOpen(true)}
                    aria-label="Open device menu"
                >
                    <Menu className="h-5 w-5" />
                </Button>
                <span className="font-semibold text-foreground">
                    {unlockedVaultName}
                </span>
                <div className="w-9" /> {/* Spacer for centering */}
            </div>

            {/* Mobile Sidebar Sheet */}
            <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
                <SheetContent side="left" className="w-72 p-0">
                    <DeviceSidebar
                        vaultName={unlockedVaultName}
                        vaultDescription={unlockedVaultDescription}
                        devices={linkedDevices}
                        onSaveDeviceConfig={handleSaveDeviceConfig}
                        onOpenAccountDialog={handleOpenAccountDialog}
                        accountButtonLabel={accountButtonLabel}
                        accountButtonClassName={accountButtonClassName}
                        onOpenVaultSettings={handleOpenVaultSettings}
                        onOpenPasswordGenerator={handleOpenPasswordGenerator}
                        onLockVault={lockVaultConfirm}
                        signalingConfig={vaultSignalingConfig}
                        onSaveSignalingConfig={handleSaveSignalingConfig}
                        syncConnectionController={GlobalSyncConnectionController}
                        deviceConnectionStatuses={deviceConnectionStatuses}
                        showWarningDialog={showWarningDialog}
                        isMobile
                        onClose={() => setIsSidebarOpen(false)}
                    />
                </SheetContent>
            </Sheet>

            {/* Desktop Sidebar */}
            <div className="hidden lg:block">
                <DeviceSidebar
                    vaultName={unlockedVaultName}
                    vaultDescription={unlockedVaultDescription}
                    devices={linkedDevices}
                    onSaveDeviceConfig={handleSaveDeviceConfig}
                    onOpenAccountDialog={handleOpenAccountDialog}
                    accountButtonLabel={accountButtonLabel}
                    accountButtonClassName={accountButtonClassName}
                    onOpenVaultSettings={handleOpenVaultSettings}
                    onOpenPasswordGenerator={handleOpenPasswordGenerator}
                    onLockVault={lockVaultConfirm}
                    signalingConfig={vaultSignalingConfig}
                    onSaveSignalingConfig={handleSaveSignalingConfig}
                    syncConnectionController={GlobalSyncConnectionController}
                    deviceConnectionStatuses={deviceConnectionStatuses}
                    showWarningDialog={showWarningDialog}
                />
            </div>

            {/* Main Content */}
            <div className="flex min-w-0 flex-1 pt-14 lg:pt-0">
                {/* Credentials List */}
                <CredentialsList
                    credentials={credentials}
                    selectedId={selectedCredential?.ID || null}
                    onSelect={handleSelectCredential}
                    onAddNew={handleAddNew}
                    onCopyUsername={handleCopyUsername}
                    onCopyPassword={handleCopyPassword}
                    onCopyTOTP={handleCopyTOTP}
                    onOpenUrl={handleOpenCredentialUrl}
                    onDeleteCredential={handleDeleteCredential}
                    onFilteredCredentialsChange={
                        handleFilteredCredentialsChange
                    }
                    searchFocusRequestToken={searchFocusRequestToken}
                />

                {/* Desktop Detail Panel */}
                <div className="hidden lg:block">
                    <CredentialDetail
                        credential={selectedCredential}
                        onEdit={handleEditCredential}
                        onClose={handleCloseDetail}
                        onCopyUsername={handleCopyUsername}
                        onCopyPassword={handleCopyPassword}
                        onCopyTOTP={handleCopyTOTP}
                        onOpenUrl={handleOpenCredentialUrl}
                        onDeleteCredential={handleDeleteCredential}
                    />
                </div>

                {/* Mobile Detail Sheet - only renders on mobile */}
                {!isDesktop && (
                    <Sheet
                        open={isDetailOpen && !!selectedCredential}
                        onOpenChange={(open) => {
                            if (!open) handleCloseDetail();
                        }}
                    >
                        <SheetContent
                            side="right"
                            className="w-full p-0 sm:w-96"
                        >
                            <CredentialDetail
                                credential={selectedCredential}
                                onEdit={handleEditCredential}
                                onClose={handleCloseDetail}
                                isMobile
                                onCopyUsername={handleCopyUsername}
                                onCopyPassword={handleCopyPassword}
                                onCopyTOTP={handleCopyTOTP}
                                onOpenUrl={handleOpenCredentialUrl}
                                onDeleteCredential={handleDeleteCredential}
                            />
                        </SheetContent>
                    </Sheet>
                )}
            </div>

            {/* Edit Drawer */}
            <EditDrawer
                credential={editingCredential}
                isOpen={isEditDrawerOpen}
                onClose={() => setIsEditDrawerOpen(false)}
                onSave={handleSaveCredential}
            />
            <div className="fixed bottom-4 left-4 right-4 z-50 lg:left-3 lg:right-auto"></div>
            <PasswordGeneratorDialog
                open={isPasswordGeneratorOpen}
                onOpenChange={setIsPasswordGeneratorOpen}
            />
            <VaultSettingsDialog
                open={isVaultSettingsOpen}
                onOpenChange={setIsVaultSettingsOpen}
                onOpenLogInspector={() => showLogInspectorDialogRef.current?.()}
            />
            <AccountDialog
                open={isAccountDialogOpen}
                onOpenChange={setIsAccountDialogOpen}
            />
            <LogInspectorDialog showDialogFnRef={showLogInspectorDialogRef} />
            <WarningDialog showFnRef={showWarningDialogFnRef} />
            <KeyboardShortcutsDialog
                open={isKeyboardShortcutsOpen}
                onOpenChange={setIsKeyboardShortcutsOpen}
            />
        </div>
    );
}
