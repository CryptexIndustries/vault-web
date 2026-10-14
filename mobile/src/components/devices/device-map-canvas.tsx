import { memo, useMemo, type ComponentProps } from "react";
import { Platform } from "react-native";
import {
    Canvas,
    Circle,
    DashPathEffect,
    Group,
    Path,
    Paint,
    RoundedRect,
    Text,
    matchFont,
    Skia,
} from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { Laptop, Smartphone } from "lucide-react-native";
import { WebRTCStatus } from "@cryptex-industries/vault-core/synchronization-utils";
import type {
    DeviceNode,
    DeviceRelationship,
    DeviceRelationshipMap,
} from "@/components/account/device-topology";
import { colors } from "@/theme";
import {
    deviceLiveStatus,
    primaryLocalDevice,
    type DeviceConnectionStatuses,
    type DeviceSelection,
} from "./device-browser";
import { deviceGlyphIcon } from "./device-glyph";
import { relationshipPath, type MapPoint } from "./device-map-layout";
import type { MapTransform } from "./device-map-camera";
import { DeviceMapFlow } from "./device-map-flow";

function glyphPath(point: MapPoint, node: DeviceNode) {
    const icon = deviceGlyphIcon(node);
    return icon === Smartphone
        ? `M ${point.x - 4} ${point.y - 10} h 8 a 2 2 0 0 1 2 2 v 16 a 2 2 0 0 1 -2 2 h -8 a 2 2 0 0 1 -2 -2 v -16 a 2 2 0 0 1 2 -2 Z M ${point.x - 2} ${point.y + 6} h 4`
        : icon === Laptop
          ? `M ${point.x - 8} ${point.y - 8} h 16 v 12 h -16 Z M ${point.x - 10} ${point.y + 8} h 20 l -2 -4 h -16 Z`
          : node.localDevices.length
            ? `M ${point.x - 9} ${point.y - 9} h 18 v 14 h -18 Z M ${point.x - 4} ${point.y + 9} h 8 M ${point.x} ${point.y + 5} v 4`
            : `M ${point.x - 7} ${point.y - 8} h 14 v 16 h -14 Z M ${point.x - 3} ${point.y - 4} h 6 M ${point.x - 3} ${point.y} h 6 M ${point.x - 3} ${point.y + 4} h 3`;
}

export function createDeviceMapFonts() {
    const fontFamily = Platform.OS === "ios" ? "Helvetica" : "sans-serif";
    return {
        name: matchFont({ fontFamily, fontSize: 12 }),
        status: matchFont({ fontFamily, fontSize: 11 }),
        root: matchFont({ fontFamily, fontSize: 10 }),
        isolated: matchFont({ fontFamily, fontSize: 14 }),
    };
}

const DeviceMapDrawing = memo(function DeviceMapDrawing({
    map,
    nodes,
    positions,
    edges,
    statuses,
    connectedIds,
    selection,
    neighborhood,
    isolatedBounds,
    isolatedCount,
    camera,
    phase,
    flowVisible,
    viewport,
    fonts,
    isolatedIds,
}: {
    fonts: ReturnType<typeof createDeviceMapFonts>;
    isolatedIds: Set<string>;
    map: DeviceRelationshipMap;
    nodes: DeviceNode[];
    positions: Map<string, MapPoint>;
    edges: DeviceRelationship[];
    statuses: DeviceConnectionStatuses;
    connectedIds: Set<string>;
    selection: DeviceSelection | null;
    neighborhood: Set<string> | null;
    isolatedBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    isolatedCount: number;
    camera: SharedValue<MapTransform>;
    phase: SharedValue<number>;
    flowVisible: SharedValue<number>;
    viewport: { width: number; height: number };
}) {
    const geometry = useMemo(
        () => ({
            nodes: nodes.flatMap((node) => {
                const point = positions.get(node.id);
                if (!point) return [];
                const label =
                    node.displayName.length > 23
                        ? `${node.displayName.slice(0, 21)}…`
                        : node.displayName;
                return [
                    {
                        node,
                        point,
                        label,
                        labelWidth: fonts.name.measureText(label).width,
                        glyph: Skia.Path.MakeFromSVGString(
                            glyphPath(point, node),
                        )!,
                    },
                ];
            }),
            edges: edges.flatMap((edge) => {
                const path = relationshipPath(
                    edge,
                    map.relationships,
                    positions,
                );
                return path
                    ? [{ edge, path: Skia.Path.MakeFromSVGString(path)! }]
                    : [];
            }),
        }),
        [nodes, edges, positions, map.relationships, fonts],
    );
    const dots = useMemo(() => {
        const path = Skia.Path.Make();
        for (let x = 1; x < viewport.width; x += 19)
            for (let y = 1; y < viewport.height; y += 19)
                path.addCircle(x, y, 0.7);
        return path;
    }, [viewport.width, viewport.height]);
    const world = useDerivedValue(() => [
        { translateX: camera.value.x },
        { translateY: camera.value.y },
        { scale: camera.value.scale },
    ]);
    const labelOpacity = useDerivedValue(() =>
        camera.value.scale < 0.4 ? 0 : 1,
    );
    const glyphStroke = useDerivedValue(() =>
        camera.value.scale < 0.4 ? 3 : 1.5,
    );
    const edgeStroke = useDerivedValue(() =>
        camera.value.scale < 0.4 ? 2 : 1.4,
    );
    const selectedStroke = useDerivedValue(() => 2.5 / camera.value.scale);
    const flowPaths = useMemo(() => {
        const normal = Skia.Path.Make();
        const dimmed = Skia.Path.Make();
        for (const { edge, path } of geometry.edges) {
            if (!connectedIds.has(edge.id)) continue;
            const unrelated =
                selection?.kind === "edge"
                    ? edge.id !== selection.id
                    : selection?.kind === "node" &&
                      edge.fromDeviceId !== selection.id &&
                      edge.toDeviceId !== selection.id;
            (unrelated ? dimmed : normal).addPath(path);
        }
        return { normal, dimmed };
    }, [geometry.edges, connectedIds, selection]);
    const nodeLayers = useMemo(
        () => ({
            dimmed: geometry.nodes.filter(
                (item) => neighborhood && !neighborhood.has(item.node.id),
            ),
            normal: geometry.nodes.filter(
                (item) => !neighborhood || neighborhood.has(item.node.id),
            ),
        }),
        [geometry.nodes, neighborhood],
    );
    const orderedEdges = useMemo(() => {
        const dimmed = (edge: DeviceRelationship) =>
            selection?.kind === "edge"
                ? edge.id !== selection.id
                : selection?.kind === "node" &&
                  edge.fromDeviceId !== selection.id &&
                  edge.toDeviceId !== selection.id;
        return [
            ...geometry.edges.filter((item) => dimmed(item.edge)),
            ...geometry.edges.filter((item) => !dimmed(item.edge)),
        ];
    }, [geometry.edges, selection]);
    const nodeView = ({
        node,
        point,
        label,
        labelWidth,
        glyph,
    }: (typeof geometry.nodes)[number]) => {
        const selected = selection?.kind === "node" && selection.id === node.id;
        const local = primaryLocalDevice(node, statuses);
        const connected =
            !!local &&
            statuses[local.ID]?.webRTCStatus === WebRTCStatus.Connected;
        const custom =
            !node.current &&
            map.relationships.some(
                (edge) =>
                    edge.custom &&
                    (edge.fromDeviceId === node.id ||
                        edge.toDeviceId === node.id),
            );
        const status = node.current
            ? ""
            : local
              ? deviceLiveStatus(local, statuses)
              : isolatedIds.has(node.id)
                ? "No recorded links"
                : "No local link";
        return (
            <Group key={node.id}>
                <RoundedRect
                    x={point.x - 30}
                    y={point.y - 30}
                    width={60}
                    height={60}
                    r={18}
                    color={node.current ? "#2b2738" : colors.background}
                />
                <RoundedRect
                    x={point.x - 30}
                    y={point.y - 30}
                    width={60}
                    height={60}
                    r={18}
                    style="stroke"
                    color={selected ? colors.primary : colors.border}
                    strokeWidth={selected ? selectedStroke : 1.3}
                />
                <Path
                    path={glyph}
                    style="stroke"
                    strokeWidth={glyphStroke}
                    strokeCap="round"
                    strokeJoin="round"
                    color={node.current ? colors.primary : colors.foreground}
                />
                {custom ? (
                    <Group>
                        <Path
                            path={`M ${point.x - 25} ${point.y - 36} l 7 7 -7 7 -7 -7 Z`}
                            color={colors.background}
                        />
                        <Path
                            path={`M ${point.x - 25} ${point.y - 36} l 7 7 -7 7 -7 -7 Z`}
                            style="stroke"
                            strokeWidth={2}
                            color="#b193ff"
                        />
                    </Group>
                ) : null}
                {connected ? (
                    <Circle
                        cx={point.x + 24}
                        cy={point.y + 24}
                        r={4}
                        color={colors.success}
                    />
                ) : null}
                <Group opacity={labelOpacity}>
                    <Text
                        x={point.x - labelWidth / 2}
                        y={point.y + 49}
                        text={label}
                        font={fonts.name}
                        color={colors.foreground}
                    />
                    <Text
                        x={point.x - fonts.status.measureText(status).width / 2}
                        y={point.y + 65}
                        text={status}
                        font={fonts.status}
                        color={connected ? colors.success : colors.muted}
                    />
                    {node.root ? (
                        <Group>
                            <RoundedRect
                                x={point.x - 22}
                                y={point.y - 44}
                                width={44}
                                height={17}
                                r={4}
                                color={colors.secondary}
                            />
                            <RoundedRect
                                x={point.x - 22}
                                y={point.y - 44}
                                width={44}
                                height={17}
                                r={4}
                                style="stroke"
                                strokeWidth={1}
                                color={colors.border}
                            />
                            <Text
                                x={
                                    point.x -
                                    fonts.root.measureText("Root").width / 2
                                }
                                y={point.y - 32}
                                text="Root"
                                font={fonts.root}
                                color={colors.foreground}
                            />
                        </Group>
                    ) : null}
                </Group>
            </Group>
        );
    };
    return (
        <Canvas
            testID="device-map-canvas"
            style={{ flex: 1 }}
            accessible={false}
        >
            <Path path={dots} color="#3b455b80" />
            <Group transform={world}>
                {isolatedBounds ? (
                    <Group>
                        <RoundedRect
                            {...isolatedBounds}
                            r={12}
                            color="#22293a55"
                        />
                        <RoundedRect
                            {...isolatedBounds}
                            r={12}
                            color={colors.border}
                            style="stroke"
                            strokeWidth={1}
                        >
                            <DashPathEffect intervals={[6, 6]} />
                        </RoundedRect>
                        <Text
                            x={isolatedBounds.x + 18}
                            y={isolatedBounds.y + 25}
                            text={`No recorded links (${isolatedCount})`}
                            font={fonts.isolated}
                            color={colors.muted}
                        />
                    </Group>
                ) : null}
                {orderedEdges.map(({ edge, path }) => {
                    const selected =
                        selection?.kind === "edge" && selection.id === edge.id;
                    const dimmed =
                        selection?.kind === "edge"
                            ? !selected
                            : selection?.kind === "node" &&
                              edge.fromDeviceId !== selection.id &&
                              edge.toDeviceId !== selection.id;
                    return (
                        <Path
                            key={edge.id}
                            path={path}
                            style="stroke"
                            strokeWidth={selected ? 3 : edgeStroke}
                            color={
                                connectedIds.has(edge.id)
                                    ? colors.success
                                    : colors.muted
                            }
                            opacity={dimmed ? 0.15 : 1}
                        >
                            {edge.localDevice ? null : (
                                <DashPathEffect intervals={[4, 5]} />
                            )}
                        </Path>
                    );
                })}
                <DeviceMapFlow
                    {...flowPaths}
                    camera={camera}
                    phase={phase}
                    visible={flowVisible}
                />
                {nodeLayers.dimmed.length ? (
                    <Group layer={<Paint opacity={0.15} />}>
                        {nodeLayers.dimmed.map(nodeView)}
                    </Group>
                ) : null}
                {nodeLayers.normal.map(nodeView)}
            </Group>
        </Canvas>
    );
});

export const DeviceMapCanvas = memo(
    function DeviceMapCanvas({
        active: _active,
        ...props
    }: ComponentProps<typeof DeviceMapDrawing> & { active: boolean }) {
        return <DeviceMapDrawing {...props} />;
    },
    (previous, next) => {
        // Record the opening selection, then retain it through covered sheet changes.
        if (!previous.active && !next.active) return true;
        const keys = Object.keys(next) as (keyof typeof next)[];
        return (
            keys.length === Object.keys(previous).length &&
            keys.every((key) => Object.is(previous[key], next[key]))
        );
    },
);
