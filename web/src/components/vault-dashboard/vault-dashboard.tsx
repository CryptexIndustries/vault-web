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
    createCredential,
    createDirectory,
    Directory,
    deleteDirectory,
    deleteCredential,
    moveCredentialsToDirectory,
    updateCredentialFromForm,
    updateDirectory,
} from "@/app_lib/vault-utils/vault";
import type { CredentialFormSchemaType } from "@/app_lib/vault-utils/vault";
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
} from "@/utils/atoms";
import { copySecretToClipboard } from "@/utils/clipboard";
import { normalizeCredentialUrl } from "@/utils/credential-url";
import {
    onlineServicesLog,
    signalingLog,
    vaultLog,
    webrtcLog,
} from "@/utils/logging";
import { MISSING_VAULT_SECRET_ERROR } from "@/utils/vault-session";
import { persistVaultMutation } from "@/utils/vault-mutations";
import {
    useVaultAutoLock,
    type VaultAutoLockReason,
} from "@/utils/vault-auto-lock";
import { lockUnlockedVault } from "@/utils/vault-lock";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { useAtomValue, useSetAtom } from "jotai/react";
import { Menu } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SyncConnectionController } from "src/app_lib/synchronization";
import type { VaultWriteKind } from "@/app_lib/vault-utils/vault-write-coordinator";
import { AccountDialog } from "./account-dialog";
import { CredentialDetail } from "./credential-detail";
import { CredentialsList } from "./credentials-list";
import {
    DeviceSidebar,
    type DeviceConfigurationDraft,
    type DeviceConnectionStatus,
} from "./device-sidebar";
import { EditDrawer } from "./edit-drawer";
import { SecurityReport } from "./security-report";
import { useSecurityAnalysis } from "./use-security-analysis";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import type { VaultSignalingConfig } from "./link";
import {
    shouldAutoReconnectAfterWebRTCStatus,
    useSyncConnectionController,
} from "./sync-controller";
import { VaultSettingsDialog } from "./vault-settings-dialog";
import { VaultMigrationNoticeDialog } from "./vault-migration-notice-dialog";
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

type DashboardView = "credentials" | "security-report";

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
                        getDeviceConnectionStatus(
                            device,
                            syncConnectionController,
                        )),
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
                    device.LastSync = new Date().toISOString();
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
                            webrtcLog.info(
                                "Sync timeout expired, disconnecting device",
                                {
                                    deviceId: device.ID,
                                    deviceName: device.Name,
                                    timeoutMs: period,
                                },
                            );
                        }, period);
                        timeoutIDs.push(timeoutID);
                    } else if (
                        shouldAutoReconnectAfterWebRTCStatus(
                            device,
                            event.connectionState,
                        )
                    ) {
                        void syncConnectionController.disconnectDevice(device);
                        void syncConnectionController.connectDevice(device.ID);
                    }
                }
            };

            const handlerID =
                syncConnectionController.registerSyncSignalingHandler(
                    device.SignalingServerID,
                    syncSignalingEventHandler,
                );

            if (!handlerID) {
                signalingLog.error(
                    "Failed to register sync signaling handler",
                    {
                        deviceId: device.ID,
                        deviceName: device.Name,
                        signalingServerId: device.SignalingServerID,
                    },
                );
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
    // const setLinkedDevices = useSetAtom(linkedDevicesAtom);
    const unlockedVaultName = unlockedVaultMetadata?.Name?.trim() || "Vault";
    const unlockedVaultDescription = unlockedVaultMetadata?.Description?.trim();

    const allCredentials = vaultCredentials.filter((c) => !c.Deleted);
    const cloudServicesEnabled = isCloudServicesEnabled();
    // const devices = linkedDevices;
    const vaultSignalingConfig: VaultSignalingConfig = {
        stunServers: unlockedVault.LinkedDevices.STUNServers,
        turnServers: unlockedVault.LinkedDevices.TURNServers,
        signalingServers: unlockedVault.LinkedDevices.SignalingServers,
    };

    const [selectedCredential, setSelectedCredential] =
        useState<VaultCredential | null>(null);
    const [dashboardView, setDashboardView] =
        useState<DashboardView>("credentials");
    const [selectedDirectoryID, setSelectedDirectoryID] =
        useState<string>("all");
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
        useState<VaultCredential[]>(allCredentials);
    const showWarningDialogFnRef = useRef<WarningDialogShowFn | null>(null);
    const showLogInspectorDialogRef = useRef<(() => void) | null>(null);
    const pendingKeySequenceRef = useRef<string | null>(null);
    const pendingKeyTimeoutRef = useRef<number | null>(null);
    const syncConnectionController = useSyncConnectionController(
        unlockedVaultMetadata,
    );
    const credentials = allCredentials.filter(
        (credential) =>
            selectedDirectoryID === "all" ||
            credential.DirectoryID === selectedDirectoryID,
    );
    const credentialCounts = allCredentials.reduce<Record<string, number>>(
        (counts, credential) => {
            counts.all = (counts.all ?? 0) + 1;
            const key = credential.DirectoryID || "root";
            counts[key] = (counts[key] ?? 0) + 1;
            return counts;
        },
        { all: 0, root: 0 },
    );
    const {
        analysis: securityAnalysis,
        progress: securityAnalysisProgress,
        isAnalyzing: isSecurityAnalysisRunning,
        error: securityAnalysisError,
        analyzedAt: securityAnalysisAnalyzedAt,
        refresh: refreshSecurityAnalysis,
    } = useSecurityAnalysis(
        vaultCredentials,
        dashboardView === "security-report",
    );

    const deviceConnectionStatuses = useDeviceConnectionLifecycle(
        linkedDevices,
        syncConnectionController,
    );

    useEffect(() => {
        if (dashboardView !== "credentials") return;
        if (!selectedCredential) return;

        const fresh = credentials.find((c) => c.ID === selectedCredential.ID);
        if (!fresh) {
            setSelectedCredential(null);
            setIsDetailOpen(false);
            return;
        }

        setSelectedCredential(fresh);
    }, [credentials, dashboardView, selectedCredential]);

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

    const handleEditSecurityFinding = useCallback(
        (credentialId: string) => {
            const credential = vaultCredentials.find(
                (item) => item.ID === credentialId && !item.Deleted,
            );
            if (credential) handleEditCredential(credential);
        },
        [handleEditCredential, vaultCredentials],
    );

    const handleAddNew = useCallback(() => {
        setEditingCredential(null);
        setIsEditDrawerOpen(true);
    }, []);

    const handleSaveCredential = useCallback(
        async (form: CredentialFormSchemaType) => {
            const toastId = toast.loading("Saving vault...");

            const mutationResult = await persistVaultMutation(
                "credential.upsert",
                async (currentVault) => {
                    const updatedVault = Object.assign(
                        new Vault(),
                        currentVault,
                    );
                    updatedVault.Credentials = [...currentVault.Credentials];

                    const existingIndex = form.ID
                        ? updatedVault.Credentials.findIndex(
                              (credential) =>
                                  credential.ID === form.ID &&
                                  !credential.Deleted,
                          )
                        : -1;
                    if (form.ID && existingIndex < 0) {
                        throw new Error("Credential is no longer available");
                    }
                    const existingCredential =
                        existingIndex >= 0
                            ? updatedVault.Credentials[existingIndex]
                            : undefined;
                    const savedCredential = existingCredential
                        ? await updateCredentialFromForm(
                              existingCredential,
                              form,
                          )
                        : await createCredential(form);

                    if (existingIndex >= 0) {
                        updatedVault.Credentials[existingIndex] =
                            savedCredential;
                    } else {
                        updatedVault.Credentials.push(savedCredential);
                    }

                    return { vault: updatedVault, result: savedCredential };
                },
            );

            if (mutationResult.isErr()) {
                if (mutationResult.error === "VAULT_DEK_NOT_FOUND") {
                    toast.error(
                        "Failed to save vault. Vault encryption secret is missing.",
                        {
                            id: toastId,
                        },
                    );
                    return false;
                }

                toast.error(
                    mutationResult.error === "VAULT_METADATA_MISSING"
                        ? "Vault metadata is unavailable."
                        : "Failed to save vault.",
                    {
                        id: toastId,
                    },
                );
                return false;
            }

            const savedCredential = mutationResult.value;
            if (selectedCredential?.ID === savedCredential.ID) {
                setSelectedCredential(savedCredential);
            }
            setEditingCredential(null);

            toast.success("Vault saved.", {
                id: toastId,
                duration: 3000,
            });
            return true;
        },
        [selectedCredential],
    );

    const saveDirectoryChange = useCallback(
        async (
            kind: VaultWriteKind,
            buildUpdatedVault: (currentVault: Vault) => Promise<Vault>,
            successMessage: string,
        ) => {
            const mutationResult = await persistVaultMutation(
                kind,
                async (currentVault) => ({
                    vault: await buildUpdatedVault(currentVault),
                    result: undefined,
                }),
            );
            if (mutationResult.isErr()) {
                throw new Error("Failed to save directory changes");
            }
            toast.success(successMessage);
        },
        [],
    );

    const handleCreateDirectory = useCallback(
        async (name: string) => {
            let createdDirectoryID = "";
            await saveDirectoryChange(
                "directory.create",
                async (currentVault) => {
                    const updatedVault = Object.assign(
                        new Vault(),
                        currentVault,
                        {
                            Directories: [...currentVault.Directories],
                        },
                    );
                    const directory = await createDirectory(
                        updatedVault.Directories,
                        { ID: null, Name: name },
                    );
                    createdDirectoryID = directory.ID;
                    return updatedVault;
                },
                "Directory created.",
            );
            setSelectedDirectoryID(createdDirectoryID);
        },
        [saveDirectoryChange],
    );

    const handleRenameDirectory = useCallback(
        async (directoryID: string, name: string) => {
            await saveDirectoryChange(
                "directory.rename",
                async (currentVault) => {
                    const updatedVault = Object.assign(
                        new Vault(),
                        currentVault,
                        {
                            Directories: currentVault.Directories.map(
                                (directory) =>
                                    Object.assign(new Directory(), directory),
                            ),
                        },
                    );
                    await updateDirectory(
                        updatedVault.Directories,
                        directoryID,
                        { Name: name },
                    );
                    return updatedVault;
                },
                "Directory renamed.",
            );
        },
        [saveDirectoryChange],
    );

    const handleDeleteDirectory = useCallback(
        async (directoryID: string) => {
            const directory = unlockedVault.Directories.find(
                (entry) => entry.ID === directoryID && !entry.Deleted,
            );
            if (!directory) return;
            const count = allCredentials.filter(
                (credential) => credential.DirectoryID === directoryID,
            ).length;
            showWarningDialogFnRef.current?.(
                `Delete “${directory.Name}” and ${count} credential${count === 1 ? "" : "s"}? This permanently deletes every credential in the directory.`,
                async () => {
                    const mutationResult = await persistVaultMutation(
                        "directory.delete",
                        async (currentVault) => {
                            const updatedVault = Object.assign(
                                new Vault(),
                                currentVault,
                                {
                                    Directories: currentVault.Directories.map(
                                        (entry) =>
                                            Object.assign(
                                                new Directory(),
                                                entry,
                                            ),
                                    ),
                                    Credentials: currentVault.Credentials.map(
                                        (currentCredential) =>
                                            Object.assign(
                                                new VaultCredential(),
                                                currentCredential,
                                            ),
                                    ),
                                },
                            );
                            await deleteDirectory(
                                updatedVault.Directories,
                                updatedVault.Credentials,
                                directoryID,
                            );
                            return { vault: updatedVault, result: undefined };
                        },
                    );
                    if (mutationResult.isErr()) {
                        throw new Error(
                            "Failed to save directory and credential deletion",
                        );
                    }
                    toast.success("Directory and credentials deleted.");
                    setSelectedDirectoryID("all");
                },
                () => undefined,
                "Delete directory",
            );
        },
        [allCredentials, unlockedVault.Directories],
    );

    const handleMoveCredentials = useCallback(
        async (credentialIDs: string[], directoryID: string) => {
            const mutationResult = await persistVaultMutation(
                "credentials.move",
                async (currentVault) => {
                    const updatedVault = Object.assign(
                        new Vault(),
                        currentVault,
                        {
                            Credentials: currentVault.Credentials.map(
                                (credential) =>
                                    Object.assign(
                                        new VaultCredential(),
                                        credential,
                                    ),
                            ),
                        },
                    );
                    await moveCredentialsToDirectory(
                        updatedVault.Credentials,
                        credentialIDs,
                        directoryID,
                        updatedVault.Directories,
                    );
                    return { vault: updatedVault, result: undefined };
                },
            );
            if (mutationResult.isErr()) {
                throw new Error("Failed to save credential move");
            }
            toast.success("Credentials moved.");
        },
        [],
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
            const toastId = toast.loading("Saving signaling configuration...");
            const mutationResult = await persistVaultMutation(
                "vault.configuration",
                (currentVault) => {
                    const updatedVault = Object.assign(
                        new Vault(),
                        currentVault,
                    );
                    const updatedLinkedDevices = LinkedDevices.fromGeneric(
                        currentVault.LinkedDevices,
                    );

                    updatedLinkedDevices.STUNServers = config.stunServers.map(
                        (server) =>
                            Object.assign(
                                new STUNServerConfiguration(),
                                server,
                            ),
                    );
                    updatedLinkedDevices.TURNServers = config.turnServers.map(
                        (server) =>
                            Object.assign(
                                new TURNServerConfiguration(),
                                server,
                            ),
                    );
                    updatedLinkedDevices.SignalingServers =
                        config.signalingServers.map((server) =>
                            Object.assign(
                                new SignalingServerConfiguration(),
                                server,
                            ),
                        );

                    updatedVault.LinkedDevices = updatedLinkedDevices;
                    return { vault: updatedVault, result: undefined };
                },
            );
            if (mutationResult.isErr()) {
                const message =
                    mutationResult.error === "VAULT_DEK_NOT_FOUND"
                        ? "Failed to save signaling configuration. Vault encryption secret is missing."
                        : "Failed to save signaling configuration.";
                toast.error(message, { id: toastId });
                throw new Error(message);
            }

            toast.success("Signaling configuration saved.", {
                id: toastId,
                duration: 3000,
            });
        },
        [],
    );

    const handleSaveDeviceConfig = useCallback(
        async (config: DeviceConfigurationDraft) => {
            const toastId = toast.loading("Saving device configuration...");
            const mutationResult = await persistVaultMutation(
                "vault.configuration",
                (currentVault) => {
                    const updatedVault = Object.assign(
                        new Vault(),
                        currentVault,
                    );
                    const updatedLinkedDevices = LinkedDevices.fromGeneric(
                        currentVault.LinkedDevices,
                    );
                    const deviceExists = updatedLinkedDevices.Devices.some(
                        (device) => device.ID === config.ID,
                    );

                    if (!deviceExists) {
                        throw new Error("Device is no longer linked.");
                    }

                    updatedLinkedDevices.Devices =
                        updatedLinkedDevices.Devices.map((device) => {
                            if (device.ID !== config.ID) return device;
                            return Object.assign(
                                LinkedDevices.fromGenericDevice(device),
                                {
                                    Name: config.Name,
                                    AutoConnect: config.AutoConnect,
                                    AutoSync: config.AutoSync,
                                    SyncTimeout: config.SyncTimeout,
                                    SyncTimeoutPeriod: config.SyncTimeoutPeriod,
                                },
                            );
                        });
                    updatedVault.LinkedDevices = updatedLinkedDevices;
                    return { vault: updatedVault, result: undefined };
                },
            );
            if (mutationResult.isErr()) {
                const message =
                    mutationResult.error === "VAULT_DEK_NOT_FOUND"
                        ? "Failed to save device configuration. Vault encryption secret is missing."
                        : mutationResult.error === "VAULT_MUTATION_FAILED"
                          ? "Device is no longer linked."
                          : "Failed to save device configuration.";
                toast.error(message, { id: toastId });
                throw new Error(message);
            }

            toast.success("Device configuration saved.", {
                id: toastId,
                duration: 3000,
            });
        },
        [],
    );

    const handleCloseDetail = useCallback(() => {
        setSelectedCredential(null);
        setIsDetailOpen(false);
    }, []);

    const handleCopyUsername = useCallback((credential: VaultCredential) => {
        void copySecretToClipboard(credential.Username);
    }, []);

    const handleCopyPassword = useCallback((credential: VaultCredential) => {
        void copySecretToClipboard(credential.Password);
    }, []);

    const handleCopyTOTP = useCallback((credential: VaultCredential) => {
        if (!credential.TOTP) return;
        const data = calculateTOTP(credential.TOTP);

        void copySecretToClipboard(data.code, { toastId: "copy-otp" });
    }, []);

    const handleOpenCredentialUrl = useCallback(
        (credential: VaultCredential) => {
            const urlString = normalizeCredentialUrl(credential.URL);
            if (!urlString) {
                toast.error("Credential URL is invalid.");
                return;
            }

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

    const handleOpenSecurityFindingUrl = useCallback(
        (credentialId: string) => {
            const credential = vaultCredentials.find(
                (item) => item.ID === credentialId && !item.Deleted,
            );
            if (credential) handleOpenCredentialUrl(credential);
        },
        [handleOpenCredentialUrl, vaultCredentials],
    );

    const handleDeleteCredential = useCallback(
        (credential: VaultCredential) => {
            showWarningDialogFnRef.current?.(
                `You are about to remove the "${credential.Name}" credential.`,
                async () => {
                    const toastId = toast.loading("Removing credential...");

                    try {
                        const mutationResult = await persistVaultMutation(
                            "credential.delete",
                            async (currentVault) => {
                                const updatedVault = Object.assign(
                                    new Vault(),
                                    currentVault,
                                );
                                const deleted = await deleteCredential(
                                    [...currentVault.Credentials],
                                    credential.ID,
                                );

                                if (deleted.isErr()) {
                                    throw new Error(deleted.error);
                                }

                                updatedVault.Credentials = deleted.value;
                                return {
                                    vault: updatedVault,
                                    result: undefined,
                                };
                            },
                        );

                        if (mutationResult.isErr()) {
                            if (
                                mutationResult.error === "VAULT_MUTATION_FAILED"
                            ) {
                                toast.error(
                                    "Failed to remove credential. Could not find the credential to delete.",
                                    { id: toastId },
                                );
                                return;
                            }
                            if (
                                mutationResult.error === "VAULT_DEK_NOT_FOUND"
                            ) {
                                toast.error(
                                    "Failed to remove credential. Vault encryption secret is missing.",
                                    { id: toastId },
                                );
                                return;
                            }
                            toast.error(
                                mutationResult.error ===
                                    "VAULT_METADATA_MISSING"
                                    ? "Vault metadata is unavailable."
                                    : "Failed to remove credential. Failed to save the vault.",
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
        [],
    );

    const handleOpenVaultSettings = useCallback(() => {
        setIsVaultSettingsOpen(true);
    }, []);

    const handleOpenAccountDialog = useCallback(() => {
        setIsAccountDialogOpen(true);
    }, []);

    const onlineServicesBound = Vault.isOnlineServicesBound(unlockedVault);
    const hasOnlineAuth = !!onlineServicesData?.sessionToken?.length;
    const remoteOnlineServicesData = onlineServicesData?.remoteData;
    const isFreeOnlineServicesTier =
        cloudServicesEnabled &&
        hasOnlineAuth &&
        !!remoteOnlineServicesData &&
        !remoteOnlineServicesData.canLink;
    const showSubscriptionCta =
        cloudServicesEnabled && (!hasOnlineAuth || isFreeOnlineServicesTier);
    const subscriptionCtaVariant = isFreeOnlineServicesTier
        ? "upgrade"
        : onlineServicesBound
          ? "signin"
          : "signup";

    const accountButtonLabel = (() => {
        if (!onlineServicesBound) return "Sign up";
        if (!hasOnlineAuth) return "Sign in";
        return "Signed In";
    })();

    const accountButtonClassName = cn(
        "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/70 mb-1 h-9 w-full justify-start gap-2 rounded-md text-xs transition-all",
        hasOnlineAuth &&
            onlineServicesBound &&
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
        } else if (
            data?.sessionToken?.length &&
            data.deviceId === vaultOs.DeviceId
        ) {
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
            onlineServicesLog.error(
                "Failed to establish Online Services session",
                {
                    deviceId: vaultOs.DeviceId,
                    error: e,
                },
            );
            toast.error(
                "Could not sign in to Online Services. Open Account to retry.",
            );
        }

        return () => {
            cancelled = true;
        };
    }, [unlockedVault.OnlineServices]);

    useEffect(() => {
        if (!cloudServicesEnabled) {
            return;
        }
        void (async () => {
            await ensureSession();
        })();
    }, [ensureSession, cloudServicesEnabled]);

    const handleOpenPasswordGenerator = useCallback(() => {
        setIsPasswordGeneratorOpen(true);
    }, []);

    const lockVault = useCallback(
        async (reason?: VaultAutoLockReason) => {
            const toastId = toast.loading(
                reason ? "Auto-locking vault..." : "Securing vault...",
            );

            const lockRes = await lockUnlockedVault({
                unlockedVaultMetadata,
                setUnlockedVault,
                setUnlockedVaultMetadata,
                syncConnectionController,
            });

            if (lockRes.isOk()) {
                toast.success(
                    reason ? "Vault auto-locked." : "Vault secured.",
                    {
                        id: toastId,
                        duration: 3000,
                    },
                );
                return;
            }

            if (lockRes.error === "VAULT_METADATA_MISSING") {
                toast.error("Vault metadata is unavailable.", { id: toastId });
                return;
            }

            if (lockRes.error === "VAULT_DEK_NOT_FOUND") {
                toast.error(MISSING_VAULT_SECRET_ERROR, { id: toastId });
                return;
            }

            toast.error(
                "Failed to lock vault. There is a high possibility of data loss!",
                {
                    id: toastId,
                },
            );
        },
        [
            setUnlockedVault,
            setUnlockedVaultMetadata,
            syncConnectionController,
            unlockedVaultMetadata,
        ],
    );

    const handleLockVault = useCallback(async () => {
        await lockVault();
    }, [lockVault]);

    useVaultAutoLock(lockVault);

    const showWarningDialog = useCallback(
        (...args: Parameters<WarningDialogShowFn>) => {
            showWarningDialogFnRef.current?.(...args);
        },
        [showWarningDialogFnRef],
    );

    const lockVaultConfirm = useCallback(() => {
        showWarningDialogFnRef.current?.(
            "Are you sure you want to lock the vault? This will prevent anyone from accessing it.",
            handleLockVault,
            () => {
                // No-op
            },
            "Lock Vault",
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
        if (dashboardView !== "credentials") return;
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
    }, [
        dashboardView,
        filteredCredentials,
        selectCredentialAtIndex,
        selectedCredential,
    ]);

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

            if (dashboardView !== "credentials") return;

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
        dashboardView,
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
        <div className="flex h-svh overflow-hidden bg-background">
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
                    {dashboardView === "security-report"
                        ? "Security Report"
                        : unlockedVaultName}
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
                        showSubscriptionCta={showSubscriptionCta}
                        subscriptionCtaVariant={subscriptionCtaVariant}
                        onOpenVaultSettings={handleOpenVaultSettings}
                        onOpenPasswordGenerator={handleOpenPasswordGenerator}
                        onOpenSecurityReport={() =>
                            setDashboardView("security-report")
                        }
                        activeView={dashboardView}
                        onLockVault={lockVaultConfirm}
                        signalingConfig={vaultSignalingConfig}
                        onSaveSignalingConfig={handleSaveSignalingConfig}
                        syncConnectionController={syncConnectionController}
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
                    showSubscriptionCta={showSubscriptionCta}
                    subscriptionCtaVariant={subscriptionCtaVariant}
                    onOpenVaultSettings={handleOpenVaultSettings}
                    onOpenPasswordGenerator={handleOpenPasswordGenerator}
                    onOpenSecurityReport={() =>
                        setDashboardView("security-report")
                    }
                    activeView={dashboardView}
                    onLockVault={lockVaultConfirm}
                    signalingConfig={vaultSignalingConfig}
                    onSaveSignalingConfig={handleSaveSignalingConfig}
                    syncConnectionController={syncConnectionController}
                    deviceConnectionStatuses={deviceConnectionStatuses}
                    showWarningDialog={showWarningDialog}
                />
            </div>

            {/* Main Content */}
            <div className="flex min-w-0 flex-1 pt-14 lg:pt-0">
                {dashboardView === "security-report" ? (
                    <SecurityReport
                        analysis={securityAnalysis}
                        progress={securityAnalysisProgress}
                        isAnalyzing={isSecurityAnalysisRunning}
                        error={securityAnalysisError}
                        analyzedAt={securityAnalysisAnalyzedAt}
                        onBack={() => setDashboardView("credentials")}
                        onEditCredential={handleEditSecurityFinding}
                        onOpenCredentialUrl={handleOpenSecurityFindingUrl}
                        onRefresh={refreshSecurityAnalysis}
                    />
                ) : (
                    <>
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
                            directories={unlockedVault.Directories}
                            credentialCounts={credentialCounts}
                            selectedDirectoryID={selectedDirectoryID}
                            onSelectDirectory={setSelectedDirectoryID}
                            onCreateDirectory={handleCreateDirectory}
                            onRenameDirectory={handleRenameDirectory}
                            onDeleteDirectory={handleDeleteDirectory}
                            onMoveCredentials={handleMoveCredentials}
                            onFilteredCredentialsChange={
                                handleFilteredCredentialsChange
                            }
                            searchFocusRequestToken={searchFocusRequestToken}
                        />

                        <div className="hidden lg:block">
                            <CredentialDetail
                                credential={selectedCredential}
                                onEdit={handleEditCredential}
                                onOpenUrl={handleOpenCredentialUrl}
                                onDeleteCredential={handleDeleteCredential}
                                directoryName={
                                    unlockedVault.Directories.find(
                                        (directory) =>
                                            directory.ID ===
                                            selectedCredential?.DirectoryID,
                                    )?.Name ?? "Root"
                                }
                            />
                        </div>

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
                                        isMobile
                                        onOpenUrl={handleOpenCredentialUrl}
                                        onDeleteCredential={
                                            handleDeleteCredential
                                        }
                                        directoryName={
                                            unlockedVault.Directories.find(
                                                (directory) =>
                                                    directory.ID ===
                                                    selectedCredential?.DirectoryID,
                                            )?.Name ?? "Root"
                                        }
                                    />
                                </SheetContent>
                            </Sheet>
                        )}
                    </>
                )}
            </div>

            {/* Edit Drawer */}
            <EditDrawer
                credential={editingCredential}
                isOpen={isEditDrawerOpen}
                onClose={() => setIsEditDrawerOpen(false)}
                onSave={handleSaveCredential}
                directories={unlockedVault.Directories}
                initialDirectoryID={
                    selectedDirectoryID === "all" ? "" : selectedDirectoryID
                }
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
            {cloudServicesEnabled ? (
                <AccountDialog
                    open={isAccountDialogOpen}
                    onOpenChange={setIsAccountDialogOpen}
                />
            ) : null}
            <LogInspectorDialog showDialogFnRef={showLogInspectorDialogRef} />
            <WarningDialog showFnRef={showWarningDialogFnRef} />
            {/* TODO: Remove VaultMigrationNoticeDialog after December 31, 2026. */}
            <VaultMigrationNoticeDialog />
            <KeyboardShortcutsDialog
                open={isKeyboardShortcutsOpen}
                onOpenChange={setIsKeyboardShortcutsOpen}
            />
        </div>
    );
}
