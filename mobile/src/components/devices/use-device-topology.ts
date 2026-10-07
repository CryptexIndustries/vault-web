import { useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";

import {
    LinkedDevices,
    Vault,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    establishOnlineServicesSession,
    syncOnlineServicesRemoteConfiguration,
} from "@/app_lib/auth-session";
import { buildDeviceRelationshipMap } from "@/components/account/device-topology";
import { useDeviceActions } from "@/components/devices/use-device-actions";
import {
    DeviceActionError,
    type CompletedDeviceAction,
} from "@/components/devices/device-action-error";
import {
    onlineServicesDataAtom,
    onlineServicesStore,
    unlockedVaultAtom,
    vaultStore,
} from "@/utils/atoms";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { trpcReact } from "@/utils/trpc";
import {
    getVaultSessionGeneration,
    isSameActiveVaultSession,
} from "@/utils/vault-session";

export function useDeviceTopology() {
    const vault = useAtomValue(unlockedVaultAtom);
    const session = useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    });
    const bound = Vault.isOnlineServicesBound(vault);
    const deviceId = bound ? vault.OnlineServices.DeviceId : undefined;
    const cloudEnabled = isCloudServicesEnabled();
    const hasSession =
        cloudEnabled &&
        bound &&
        !!session?.sessionToken &&
        session.deviceId === deviceId;
    const config = trpcReact.v1.user.configuration.useQuery(undefined, {
        enabled: hasSession,
    });
    const matchingConfig = config.data?.deviceId === deviceId;
    const isRoot = hasSession && matchingConfig && !!config.data?.root;
    const canPromote = isRoot && !!config.data?.canPromoteDevices;
    const topology = trpcReact.v1.device.topology.useQuery(undefined, {
        enabled: isRoot,
    });
    const map = useMemo(
        () =>
            buildDeviceRelationshipMap(
                isRoot && topology.data?.devices.some((d) => d.id === deviceId)
                    ? topology.data
                    : undefined,
                vault.LinkedDevices?.Devices ?? [],
                deviceId,
                {
                    currentRoot: isRoot,
                    topologyVerified:
                        isRoot &&
                        config.isSuccess &&
                        !config.isError &&
                        !config.isFetching &&
                        topology.isSuccess &&
                        !topology.isError &&
                        !topology.isFetching,
                },
            ),
        [
            isRoot,
            deviceId,
            config.isSuccess,
            config.isError,
            config.isFetching,
            topology.data,
            topology.isSuccess,
            topology.isError,
            topology.isFetching,
            vault.LinkedDevices?.Devices,
        ],
    );
    const remove = trpcReact.v1.device.remove.useMutation();
    const breakLink = trpcReact.v1.device.breakLink.useMutation();
    const setRoot = trpcReact.v1.device.setRoot.useMutation();
    const utils = trpcReact.useUtils();
    const { removeLocalDevices } = useDeviceActions();
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const pending = useRef(false);

    function assertSession(generation: number) {
        if (
            !isSameActiveVaultSession(generation) ||
            vaultStore.get(unlockedVaultAtom).OnlineServices?.DeviceId !==
                deviceId
        ) {
            throw new Error(
                "The vault session changed. Unlock the vault and try again.",
            );
        }
    }

    async function run<T>(
        action: (generation: number) => Promise<T>,
    ): Promise<T> {
        if (pending.current)
            throw new Error("A device update is already in progress.");
        const generation = getVaultSessionGeneration();
        assertSession(generation);
        pending.current = true;
        setBusy(true);
        setActionError(null);
        try {
            return await action(generation);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }

    async function refresh() {
        try {
            await run(async (generation) => {
                if (!bound || !cloudEnabled) return;
                if (!hasSession) {
                    await establishOnlineServicesSession({
                        deviceId: vault.OnlineServices.DeviceId,
                        privateKeyJWK: vault.OnlineServices.PrivateKeyJWK,
                    });
                    assertSession(generation);
                }
                const result = await config.refetch({ throwOnError: true });
                assertSession(generation);
                if (!result.data || result.data.deviceId !== deviceId) {
                    throw new Error(
                        "Account information does not match this device. Sign in again.",
                    );
                }
                if (result.data.root) {
                    await topology.refetch({ throwOnError: true });
                    assertSession(generation);
                }
            });
        } catch (error) {
            setActionError(
                error instanceof Error
                    ? error.message
                    : "Could not refresh devices.",
            );
        }
    }

    function requireAccountDevice(id: string) {
        if (!isRoot || !map.topologyVerified) {
            throw new Error(
                "Refresh device information from a root device before changing account access.",
            );
        }
        const node = map.nodes.find((entry) => entry.serverId === id);
        if (!node)
            throw new Error("This account device is no longer available.");
        return node;
    }

    async function finishServerRemoval(
        generation: number,
        localIds: string[],
        completed: CompletedDeviceAction,
    ) {
        const outcome =
            completed === "device-removed"
                ? "Account device removed."
                : "Account connection unlinked.";
        const cleanupMessage =
            completed === "device-removed"
                ? "Remove its remaining saved links from device details."
                : "Forget its remaining saved link from connection details.";
        let localCleanupRequired = localIds.length > 0;
        let cleanupFailed = false;
        try {
            assertSession(generation);
            try {
                if (localIds.length) await removeLocalDevices(localIds);
                localCleanupRequired = false;
            } catch {
                cleanupFailed = true;
            }
            assertSession(generation);
            await Promise.all([
                utils.v1.device.invalidate(),
                utils.v1.payment.subscription.invalidate(),
            ]);
        } catch (error) {
            const reason = cleanupFailed
                ? cleanupMessage
                : error instanceof Error
                  ? error.message
                  : "Account data could not be refreshed. Refresh devices to verify the change.";
            throw new DeviceActionError(
                `${outcome} ${reason}`,
                completed,
                localCleanupRequired,
            );
        }
        if (cleanupFailed)
            throw new DeviceActionError(
                `${outcome} ${cleanupMessage}`,
                completed,
                true,
            );
    }

    async function removeAccountDevice(id: string) {
        await run(async (generation) => {
            const node = requireAccountDevice(id);
            if (node.current || node.root) {
                throw new Error(
                    "Only another device without root access can be removed.",
                );
            }
            const syncIds = new Set(
                map.relationships
                    .filter(
                        (relationship) =>
                            relationship.recordedOnServer &&
                            (relationship.fromDeviceId === node.id ||
                                relationship.toDeviceId === node.id) &&
                            (relationship.fromDeviceId ===
                                map.currentDeviceId ||
                                relationship.toDeviceId ===
                                    map.currentDeviceId),
                    )
                    .map((relationship) => relationship.syncId),
            );
            const localIds = vaultStore
                .get(unlockedVaultAtom)
                .LinkedDevices.Devices.filter(
                    (device) =>
                        syncIds.has(device.SyncID) &&
                        LinkedDevices.isUsingOnlineServices(device),
                )
                .map((device) => device.ID);
            await remove.mutateAsync({ id });
            await finishServerRemoval(generation, localIds, "device-removed");
        });
    }

    async function unlinkRelationship(relationshipId: string) {
        await run(async (generation) => {
            if (!isRoot || !map.topologyVerified) {
                throw new Error(
                    "Refresh device information from a root device before changing account connections.",
                );
            }
            const relationship = map.relationships.find(
                (entry) => entry.id === relationshipId,
            );
            if (!relationship?.recordedOnServer || !relationship.syncId) {
                throw new Error(
                    "This account connection is no longer available. Refresh devices before unlinking.",
                );
            }
            // Capture the records before invalidating topology. A custom signaling
            // link may still use Online Services for STUN or TURN.
            const localIds = vaultStore
                .get(unlockedVaultAtom)
                .LinkedDevices.Devices.filter(
                    (device) =>
                        (relationship.fromDeviceId === map.currentDeviceId ||
                            relationship.toDeviceId === map.currentDeviceId) &&
                        device.SyncID === relationship.syncId &&
                        LinkedDevices.isUsingOnlineServices(device),
                )
                .map((device) => device.ID);
            await breakLink.mutateAsync({ syncId: relationship.syncId });
            await finishServerRemoval(
                generation,
                localIds,
                "connection-unlinked",
            );
        });
    }

    async function toggleRoot(id: string, root: boolean) {
        await run(async (generation) => {
            const node = requireAccountDevice(id);
            if (!canPromote)
                throw new Error("This account cannot change root permissions.");
            if (!root && node.root && map.rootCount <= 1) {
                throw new Error("At least one device must retain root access.");
            }
            if (root === node.root) return;
            await setRoot.mutateAsync({ id, root });
            assertSession(generation);
            try {
                await Promise.all([
                    utils.v1.device.invalidate(),
                    syncOnlineServicesRemoteConfiguration(),
                    config.refetch({ throwOnError: true }),
                ]);
                assertSession(generation);
            } catch {
                throw new Error(
                    "Root access changed, but account information could not be refreshed. Refresh to verify the current permissions.",
                );
            }
        });
    }

    const error =
        actionError ??
        (hasSession && config.isError
            ? "Could not load account permissions. Refresh to try again."
            : isRoot && topology.isError
              ? "Could not load account devices. Saved links are still available."
              : null);

    return {
        map,
        isRoot,
        canPromote,
        hasSession,
        bound,
        loading: config.isFetching || (isRoot && topology.isFetching),
        error,
        busy,
        refresh,
        removeAccountDevice,
        unlinkRelationship,
        toggleRoot,
    };
}
