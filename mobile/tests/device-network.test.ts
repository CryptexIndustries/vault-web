import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement, type ReactNode } from "react";
import {
    act,
    create,
    type ReactTestInstance,
    type ReactTestRenderer,
} from "react-test-renderer";
import { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    SignalingStatus,
    WebRTCStatus,
} from "@cryptex-industries/vault-core/synchronization-utils";
import { buildDeviceRelationshipMap } from "@/components/account/device-topology";
import { DeviceNetwork } from "@/components/devices/device-network";
import { cancelAnimation, withRepeat } from "react-native-reanimated";
import {
    buildDeviceMapLayout,
    relationshipPath,
} from "@/components/devices/device-map-layout";
import { colors } from "@/theme";

let mockReducedMotion = true;
let mockScreenReader = true;
let mockReaderListener: ((value: boolean) => void) | undefined;
let mockCapturePhase = true;
let mockFocusCleanup: (() => void) | undefined;
let mockFocusSetup: (() => () => void) | undefined;
let mockMotionListener: ((value: boolean) => void) | undefined;
let mockAppStateListener: ((value: string) => void) | undefined;
let mockPhase: { value: number };
let mockQueueJS = false;
let mockJSQueue: (() => void)[] = [];
let mockCanvasRenders = 0;

jest.mock("react-native", () => ({
    Platform: { OS: "android" },
    View: "View",
    Pressable: "Pressable",
    Switch: "Switch",
    FlatList: "FlatList",
    ActivityIndicator: "ActivityIndicator",
    AccessibilityInfo: {
        isReduceMotionEnabled: async () => mockReducedMotion,
        isScreenReaderEnabled: async () => mockScreenReader,
        addEventListener: (
            event: string,
            listener: typeof mockMotionListener,
        ) => {
            if (event === "screenReaderChanged") mockReaderListener = listener;
            else mockMotionListener = listener;
            return { remove() {} };
        },
    },
    AppState: {
        currentState: "active",
        addEventListener: (
            _event: string,
            listener: typeof mockAppStateListener,
        ) => {
            mockAppStateListener = listener;
            return { remove() {} };
        },
    },
    Easing: { linear: (value: number) => value },
    PanResponder: {
        create: (handlers: unknown) => ({ panHandlers: handlers }),
    },
}));
jest.mock("expo-router", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    return {
        useFocusEffect: (callback: () => () => void) => {
            React.useEffect(() => {
                mockFocusSetup = callback;
                mockFocusCleanup = callback();
                return mockFocusCleanup;
            }, [callback]);
        },
    };
});
jest.mock("react-native-gesture-handler", () => {
    const makeGesture = () => {
        const handlers: Record<
            string,
            (event?: any, success?: boolean) => void
        > = {};
        const gesture = {
            handlers,
            enabledValue: true,
            enabled: (enabled: boolean) => {
                gesture.enabledValue = enabled;
                return gesture;
            },
            minDistance: () => gesture,
            maxDistance: () => gesture,
            onEnd: (callback: (event: any, success?: boolean) => void) => {
                handlers.end = callback;
                return gesture;
            },
            averageTouches: () => gesture,
            onStart: (callback: (event: any) => void) => {
                handlers.start = callback;
                return gesture;
            },
            onUpdate: (callback: (event: any) => void) => {
                handlers.update = callback;
                return gesture;
            },
            onFinalize: (callback: () => void) => {
                handlers.finalize = callback;
                return gesture;
            },
        };
        return gesture;
    };
    return {
        Gesture: {
            Pan: makeGesture,
            Pinch: makeGesture,
            Tap: makeGesture,
            Simultaneous: (...gestures: unknown[]) => ({ gestures }),
        },
        GestureDetector: ({
            gesture,
            children,
        }: {
            gesture: unknown;
            children: ReactNode;
        }) => createElement("GestureDetector", { gesture }, children),
    };
});
jest.mock("react-native-reanimated", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    return {
        __esModule: true,
        default: {
            View: "AnimatedView",
            createAnimatedComponent: (component: unknown) => component,
        },
        Easing: { linear: (value: number) => value },
        useDerivedValue: (factory: () => unknown) => ({
            get value() {
                return factory();
            },
        }),
        useAnimatedProps: (factory: () => unknown) => factory(),
        useAnimatedStyle: (factory: () => Record<string, unknown>) => ({
            get transform() {
                return factory().transform;
            },
            get opacity() {
                return factory().opacity;
            },
        }),
        runOnJS:
            (callback: (...args: unknown[]) => unknown) =>
            (...args: unknown[]) => {
                if (mockQueueJS) mockJSQueue.push(() => callback(...args));
                else return callback(...args);
            },
        runOnUI: (callback: unknown) => callback,
        useSharedValue: (value: number) => {
            const shared = React.useRef({ value }).current;
            if (value === 0 && mockCapturePhase) {
                mockPhase = shared;
                mockCapturePhase = false;
            }
            return shared;
        },
        cancelAnimation: jest.fn(),
        withTiming: jest.fn((value) => value),
        withRepeat: jest.fn((value) => value),
    };
});
jest.mock("@shopify/react-native-skia", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    const makePath = (svg?: string) => ({
        svg,
        commands: [] as unknown[],
        addPath(path: unknown) {
            this.commands.push(path);
        },
        addCircle(x: number, y: number, r: number) {
            this.commands.push({ x, y, r });
        },
    });
    return {
        Canvas: (props: { children: ReactNode }) => {
            mockCanvasRenders++;
            return React.createElement("SkiaCanvas", props, props.children);
        },
        Circle: "SkiaCircle",
        DashPathEffect: "SkiaDashPathEffect",
        Group: "SkiaGroup",
        Path: "SkiaPath",
        Paint: "SkiaPaint",
        RoundedRect: "SkiaRoundedRect",
        Text: "SkiaText",
        matchFont: ({ fontSize }: { fontSize: number }) => ({
            measureText: (text: string) => ({
                width: (text.length * fontSize) / 2,
            }),
        }),
        Skia: { Path: { Make: makePath, MakeFromSVGString: makePath } },
    };
});
jest.mock("react-native-svg", () => ({
    __esModule: true,
    default: "Svg",
    Circle: "Circle",
    Defs: "Defs",
    G: "G",
    Path: "Path",
    Pattern: "Pattern",
    Rect: "Rect",
    Text: "SvgText",
}));
jest.mock("lucide-react-native", () => ({
    Minus: "Minus",
    MoreHorizontal: "MoreHorizontal",
    Plus: "Plus",
    Target: "Target",
    X: "X",
}));
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedText: "Text",
    UnlockedDialogTitle: "Title",
}));
jest.mock("@/components/ui/dialog", () => ({
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
        open ? createElement("Dialog", {}, children) : null,
}));
jest.mock("@/hooks/use-reduced-motion", () => ({
    useReducedMotion: () => mockReducedMotion,
}));

let renderer: ReactTestRenderer | undefined;
let props: Parameters<typeof DeviceNetwork>[0];
const byId = (id: string) =>
    renderer!.root.findAll((node) => node.props.testID === id)[0]!;
async function render() {
    await act(async () => {
        if (renderer) renderer.update(createElement(DeviceNetwork, props));
        else renderer = create(createElement(DeviceNetwork, props));
    });
}
beforeEach(async () => {
    mockCanvasRenders = 0;
    mockReducedMotion = true;
    mockScreenReader = true;
    mockCapturePhase = true;
    mockQueueJS = false;
    mockJSQueue = [];
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    const local = new LinkedDevice("Laptop", "direct", "key", "kem");
    props = {
        map: buildDeviceRelationshipMap(
            {
                devices: ["phone", "peer", "remote", "isolated"].map((id) => ({
                    id,
                    current: id === "phone",
                    root: id === "phone",
                    lastSeen: null,
                    createdAt: new Date(0),
                })),
                relationships: [
                    {
                        syncId: "direct",
                        fromDeviceId: "phone",
                        toDeviceId: "peer",
                        createdAt: new Date(0),
                    },
                    {
                        syncId: "parallel",
                        fromDeviceId: "phone",
                        toDeviceId: "peer",
                        createdAt: new Date(0),
                    },
                    {
                        syncId: "remote",
                        fromDeviceId: "peer",
                        toDeviceId: "remote",
                        createdAt: new Date(0),
                    },
                ],
            },
            [local],
            "phone",
            { topologyVerified: true },
        ),
        selection: null,
        connectedIds: new Set(),
        statuses: {},
        onSelect: jest.fn(),
    };
    await render();
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    jest.useRealTimers();
});

const canvas = () =>
    renderer!.root.findAll(
        (node) => node.props.fonts && node.props.positions,
    )[0]!;
const camera = () => ({ ...canvas().props.camera.value });
const gestures = () =>
    renderer!.root.findByType("GestureDetector" as never).props.gesture
        .gestures as {
        enabledValue: boolean;
        handlers: {
            start(event: unknown): void;
            update(event: unknown): void;
            finalize(): void;
            end(event: unknown, success: boolean): void;
        };
    }[];
const nodeBody = (id: string, outline = false) => {
    const point = canvas().props.positions.get(id);
    return renderer!.root
        .findAllByType("SkiaRoundedRect" as never)
        .find(
            (node) =>
                node.props.width === 60 &&
                node.props.x === point.x - 30 &&
                node.props.y === point.y - 30 &&
                (node.props.style === "stroke") === outline,
        )!;
};
const effectiveOpacity = (node: ReactTestInstance) => {
    let opacity = 1;
    let current: ReactTestInstance | null = node;
    while (current) {
        const value = current.props.opacity;
        opacity *=
            typeof value === "number"
                ? value
                : (current.props.layer?.props.opacity ?? 1);
        current = current.parent;
    }
    return opacity;
};
const paths = () =>
    renderer!.root
        .findAllByType("SkiaPath" as never)
        .map((node) => node.props.path);
const panStart = { numberOfPointers: 1, translationX: 0, translationY: 0 };
const pinchStart = { numberOfPointers: 2, focalX: 180, focalY: 195, scale: 1 };
const screenPoint = (id: string) => {
    const point = canvas().props.positions.get(id);
    const current = camera();
    return {
        x: point.x * current.scale + current.x,
        y: point.y * current.scale + current.y,
    };
};

it("renders one full canvas with text and leaves the account undimmed initially", () => {
    expect(renderer!.root.findAllByType("SkiaCanvas" as never)).toHaveLength(1);
    expect(renderer!.root.findAllByType("Svg" as never)).toHaveLength(0);
    expect(
        renderer!.root.findAllByType("SkiaText" as never).length,
    ).toBeGreaterThan(4);
    for (const node of props.map.nodes)
        expect(effectiveOpacity(nodeBody(node.id))).toBe(1);
});

it("dims unrelated nodes in one composite layer and clears the current outline on reselect", async () => {
    props.selection = { kind: "edge", id: "server:direct" };
    await render();
    expect(effectiveOpacity(nodeBody("account:phone"))).toBe(1);
    expect(effectiveOpacity(nodeBody("account:peer"))).toBe(1);
    expect(effectiveOpacity(nodeBody("account:remote"))).toBe(0.15);
    expect(
        renderer!.root
            .findAllByType("SkiaGroup" as never)
            .filter((node) => node.props.layer?.props.opacity === 0.15),
    ).toHaveLength(1);
    props.selection = { kind: "node", id: "account:phone" };
    await render();
    const outline = nodeBody("account:phone", true);
    expect(outline.props.color).toBe(colors.primary);
    expect(outline.props.strokeWidth.value * camera().scale).toBeCloseTo(2.5);
    await act(async () =>
        byId("device-map-node-account:phone").props.onPress(),
    );
    expect(props.onSelect).toHaveBeenCalledWith(null);
    props.selection = null;
    await render();
    expect(nodeBody("account:phone", true).props.color).toBe(colors.border);
    expect(nodeBody("account:phone", true).props.strokeWidth).toBe(1.3);
});

it("updates the UI camera during pan and pinch without rebuilding static paths", async () => {
    const initial = camera();
    const originalPaths = paths();
    const originalOverlay = byId("device-map-node-account:phone").props.style;
    const [pan, pinch] = gestures();
    await act(async () => pan!.handlers.start(panStart));
    await act(async () =>
        pan!.handlers.update({
            ...panStart,
            translationX: 30,
            translationY: 45,
        }),
    );
    expect(camera()).toEqual({
        ...initial,
        x: initial.x + 30,
        y: initial.y + 45,
    });
    paths().forEach((path, index) => expect(path).toBe(originalPaths[index]));
    expect(byId("device-map-node-account:phone").props.style).toBe(
        originalOverlay,
    );
    await act(async () => pan!.handlers.finalize());
    expect(byId("device-map-node-account:phone").props.style.left).toBeCloseTo(
        originalOverlay.left + 30,
    );
    const panned = camera();
    await act(async () => pinch!.handlers.start(pinchStart));
    await act(async () => pinch!.handlers.update({ ...pinchStart, scale: 2 }));
    expect(camera().scale).toBeCloseTo(panned.scale * 2);
    expect(camera().x).toBeCloseTo(180 - (180 - panned.x) * 2);
    await act(async () => pinch!.handlers.finalize());
    paths().forEach((path, index) => expect(path).toBe(originalPaths[index]));
    await act(async () => byId("device-map-fit").props.onPress());
    expect(camera()).toEqual(initial);
    expect(props.onSelect).toHaveBeenCalledWith(null);
});

it("zooms immediately around the viewport center after a pan and clamps both limits", async () => {
    const [pan] = gestures();
    await act(async () => pan!.handlers.start(panStart));
    await act(async () =>
        pan!.handlers.update({
            ...panStart,
            translationX: 30,
            translationY: 20,
        }),
    );
    await act(async () => pan!.handlers.finalize());
    const before = camera();
    await act(async () => byId("device-map-zoom-in").props.onPress());
    expect(camera().scale).toBeCloseTo(before.scale * 1.25);
    expect(camera().x).toBeCloseTo(180 - (180 - before.x) * 1.25);
    expect(camera().y).toBeCloseTo(195 - (195 - before.y) * 1.25);
    await act(async () => {
        for (let count = 0; count < 40; count++)
            byId("device-map-zoom-in").props.onPress();
    });
    expect(camera().scale).toBe(2.5);
    expect(byId("device-map-zoom-in").props.disabled).toBe(true);
    await act(async () => {
        for (let count = 0; count < 60; count++)
            byId("device-map-zoom-out").props.onPress();
    });
    expect(camera().scale).toBe(0.09);
    expect(byId("device-map-zoom-out").props.disabled).toBe(true);
});

it("rejects queued zoom and gesture finishes after Fit and ignores canceled updates", async () => {
    const initial = camera();
    mockQueueJS = true;
    await act(async () => byId("device-map-zoom-in").props.onPress());
    expect(camera().scale).toBeGreaterThan(initial.scale);
    await act(async () => byId("device-map-fit").props.onPress());
    mockQueueJS = false;
    await act(async () => {
        for (const callback of mockJSQueue.splice(0)) callback();
    });
    expect(camera()).toEqual(initial);
    const [pan] = gestures();
    await act(async () => pan!.handlers.start(panStart));
    mockQueueJS = true;
    await act(async () =>
        pan!.handlers.update({
            ...panStart,
            translationX: -2000,
            translationY: 2000,
        }),
    );
    await act(async () => pan!.handlers.finalize());
    await act(async () => byId("device-map-fit").props.onPress());
    mockQueueJS = false;
    await act(async () => {
        for (const callback of mockJSQueue.splice(0)) callback();
        pan!.handlers.update({
            ...panStart,
            translationX: 2000,
            translationY: -2000,
        });
        pan!.handlers.finalize();
    });
    expect(camera()).toEqual(initial);
});

it("does not let a queued finish or tap resume flow during a new pan", async () => {
    mockReducedMotion = false;
    props.connectedIds = new Set(["server:direct"]);
    await render();
    const [pan, , tap] = gestures();
    mockQueueJS = true;
    await act(async () =>
        tap!.handlers.end(screenPoint("account:phone"), true),
    );
    await act(async () => pan!.handlers.start(panStart));
    await act(async () => pan!.handlers.finalize());
    await act(async () => pan!.handlers.start(panStart));
    mockQueueJS = false;
    await act(async () => {
        for (const callback of mockJSQueue.splice(0)) callback();
    });
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(mockPhase.value).toBe(0);
    await act(async () => pan!.handlers.finalize());
    expect(mockPhase.value).toBe(-48);
});

it("ignores the remaining finger's pinch focal point and continues one-finger pan without a jump", async () => {
    const [pan, pinch] = gestures();
    await act(async () =>
        pan!.handlers.start({ ...panStart, numberOfPointers: 2 }),
    );
    await act(async () => pinch!.handlers.start(pinchStart));
    await act(async () =>
        pinch!.handlers.update({ ...pinchStart, scale: 1.5 }),
    );
    const before = camera();
    await act(async () =>
        pinch!.handlers.update({
            ...pinchStart,
            numberOfPointers: 1,
            focalX: 80,
            scale: 1.5,
        }),
    );
    expect(camera()).toEqual(before);
    await act(async () =>
        pan!.handlers.update({ ...panStart, translationX: -100 }),
    );
    expect(camera()).toEqual(before);
    await act(async () =>
        pan!.handlers.update({ ...panStart, translationX: -90 }),
    );
    expect(camera().x).toBeCloseTo(before.x + 10);
    await act(async () => pinch!.handlers.finalize());
    await act(async () => pan!.handlers.finalize());
});

it("hit tests normal taps against the live camera and suppresses taps throughout a long gesture", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1000);
    const [pan, , tap] = gestures();
    await act(async () =>
        tap!.handlers.end(screenPoint("account:phone"), true),
    );
    expect(props.onSelect).toHaveBeenCalledWith({
        kind: "node",
        id: "account:phone",
    });
    jest.mocked(props.onSelect).mockClear();
    await act(async () => pan!.handlers.start(panStart));
    await act(async () =>
        pan!.handlers.update({
            ...panStart,
            translationX: 20,
            translationY: 20,
        }),
    );
    now.mockReturnValue(2000);
    await act(async () =>
        tap!.handlers.end(screenPoint("account:phone"), true),
    );
    expect(props.onSelect).not.toHaveBeenCalled();
    await act(async () => pan!.handlers.finalize());
    now.mockReturnValue(2121);
    await act(async () =>
        tap!.handlers.end(screenPoint("account:phone"), true),
    );
    expect(props.onSelect).toHaveBeenCalledWith({
        kind: "node",
        id: "account:phone",
    });
    now.mockRestore();
});

it("provides native node and curved-connection targets only for screen readers", async () => {
    expect(
        byId("device-map-node-account:phone").props.accessibilityLabel,
    ).toContain("root device");
    const first = byId("device-map-edge-server:direct");
    const second = byId("device-map-edge-server:parallel");
    expect(first.props.style).not.toEqual(second.props.style);
    expect(second.props.style.width).toBe(44);
    await act(async () => second.props.onPress());
    expect(props.onSelect).toHaveBeenCalledWith({
        kind: "edge",
        id: "server:parallel",
    });
    await act(async () => mockReaderListener?.(false));
    expect(
        renderer!.root.findAll(
            (node) => node.props.testID === "device-map-accessibility",
        ),
    ).toHaveLength(0);
    expect(renderer!.root.findAllByType("SkiaCanvas" as never)).toHaveLength(1);
});

it("skips active-only canvas draws while preserving covered updates for resume", async () => {
    const initialRenders = mockCanvasRenders;
    props.active = false;
    await render();
    expect(mockCanvasRenders).toBe(initialRenders);
    props.active = true;
    await render();
    expect(mockCanvasRenders).toBe(initialRenders);
    props.active = false;
    await render();
    props.selection = { kind: "edge", id: "server:direct" };
    await render();
    expect(mockCanvasRenders).toBe(initialRenders);
    props.active = true;
    await render();
    expect(mockCanvasRenders).toBe(initialRenders + 1);
    expect(canvas().props.selection).toEqual(props.selection);
});

it("preserves the covered scene for later sheet changes and updates it when the map becomes active", async () => {
    const initialRenders = mockCanvasRenders;
    const scene = () =>
        renderer!.root.findByType("SkiaCanvas" as never).props.children;
    const initialScene = scene();
    props.selection = { kind: "edge", id: "server:direct" };
    props.active = false;
    await render();
    const coveredScene = scene();
    expect(mockCanvasRenders).toBe(initialRenders + 1);
    expect(coveredScene).not.toBe(initialScene);
    expect(effectiveOpacity(nodeBody("account:phone"))).toBe(1);
    expect(effectiveOpacity(nodeBody("account:peer"))).toBe(1);
    expect(effectiveOpacity(nodeBody("account:remote"))).toBe(0.15);
    const edge = props.map.relationships.find(
        (item) => item.id === "server:direct",
    )!;
    const selectedPath = relationshipPath(
        edge,
        props.map.relationships,
        canvas().props.positions,
    );
    const selectedStroke = renderer!.root
        .findAllByType("SkiaPath" as never)
        .find((node) => node.props.path?.svg === selectedPath)!;
    expect(selectedStroke.props.strokeWidth).toBe(3);
    expect(selectedStroke.props.opacity).toBe(1);
    props.selection = { kind: "node", id: "account:peer" };
    props.nodes = props.map.nodes.slice(0, 2);
    const local = props.nodes[1]!.localDevices[0]!;
    props.statuses = {
        [local.ID]: {
            signalingServerStatus: SignalingStatus.Connected,
            webRTCStatus: WebRTCStatus.Connected,
            lastSync: new Date(0),
        },
    };
    await render();
    expect(scene()).toBe(coveredScene);
    props.active = true;
    await render();
    expect(scene()).not.toBe(coveredScene);
    expect(nodeBody("account:peer", true).props.color).toBe(colors.primary);
    expect(
        renderer!.root
            .findAllByType("SkiaCircle" as never)
            .some(
                (node) =>
                    node.props.r === 4 && node.props.color === colors.success,
            ),
    ).toBe(true);
    expect(
        renderer!.root
            .findAllByType("SkiaRoundedRect" as never)
            .filter((node) => node.props.width === 60 && !node.props.style),
    ).toHaveLength(2);
});

it("keeps full geometry and fonts stable for 100 nodes while combining 50 animated links", async () => {
    const devices = Array.from({ length: 100 }, (_, index) => ({
        id: `device-${index}`,
        current: index === 0,
        root: index === 0,
        lastSeen: null,
        createdAt: new Date(0),
    }));
    props.map = buildDeviceRelationshipMap(
        {
            devices,
            relationships: devices.slice(1).map((device, index) => ({
                syncId: `large-link-${index}`,
                fromDeviceId: "device-0",
                toDeviceId: device.id,
                createdAt: new Date(0),
            })),
        },
        [],
        "device-0",
        { topologyVerified: true },
    );
    props.connectedIds = new Set(
        props.map.relationships.slice(0, 50).map((edge) => edge.id),
    );
    props.selection = { kind: "edge", id: props.map.relationships[0]!.id };
    await render();
    const flow = renderer!.root.findAll(
        (node) => node.props.normal?.commands,
    )[0]!;
    expect(flow.props.normal.commands).toHaveLength(1);
    expect(flow.props.dimmed.commands).toHaveLength(49);
    expect(
        renderer!.root
            .findAllByType("SkiaRoundedRect" as never)
            .filter((node) => node.props.width === 60 && !node.props.style),
    ).toHaveLength(100);
    const originalPaths = paths();
    const originalFonts = canvas().props.fonts;
    const [pan] = gestures();
    await act(async () => pan!.handlers.start(panStart));
    for (let step = 1; step <= 5; step++)
        await act(async () =>
            pan!.handlers.update({
                ...panStart,
                translationX: step * 10,
                translationY: step * 5,
            }),
        );
    await act(async () => pan!.handlers.finalize());
    await act(async () => byId("device-map-zoom-in").props.onPress());
    paths().forEach((path, index) => expect(path).toBe(originalPaths[index]));
    expect(canvas().props.fonts).toBe(originalFonts);
    expect(renderer!.root.findAllByType("SkiaCanvas" as never)).toHaveLength(1);
});

it("shows only the legend key and animation toggle with accessible controls and reduced motion", async () => {
    props.connectedIds = new Set(["server:direct"]);
    await render();
    expect(withRepeat).not.toHaveBeenCalled();
    expect(mockPhase.value).toBe(0);
    for (const id of ["zoom-in", "zoom-out", "fit", "legend"])
        expect(
            byId(`device-map-${id}`).props.style.minHeight +
                2 * byId(`device-map-${id}`).props.hitSlop,
        ).toBeGreaterThanOrEqual(44);
    await act(async () => byId("device-map-legend").props.onPress());
    expect(byId("device-map-animation").props.disabled).toBe(true);
    expect(byId("device-map-animation").props.accessibilityState.checked).toBe(
        false,
    );
    const legend = JSON.stringify(renderer!.toJSON());
    expect(legend).toContain("Reduced motion is enabled on this device.");
    for (const removed of [
        "Focus selected device",
        "Fit devices with recorded links",
        "Fit all devices",
        "Got it",
        "Tap a connection",
        "Connection settings",
    ])
        expect(legend).not.toContain(removed);
});

it("stops flow for reduced motion, background, blur, covered maps and hidden links", async () => {
    mockReducedMotion = false;
    props.connectedIds = new Set(["server:direct"]);
    await render();
    expect(withRepeat).toHaveBeenCalledWith(-48, -1, false);
    expect(mockPhase.value).toBe(-48);
    await act(async () => mockMotionListener?.(true));
    expect(mockPhase.value).toBe(0);
    await act(async () => mockMotionListener?.(false));
    expect(mockPhase.value).toBe(-48);
    await act(async () => mockAppStateListener?.("background"));
    expect(mockPhase.value).toBe(0);
    expect(gestures().every((gesture) => !gesture.enabledValue)).toBe(true);
    await act(async () => mockAppStateListener?.("active"));
    expect(mockPhase.value).toBe(-48);
    await act(async () => mockFocusCleanup?.());
    expect(mockPhase.value).toBe(0);
    await act(async () => {
        mockFocusSetup?.();
    });
    expect(mockPhase.value).toBe(-48);
    props.active = false;
    await render();
    expect(mockPhase.value).toBe(0);
    props.active = true;
    props.nodes = props.map.nodes.filter(
        (node) => node.id === "account:isolated",
    );
    await render();
    expect(mockPhase.value).toBe(0);
    expect(cancelAnimation).toHaveBeenCalled();
});

it("disables flow when no link is live or the user turns animation off", async () => {
    mockReducedMotion = false;
    await render();
    expect(withRepeat).not.toHaveBeenCalled();
    props.connectedIds = new Set(["server:direct"]);
    await render();
    expect(mockPhase.value).toBe(-48);
    const closeLegend = () =>
        renderer!.root
            .findAll(
                (node) => node.props.accessibilityLabel === "Close map legend",
            )[0]!
            .props.onPress();
    await act(async () => byId("device-map-legend").props.onPress());
    expect(mockPhase.value).toBe(0);
    await act(async () => byId("device-map-animation").props.onPress());
    await act(async () => closeLegend());
    expect(mockPhase.value).toBe(0);
    await act(async () => byId("device-map-legend").props.onPress());
    await act(async () => byId("device-map-animation").props.onPress());
    await act(async () => closeLegend());
    expect(mockPhase.value).toBe(-48);
});

it("keeps 124 account nodes and isolated devices in a finite layout", () => {
    const map = buildDeviceRelationshipMap(
        {
            devices: Array.from({ length: 124 }, (_, index) => ({
                id: String(index),
                current: index === 0,
                root: index === 0,
                lastSeen: null,
                createdAt: new Date(0),
            })),
            relationships: Array.from({ length: 100 }, (_, index) => ({
                syncId: String(index),
                fromDeviceId: "0",
                toDeviceId: String(index + 1),
                createdAt: new Date(0),
            })),
        },
        [],
        "0",
    );
    const layout = buildDeviceMapLayout(map);
    expect(layout.positions.size).toBe(124);
    expect(layout.isolatedIds.size).toBe(23);
    expect(
        [...layout.positions.values()].every(
            (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
        ),
    ).toBe(true);
    expect(
        map.relationships.every(
            (edge) =>
                !!relationshipPath(edge, map.relationships, layout.positions),
        ),
    ).toBe(true);
});
