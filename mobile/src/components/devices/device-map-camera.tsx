import {
    forwardRef,
    memo,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    type ReactNode,
} from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
    cancelAnimation,
    runOnJS,
    runOnUI,
    useSharedValue,
    type SharedValue,
} from "react-native-reanimated";
import type { DeviceSelection } from "./device-browser";
import {
    hitTestDeviceMap,
    type MapHitEdge,
    type MapHitNode,
} from "./device-map-hit-testing";

export type MapTransform = { scale: number; x: number; y: number };
export const MIN_MAP_ZOOM = 0.09;
export const MAX_MAP_ZOOM = 2.5;
export type DeviceMapCameraHandle = {
    zoomBy: (factor: number) => void;
    stop: () => void;
};

type CameraProps = {
    camera: SharedValue<MapTransform>;
    viewport: { width: number; height: number };
    onCameraChange: (next: MapTransform) => void;
    onGestureChange: (active: boolean) => void;
    onSelect: (next: DeviceSelection) => void;
    enabled: boolean;
    flow: SharedValue<number>;
    flowVisible: SharedValue<number>;
    hitNodes: MapHitNode[];
    hitEdges: MapHitEdge[];
    selection: DeviceSelection | null;
    children: ReactNode;
};

export const DeviceMapCamera = memo(
    forwardRef<DeviceMapCameraHandle, CameraProps>(function DeviceMapCamera(
        {
            camera,
            viewport,
            onCameraChange,
            onGestureChange,
            onSelect,
            enabled,
            flow,
            flowVisible,
            hitNodes,
            hitEdges,
            selection,
            children,
        },
        ref,
    ) {
        const generation = useRef(0);
        const activeRef = useRef(false);
        const panActive = useSharedValue(false);
        const pinchActive = useSharedValue(false);
        const epoch = useSharedValue(0);
        const movedAt = useSharedValue(0);
        const panOrigin = useSharedValue({ x: 0, y: 0 });
        const panTranslation = useSharedValue({ x: 0, y: 0 });
        const panPointers = useSharedValue(0);
        const pinchPointers = useSharedValue(0);
        const pinchOrigin = useSharedValue({ scale: 1, x: 0, y: 0 });
        const notify = useCallback(
            (active: boolean, token: number) => {
                if (
                    token !== generation.current ||
                    activeRef.current === active
                )
                    return;
                activeRef.current = active;
                onGestureChange(active);
            },
            [onGestureChange],
        );
        const finish = useCallback(
            (next: MapTransform, token: number) => {
                if (
                    token !== generation.current ||
                    panActive.value ||
                    pinchActive.value
                )
                    return;
                onCameraChange(next);
                notify(false, token);
            },
            [onCameraChange, notify, panActive, pinchActive],
        );
        const tap = useCallback(
            (
                next: DeviceSelection,
                nextCamera: MapTransform,
                token: number,
            ) => {
                if (
                    token !== generation.current ||
                    panActive.value ||
                    pinchActive.value
                )
                    return;
                onCameraChange(nextCamera);
                onSelect(next);
            },
            [onCameraChange, onSelect, panActive, pinchActive],
        );
        const stop = useCallback(() => {
            const token = ++generation.current;
            runOnUI(() => {
                "worklet";
                epoch.value = token;
                panActive.value = false;
                pinchActive.value = false;
            })();
            if (activeRef.current) {
                activeRef.current = false;
                onGestureChange(false);
            }
        }, [epoch, panActive, pinchActive, onGestureChange]);
        useImperativeHandle(
            ref,
            () => ({
                stop,
                zoomBy(factor) {
                    if (!enabled || panActive.value || pinchActive.value)
                        return;
                    const token = generation.current;
                    runOnUI(() => {
                        "worklet";
                        if (
                            epoch.value !== token ||
                            panActive.value ||
                            pinchActive.value
                        )
                            return;
                        const current = camera.value;
                        const scale = Math.max(
                            MIN_MAP_ZOOM,
                            Math.min(MAX_MAP_ZOOM, current.scale * factor),
                        );
                        const ratio = scale / current.scale;
                        camera.value = {
                            scale,
                            x:
                                viewport.width / 2 -
                                (viewport.width / 2 - current.x) * ratio,
                            y:
                                viewport.height / 2 -
                                (viewport.height / 2 - current.y) * ratio,
                        };
                        runOnJS(finish)(camera.value, token);
                    })();
                },
            }),
            [
                stop,
                enabled,
                panActive,
                pinchActive,
                camera,
                epoch,
                viewport.width,
                viewport.height,
                finish,
            ],
        );
        useEffect(() => {
            if (!enabled) stop();
        }, [enabled, stop]);
        const gesture = useMemo(() => {
            const begin = () => {
                "worklet";
                if (panActive.value || pinchActive.value) return;
                movedAt.value = Date.now();
                flowVisible.value = 0;
                cancelAnimation(flow);
                flow.value = 0;
                runOnJS(notify)(true, epoch.value);
            };
            const finalize = () => {
                "worklet";
                if (panActive.value || pinchActive.value) return;
                movedAt.value = Date.now();
                runOnJS(finish)(camera.value, epoch.value);
            };
            const pan = Gesture.Pan()
                .enabled(enabled)
                .minDistance(4)
                .averageTouches(true)
                .onStart((event) => {
                    begin();
                    panActive.value = true;
                    panPointers.value = event.numberOfPointers;
                    panTranslation.value = {
                        x: event.translationX,
                        y: event.translationY,
                    };
                    panOrigin.value = {
                        x: camera.value.x - event.translationX,
                        y: camera.value.y - event.translationY,
                    };
                })
                .onUpdate((event) => {
                    if (!panActive.value) return;
                    panTranslation.value = {
                        x: event.translationX,
                        y: event.translationY,
                    };
                    if (panPointers.value !== event.numberOfPointers) {
                        panPointers.value = event.numberOfPointers;
                        panOrigin.value = {
                            x: camera.value.x - event.translationX,
                            y: camera.value.y - event.translationY,
                        };
                        return;
                    }
                    if (pinchActive.value && event.numberOfPointers > 1) return;
                    camera.value = {
                        scale: camera.value.scale,
                        x: panOrigin.value.x + event.translationX,
                        y: panOrigin.value.y + event.translationY,
                    };
                })
                .onFinalize(() => {
                    if (!panActive.value) return;
                    panActive.value = false;
                    finalize();
                });
            const pinch = Gesture.Pinch()
                .enabled(enabled)
                .onStart((event) => {
                    begin();
                    pinchActive.value = true;
                    pinchPointers.value = event.numberOfPointers;
                    pinchOrigin.value = {
                        scale: camera.value.scale / event.scale,
                        x: (event.focalX - camera.value.x) / camera.value.scale,
                        y: (event.focalY - camera.value.y) / camera.value.scale,
                    };
                })
                .onUpdate((event) => {
                    if (!pinchActive.value) return;
                    if (event.numberOfPointers < 2) {
                        pinchPointers.value = event.numberOfPointers;
                        return;
                    }
                    if (pinchPointers.value < 2)
                        pinchOrigin.value = {
                            scale: camera.value.scale / event.scale,
                            x:
                                (event.focalX - camera.value.x) /
                                camera.value.scale,
                            y:
                                (event.focalY - camera.value.y) /
                                camera.value.scale,
                        };
                    pinchPointers.value = event.numberOfPointers;
                    const scale = Math.max(
                        MIN_MAP_ZOOM,
                        Math.min(
                            MAX_MAP_ZOOM,
                            pinchOrigin.value.scale * event.scale,
                        ),
                    );
                    camera.value = {
                        scale,
                        x: event.focalX - pinchOrigin.value.x * scale,
                        y: event.focalY - pinchOrigin.value.y * scale,
                    };
                })
                .onFinalize(() => {
                    if (!pinchActive.value) return;
                    pinchActive.value = false;
                    panOrigin.value = {
                        x: camera.value.x - panTranslation.value.x,
                        y: camera.value.y - panTranslation.value.y,
                    };
                    finalize();
                });
            const press = Gesture.Tap()
                .enabled(enabled)
                .maxDistance(8)
                .onEnd((event, success) => {
                    if (
                        !success ||
                        panActive.value ||
                        pinchActive.value ||
                        Date.now() - movedAt.value < 120
                    )
                        return;
                    const next = hitTestDeviceMap(
                        { x: event.x, y: event.y },
                        camera.value,
                        hitNodes,
                        hitEdges,
                        selection,
                    );
                    if (next) runOnJS(tap)(next, camera.value, epoch.value);
                });
            return Gesture.Simultaneous(pan, pinch, press);
        }, [
            camera,
            enabled,
            flow,
            flowVisible,
            hitNodes,
            hitEdges,
            selection,
            notify,
            finish,
            tap,
            epoch,
            movedAt,
            panActive,
            pinchActive,
            panOrigin,
            panTranslation,
            panPointers,
            pinchPointers,
            pinchOrigin,
        ]);
        return (
            <GestureDetector gesture={gesture}>
                <View
                    testID="device-map-camera"
                    style={{ flex: 1 }}
                    collapsable={false}
                >
                    {children}
                </View>
            </GestureDetector>
        );
    }),
);
