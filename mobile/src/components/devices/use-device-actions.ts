import { useCallback, useRef, useState } from "react";

import { WebRTCStatus } from "@cryptex-industries/vault-core/synchronization-utils";
import {
    LinkedDevice,
    LinkedDevices,
    Vault,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { useSyncRuntime } from "@/components/sync-controller-provider";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";
import {
    onlineServicesDataAtom,
    onlineServicesStore,
    getUnlockedVault,
} from "@/utils/atoms";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { trpcReact } from "@/utils/trpc";
import type { DeviceConfigurationDraft } from "@/components/devices/device-configuration-draft";
import { DeviceActionError } from "@/components/devices/device-action-error";

async function removeLocalDeviceRecords(ids: string[]) {
    const result = await persistVaultMutation(
        "vault.configuration",
        (current) => {
            const next = Object.assign(new Vault(), current);
            next.LinkedDevices = LinkedDevices.fromGeneric(
                current.LinkedDevices,
            );
            next.LinkedDevices.Devices = next.LinkedDevices.Devices.filter(
                (device) => !ids.includes(device.ID),
            );
            return { vault: next, result: undefined };
        },
    );
    if (result.isErr()) {
        throw new Error(
            "Could not save the local link changes. The saved links were kept. Retry removing them.",
        );
    }
}

export function useDeviceActions() {
    const { controller, connectionStatuses, runSyncQueue } = useSyncRuntime();
    const [pendingId, setPendingId] = useState<string | null>(null);
    const inFlight = useRef(false);
    const utils = trpcReact.useUtils();
    const breakLinkMut = trpcReact.v1.device.breakLink.useMutation();
    const cloudEnabled = isCloudServicesEnabled();

    const saveDeviceConfig = useCallback(
        async (config: DeviceConfigurationDraft) => {
            const result = await persistVaultMutation(
                "vault.configuration",
                (currentVault) => {
                    const updatedVault = Object.assign(
                        new Vault(),
                        currentVault,
                    );
                    const updatedLinkedDevices = LinkedDevices.fromGeneric(
                        currentVault.LinkedDevices,
                    );
                    if (
                        !updatedLinkedDevices.Devices.some(
                            (device) => device.ID === config.ID,
                        )
                    ) {
                        throw new Error("Device is no longer linked.");
                    }
                    updatedLinkedDevices.Devices =
                        updatedLinkedDevices.Devices.map((device) =>
                            device.ID !== config.ID
                                ? device
                                : Object.assign(
                                      LinkedDevices.fromGenericDevice(device),
                                      config,
                                  ),
                        );
                    updatedVault.LinkedDevices = updatedLinkedDevices;
                    return { vault: updatedVault, result: undefined };
                },
            );
            if (result.isErr()) {
                throw new Error("Failed to save device configuration.");
            }
        },
        [],
    );

    const removeLocalDevices = useCallback(
        async (ids: string[]) => {
            const removed = getUnlockedVault().LinkedDevices.Devices.filter((device) =>
                ids.includes(device.ID),
            );
            await removeLocalDeviceRecords(ids);
            for (const device of removed) {
                try {
                    await controller.disconnectDevice(device);
                } catch {
                    // Removing a saved link must also work when the connection has failed.
                }
            }
        },
        [controller],
    );

    const unlinkDevice = useCallback(
        async (device: LinkedDevice, localOnly = false): Promise<string> => {
            if (inFlight.current)
                throw new Error("A device change is already in progress.");
            const generation = getVaultSessionGeneration();
            inFlight.current = true;
            setPendingId(device.ID);
            try {
                const current = getUnlockedVault().LinkedDevices.Devices.find(
                    (entry) => entry.ID === device.ID,
                );
                if (!current) throw new Error("Device is no longer linked.");
                let serverUnlinked = false;
                if (
                    !localOnly &&
                    LinkedDevices.isUsingOnlineServices(current)
                ) {
                    if (!cloudEnabled)
                        throw new Error(
                            "Online Services is unavailable. The saved link was kept.",
                        );
                    const currentVault = getUnlockedVault();
                    const session = onlineServicesStore.get(
                        onlineServicesDataAtom,
                    );
                    if (
                        !Vault.isOnlineServicesBound(currentVault) ||
                        !session?.sessionToken ||
                        session.deviceId !==
                            currentVault.OnlineServices.DeviceId
                    ) {
                        throw new Error(
                            "Sign in to Online Services on this device before unlinking. The saved link was kept.",
                        );
                    }
                    if (!current.SyncID.trim())
                        throw new Error(
                            "This saved connection has no relationship ID. The saved link was kept.",
                        );
                    await breakLinkMut.mutateAsync({ syncId: current.SyncID });
                    serverUnlinked = true;
                }
                if (!isSameActiveVaultSession(generation)) {
                    if (serverUnlinked) {
                        throw new DeviceActionError(
                            "Online Services connection unlinked, but the vault session changed before its saved link could be removed. Open the original vault and forget its saved link locally to finish.",
                            "connection-unlinked",
                            true,
                        );
                    }
                    throw new Error(
                        "The vault session changed. Open Devices again to continue.",
                    );
                }
                try {
                    await removeLocalDevices([current.ID]);
                } catch (error) {
                    if (serverUnlinked) {
                        throw new DeviceActionError(
                            "Online Services connection unlinked, but the saved links were kept because this vault could not save the local removal. Forget its saved link locally to finish.",
                            "connection-unlinked",
                            true,
                        );
                    }
                    throw error;
                }
                return localOnly
                    ? "Saved link removed from this vault."
                    : `Unlinked ${current.Name || "device"}.`;
            } finally {
                inFlight.current = false;
                setPendingId(null);
                void utils.v1.device.invalidate().catch(() => undefined);
                void utils.v1.payment.subscription
                    .invalidate()
                    .catch(() => undefined);
            }
        },
        [breakLinkMut, cloudEnabled, removeLocalDevices, utils],
    );

    const connectDevice = useCallback(
        async (deviceId: string) => {
            if (
                controller.getWebRTCStatus(deviceId) === WebRTCStatus.Connected
            ) {
                await runSyncQueue([deviceId]);
            } else {
                const started = await controller.connectDevice(deviceId);
                if (!started)
                    throw new Error(
                        "Could not start the connection. Check this device's connection settings and try again.",
                    );
            }
        },
        [controller, runSyncQueue],
    );

    return {
        connectionStatuses,
        pendingId,
        removeLocalDevices,
        saveDeviceConfig,
        unlinkDevice,
        connectDevice,
    };
}
