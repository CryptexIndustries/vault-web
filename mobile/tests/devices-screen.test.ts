import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { createElement, type ReactNode } from "react";
import {
    act,
    create,
    type ReactTestInstance,
    type ReactTestRenderer,
} from "react-test-renderer";
import { ONLINE_SERVICES_SELECTION_ID } from "@cryptex-industries/vault-core/consts";
import { LinkedDevice } from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    SignalingStatus,
    WebRTCStatus,
} from "@cryptex-industries/vault-core/synchronization-utils";
import DevicesScreen from "../app/(app)/(tabs)/devices";
import { buildDeviceRelationshipMap } from "@/components/account/device-topology";
import { filterDeviceNodes } from "@/components/devices/device-browser";
import {
    formatDeviceActivity,
    formatDeviceDateTime,
} from "@/components/devices/device-dates";
import { useDeviceActions } from "@/components/devices/use-device-actions";
import { useDeviceTopology } from "@/components/devices/use-device-topology";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { router } from "expo-router";

let mockReducedMotion = false;
let mockFontScale = 1;
const mockTabTransitions: {
    config: { toValue: number; duration: number; useNativeDriver: boolean };
    start: ReturnType<typeof jest.fn>;
    stop: ReturnType<typeof jest.fn>;
}[] = [];

jest.mock("react-native", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    return {
        Platform: { OS: "android" },
        ActivityIndicator: "ActivityIndicator",
        Pressable: "Pressable",
        View: "View",
        useWindowDimensions: () => ({
            width: 360,
            height: 724,
            fontScale: mockFontScale,
        }),
        Switch: "Switch",
        Keyboard: { dismiss: jest.fn() },
        AccessibilityInfo: {
            isReduceMotionEnabled: async () => true,
            isScreenReaderEnabled: async () => true,
            addEventListener: () => ({ remove() {} }),
        },
        AppState: {
            currentState: "active",
            addEventListener: () => ({ remove() {} }),
        },
        Animated: {
            View: "AnimatedView",
            createAnimatedComponent: (component: unknown) => component,
            Value: class {
                value: number;
                constructor(value: number) {
                    this.value = value;
                }
                setValue(value: number) {
                    this.value = value;
                }
                stopAnimation() {}
                interpolate(config: unknown) {
                    return { parent: this, config };
                }
            },
            loop: () => ({ start() {}, stop() {} }),
            timing: (_value: unknown, config: any) => {
                const transition = {
                    config,
                    start: jest.fn(),
                    stop: jest.fn(),
                };
                mockTabTransitions.push(transition);
                return transition;
            },
        },
        Easing: {
            linear: (value: number) => value,
            quad: (value: number) => value * value,
            out: (easing: unknown) => easing,
        },
        PanResponder: {
            create: (handlers: unknown) => ({ panHandlers: handlers }),
        },
        FlatList: React.forwardRef((props: any, ref) => {
            React.useImperativeHandle(ref, () => ({
                scrollToOffset: jest.fn(),
            }));
            return React.createElement(
                "FlatList",
                props,
                props.data.length
                    ? props.data
                          .slice(0, props.initialNumToRender)
                          .map((item: unknown, index: number) =>
                              React.createElement(
                                  "ListItem",
                                  { key: props.keyExtractor(item) },
                                  props.renderItem({ item, index }),
                              ),
                          )
                    : props.ListEmptyComponent,
            );
        }),
    };
});
jest.mock("@shopify/react-native-skia", () => {
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
        Canvas: "SkiaCanvas",
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
        runOnJS: (callback: unknown) => callback,
        runOnUI: (callback: unknown) => callback,
        useSharedValue: (value: number) => React.useRef({ value }).current,
        cancelAnimation: jest.fn(),
        withTiming: (value: number) => value,
        withRepeat: (value: number) => value,
    };
});
jest.mock("expo-router", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    return {
        router: { push: jest.fn() },
        useFocusEffect: (callback: () => void) =>
            React.useEffect(callback, [callback]),
    };
});
jest.mock("jotai", () => ({ useAtomValue: () => ({ LinkedDevices: {} }) }));
jest.mock("@/utils/atoms", () => ({ unlockedVaultAtom: {} }));
jest.mock("@/hooks/use-breakpoint", () => ({ useBreakpoint: jest.fn() }));
jest.mock("@/hooks/use-reduced-motion", () => ({
    useReducedMotion: () => mockReducedMotion,
}));
jest.mock("lucide-react-native", () =>
    Object.fromEntries(
        [
            "Check",
            "ChevronDown",
            "ChevronRight",
            "Clock3",
            "HardDrive",
            "Laptop",
            "Link2",
            "Minus",
            "Monitor",
            "MoreHorizontal",
            "Plus",
            "QrCode",
            "RotateCw",
            "Search",
            "Send",
            "Smartphone",
            "Target",
            "X",
        ].map((name) => [name, name]),
    ),
);
jest.mock("@/components/unlocked/unlocked-ui", () => ({
    UnlockedMenuRow: "MenuRow",
    UnlockedScreen: "Screen",
    UnlockedText: "Text",
    UnlockedButton: "Button",
    UnlockedInput: "Input",
    UnlockedDialogTitle: "Title",
}));
jest.mock("@/components/ui/dialog", () => ({
    Dialog: ({
        open,
        children,
        ...props
    }: {
        open: boolean;
        children: ReactNode;
    }) => (open ? createElement("Dialog", props, children) : null),
    DialogHeader: "DialogHeader",
    DialogDescription: "DialogDescription",
    DialogFooter: "DialogFooter",
}));
jest.mock("@/components/devices/device-details-sheet", () => ({
    DeviceDetails: "DeviceDetails",
}));
jest.mock("@/utils/vault-session", () => ({
    getVaultSessionGeneration: () => 1,
}));
jest.mock("@/components/devices/device-details-dialog", () => ({
    DeviceDetailsDialog: ({
        open,
        children,
        ...props
    }: {
        open: boolean;
        children: ReactNode;
    }) => (open ? createElement("Dialog", props, children) : null),
}));
jest.mock("@/components/devices/use-device-topology", () => ({
    useDeviceTopology: jest.fn(),
}));
jest.mock("@/components/devices/use-device-actions", () => ({
    useDeviceActions: jest.fn(),
}));
jest.mock("@/utils/clipboard", () => ({
    copyTextToClipboard: jest
        .fn<() => Promise<boolean>>()
        .mockResolvedValue(true),
}));

const local = Object.assign(new LinkedDevice("Laptop", "sync-peer", "", ""), {
    ID: "saved-peer",
    Name: "Laptop",
    SyncID: "sync-peer",
    SignalingServerID: ONLINE_SERVICES_SELECTION_ID,
});
const topology = {
    devices: ["phone", "peer", "remote"].map((id) => ({
        id,
        current: id === "phone",
        root: id === "phone",
        lastSeen: null,
        createdAt: new Date(0),
    })),
    relationships: [
        {
            syncId: "sync-peer",
            fromDeviceId: "phone",
            toDeviceId: "peer",
            createdAt: new Date(0),
        },
    ],
};
let account: ReturnType<typeof useDeviceTopology>;
let renderer: ReactTestRenderer | undefined;
const frames = new Map<number, Parameters<typeof requestAnimationFrame>[0]>();
let nextFrame = 0;
const actions = {
    connectionStatuses: {} as ReturnType<
        typeof useDeviceActions
    >["connectionStatuses"],
    pendingId: null,
    saveDeviceConfig: jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
    unlinkDevice: jest
        .fn<() => Promise<string>>()
        .mockResolvedValue("Unlinked Laptop."),
    connectDevice: jest
        .fn<(id: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    removeLocalDevices: jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
};
const byId = (id: string) =>
    renderer!.root.findAll((node) => node.props.testID === id)[0]!;
const effectiveOpacity = (id: string) => {
    const canvas = renderer!.root.findAll(
        (node) => node.props.fonts && node.props.positions,
    )[0]!;
    const point = canvas.props.positions.get(
        id.replace("device-map-node-", ""),
    );
    let node: ReactTestInstance | null = renderer!.root
        .findAllByType("SkiaRoundedRect" as never)
        .find(
            (item) =>
                item.props.width === 60 &&
                item.props.x === point.x - 30 &&
                item.props.y === point.y - 30,
        )!;
    let opacity = 1;
    while (node) {
        opacity *= node.props.opacity ?? node.props.layer?.props.opacity ?? 1;
        node = node.parent;
    }
    return opacity;
};
const details = () => renderer!.root.findByType("DeviceDetails" as never);
const button = (label: string) =>
    renderer!.root
        .findAllByType("Button" as never)
        .find((node) => node.props.children === label)!;
async function advanceFrame() {
    const callbacks = [...frames.values()];
    frames.clear();
    await act(async () =>
        callbacks.forEach((callback) => callback(Date.now())),
    );
}
async function prepareGraph() {
    await advanceFrame();
    await advanceFrame();
    await act(async () =>
        byId("device-map").props.onLayout({
            nativeEvent: { layout: { width: 360, height: 390 } },
        }),
    );
    await advanceFrame();
}
async function mount(prepare = true) {
    await act(async () => {
        if (renderer) renderer.update(createElement(DevicesScreen));
        else renderer = create(createElement(DevicesScreen));
    });
    if (prepare) await prepareGraph();
}
async function press(id: string) {
    await act(async () => byId(id).props.onPress());
}
async function openPeer() {
    await press("device-view-list");
    await press("device-row-peer");
}

beforeEach(() => {
    mockReducedMotion = false;
    mockFontScale = 1;
    mockTabTransitions.length = 0;
    frames.clear();
    globalThis.requestAnimationFrame = (callback) => {
        const id = ++nextFrame;
        frames.set(id, callback);
        return id;
    };
    globalThis.cancelAnimationFrame = (id) => {
        if (typeof id === "number") frames.delete(id);
    };
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    jest.mocked(useBreakpoint).mockReturnValue({
        isTablet: false,
    } as ReturnType<typeof useBreakpoint>);
    actions.connectionStatuses = {};
    actions.connectDevice.mockResolvedValue(undefined);
    account = {
        map: buildDeviceRelationshipMap(topology, [local], "phone", {
            topologyVerified: true,
        }),
        isRoot: true,
        canPromote: true,
        hasSession: true,
        bound: true,
        loading: false,
        busy: false,
        error: null,
        refresh: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        removeAccountDevice: jest
            .fn<(id: string) => Promise<void>>()
            .mockResolvedValue(undefined),
        unlinkRelationship: jest
            .fn<(id: string) => Promise<void>>()
            .mockResolvedValue(undefined),
        toggleRoot: jest
            .fn<(id: string, root: boolean) => Promise<void>>()
            .mockResolvedValue(undefined),
    };
    jest.mocked(useDeviceTopology).mockImplementation(() => account);
    jest.mocked(useDeviceActions).mockReturnValue(
        actions as unknown as ReturnType<typeof useDeviceActions>,
    );
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe("mobile devices screen", () => {
    it("paints loading before preparation and waits for native map layout", async () => {
        await mount(false);
        expect(byId("device-map-loading").props.accessibilityRole).toBe(
            "progressbar",
        );
        expect(
            renderer!.root.findAllByType("SkiaCanvas" as never),
        ).toHaveLength(0);
        await advanceFrame();
        await advanceFrame();
        expect(
            renderer!.root.findAllByType("SkiaCanvas" as never),
        ).toHaveLength(1);
        expect(byId("device-map-loading")).toBeDefined();
        await act(async () =>
            byId("device-map").props.onLayout({
                nativeEvent: { layout: { width: 376, height: 323 } },
            }),
        );
        await advanceFrame();
        expect(
            renderer!.root.findAll(
                (node) => node.props.testID === "device-map-loading",
            ),
        ).toHaveLength(0);
    });
    it("cancels unfinished preparation when List is selected", async () => {
        await mount(false);
        await advanceFrame();
        await press("device-view-list");
        await advanceFrame();
        expect(
            renderer!.root.findAllByType("SkiaCanvas" as never),
        ).toHaveLength(0);
        expect(byId("device-view-list").props.accessibilityState.selected).toBe(
            true,
        );
        await press("device-view-map");
        await prepareGraph();
        expect(byId("device-view-map").props.accessibilityState.selected).toBe(
            true,
        );
        expect(
            renderer!.root.findAllByType("SkiaCanvas" as never),
        ).toHaveLength(1);
    });
    it("retains the prepared canvas and camera while List blocks its input and accessibility", async () => {
        await mount();
        const canvas = renderer!.root.findByType("SkiaCanvas" as never);
        const camera = renderer!.root.findAll(
            (node) => node.props.camera && node.props.hitNodes,
        )[0]!;
        const position = camera.props.camera;
        await press("device-view-list");
        const list = renderer!.root.findByType("FlatList" as never);
        expect(renderer!.root.findByType("SkiaCanvas" as never)).toBe(canvas);
        expect(byId("device-map-layer").props.pointerEvents).toBe("none");
        expect(byId("device-map-layer").props.importantForAccessibility).toBe(
            "no-hide-descendants",
        );
        expect(camera.props.enabled).toBe(false);
        await press("device-view-map");
        expect(renderer!.root.findByType("FlatList" as never)).toBe(list);
        expect(byId("device-list-layer").props.pointerEvents).toBe("none");
        expect(byId("device-list-layer").props.importantForAccessibility).toBe(
            "no-hide-descendants",
        );
        expect(renderer!.root.findByType("SkiaCanvas" as never)).toBe(canvas);
        expect(camera.props.camera).toBe(position);
        expect(byId("device-map-layer").props.pointerEvents).toBe("auto");
        expect(
            renderer!.root.findAll(
                (node) => node.props.testID === "device-map-loading",
            ),
        ).toHaveLength(0);
    });
    it("starts without a tab animation and uses a short native fade and slide for switching", async () => {
        await mount();
        expect(mockTabTransitions).toHaveLength(0);
        const mapStyle = byId("device-map-layer").props.style[1];
        expect(mapStyle.opacity.value).toBe(1);
        expect(mapStyle.transform[0].translateX.config.outputRange).toEqual([
            -12, 0,
        ]);
        await press("device-view-list");
        expect(mockTabTransitions).toHaveLength(1);
        expect(mockTabTransitions[0]!.config).toMatchObject({
            toValue: 0,
            duration: 190,
            useNativeDriver: true,
        });
        expect(mockTabTransitions[0]!.start).toHaveBeenCalledTimes(1);
        expect(
            byId("device-list-layer").props.style[1].transform[0].translateX
                .config.outputRange,
        ).toEqual([0, 12]);
    });
    it("interrupts a tab transition on rapid taps and keeps only the selected layer interactive", async () => {
        await mount();
        await press("device-view-list");
        await press("device-view-map");
        expect(mockTabTransitions[0]!.stop).toHaveBeenCalledTimes(1);
        expect(mockTabTransitions[1]!.config.toValue).toBe(1);
        expect(byId("device-map-layer").props.pointerEvents).toBe("auto");
        expect(byId("device-list-layer").props.pointerEvents).toBe("none");
        await press("device-view-list");
        expect(mockTabTransitions[1]!.stop).toHaveBeenCalledTimes(1);
        expect(mockTabTransitions[2]!.config.toValue).toBe(0);
        expect(byId("device-map-layer").props.pointerEvents).toBe("none");
        expect(byId("device-list-layer").props.pointerEvents).toBe("auto");
    });
    it("snaps to the selected tab when reduced motion is enabled during a transition", async () => {
        await mount();
        await press("device-view-list");
        mockReducedMotion = true;
        await mount(false);
        expect(mockTabTransitions[0]!.stop).toHaveBeenCalledTimes(1);
        expect(mockTabTransitions).toHaveLength(1);
        expect(byId("device-map-layer").props.style[1].opacity.value).toBe(0);
        await press("device-view-map");
        expect(mockTabTransitions).toHaveLength(1);
        expect(byId("device-map-layer").props.style[1].opacity.value).toBe(1);
    });
    it("keeps the hint hidden after explicit device selection and clearing or switching views", async () => {
        await mount();
        const network = () =>
            renderer!.root.findAll(
                (node) =>
                    node.props.onReady && node.props.showHint !== undefined,
            )[0]!;
        expect(network().props.showHint).toBe(true);
        await press("device-map-node-account:peer");
        expect(network().props.showHint).toBe(false);
        await press("device-map-fit");
        await press("device-view-list");
        await press("device-view-map");
        expect(network().props.showHint).toBe(false);
    });
    it("counts List device details as explicit exploration without counting the default current device", async () => {
        await mount();
        const network = () =>
            renderer!.root.findAll(
                (node) =>
                    node.props.onReady && node.props.showHint !== undefined,
            )[0]!;
        expect(network().props.showHint).toBe(true);
        await openPeer();
        expect(network().props.showHint).toBe(false);
    });
    it("uses relative activity under a day and dates with times at the day boundary", () => {
        jest.useFakeTimers();
        const now = new Date(2026, 9, 5, 16, 30);
        jest.setSystemTime(now);
        expect(formatDeviceActivity("invalid date")).toBe("Not available");
        expect(formatDeviceDateTime(null)).toBe("Not available");
        expect(formatDeviceActivity(now.getTime() - 23 * 60 * 60 * 1000)).toBe(
            "23h ago",
        );
        const dayOld = formatDeviceActivity(
            now.getTime() - 24 * 60 * 60 * 1000,
        );
        expect(dayOld).not.toContain("ago");
        expect(dayOld).toContain("04");
        expect(dayOld).toContain("16:30");
    });
    it("opens the map with no dimming and keeps the existing screen header", async () => {
        await mount();
        expect(renderer!.root.findByType("Screen" as never).props.padded).toBe(
            false,
        );
        expect(byId("device-view-map").props.accessibilityState.selected).toBe(
            true,
        );
        expect(renderer!.root.findAllByType("Dialog" as never)).toHaveLength(0);
        for (const node of account.map.nodes)
            expect(effectiveOpacity(`device-map-node-${node.id}`)).toBe(1);
        expect(byId("device-selection-details")).toBeDefined();
    });
    it("keeps the account notice in the map layout while details and confirmation cover it", async () => {
        account.hasSession = false;
        account.bound = false;
        await mount();
        const noticeText =
            "Showing links saved in this vault. Connect to Online Services to view account devices.";
        const notice = renderer!.root.findByProps({ children: noticeText });
        const canvas = renderer!.root.findByType("SkiaCanvas" as never);
        await press("device-selection-details");
        expect(renderer!.root.findByProps({ children: noticeText })).toBe(
            notice,
        );
        expect(renderer!.root.findByType("SkiaCanvas" as never)).toBe(canvas);
        await act(async () =>
            details().props.onToggleRoot(
                account.map.nodes.find((node) => node.serverId === "peer"),
            ),
        );
        expect(byId("device-confirm-action")).toBeDefined();
        expect(renderer!.root.findByProps({ children: noticeText })).toBe(
            notice,
        );
    });
    it.each([1, 1.6])(
        "reserves the sync line in the summary at font scale %s before selecting a connection",
        async (fontScale) => {
            mockFontScale = fontScale;
            await mount();
            const initialHeight = byId("device-selection-details").props.style
                .minHeight;
            expect(initialHeight).toBe(Math.max(48, 51 * fontScale + 8));
            await press("device-map-edge-server:sync-peer");
            const summary = byId("device-selection-details");
            expect(summary.props.style.minHeight).toBe(initialHeight);
            expect(
                summary.findAllByType("Text" as never).some((text) => {
                    const children = text.props.children;
                    return (
                        Array.isArray(children) && children[0] === "Last sync "
                    );
                }),
            ).toBe(true);
        },
    );
    it("toggles a map node's neighborhood and clears dimming on fit", async () => {
        await mount();
        await press("device-map-node-account:peer");
        expect(effectiveOpacity("device-map-node-account:remote")).toBe(0.15);
        expect(renderer!.root.findAllByType("Dialog" as never)).toHaveLength(0);
        await press("device-map-node-account:peer");
        expect(effectiveOpacity("device-map-node-account:remote")).toBe(1);
        await press("device-map-node-account:peer");
        await press("device-map-fit");
        expect(effectiveOpacity("device-map-node-account:remote")).toBe(1);
    });
    it("opens a relationship sheet and repeats its selection to clear focus", async () => {
        await mount();
        await press("device-map-edge-server:sync-peer");
        expect(details().props.selection).toEqual({
            kind: "edge",
            id: "server:sync-peer",
        });
        await act(async () => details().props.onClose());
        await press("device-map-edge-server:sync-peer");
        expect(effectiveOpacity("device-map-node-account:remote")).toBe(1);
    });
    it("keeps the selected connection while refreshed topology removes its record", async () => {
        await mount();
        await press("device-map-edge-server:sync-peer");
        await act(async () => details().props.onBusyChange(true));
        account = {
            ...account,
            map: { ...account.map, relationships: [] },
        };
        await mount(false);
        expect(details().props.selection).toEqual({
            kind: "edge",
            id: "server:sync-peer",
        });
        await act(async () => details().props.onBusyChange(false));
        await act(async () =>
            details().props.onChoose({ kind: "node", id: "account:phone" }),
        );
        expect(details().props.selection).toEqual({
            kind: "node",
            id: "account:phone",
        });
    });
    it("keeps the search input stable while filtering the current map view", async () => {
        await mount();
        const input = byId("device-search");
        await act(async () => input.props.onChangeText("Lap"));
        const firstStyle = input.props.style;
        await act(async () => input.props.onChangeText("Laptop"));
        expect(byId("device-search")).toBe(input);
        expect(input.props.style).toBe(firstStyle);
        expect(byId("device-view-map").props.accessibilityState.selected).toBe(
            true,
        );
        expect(
            renderer!.root.findAll(
                (node) => node.props.testID === "device-map-node-account:peer",
            ),
        ).toHaveLength(1);
        expect(
            renderer!.root.findAll(
                (node) =>
                    node.props.testID === "device-map-node-account:remote",
            ),
        ).toHaveLength(0);
        await press("device-search-clear");
        expect(input.props.value).toBe("");
    });
    it("filters map and list through the same filter sheet", async () => {
        await mount();
        await press("device-filter");
        await press("device-filter-isolated");
        expect(
            renderer!.root.findAll(
                (node) =>
                    node.props.testID === "device-map-node-account:remote",
            ),
        ).toHaveLength(1);
        await press("device-view-list");
        expect(
            renderer!.root
                .findByType("FlatList" as never)
                .props.data.map((node: { serverId: string }) => node.serverId),
        ).toEqual(["remote"]);
        await press("device-scope");
        expect(
            renderer!.root.findByType("FlatList" as never).props.data,
        ).toHaveLength(2);
    });
    it("uses a virtual list with 84 pixel rows and inline actions", async () => {
        account.map = buildDeviceRelationshipMap(
            {
                devices: Array.from({ length: 120 }, (_, index) => ({
                    id: String(index),
                    current: index === 0,
                    root: index === 0,
                    lastSeen: null,
                    createdAt: new Date(0),
                })),
                relationships: [],
            },
            [local],
            "0",
            { topologyVerified: true },
        );
        await mount();
        await press("device-view-list");
        const list = renderer!.root.findByType("FlatList" as never);
        expect(list.props.data).toHaveLength(121);
        expect(list.props.getItemLayout(undefined, 100)).toEqual({
            index: 100,
            length: 84,
            offset: 8400,
        });
        expect(renderer!.root.findAllByType("ListItem" as never)).toHaveLength(
            8,
        );
    });
    it("runs the selected local link's real connect or sync action", async () => {
        actions.connectionStatuses = {
            [local.ID]: {
                webRTCStatus: WebRTCStatus.Connected,
                signalingServerStatus: SignalingStatus.Connected,
                lastSync: new Date(0),
            },
        } as typeof actions.connectionStatuses;
        await mount();
        await press("device-view-list");
        await press("device-row-action-account:peer");
        expect(actions.connectDevice).toHaveBeenCalledWith(local.ID);
        expect(
            byId("device-row-action-account:peer").props.accessibilityLabel,
        ).toBe("Sync Laptop");
    });
    it("disables quick actions during signaling setup", async () => {
        actions.connectionStatuses = {
            [local.ID]: {
                webRTCStatus: WebRTCStatus.Disconnected,
                signalingServerStatus: SignalingStatus.Connecting,
            },
        } as typeof actions.connectionStatuses;
        await mount();
        await press("device-view-list");
        expect(byId("device-row-action-account:peer").props.disabled).toBe(
            true,
        );
    });
    it("preserves both existing invitation routes", async () => {
        await mount();
        await press("device-link");
        const menus = renderer!.root.findAllByType("MenuRow" as never);
        expect(menus.map((item) => item.props.title)).toEqual([
            "Create invitation",
            "Use invitation",
        ]);
        await act(async () => menus[0]!.props.onPress());
        expect(router.push).toHaveBeenCalledWith("/(app)/devices/link-send");
        await press("device-link");
        await act(async () =>
            renderer!.root
                .findAllByType("MenuRow" as never)[1]!
                .props.onPress(),
        );
        expect(router.push).toHaveBeenCalledWith("/link-receive");
    });
    it("refreshes a bound account once during the ten second cooldown", async () => {
        jest.useFakeTimers();
        await mount();
        await press("device-refresh");
        expect(account.refresh).toHaveBeenCalledTimes(1);
        expect(byId("device-refresh").props.disabled).toBe(true);
        expect(byId("device-refresh").props.accessibilityLabel).toContain(
            "10 seconds",
        );
        await press("device-refresh");
        expect(account.refresh).toHaveBeenCalledTimes(1);
        await act(async () => jest.advanceTimersByTime(10_000));
        expect(byId("device-refresh").props.disabled).toBe(false);
    });
    it("disables account refresh for an unbound vault", async () => {
        account.bound = false;
        account.hasSession = false;
        await mount();
        expect(byId("device-refresh").props.disabled).toBe(true);
        await press("device-refresh");
        expect(account.refresh).not.toHaveBeenCalled();
    });
    it("keeps detail callbacks scoped to the selected record and protects busy dismissal", async () => {
        await mount();
        await openPeer();
        expect(details().props.selection.id).toBe("account:peer");
        expect(details().props.onUnlinkRelationship).toBe(
            account.unlinkRelationship,
        );
        await act(async () => details().props.onBusyChange(true));
        const dialog = renderer!.root.findByType("Dialog" as never);
        expect(dialog.props.dismissible).toBe(false);
        await act(async () => dialog.props.onOpenChange(false));
        expect(details()).toBeDefined();
        await act(async () => details().props.onClose());
        expect(renderer!.root.findAllByType("Dialog" as never)).toHaveLength(0);
    });
    it("returns from details to the device's map neighborhood", async () => {
        await mount();
        await openPeer();
        await act(async () => details().props.onExplore("account:peer"));
        expect(renderer!.root.findAllByType("Dialog" as never)).toHaveLength(0);
        expect(byId("device-view-map").props.accessibilityState.selected).toBe(
            true,
        );
        expect(effectiveOpacity("device-map-node-account:remote")).toBe(0.15);
    });
    it("uses the latest committed account action when confirming root access", async () => {
        await mount();
        await openPeer();
        const rootAction = details().props.onToggleRoot;
        const previousToggleRoot = account.toggleRoot;
        const latestToggleRoot = jest
            .fn<(id: string, root: boolean) => Promise<void>>()
            .mockResolvedValue(undefined);
        account = { ...account, toggleRoot: latestToggleRoot };
        await mount(false);
        await act(async () =>
            rootAction(
                account.map.nodes.find((node) => node.serverId === "peer"),
            ),
        );
        await press("device-confirm-action");
        expect(latestToggleRoot).toHaveBeenCalledWith("peer", true);
        expect(previousToggleRoot).not.toHaveBeenCalled();
        expect(details().props.selection.id).toBe("account:peer");
    });
    it("checks current permissions when root access is confirmed after the prompt opens", async () => {
        await mount();
        await openPeer();
        await act(async () =>
            details().props.onToggleRoot(
                account.map.nodes.find((node) => node.serverId === "peer"),
            ),
        );
        const previousToggleRoot = account.toggleRoot;
        const latestToggleRoot = jest
            .fn<(id: string, root: boolean) => Promise<void>>()
            .mockRejectedValue(
                new Error("Root access is no longer available."),
            );
        account = {
            ...account,
            isRoot: false,
            toggleRoot: latestToggleRoot,
        };
        await mount(false);
        await press("device-confirm-action");
        expect(latestToggleRoot).toHaveBeenCalledWith("peer", true);
        expect(previousToggleRoot).not.toHaveBeenCalled();
        expect(
            renderer!.root.findByType("DialogDescription" as never).props
                .children,
        ).toBe("Root access is no longer available.");
    });
    it("requires root confirmation and preserves the failure in its active sheet", async () => {
        jest.mocked(account.toggleRoot).mockRejectedValue(
            new Error("Root access could not be changed."),
        );
        await mount();
        await openPeer();
        await act(async () =>
            details().props.onToggleRoot(
                account.map.nodes.find((node) => node.serverId === "peer"),
            ),
        );
        expect(account.toggleRoot).not.toHaveBeenCalled();
        await press("device-confirm-action");
        expect(account.toggleRoot).toHaveBeenCalledWith("peer", true);
        expect(
            renderer!.root.findByType("DialogDescription" as never).props
                .children,
        ).toBe("Root access could not be changed.");
        await act(async () => button("Cancel").props.onPress());
        expect(details().props.selection.id).toBe("account:peer");
    });
    it("presents an account failure in a dismissible sheet", async () => {
        account.error = "Account refresh failed.";
        await mount();
        expect(
            renderer!.root.findByType("DialogDescription" as never).props
                .children,
        ).toBe(account.error);
        await act(async () => button("Close").props.onPress());
        expect(renderer!.root.findAllByType("Dialog" as never)).toHaveLength(0);
        expect(byId("device-map")).toBeDefined();
    });
    it("filters saved peers, account-only devices and isolated nodes", () => {
        expect(
            filterDeviceNodes(account.map, "saved-peer", "all").map(
                (node) => node.displayName,
            ),
        ).toEqual(["Laptop"]);
        expect(
            filterDeviceNodes(account.map, "", "local").map(
                (node) => node.displayName,
            ),
        ).toEqual(["Laptop"]);
        expect(
            filterDeviceNodes(account.map, "", "remote").map(
                (node) => node.serverId,
            ),
        ).toEqual(["remote"]);
        expect(
            filterDeviceNodes(account.map, "", "isolated").map(
                (node) => node.serverId,
            ),
        ).toEqual(["remote"]);
    });
});
