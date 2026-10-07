import { memo } from "react";
import {
    DashPathEffect,
    Group,
    Path,
    type SkPath,
} from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import type { MapTransform } from "./device-map-camera";

export const DeviceMapFlow = memo(function DeviceMapFlow({
    normal,
    dimmed,
    camera,
    phase,
    visible,
}: {
    normal: SkPath;
    dimmed: SkPath;
    camera: SharedValue<MapTransform>;
    phase: SharedValue<number>;
    visible: SharedValue<number>;
}) {
    const width = useDerivedValue(() => 2.5 / camera.value.scale);
    const intervals = useDerivedValue(() => [
        5 / camera.value.scale,
        19 / camera.value.scale,
    ]);
    const offset = useDerivedValue(() => phase.value / camera.value.scale);
    return (
        <Group opacity={visible}>
            <Path
                path={dimmed}
                style="stroke"
                color="#6ee7b7"
                strokeWidth={width}
                opacity={0.15}
            >
                <DashPathEffect intervals={intervals} phase={offset} />
            </Path>
            <Path
                path={normal}
                style="stroke"
                color="#6ee7b7"
                strokeWidth={width}
            >
                <DashPathEffect intervals={intervals} phase={offset} />
            </Path>
        </Group>
    );
});
