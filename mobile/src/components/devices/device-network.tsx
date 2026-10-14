import {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { AccessibilityInfo, AppState, Pressable, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
    cancelAnimation,
    Easing,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import { Minus, MoreHorizontal, Plus, Target, X } from "lucide-react-native";
import type {
    DeviceNode,
    DeviceRelationshipMap,
} from "@/components/account/device-topology";
import {
    UnlockedText as Text,
    UnlockedDialogTitle,
} from "@/components/unlocked/unlocked-ui";
import { Dialog } from "@/components/ui/dialog";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { colors } from "@/theme";
import {
    buildDeviceMapLayout,
    relationshipCurve,
    type MapPoint,
} from "./device-map-layout";
import {
    type DeviceConnectionStatuses,
    type DeviceSelection,
} from "./device-browser";
import { DeviceMapCanvas, createDeviceMapFonts } from "./device-map-canvas";
import { DeviceMapAccessibility } from "./device-map-accessibility";
import { sampleMapCurve } from "./device-map-hit-testing";
import {
    DeviceMapCamera,
    MIN_MAP_ZOOM as MIN_ZOOM,
    MAX_MAP_ZOOM as MAX_ZOOM,
    type DeviceMapCameraHandle,
    type MapTransform,
} from "./device-map-camera";

export const DeviceNetwork = memo(function DeviceNetwork({
    map,
    nodes = map.nodes,
    selection,
    connectedIds,
    statuses,
    focusId,
    active = true,
    showHint = true,
    onReady,
    onSelect,
}: {
    map: DeviceRelationshipMap;
    nodes?: DeviceNode[];
    selection: DeviceSelection | null;
    connectedIds: Set<string>;
    statuses: DeviceConnectionStatuses;
    focusId?: string | null;
    active?: boolean;
    showHint?: boolean;
    onReady?: () => void;
    onSelect: (selection: DeviceSelection | null) => void;
}) {
    const fonts = useMemo(createDeviceMapFonts, []);
    const initialReducedMotion = useReducedMotion();
    const [reducedMotion, setReducedMotion] = useState(initialReducedMotion);
    const [focused, setFocused] = useState(false);
    const [appActive, setAppActive] = useState(
        AppState.currentState === "active",
    );
    const [animate, setAnimate] = useState(true);
    const [legendOpen, setLegendOpen] = useState(false);
    const [screenReader, setScreenReader] = useState(false);
    const [gesturing, setGesturing] = useState(false);
    const [viewport, setViewport] = useState({ width: 360, height: 390 });
    const [measured, setMeasured] = useState(false);
    const [transform, setTransform] = useState<MapTransform>({
        scale: 1,
        x: 0,
        y: 0,
    });
    const camera = useSharedValue(transform);
    const transformRef = useRef(transform);
    const cameraRef = useRef<DeviceMapCameraHandle>(null);
    const commitCamera = useCallback(
        (next: MapTransform) => {
            transformRef.current = next;
            camera.value = next;
            setTransform(next);
        },
        [camera],
    );
    const trackCamera = useCallback((next: MapTransform) => {
        transformRef.current = next;
        setTransform(next);
    }, []);
    const movedAt = useRef(0);
    const gesturingRef = useRef(false);
    const flow = useSharedValue(0);
    const flowVisible = useSharedValue(1);
    const mapRef = useRef<View>(null);
    const layout = useMemo(() => buildDeviceMapLayout(map), [map]);
    useFocusEffect(
        useCallback(() => {
            setFocused(true);
            return () => setFocused(false);
        }, []),
    );
    const ids = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
    const visibleEdges = useMemo(
        () =>
            map.relationships.filter(
                (edge) =>
                    ids.has(edge.fromDeviceId) && ids.has(edge.toDeviceId),
            ),
        [map.relationships, ids],
    );
    const hasVisibleConnections = visibleEdges.some((edge) =>
        connectedIds.has(edge.id),
    );
    useEffect(() => {
        if (!measured || !onReady) return;
        const frame = requestAnimationFrame(onReady);
        return () => cancelAnimationFrame(frame);
    }, [measured, onReady]);
    const selectedEdge =
        selection?.kind === "edge"
            ? map.relationships.find((edge) => edge.id === selection.id)
            : undefined;
    const neighborhood = useMemo(() => {
        if (selectedEdge)
            return new Set([
                selectedEdge.fromDeviceId,
                selectedEdge.toDeviceId,
            ]);
        if (selection?.kind !== "node") return null;
        return new Set([
            selection.id,
            ...map.relationships
                .filter(
                    (edge) =>
                        edge.fromDeviceId === selection.id ||
                        edge.toDeviceId === selection.id,
                )
                .flatMap((edge) => [edge.fromDeviceId, edge.toDeviceId]),
        ]);
    }, [selection, selectedEdge, map.relationships]);
    const isolated = useMemo(
        () => nodes.filter((node) => layout.isolatedIds.has(node.id)),
        [nodes, layout.isolatedIds],
    );

    const fit = (targets: DeviceNode[] = nodes) => {
        cameraRef.current?.stop();
        const points = targets
            .map((node) => layout.positions.get(node.id))
            .filter((point): point is MapPoint => !!point);
        if (!points.length) return;
        const left = Math.min(...points.map((point) => point.x)) - 85;
        const right = Math.max(...points.map((point) => point.x)) + 85;
        const top = Math.min(...points.map((point) => point.y)) - 75;
        const bottom = Math.max(...points.map((point) => point.y)) + 85;
        const scale = Math.max(
            MIN_ZOOM,
            Math.min(
                1.2,
                (viewport.width - 34) / (right - left),
                (viewport.height - 34) / (bottom - top),
            ),
        );
        commitCamera({
            scale,
            x: viewport.width / 2 - ((left + right) / 2) * scale,
            y: viewport.height / 2 - ((top + bottom) / 2) * scale,
        });
    };
    const fitRef = useRef(fit);
    fitRef.current = fit;
    const visibleKey = nodes.map((node) => node.id).join("|");
    useEffect(() => {
        fitRef.current();
    }, [layout, visibleKey, viewport.width, viewport.height]);
    useEffect(() => {
        if (!focusId) return;
        const neighbors = new Set([
            focusId,
            ...map.relationships
                .filter(
                    (edge) =>
                        edge.fromDeviceId === focusId ||
                        edge.toDeviceId === focusId,
                )
                .flatMap((edge) => [edge.fromDeviceId, edge.toDeviceId]),
        ]);
        fitRef.current(nodes.filter((node) => neighbors.has(node.id)));
    }, [
        focusId,
        layout,
        viewport.width,
        viewport.height,
        map.relationships,
        nodes,
    ]);
    useEffect(() => {
        setReducedMotion(initialReducedMotion);
    }, [initialReducedMotion]);
    useEffect(() => {
        let mounted = true;
        void AccessibilityInfo.isReduceMotionEnabled()
            .then((enabled) => {
                if (mounted) setReducedMotion(enabled);
            })
            .catch(() => undefined);
        void AccessibilityInfo.isScreenReaderEnabled()
            .then((enabled) => {
                if (mounted) setScreenReader(enabled);
            })
            .catch(() => undefined);
        const reader = AccessibilityInfo.addEventListener(
            "screenReaderChanged",
            setScreenReader,
        );
        const motion = AccessibilityInfo.addEventListener(
            "reduceMotionChanged",
            setReducedMotion,
        );
        const appState = AppState.addEventListener("change", (state) =>
            setAppActive(state === "active"),
        );
        return () => {
            mounted = false;
            motion.remove();
            reader.remove();
            appState.remove();
        };
    }, []);
    useEffect(() => {
        cancelAnimation(flow);
        flow.value = 0;
        flowVisible.value =
            active && focused && appActive && !legendOpen && !gesturing ? 1 : 0;
        if (
            active &&
            focused &&
            appActive &&
            !legendOpen &&
            !gesturing &&
            !reducedMotion &&
            animate &&
            hasVisibleConnections
        ) {
            flow.value = withRepeat(
                withTiming(-48, { duration: 1800, easing: Easing.linear }),
                -1,
                false,
            );
        }
        return () => {
            cancelAnimation(flow);
            flow.value = 0;
        };
    }, [
        active,
        focused,
        appActive,
        legendOpen,
        gesturing,
        reducedMotion,
        animate,
        hasVisibleConnections,
        flow,
        flowVisible,
    ]);

    const gestureChange = useCallback((active: boolean) => {
        gesturingRef.current = active;
        setGesturing(active);
        movedAt.current = Date.now();
    }, []);

    const zoomBy = (factor: number) => cameraRef.current?.zoomBy(factor);
    const select = useCallback(
        (next: DeviceSelection) => {
            if (gesturingRef.current || Date.now() - movedAt.current < 120)
                return;
            const repeat =
                selection?.kind === next.kind && selection.id === next.id;
            onSelect(repeat ? null : next);
            if (
                !repeat &&
                next.kind === "node" &&
                transformRef.current.scale < 0.4
            ) {
                const neighbors = new Set([
                    next.id,
                    ...map.relationships
                        .filter(
                            (edge) =>
                                edge.fromDeviceId === next.id ||
                                edge.toDeviceId === next.id,
                        )
                        .flatMap((edge) => [
                            edge.fromDeviceId,
                            edge.toDeviceId,
                        ]),
                ]);
                fitRef.current(nodes.filter((node) => neighbors.has(node.id)));
            }
        },
        [selection, onSelect, map.relationships, nodes],
    );
    const overview = transform.scale < 0.4;
    const isolatedBounds = useMemo(() => {
        if (!isolated.length) return null;
        const points = isolated.map((node) => layout.positions.get(node.id)!);
        return {
            x: Math.min(...points.map((point) => point.x)) - 70,
            y: Math.min(...points.map((point) => point.y)) - 90,
            width:
                Math.max(...points.map((point) => point.x)) -
                Math.min(...points.map((point) => point.x)) +
                140,
            height:
                Math.max(...points.map((point) => point.y)) -
                Math.min(...points.map((point) => point.y)) +
                180,
        };
    }, [isolated, layout.positions]);
    const hitNodes = useMemo(
        () =>
            nodes.flatMap((node) => {
                const point = layout.positions.get(node.id);
                return point
                    ? [
                          {
                              id: node.id,
                              root: node.root,
                              custom:
                                  !node.current &&
                                  map.relationships.some(
                                      (edge) =>
                                          edge.custom &&
                                          (edge.fromDeviceId === node.id ||
                                              edge.toDeviceId === node.id),
                                  ),
                              ...point,
                              labelWidth: Math.max(
                                  fonts.name.measureText(
                                      node.displayName.length > 23
                                          ? `${node.displayName.slice(0, 21)}…`
                                          : node.displayName,
                                  ).width,
                                  fonts.status.measureText("No recorded links")
                                      .width,
                              ),
                          },
                      ]
                    : [];
            }),
        [nodes, layout.positions, fonts, map.relationships],
    );
    const hitEdges = useMemo(
        () =>
            visibleEdges.flatMap((edge) => {
                const curve = relationshipCurve(
                    edge,
                    map.relationships,
                    layout.positions,
                );
                return curve
                    ? [{ id: edge.id, points: sampleMapCurve(curve.points) }]
                    : [];
            }),
        [visibleEdges, map.relationships, layout.positions],
    );
    return (
        <View style={{ flex: 1, minHeight: 180 }}>
            <View
                ref={mapRef}
                testID="device-map"
                style={{ flex: 1, overflow: "hidden" }}
                onLayout={(event) => {
                    const { width, height } = event.nativeEvent.layout;
                    if (width > 0 && height > 0) {
                        setMeasured(true);
                        setViewport((current) =>
                            current.width === width && current.height === height
                                ? current
                                : { width, height },
                        );
                    }
                }}
            >
                <DeviceMapCamera
                    ref={cameraRef}
                    camera={camera}
                    viewport={viewport}
                    onCameraChange={trackCamera}
                    enabled={active && focused && appActive && !legendOpen}
                    onGestureChange={gestureChange}
                    onSelect={select}
                    hitNodes={hitNodes}
                    hitEdges={hitEdges}
                    selection={selection}
                    flow={flow}
                    flowVisible={flowVisible}
                >
                    <DeviceMapCanvas
                        active={active && focused && appActive && !legendOpen}
                        fonts={fonts}
                        isolatedIds={layout.isolatedIds}
                        map={map}
                        nodes={nodes}
                        positions={layout.positions}
                        edges={visibleEdges}
                        statuses={statuses}
                        connectedIds={connectedIds}
                        selection={selection}
                        neighborhood={neighborhood}
                        isolatedBounds={isolatedBounds}
                        isolatedCount={isolated.length}
                        camera={camera}
                        phase={flow}
                        flowVisible={flowVisible}
                        viewport={viewport}
                    />
                    <DeviceMapAccessibility
                        enabled={
                            screenReader &&
                            active &&
                            focused &&
                            appActive &&
                            !legendOpen
                        }
                        map={map}
                        nodes={nodes}
                        positions={layout.positions}
                        edges={hitEdges}
                        camera={transform}
                        viewport={viewport}
                        statuses={statuses}
                        selection={selection}
                        onSelect={select}
                    />
                </DeviceMapCamera>
                {overview && showHint ? (
                    <Text
                        testID="device-map-hint"
                        pointerEvents="none"
                        style={{
                            position: "absolute",
                            left: 12,
                            top: 8,
                            fontSize: 10,
                            color: colors.muted,
                        }}
                    >
                        Select a device to explore
                    </Text>
                ) : null}
                {!nodes.length ? (
                    <Text
                        style={{
                            position: "absolute",
                            left: 18,
                            right: 18,
                            top: "35%",
                            textAlign: "center",
                            fontSize: 13,
                            color: colors.muted,
                        }}
                    >
                        No matching devices
                    </Text>
                ) : null}
                <View
                    style={{
                        position: "absolute",
                        right: 10,
                        bottom: 33,
                        backgroundColor: colors.navigation,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 7,
                        overflow: "hidden",
                    }}
                >
                    <MapControl
                        id="zoom-in"
                        label="Zoom in"
                        disabled={transform.scale >= MAX_ZOOM}
                        onPress={() => zoomBy(1.25)}
                    >
                        <Plus size={20} color={colors.foreground} />
                    </MapControl>
                    <MapControl
                        id="zoom-out"
                        label="Zoom out"
                        disabled={transform.scale <= MIN_ZOOM}
                        onPress={() => zoomBy(0.8)}
                    >
                        <Minus size={20} color={colors.foreground} />
                    </MapControl>
                    <MapControl
                        id="fit"
                        label="Fit all visible devices"
                        onPress={() => {
                            onSelect(null);
                            fit();
                        }}
                    >
                        <Target
                            size={21}
                            color={colors.foreground}
                            strokeWidth={1.6}
                        />
                    </MapControl>
                    <MapControl
                        id="legend"
                        label="Map legend"
                        onPress={() => setLegendOpen(true)}
                    >
                        <MoreHorizontal size={18} color={colors.foreground} />
                        <Text style={{ fontSize: 9 }}>Legend</Text>
                    </MapControl>
                </View>
            </View>
            <Dialog
                open={legendOpen}
                onOpenChange={setLegendOpen}
                placement="bottom"
                bottomSheetVariant="devices"
                scroll
            >
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        minHeight: 42,
                        marginBottom: 12,
                    }}
                >
                    <UnlockedDialogTitle style={{ fontSize: 24 }}>
                        Reading the map
                    </UnlockedDialogTitle>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close map legend"
                        onPress={() => setLegendOpen(false)}
                        hitSlop={1}
                        style={{
                            width: 42,
                            height: 42,
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <X size={20} color={colors.muted} />
                    </Pressable>
                </View>
                <LegendEntry
                    title="Connected"
                    explanation="Moving dashes show an active connection from this device, not a sync or transfer in progress."
                    color={colors.success}
                />
                <LegendEntry
                    title="Disconnected"
                    explanation="A saved local link that is currently offline."
                    color={colors.muted}
                />
                <LegendEntry
                    title="Status unknown"
                    explanation="A recorded relationship whose live connection status is unavailable here."
                    color={colors.muted}
                    dashed
                />
                <LegendEntry
                    title="Custom signaling"
                    explanation="This link uses a custom signaling server. STUN and TURN may still use Online Services."
                    color="#b193ff"
                    diamond
                />
                <View
                    style={{
                        paddingVertical: 16,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                        flexDirection: "row",
                        gap: 18,
                        alignItems: "center",
                    }}
                >
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13 }}>
                            Animate active connections
                        </Text>
                        {reducedMotion ? (
                            <Text
                                style={{
                                    fontSize: 11,
                                    color: colors.muted,
                                    marginTop: 6,
                                    lineHeight: 17,
                                }}
                            >
                                Reduced motion is enabled on this device.
                            </Text>
                        ) : null}
                    </View>
                    <Pressable
                        testID="device-map-animation"
                        accessibilityRole="switch"
                        accessibilityLabel="Animate active connections"
                        accessibilityState={{
                            checked: animate && !reducedMotion,
                            disabled: reducedMotion,
                        }}
                        disabled={reducedMotion}
                        onPress={() => setAnimate((current) => !current)}
                        style={{
                            width: 44,
                            minHeight: 44,
                            justifyContent: "center",
                            opacity: reducedMotion ? 0.4 : 1,
                        }}
                    >
                        <View
                            style={{
                                width: 44,
                                height: 26,
                                borderRadius: 20,
                                backgroundColor:
                                    animate && !reducedMotion
                                        ? colors.primary
                                        : "#3d4559",
                            }}
                        >
                            <View
                                style={{
                                    width: 20,
                                    height: 20,
                                    borderRadius: 10,
                                    backgroundColor: colors.foreground,
                                    position: "absolute",
                                    top: 3,
                                    left: animate && !reducedMotion ? 21 : 3,
                                }}
                            />
                        </View>
                    </Pressable>
                </View>
            </Dialog>
        </View>
    );
});

function MapControl({
    id,
    label,
    onPress,
    disabled = false,
    children,
}: {
    id: string;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    children: ReactNode;
}) {
    return (
        <Pressable
            testID={`device-map-${id}`}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
            hitSlop={1}
            style={{
                width: 42,
                minHeight: id === "legend" ? 48 : 42,
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                borderTopWidth: id === "zoom-in" ? 0 : 1,
                borderTopColor: colors.border,
                opacity: disabled ? 0.4 : 1,
            }}
        >
            {children}
        </Pressable>
    );
}

function LegendEntry({
    title,
    explanation,
    color,
    dashed = false,
    diamond = false,
}: {
    title: string;
    explanation: string;
    color: string;
    dashed?: boolean;
    diamond?: boolean;
}) {
    return (
        <View
            style={{
                flexDirection: "row",
                gap: 14,
                paddingVertical: 13,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <View
                style={
                    diamond
                        ? {
                              width: 8,
                              height: 8,
                              borderWidth: 1,
                              borderColor: color,
                              transform: [{ rotate: "45deg" }],
                              marginTop: 6,
                              marginHorizontal: 5,
                          }
                        : {
                              width: 17,
                              borderTopWidth: 2,
                              borderColor: color,
                              borderStyle: dashed ? "dashed" : "solid",
                              marginTop: 8,
                          }
                }
            />
            <View style={{ flex: 1 }}>
                <Text
                    style={{ fontSize: 13, lineHeight: 18, fontWeight: "500" }}
                >
                    {title}
                </Text>
                <Text
                    style={{
                        fontSize: 12,
                        color: colors.muted,
                        lineHeight: 19.2,
                        marginTop: 8,
                    }}
                >
                    {explanation}
                </Text>
            </View>
        </View>
    );
}
