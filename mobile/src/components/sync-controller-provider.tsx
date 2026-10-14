import {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { useAtomValue } from "jotai";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SyncConnectionController } from "@cryptex-industries/vault-core/synchronization";
import {
    SignalingStatus,
    SyncConnectionControllerEventType,
    WebRTCMessageEventType,
    WebRTCStatus,
    type SCCEvent,
    type SignalingEventData,
    type WebRTCEventDataPayload,
} from "@cryptex-industries/vault-core/synchronization-utils";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { ONLINE_SERVICES_SELECTION_ID } from "@cryptex-industries/vault-core/consts";
import { createSyncConnectionController } from "@/components/sync-controller";
import {
    getUnlockedVault,
    onlineServicesStore,
    onlineServicesDataAtom,
    linkedDevicesAtom,
} from "@/utils/atoms";
import {
    ensureFreshOnlineServicesSession,
    syncOnlineServicesRemoteConfiguration,
} from "@/app_lib/auth-session";
import { managedBackupCoordinator } from "@/app_lib/managed-backup-coordinator";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { getVaultSessionGeneration } from "@/utils/vault-session";
import { onlineServicesLog } from "@/utils/logging";
import {
    isAutoLockDue,
    subscribeVaultTimeoutChanges,
    vaultTimeoutRemainingMs,
} from "@/utils/session-timeout";
import { registerActiveSyncController } from "@/utils/active-sync-controllers";

export const AUTO_CONNECT_KEY = "cryptex:auto-connect-sync";
export type DeviceConnectionStatus = {
    signalingServerStatus: SignalingStatus;
    webRTCStatus: WebRTCStatus;
    lastSync: Date | null;
};
type SyncQueueResult = "Queued" | "Syncing" | "Synced" | "Failed";
type SyncQueueState = {
    active: boolean;
    total: number;
    done: number;
    stopRequested: boolean;
    results: Record<string, SyncQueueResult>;
};

type SyncRuntime = {
    controller: SyncConnectionController;
    connectionStatuses: Record<string, DeviceConnectionStatus>;
    connectedDeviceCount: number;
    syncQueue: SyncQueueState;
    runSyncQueue: (deviceIds: string[]) => Promise<void>;
    stopSyncQueue: () => void;
};

const SyncControllerContext = createContext<SyncRuntime | null>(null);

/** One foreground lifecycle owns auth, backups, and automatic peer connections. */
export function SyncControllerProvider({ children }: { children: ReactNode }) {
    const [controller] = useState(createSyncConnectionController);
    const devices = useAtomValue(linkedDevicesAtom);
    const listeners = useRef(
        new Map<string, Set<(event: WebRTCEventDataPayload) => void>>(),
    );
    const manualSyncActiveDevices = useRef(new Set<string>());
    const syncTimeoutIDs = useRef(
        new Map<string, ReturnType<typeof setTimeout>>(),
    );
    const [connectionStatuses, setConnectionStatuses] = useState<
        Record<string, DeviceConnectionStatus>
    >({});
    const [syncQueue, setSyncQueue] = useState<SyncQueueState>({
        active: false,
        total: 0,
        done: 0,
        stopRequested: false,
        results: {},
    });
    const queueActive = useRef(false);
    const queueStopRequested = useRef(false);
    const cancelActiveQueueItem = useRef<(() => void) | null>(null);

    useEffect(() => {
        const timeoutIDs = syncTimeoutIDs.current;
        const signalingHandlerIDs: Array<{
            serverID: string;
            handlerID: string;
        }> = [];

        setConnectionStatuses((previous) => {
            const next: Record<string, DeviceConnectionStatus> = {};
            for (const device of devices) {
                next[device.ID] = {
                    // Reconcile from the controller itself. A link merge can
                    // add the device after its first connection event fired.
                    signalingServerStatus: controller.getSignalingStatus(
                        device.SignalingServerID,
                    ),
                    webRTCStatus: controller.getWebRTCStatus(device.ID),
                    lastSync: device.LastSync
                        ? new Date(device.LastSync)
                        : (previous[device.ID]?.lastSync ?? null),
                };
            }
            return next;
        });

        for (const device of devices) {
            const mergeStatus = (partial: Partial<DeviceConnectionStatus>) => {
                setConnectionStatuses((previous) => ({
                    ...previous,
                    [device.ID]: {
                        signalingServerStatus:
                            previous[device.ID]?.signalingServerStatus ??
                            controller.getSignalingStatus(
                                device.SignalingServerID,
                            ),
                        webRTCStatus:
                            previous[device.ID]?.webRTCStatus ??
                            controller.getWebRTCStatus(device.ID),
                        lastSync:
                            previous[device.ID]?.lastSync ??
                            (device.LastSync ? new Date(device.LastSync) : null),
                        ...partial,
                    },
                }));
            };
            const signalingHandler = (event: SCCEvent<SignalingEventData>) => {
                mergeStatus({
                    signalingServerStatus: event.data.connectionState,
                });
            };
            const handlerID = controller.registerSyncSignalingHandler(
                device.SignalingServerID,
                signalingHandler,
            );
            if (handlerID) {
                signalingHandlerIDs.push({
                    serverID: device.SignalingServerID,
                    handlerID,
                });
            }

            controller.registerSyncWebRTCHandler(device.ID, (event) => {
                if (
                    event.type ===
                    SyncConnectionControllerEventType.ConnectionStatus
                ) {
                    mergeStatus({ webRTCStatus: event.connectionState });
                    const currentTimeout = timeoutIDs.get(device.ID);
                    if (currentTimeout) clearTimeout(currentTimeout);
                    if (
                        device.SyncTimeout &&
                        event.connectionState === WebRTCStatus.Connected &&
                        !manualSyncActiveDevices.current.has(device.ID)
                    ) {
                        timeoutIDs.set(
                            device.ID,
                            setTimeout(
                                () => void controller.disconnectDevice(device),
                                Math.abs(device.SyncTimeoutPeriod || 30) * 1000,
                            ),
                        );
                    }
                } else if (
                    event.type ===
                        SyncConnectionControllerEventType.SynchronizationMessage &&
                    event.event === WebRTCMessageEventType.Synchronized
                ) {
                    mergeStatus({ lastSync: new Date() });
                }
                listeners.current
                    .get(device.ID)
                    ?.forEach((listener) => listener(event));
            });
        }

        return () => {
            for (const { serverID, handlerID } of signalingHandlerIDs) {
                controller.removeSyncSignalingHandler(serverID, handlerID);
            }
            for (const device of devices) {
                controller.removeSyncWebRTCHandler(device.ID);
            }
            timeoutIDs.forEach(clearTimeout);
            timeoutIDs.clear();
        };
    }, [controller, devices]);
    useEffect(() => {
        const unregisterController = registerActiveSyncController(controller);
        const generation = getVaultSessionGeneration();
        let stopped = false;
        let running = false;
        let reachable = false;
        let configuredDevice: string | undefined;
        let sessionPauseTimer: ReturnType<typeof setTimeout> | null = null;
        const pauseConnections = () => {
            queueStopRequested.current = true;
            cancelActiveQueueItem.current?.();
            controller.pauseConnections();
            managedBackupCoordinator.stop();
            configuredDevice = undefined;
        };
        const scheduleSessionPause = () => {
            if (sessionPauseTimer != null) clearTimeout(sessionPauseTimer);
            sessionPauseTimer = null;
            const remaining = vaultTimeoutRemainingMs();
            if (remaining == null) return;
            sessionPauseTimer = setTimeout(() => {
                sessionPauseTimer = null;
                if (isAutoLockDue()) pauseConnections();
                else scheduleSessionPause();
            }, remaining);
        };
        const active = () =>
            !stopped &&
            generation === getVaultSessionGeneration() &&
            AppState.currentState === "active" &&
            !isAutoLockDue() &&
            reachable;

        const reconcile = async () => {
            if (running || !active()) return;
            running = true;
            try {
                const vault = getUnlockedVault();
                if (
                    isCloudServicesEnabled() &&
                    Vault.isOnlineServicesBound(vault)
                ) {
                    await ensureFreshOnlineServicesSession();
                    if (!active()) return;
                    const session = onlineServicesStore.get(
                        onlineServicesDataAtom,
                    );
                    if (
                        !session?.sessionToken ||
                        session.deviceId !== vault.OnlineServices.DeviceId ||
                        (session.sessionExpiresAt ?? 0) <= Date.now()
                    ) {
                        managedBackupCoordinator.stop();
                        configuredDevice = undefined;
                        for (const device of vault.LinkedDevices.Devices) {
                            if (!active()) return;
                            if (
                                device.SignalingServerID ===
                                ONLINE_SERVICES_SELECTION_ID
                            ) {
                                await controller.disconnectDevice(device);
                            }
                        }
                        return;
                    }
                    if (configuredDevice !== session.deviceId) {
                        await syncOnlineServicesRemoteConfiguration();
                        if (!active()) return;
                        await managedBackupCoordinator.start();
                        if (!active()) return;
                        configuredDevice = session.deviceId;
                    }
                } else {
                    configuredDevice = undefined;
                    managedBackupCoordinator.stop();
                }
                const connectAll =
                    (await AsyncStorage.getItem(AUTO_CONNECT_KEY)) === "1";
                if (!active()) return;
                const devices = getUnlockedVault().LinkedDevices.Devices.filter(
                    (device) => connectAll || device.AutoConnect,
                );
                for (const device of devices) {
                    if (!active()) return;
                    await controller.connectDevice(device.ID);
                }
            } catch {
                onlineServicesLog.warn(
                    "Online Services reconnect deferred; retrying when available",
                );
            } finally {
                running = false;
            }
        };
        controller.init();
        scheduleSessionPause();
        const timeoutSubscription = subscribeVaultTimeoutChanges(scheduleSessionPause);
        const networkSubscription = NetInfo.addEventListener((state) => {
            // Internet reachability probes need not succeed for LAN-only servers.
            reachable = state.isConnected === true;
            if (reachable) void reconcile();
        });
        const appSubscription = AppState.addEventListener("change", (state) => {
            if (state !== "active") {
                // No peer may retain a live sync channel while JS is suspended.
                pauseConnections();
                return;
            }
            if (!isAutoLockDue()) {
                controller.init();
                void reconcile();
            } else {
                pauseConnections();
            }
        });
        const authSubscription = onlineServicesStore.sub(
            onlineServicesDataAtom,
            () => void reconcile(),
        );
        const interval = setInterval(() => void reconcile(), 30_000);
        return () => {
            stopped = true;
            networkSubscription();
            appSubscription.remove();
            authSubscription();
            timeoutSubscription();
            if (sessionPauseTimer != null) clearTimeout(sessionPauseTimer);
            clearInterval(interval);
            unregisterController();
            managedBackupCoordinator.stop();
        };
    }, [controller]);

    useEffect(
        () => () => {
            queueStopRequested.current = true;
            cancelActiveQueueItem.current?.();
        },
        [],
    );

    const setManualSyncActive = (deviceId: string, active: boolean) => {
        if (active) {
            manualSyncActiveDevices.current.add(deviceId);
            const timeout = syncTimeoutIDs.current.get(deviceId);
            if (timeout) clearTimeout(timeout);
            syncTimeoutIDs.current.delete(deviceId);
        } else {
            manualSyncActiveDevices.current.delete(deviceId);
            const device = devices.find(
                (candidate) => candidate.ID === deviceId,
            );
            const currentTimeout = syncTimeoutIDs.current.get(deviceId);
            if (currentTimeout) clearTimeout(currentTimeout);
            syncTimeoutIDs.current.delete(deviceId);
            if (
                device?.SyncTimeout &&
                controller.getWebRTCStatus(deviceId) === WebRTCStatus.Connected
            ) {
                syncTimeoutIDs.current.set(
                    deviceId,
                    setTimeout(
                        () => void controller.disconnectDevice(device),
                        Math.abs(device.SyncTimeoutPeriod || 30) * 1000,
                    ),
                );
            }
        }
    };

    const waitForSync = (deviceId: string) => {
        const device = devices.find((candidate) => candidate.ID === deviceId);
        if (!device) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
            let settled = false;
            let timeout: ReturnType<typeof setTimeout> | undefined;
            const deviceListeners = listeners.current.get(deviceId) ?? new Set();
            const finish = async (success: boolean) => {
                if (settled) return;
                settled = true;
                if (timeout) clearTimeout(timeout);
                deviceListeners.delete(listener);
                if (deviceListeners.size === 0) listeners.current.delete(deviceId);
                cancelActiveQueueItem.current = null;
                if (!success) {
                    // A failed or timed-out item is torn down before the queue
                    // advances, so two synchronization sessions cannot overlap.
                    await controller.disconnectDevice(device).catch(() => false);
                }
                resolve(success);
            };
            const listener = (event: WebRTCEventDataPayload) => {
                if (
                    event.type ===
                        SyncConnectionControllerEventType.SynchronizationMessage &&
                    event.event === WebRTCMessageEventType.Synchronized
                ) {
                    void finish(true);
                } else if (
                    (event.type ===
                        SyncConnectionControllerEventType.SynchronizationMessage &&
                        event.event === WebRTCMessageEventType.Error) ||
                    (event.type ===
                        SyncConnectionControllerEventType.ConnectionStatus &&
                        event.connectionState === WebRTCStatus.Failed)
                ) {
                    void finish(false);
                }
            };
            deviceListeners.add(listener);
            listeners.current.set(deviceId, deviceListeners);
            cancelActiveQueueItem.current = () => void finish(false);
            timeout = setTimeout(() => void finish(false), 45_000);
            void controller
                .synchronizeDevice(deviceId)
                .then((started) => {
                    if (!started) void finish(false);
                })
                .catch(() => void finish(false));
        });
    };

    const runSyncQueue = async (requestedIds: string[]) => {
        const deviceIds = [...new Set(requestedIds)];
        if (
            queueActive.current ||
            deviceIds.length === 0 ||
            AppState.currentState !== "active" ||
            isAutoLockDue()
        ) return;
        queueActive.current = true;
        queueStopRequested.current = false;
        setSyncQueue((current) => {
            const results = { ...current.results };
            deviceIds.forEach((id) => (results[id] = "Queued"));
            return {
                active: true,
                total: deviceIds.length,
                done: 0,
                stopRequested: false,
                results,
            };
        });
        let processed = 0;
        let total = deviceIds.length;
        try {
            for (const deviceId of deviceIds) {
                if (
                    queueStopRequested.current ||
                    AppState.currentState !== "active" ||
                    isAutoLockDue()
                ) break;
                if (
                    controller.getWebRTCStatus(deviceId) !==
                    WebRTCStatus.Connected
                ) {
                    total -= 1;
                    setSyncQueue((current) => {
                        const results = { ...current.results };
                        delete results[deviceId];
                        return { ...current, total, results };
                    });
                    continue;
                }
                setSyncQueue((current) => ({
                    ...current,
                    results: { ...current.results, [deviceId]: "Syncing" },
                }));
                setManualSyncActive(deviceId, true);
                const success = await waitForSync(deviceId).finally(() =>
                    setManualSyncActive(deviceId, false),
                );
                processed += 1;
                setSyncQueue((current) => ({
                    ...current,
                    done: processed,
                    results: {
                        ...current.results,
                        [deviceId]: success ? "Synced" : "Failed",
                    },
                }));
            }
        } finally {
            cancelActiveQueueItem.current = null;
            queueActive.current = false;
            const finalTotal = queueStopRequested.current ? processed : total;
            setSyncQueue((current) => {
                const results = { ...current.results };
                deviceIds.forEach((id) => {
                    if (results[id] === "Queued") delete results[id];
                });
                return {
                    ...current,
                    active: false,
                    total: finalTotal,
                    done: processed,
                    stopRequested: false,
                    results,
                };
            });
        }
    };

    const stopSyncQueue = () => {
        if (!queueActive.current) return;
        queueStopRequested.current = true;
        setSyncQueue((current) => ({
            ...current,
            total: Math.min(current.total, current.done + 1),
            stopRequested: true,
        }));
    };

    const value: SyncRuntime = {
            controller,
            connectionStatuses,
            connectedDeviceCount: devices.filter(
                (device) =>
                    connectionStatuses[device.ID]?.webRTCStatus ===
                    WebRTCStatus.Connected,
            ).length,
            syncQueue,
            runSyncQueue,
            stopSyncQueue,
    };

    return (
        <SyncControllerContext.Provider value={value}>
            {children}
        </SyncControllerContext.Provider>
    );
}

export function useSyncRuntime(): SyncRuntime {
    const runtime = useContext(SyncControllerContext);
    if (!runtime)
        throw new Error("Sync runtime is outside unlocked shell");
    return runtime;
}

/** Lock UI also appears on top-level routes outside the unlocked shell. */
export function useOptionalSyncRuntime(): SyncRuntime | null {
    return useContext(SyncControllerContext);
}
