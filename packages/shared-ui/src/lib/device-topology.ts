import { ONLINE_SERVICES_SELECTION_ID } from "@cryptex-industries/vault-core/consts";
import { type LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";

export const isCustomSignaling = (
    device: Pick<LinkedDevice, "SignalingServerID">,
) => device.SignalingServerID !== ONLINE_SERVICES_SELECTION_ID;

export type DeviceTopology = {
    devices: {
        id: string;
        createdAt: Date;
        lastSeen: Date | null;
        root: boolean;
        current: boolean;
    }[];
    relationships: {
        syncId: string;
        fromDeviceId: string;
        toDeviceId: string;
        createdAt: Date;
    }[];
};
export type DeviceNode = {
    id: string;
    serverId?: string;
    displayName: string;
    current: boolean;
    root: boolean;
    lastSeen: Date | null;
    localDevices: LinkedDevice[];
};
export type DeviceRelationship = {
    id: string;
    syncId: string;
    fromDeviceId: string;
    toDeviceId: string;
    recordedOnServer: boolean;
    localDevice?: LinkedDevice;
    custom: boolean;
    missingOnServer: boolean;
};
export type DeviceRelationshipMap = {
    nodes: DeviceNode[];
    relationships: DeviceRelationship[];
    currentDeviceId: string;
    rootCount: number;
    topologyVerified: boolean;
};
export function formatRelativeAccountDate(
    value?: Date | string | number | null,
) {
    if (value === null || value === undefined) return "Not available";
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return "Not available";
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
}
export function formatSyncId(id?: string | null) {
    if (!id) return "Not available";
    return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

/** A local name describes the peer, never both endpoints of a sync relationship. */
export function buildDeviceRelationshipMap(
    topology: DeviceTopology | undefined,
    localDevices: LinkedDevice[],
    currentServerId?: string | null,
    options: { topologyVerified?: boolean; currentRoot?: boolean } = {},
): DeviceRelationshipMap {
    const serverCurrent =
        currentServerId ?? topology?.devices.find((d) => d.current)?.id;
    const currentDeviceId = serverCurrent
        ? `account:${serverCurrent}`
        : "current:local";
    const nodes = new Map<string, DeviceNode>();
    for (const device of topology?.devices ?? []) {
        const id = `account:${device.id}`;
        nodes.set(id, {
            id,
            serverId: device.id,
            current: id === currentDeviceId,
            root: device.root,
            displayName:
                id === currentDeviceId
                    ? "This device"
                    : formatSyncId(device.id),
            lastSeen: device.lastSeen,
            localDevices: [],
        });
    }
    if (!nodes.has(currentDeviceId))
        nodes.set(currentDeviceId, {
            id: currentDeviceId,
            serverId: serverCurrent ?? undefined,
            displayName: "This device",
            current: true,
            root: options.currentRoot ?? false,
            lastSeen: null,
            localDevices: [],
        });
    const relationships: DeviceRelationship[] = [];
    for (const r of topology?.relationships ?? []) {
        const fromDeviceId = `account:${r.fromDeviceId}`,
            toDeviceId = `account:${r.toDeviceId}`;
        // Do not invent devices for incomplete responses.
        if (!nodes.has(fromDeviceId) || !nodes.has(toDeviceId)) continue;
        relationships.push({
            id: `server:${r.syncId}`,
            syncId: r.syncId,
            fromDeviceId,
            toDeviceId,
            recordedOnServer: true,
            custom: false,
            missingOnServer: false,
        });
    }
    const verified =
        topology !== undefined && options.topologyVerified === true;
    for (const local of localDevices) {
        const custom = isCustomSignaling(local);
        const match = local.SyncID
            ? relationships.find(
                  (r) =>
                      r.syncId === local.SyncID &&
                      (r.fromDeviceId === currentDeviceId ||
                          r.toDeviceId === currentDeviceId) &&
                      !r.localDevice,
              )
            : undefined;
        if (match) {
            match.localDevice = local;
            match.custom = custom;
            const peer = nodes.get(
                match.fromDeviceId === currentDeviceId
                    ? match.toDeviceId
                    : match.fromDeviceId,
            )!;
            // A malformed self-link must not rename the current device.
            if (!peer.current) {
                peer.localDevices.push(local);
                peer.displayName =
                    local.Name.trim() || formatSyncId(peer.serverId);
            }
        } else {
            const id = `local:${local.ID}`;
            nodes.set(id, {
                id,
                displayName: local.Name.trim() || "Unnamed linked device",
                current: false,
                root: false,
                lastSeen: null,
                localDevices: [local],
            });
            relationships.push({
                id: `local-link:${local.ID}`,
                syncId: local.SyncID,
                fromDeviceId: currentDeviceId,
                toDeviceId: id,
                recordedOnServer: false,
                localDevice: local,
                custom,
                missingOnServer: !custom && verified,
            });
        }
    }
    return {
        nodes: [...nodes.values()],
        relationships,
        currentDeviceId,
        rootCount: [...nodes.values()].filter((d) => d.root).length,
        topologyVerified: verified,
    };
}
