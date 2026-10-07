import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Dialog, type DialogProps } from "@/components/ui/dialog";

let mockSheetOpen = false;
let mockFrames: (() => void)[] = [];
let mockReducedMotion = true;
const mockBackdropAnimations: {
    config: { toValue: number; duration: number; useNativeDriver: boolean };
    stop: ReturnType<typeof jest.fn>;
}[] = [];
const mockShow = jest.fn(() => {
    mockSheetOpen = true;
});
const mockHide = jest.fn();

jest.mock("react-native", () => ({
    ActivityIndicator: "ActivityIndicator",
    Animated: {
        View: "AnimatedView",
        Value: class {
            value: number;
            setValue = jest.fn((value: number) => {
                this.value = value;
            });
            stopAnimation = jest.fn();
            constructor(value: number) {
                this.value = value;
            }
        },
        timing: (
            value: { setValue: (next: number) => void },
            config: {
                toValue: number;
                duration: number;
                useNativeDriver: boolean;
            },
        ) => {
            const animation = {
                config,
                start: () => value.setValue(config.toValue),
                stop: jest.fn(),
            };
            mockBackdropAnimations.push(animation);
            return animation;
        },
    },
    Easing: { ease: "ease", out: (value: string) => value },
    KeyboardAvoidingView: "KeyboardAvoidingView",
    Modal: "Modal",
    Platform: { OS: "android" },
    Pressable: "Pressable",
    ScrollView: "ScrollView",
    StyleSheet: { absoluteFill: { position: "absolute", inset: 0 } },
    useWindowDimensions: () => ({ width: 376, height: 724 }),
    View: "View",
}));
jest.mock("react-native-actions-sheet", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    return {
        __esModule: true,
        default: React.forwardRef((props: { children: ReactNode }, ref) => {
            React.useImperativeHandle(ref, () => ({
                show: mockShow,
                hide: mockHide,
                isOpen: () => mockSheetOpen,
            }));
            return React.createElement("ActionSheet", props, props.children);
        }),
        ScrollView: "SheetScrollView",
    };
});
jest.mock("react-native-gesture-handler", () => ({
    GestureHandlerRootView: "GestureHandlerRootView",
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 42, bottom: 24, left: 0, right: 0 }),
}));
jest.mock("@rn-primitives/portal", () => ({ Portal: "Portal" }));
jest.mock("@/hooks/use-reduced-motion", () => ({
    useReducedMotion: () => mockReducedMotion,
}));
jest.mock("@/components/keyboard-scroll", () => ({
    KeyboardScrollProvider: "KeyboardScrollProvider",
}));
jest.mock("@/components/ui/text", () => ({ Text: "Text" }));

let renderer: ReactTestRenderer | undefined;
let props: DialogProps;
const modal = () => renderer!.root.findByType("Modal" as never);
const sheet = () => renderer!.root.findByType("ActionSheet" as never);
const backdrop = () =>
    renderer!.root.findByProps({ testID: "devices-dialog-backdrop" });
async function render() {
    await act(async () => {
        const element = createElement(Dialog, props);
        if (renderer) renderer.update(element);
        else renderer = create(element);
    });
}
async function shown() {
    await act(async () => modal().props.onShow());
}
async function sheetClosed() {
    await act(async () => {
        mockSheetOpen = false;
        sheet().props.onClose();
    });
}
beforeEach(() => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    mockSheetOpen = false;
    mockFrames = [];
    mockReducedMotion = true;
    mockBackdropAnimations.length = 0;
    globalThis.requestAnimationFrame = ((callback: () => void) => {
        mockFrames.push(callback);
        return mockFrames.length;
    }) as typeof requestAnimationFrame;
    props = {
        open: true,
        placement: "bottom",
        bottomSheetVariant: "device-detail",
        children: createElement("DetailBody"),
        onOpenChange: jest.fn(),
    };
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
});

it("waits for the Devices native window before showing the sheet", async () => {
    await render();
    expect(modal().props.visible).toBe(true);
    expect(modal().props.statusBarTranslucent).toBe(true);
    expect(modal().props.navigationBarTranslucent).toBe(true);
    expect(sheet().props.isModal).toBe(false);
    expect(sheet().props.closeOnPressBack).toBe(false);
    expect(sheet().props.openAnimationConfig).toEqual({
        duration: 200,
        dampingRatio: 1,
        overshootClamping: true,
    });
    expect(
        renderer!.root.findAllByType("GestureHandlerRootView" as never),
    ).toHaveLength(1);
    expect(mockShow).not.toHaveBeenCalled();
    await shown();
    expect(mockShow).toHaveBeenCalledTimes(1);
});

it("keeps one backdrop through native preparation and sheet presentation", async () => {
    await render();
    const scrim = backdrop();
    const opacity = scrim.props.style[1].opacity;
    expect(opacity.value).toBe(2 / 3);
    expect(scrim.props.pointerEvents).toBe("none");
    expect(sheet().props.defaultOverlayOpacity).toBe(0);
    expect(sheet().props.backdropProps).toMatchObject({
        accessibilityRole: "button",
        accessibilityLabel: "Close dialog",
    });
    await shown();
    expect(backdrop()).toBe(scrim);
    expect(backdrop().props.style[1].opacity).toBe(opacity);
    expect(mockBackdropAnimations).toHaveLength(0);
    props.open = false;
    await render();
    expect(opacity.value).toBe(0);
    expect(modal().props.visible).toBe(true);
    await sheetClosed();
    expect(modal().props.visible).toBe(false);
});

it("animates the Devices backdrop natively and interrupts it on rapid reopen", async () => {
    mockReducedMotion = false;
    await render();
    expect(mockBackdropAnimations).toHaveLength(1);
    expect(mockBackdropAnimations[0]!.config).toMatchObject({
        toValue: 2 / 3,
        duration: 180,
        useNativeDriver: true,
    });
    await shown();
    props.open = false;
    await render();
    expect(mockBackdropAnimations[0]!.stop).toHaveBeenCalledTimes(1);
    expect(mockBackdropAnimations[1]!.config.toValue).toBe(0);
    props.open = true;
    await render();
    expect(mockBackdropAnimations[1]!.stop).toHaveBeenCalledTimes(1);
    expect(mockBackdropAnimations[2]!.config.toValue).toBe(2 / 3);
    expect(modal().props.visible).toBe(true);
});

it("keeps the native modal visible until the closing sheet animation completes", async () => {
    await render();
    await shown();
    await act(async () => sheet().props.onBeforeClose());
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    props.open = false;
    await render();
    expect(mockHide).toHaveBeenCalledTimes(1);
    expect(modal().props.visible).toBe(true);
    await sheetClosed();
    expect(modal().props.visible).toBe(false);
});

it.each(["device-detail", "devices"] as const)(
    "does not report a controlled %s close as user dismissal and can reopen",
    async (variant) => {
        props.bottomSheetVariant = variant;
        await render();
        await shown();
        const beforeClose = sheet().props.onBeforeClose;
        props.open = false;
        await render();
        expect(mockHide).toHaveBeenCalledTimes(1);
        await act(async () => beforeClose());
        expect(props.onOpenChange).not.toHaveBeenCalled();
        expect(modal().props.visible).toBe(true);
        await sheetClosed();
        expect(modal().props.visible).toBe(false);
        props.open = true;
        await render();
        await shown();
        expect(mockShow).toHaveBeenCalledTimes(2);
        expect(modal().props.visible).toBe(true);
    },
);

it("uses the latest dismissal guard for native Back and previously captured sheet callbacks", async () => {
    await render();
    await shown();
    const requestClose = sheet().props.onRequestClose;
    const beforeClose = sheet().props.onBeforeClose;
    props.dismissible = false;
    await render();
    expect(sheet().props.onRequestClose).toBe(requestClose);
    expect(requestClose()).toBe(false);
    await act(async () => modal().props.onRequestClose());
    expect(props.onOpenChange).not.toHaveBeenCalled();
    const nextHandler = jest.fn();
    props.dismissible = true;
    props.onOpenChange = nextHandler;
    await render();
    expect(requestClose()).toBe(true);
    await act(async () => beforeClose());
    expect(nextHandler).toHaveBeenCalledWith(false);
});

it("closes safely before native onShow and can open again", async () => {
    await render();
    const lateShow = modal().props.onShow;
    props.open = false;
    await render();
    expect(modal().props.visible).toBe(false);
    await act(async () => lateShow());
    expect(mockShow).not.toHaveBeenCalled();
    props.open = true;
    await render();
    expect(modal().props.visible).toBe(true);
    await shown();
    expect(mockShow).toHaveBeenCalledTimes(1);
});

it("preserves a rapid reopen while the old closing animation finishes", async () => {
    await render();
    await shown();
    props.open = false;
    await render();
    props.open = true;
    await render();
    await sheetClosed();
    expect(modal().props.visible).toBe(true);
    expect(mockFrames).toHaveLength(1);
    await act(async () => {
        for (const callback of mockFrames.splice(0)) callback();
    });
    expect(mockShow).toHaveBeenCalledTimes(2);
});

it("does not reopen when that new request closes before the queued frame", async () => {
    await render();
    await shown();
    props.open = false;
    await render();
    props.open = true;
    await render();
    await sheetClosed();
    props.open = false;
    await render();
    await act(async () => {
        for (const callback of mockFrames.splice(0)) callback();
    });
    expect(modal().props.visible).toBe(false);
    expect(mockShow).toHaveBeenCalledTimes(1);
});

it("preserves the existing modal and portal paths for other bottom sheets", async () => {
    delete props.bottomSheetVariant;
    await render();
    expect(renderer!.root.findAllByType("Modal" as never)).toHaveLength(0);
    expect(sheet().props.isModal).toBe(true);
    expect(sheet().props.openAnimationConfig).toBeUndefined();
    expect(mockShow).toHaveBeenCalledTimes(1);
    props.modal = false;
    await render();
    expect(renderer!.root.findAllByType("Portal" as never)).toHaveLength(1);
    expect(sheet().props.isModal).toBe(false);
});

it("keeps centered dialogs on their existing native modal", async () => {
    props.placement = "center";
    delete props.bottomSheetVariant;
    await render();
    expect(modal().props.visible).toBe(true);
    expect(modal().props.animationType).toBe("none");
    expect(renderer!.root.findAllByType("ActionSheet" as never)).toHaveLength(
        0,
    );
    expect(modal().props.navigationBarTranslucent).toBeUndefined();
});
