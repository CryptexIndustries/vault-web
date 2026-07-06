import { LinkedDevices, type LinkedDevice } from "@/app_lib/vault-utils/vault";

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

function inferAccountDeviceKind(name: string) {
    const normalized = name.toLowerCase();
    if (/iphone|android|phone|pixel/.test(normalized)) return "Mobile";
    if (/ipad|tablet/.test(normalized)) return "Tablet";
    if (/chrome|firefox|safari|edge|browser/.test(normalized)) return "Browser";
    return "Desktop";
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
