import { useEffect } from "react";
import { Image, View } from "react-native";
import {
    BlurMask,
    Canvas,
    Circle,
    Group,
    LinearGradient,
    Path,
    RadialGradient,
    vec,
} from "@shopify/react-native-skia";
import {
    cancelAnimation,
    Easing,
    interpolate,
    useDerivedValue,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { colors } from "@/theme";

const HEXAGON = "M32 3 59 18v28L32 61 5 46V18L32 3Z";
const KEYHOLE = "M32 24a4 4 0 1 1 0 8a4 4 0 1 1 0-8Z M29 31h6l2 8H27Z";
const ease = Easing.bezierFn(0.42, 0, 0.58, 1);
const rippleEase = Easing.bezierFn(0.16, 1, 0.3, 1);

// CSS timing curves apply between keyframes, rather than across the whole loop.
function keyframe(
    phase: number,
    stops: number[],
    values: number[],
    ripple = false,
) {
    "worklet";
    const easing = ripple ? rippleEase : ease;
    for (let i = 1; i < stops.length; i++) {
        if (phase <= stops[i]) {
            const progress = (phase - stops[i - 1]) / (stops[i] - stops[i - 1]);
            return interpolate(
                easing(progress),
                [0, 1],
                [values[i - 1], values[i]],
            );
        }
    }
    return values[values.length - 1];
}

export function VaultLockAnimation() {
    const reducedMotion = useReducedMotion();
    const phase = useSharedValue(0);

    useEffect(() => {
        if (!reducedMotion) {
            phase.value = withRepeat(
                withTiming(1, { duration: 2600, easing: Easing.linear }),
                -1,
                false,
            );
        }
        return () => cancelAnimation(phase);
    }, [phase, reducedMotion]);

    const haloOpacity = useDerivedValue(() =>
        reducedMotion
            ? 0
            : keyframe(phase.value, [0, 0.32, 0.62, 1], [0.1, 0.85, 0.25, 0.1]),
    );
    const edgeOpacity = useDerivedValue(() =>
        reducedMotion
            ? 0
            : keyframe(
                  phase.value,
                  [0, 0.12, 0.3, 0.48, 0.85, 1],
                  [0, 0, 0.95, 0.4, 0, 0],
              ),
    );
    const faceOpacity = useDerivedValue(() =>
        reducedMotion
            ? 0
            : keyframe(phase.value, [0, 0.32, 0.65, 1], [0.1, 0.5, 0.15, 0.1]),
    );
    const keyholeOpacity = useDerivedValue(() =>
        reducedMotion
            ? 0.62
            : keyframe(
                  phase.value,
                  [0, 0.32, 0.65, 1],
                  [0.58, 0.72, 0.64, 0.58],
              ),
    );
    const rippleOpacity = useDerivedValue(() =>
        reducedMotion
            ? 0
            : keyframe(
                  phase.value,
                  [0, 0.22, 0.34, 0.7, 1],
                  [0, 0, 0.45, 0, 0],
                  true,
              ),
    );
    const rippleTransform = useDerivedValue(() => [
        {
            scale: reducedMotion
                ? 1
                : keyframe(
                      phase.value,
                      [0, 0.22, 0.34, 0.7, 1],
                      [1, 1, 1.025, 1.18, 1.18],
                      true,
                  ),
        },
    ]);

    return (
        <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={{ width: 88, height: 88 }}
        >
            <Image
                source={require("../../../assets/brand-mark.png")}
                style={{ width: 88, height: 88 }}
                resizeMode="contain"
            />
            <Canvas
                style={{
                    position: "absolute",
                    left: -22,
                    top: -22,
                    width: 132,
                    height: 132,
                }}
            >
                <Circle cx={66} cy={66} r={66} opacity={haloOpacity}>
                    <RadialGradient
                        c={vec(66, 66)}
                        r={66}
                        colors={[
                            "#ff566838",
                            "#ff566822",
                            "#ff56680c",
                            "#ff566800",
                        ]}
                        positions={[0, 0.34, 0.57, 0.78]}
                    />
                </Circle>
                <Group
                    transform={[
                        { translateX: 22 },
                        { translateY: 22 },
                        { scale: 88 / 64 },
                    ]}
                >
                    <Group
                        origin={vec(32, 32)}
                        transform={rippleTransform}
                        opacity={rippleOpacity}
                    >
                        <Path
                            path={HEXAGON}
                            color="#ff91a0"
                            style="stroke"
                            strokeWidth={0.7}
                        />
                    </Group>
                    <Path path={HEXAGON} color="#283148" />
                    <Path
                        path={HEXAGON}
                        color={colors.primary}
                        style="stroke"
                        strokeWidth={4}
                    />
                    <Path path={HEXAGON} opacity={faceOpacity}>
                        <RadialGradient
                            c={vec(32, 26.88)}
                            r={41.6}
                            colors={["#ff8b9a2e", "#ff566800"]}
                        />
                    </Path>
                    <Group opacity={edgeOpacity}>
                        <Path
                            path={HEXAGON}
                            color="#ff5668aa"
                            style="stroke"
                            strokeWidth={2.1}
                        >
                            <BlurMask blur={2} style="normal" />
                        </Path>
                        <Path path={HEXAGON} style="stroke" strokeWidth={2.1}>
                            <LinearGradient
                                start={vec(5, 3)}
                                end={vec(59, 61)}
                                colors={[
                                    colors.foreground,
                                    "#ffd4d0",
                                    "#ff8ca0",
                                ]}
                                positions={[0, 0.45, 1]}
                            />
                        </Path>
                    </Group>
                    <Path
                        path={KEYHOLE}
                        color={colors.primary}
                        opacity={keyholeOpacity}
                    />
                </Group>
            </Canvas>
        </View>
    );
}
