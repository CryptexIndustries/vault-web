import { memo } from "react";
import { Pressable, View } from "react-native";
import type {
    DeviceNode,
    DeviceRelationshipMap,
} from "@/components/account/device-topology";
import {
    deviceLiveStatus,
    type DeviceConnectionStatuses,
    type DeviceSelection,
} from "./device-browser";
import type { MapHitEdge } from "./device-map-hit-testing";
import type { MapTransform } from "./device-map-camera";
import type { MapPoint } from "./device-map-layout";

export const DeviceMapAccessibility = memo(function DeviceMapAccessibility({
    enabled,
    map,
    nodes,
    positions,
    edges,
    camera,
    viewport,
    statuses,
    selection,
    onSelect,
}: {
    enabled: boolean;
    map: DeviceRelationshipMap;
    nodes: DeviceNode[];
    positions: Map<string, MapPoint>;
    edges: MapHitEdge[];
    camera: MapTransform;
    viewport: { width: number; height: number };
    statuses: DeviceConnectionStatuses;
    selection: DeviceSelection | null;
    onSelect: (next: DeviceSelection) => void;
}) {
    if (!enabled) return null;
    const frame = (point: MapPoint, size: number) => {
        const x = point.x * camera.scale + camera.x;
        const y = point.y * camera.scale + camera.y;
        if (
            x + size / 2 < 0 ||
            y + size / 2 < 0 ||
            x - size / 2 > viewport.width ||
            y - size / 2 > viewport.height
        )
            return null;
        return {
            position: "absolute" as const,
            left: x - size / 2,
            top: y - size / 2,
            width: size,
            height: size,
        };
    };
    return (
        <View
            testID="device-map-accessibility"
            pointerEvents="box-none"
            style={{
                position: "absolute",
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            }}
        >
            {edges.map((edge) => {
                const relationship = map.relationships.find(
                    (item) => item.id === edge.id,
                )!;
                const point = edge.points[Math.floor(edge.points.length / 2)]!;
                const style = frame(point, 44);
                if (!style) return null;
                const from = map.nodes.find(
                    (node) => node.id === relationship.fromDeviceId,
                )?.displayName;
                const to = map.nodes.find(
                    (node) => node.id === relationship.toDeviceId,
                )?.displayName;
                return (
                    <Pressable
                        key={edge.id}
                        testID={`device-map-edge-${edge.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Connection between ${from} and ${to}: ${deviceLiveStatus(relationship.localDevice, statuses)}`}
                        accessibilityState={{
                            selected:
                                selection?.kind === "edge" &&
                                selection.id === edge.id,
                        }}
                        style={style}
                        onPress={() => onSelect({ kind: "edge", id: edge.id })}
                    />
                );
            })}
            {nodes.map((node) => {
                const point = positions.get(node.id);
                if (!point) return null;
                const style = frame(point, Math.max(44, 60 * camera.scale));
                if (!style) return null;
                return (
                    <Pressable
                        key={node.id}
                        testID={`device-map-node-${node.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Select ${node.displayName}${node.root ? ", root device" : ""}`}
                        accessibilityState={{
                            selected:
                                selection?.kind === "node" &&
                                selection.id === node.id,
                        }}
                        style={style}
                        onPress={() => onSelect({ kind: "node", id: node.id })}
                    />
                );
            })}
        </View>
    );
});
