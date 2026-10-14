import {
    LinkedDevices,
    type LinkedDevice,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    buildDeviceRelationshipMap as buildSharedMap,
    type DeviceRelationship as SharedRelationship,
    type DeviceRelationshipMap as SharedRelationshipMap,
    type DeviceTopology,
} from "@ui/lib/device-topology";

export { type DeviceTopology, type DeviceNode } from "@ui/lib/device-topology";

export type DeviceRelationship = SharedRelationship & { createdAt?: Date };
export type DeviceRelationshipMap = Omit<
    SharedRelationshipMap,
    "relationships"
> & {
    relationships: DeviceRelationship[];
};

export function buildDeviceRelationshipMap(
    topology: DeviceTopology | undefined,
    localDevices: LinkedDevice[],
    currentServerId?: string | null,
    options: { topologyVerified?: boolean; currentRoot?: boolean } = {},
): DeviceRelationshipMap {
    const accountMap = buildSharedMap(
        topology,
        localDevices.filter(LinkedDevices.isUsingOnlineServices),
        currentServerId,
        options,
    );
    // Online Services ICE creates an account relationship even with custom
    // signaling. Its sync ID and current endpoint establish the peer identity.
    // Fully custom records stay separate from coincidental account IDs.
    const customMap = buildSharedMap(
        undefined,
        localDevices.filter(
            (device) => !LinkedDevices.isUsingOnlineServices(device),
        ),
        accountMap.currentDeviceId.startsWith("account:")
            ? accountMap.currentDeviceId.slice("account:".length)
            : undefined,
        { currentRoot: options.currentRoot },
    );
    const createdAt = new Map(
        topology?.relationships.map((relationship) => [
            relationship.syncId,
            relationship.createdAt,
        ]),
    );
    return {
        ...accountMap,
        nodes: [
            ...accountMap.nodes,
            ...customMap.nodes.filter(
                (node) => node.id !== accountMap.currentDeviceId,
            ),
        ],
        relationships: [
            ...accountMap.relationships.map((relationship) => ({
                ...relationship,
                missingOnServer:
                    accountMap.topologyVerified &&
                    !!relationship.localDevice &&
                    !relationship.recordedOnServer,
                ...(relationship.recordedOnServer
                    ? { createdAt: createdAt.get(relationship.syncId) }
                    : {}),
            })),
            ...customMap.relationships,
        ],
    };
}
