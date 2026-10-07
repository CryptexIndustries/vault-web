import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import {
    createElement,
    Fragment,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { PortalHost } from "@rn-primitives/portal";
import { DialogContext } from "@/components/ui/dialog";
import { DeviceDetailsDialog } from "@/components/devices/device-details-dialog";

let mockReaderResult: Promise<boolean>;
let mockReaderListener: ((enabled: boolean) => void) | undefined;
let mockReducedMotion = false;
let mockKeyboardVisible = false;
const mockBackListeners = new Set<() => boolean>();
const mockKeyboardListeners = new Set<() => void>();
const mockPortalUpdates = new Map<string, ReactNode>();
const mockPortalNodes = new Map<string, ReactNode>();
let mockCommitHost: ((nodes: ReactNode[]) => void) | undefined;
let mockSheetOpen = false;
let mockSheetIndex = 0;
let mockSetSheetVisible: ((visible: boolean) => void) | undefined;
let mockSheetProps:
    | {
          animated: boolean;
          gestureEnabled: boolean;
          onOpen: () => void;
          onChange: (percentage: number) => void;
          onSnapIndexChange: (index: number) => void;
      }
    | undefined;
const mockShow = jest.fn((index: number) => {
    mockSheetOpen = true;
    mockSheetIndex = index;
    mockSetSheetVisible?.(true);
});
const mockHide = jest.fn();
const mockSnap = jest.fn((index: number) => {
    const previous = mockSheetIndex;
    mockSheetIndex = index;
    if (previous !== index) mockSheetProps?.onSnapIndexChange(index);
});
function mockSwipeToIndex(index: number) {
    const props = mockSheetProps;
    if (!props?.gestureEnabled) return;
    const previous = mockSheetIndex;
    mockSheetIndex = index;
    props.onChange(index === 0 ? 0 : 100);
    // Vendor moveSheetWithAnimation returns before snap notification if false.
    if (props.animated && previous !== index) {
        props.onSnapIndexChange(index);
    }
}
const mockDismissKeyboard = jest.fn();
const mockBodyMounted = jest.fn();
const mockBodyUnmounted = jest.fn();
const mockAnimations: {
    config: { toValue: number; duration: number; useNativeDriver: boolean };
    complete?: (result: { finished: boolean }) => void;
    stop: ReturnType<typeof jest.fn>;
}[] = [];

jest.mock("react-native", () => ({
    AccessibilityInfo: {
        isScreenReaderEnabled: () => mockReaderResult,
        addEventListener: (
            _event: string,
            listener: (enabled: boolean) => void,
        ) => {
            mockReaderListener = listener;
            return {
                remove: () => {
                    mockReaderListener = undefined;
                },
            };
        },
    },
    Animated: {
        View: "AnimatedView",
        Value: class {
            value: number;
            constructor(value: number) {
                this.value = value;
            }
            setValue(value: number) {
                this.value = value;
            }
            stopAnimation() {}
        },
        timing: (
            _value: unknown,
            config: {
                toValue: number;
                duration: number;
                useNativeDriver: boolean;
            },
        ) => {
            const animation = {
                config,
                complete: undefined as
                    | ((result: { finished: boolean }) => void)
                    | undefined,
                start(callback: (result: { finished: boolean }) => void) {
                    animation.complete = callback;
                },
                stop: jest.fn(),
            };
            mockAnimations.push(animation);
            return animation;
        },
    },
    BackHandler: {
        addEventListener: (_event: string, listener: () => boolean) => {
            mockBackListeners.add(listener);
            return { remove: () => mockBackListeners.delete(listener) };
        },
    },
    Easing: { ease: "ease", out: (value: string) => value },
    Keyboard: {
        dismiss: () => mockDismissKeyboard(),
        isVisible: () => mockKeyboardVisible,
        addListener: (_event: string, listener: () => void) => {
            mockKeyboardListeners.add(listener);
            return { remove: () => mockKeyboardListeners.delete(listener) };
        },
    },
    Pressable: "Pressable",
    StyleSheet: { absoluteFill: { position: "absolute", inset: 0 } },
    useWindowDimensions: () => ({ width: 376, height: 790 }),
    View: "View",
}));
jest.mock("@rn-primitives/portal", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    return {
        Portal: ({ name, children }: { name: string; children: ReactNode }) => {
            React.useEffect(() => {
                mockPortalUpdates.set(name, children);
            }, [name, children]);
            React.useEffect(
                () => () => {
                    mockPortalUpdates.set(name, null);
                },
                [name],
            );
            return null;
        },
        PortalHost: () => {
            const [nodes, setNodes] = React.useState<ReactNode[]>([]);
            React.useEffect(() => {
                mockCommitHost = setNodes;
                return () => {
                    mockCommitHost = undefined;
                };
            }, []);
            return React.createElement(React.Fragment, null, ...nodes);
        },
    };
});
jest.mock("react-native-actions-sheet", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    return {
        __esModule: true,
        default: React.forwardRef(
            (
                props: {
                    children: ReactNode;
                    animated: boolean;
                    gestureEnabled: boolean;
                    onOpen: () => void;
                    onChange: (percentage: number) => void;
                    onSnapIndexChange: (index: number) => void;
                },
                ref,
            ) => {
                const [visible, setVisible] = React.useState(false);
                mockSetSheetVisible = setVisible;
                mockSheetProps = props;
                React.useImperativeHandle(
                    ref,
                    () => ({
                        show: mockShow,
                        hide: mockHide,
                        snapToIndex: mockSnap,
                        isOpen: () => mockSheetOpen,
                        currentSnapIndex: () => mockSheetIndex,
                    }),
                    [],
                );
                React.useEffect(() => {
                    if (visible) mockSheetProps?.onOpen();
                }, [visible]);
                return React.createElement(
                    "ActionSheet",
                    props,
                    visible ? props.children : null,
                );
            },
        ),
    };
});
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 42, bottom: 24 }),
}));
jest.mock("react-native-gesture-handler", () => ({
    GestureHandlerRootView: "GestureHandlerRootView",
}));
jest.mock("react-native-reanimated", () => ({
    ReduceMotion: { Always: "always", Never: "never" },
}));
jest.mock("@/hooks/use-reduced-motion", () => ({
    useReducedMotion: () => mockReducedMotion,
}));
jest.mock("@/components/ui/dialog", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    const context = React.createContext<{
        open: boolean;
        placement: string;
        onOpenChange: (open: boolean) => void;
    } | null>(null);
    return {
        DialogContext: context,
        Dialog: ({
            children,
            ...props
        }: {
            children: ReactNode;
            open: boolean;
            onOpenChange: (open: boolean) => void;
        }) =>
            React.createElement(
                "NativeDialog",
                props,
                props.open
                    ? React.createElement(
                          context.Provider,
                          { value: { ...props, placement: "bottom" } },
                          children,
                      )
                    : null,
            ),
    };
});

function Body({ selection }: { selection: string }) {
    const context = useContext(DialogContext);
    const [draft, setDraft] = useState("original");
    useEffect(() => {
        mockBodyMounted();
        return () => {
            mockBodyUnmounted();
        };
    }, []);
    return createElement("DetailBody", { selection, draft, setDraft, context });
}

let renderer: ReactTestRenderer | undefined;
let selection: string;
let props: Omit<Parameters<typeof DeviceDetailsDialog>[0], "children">;
async function render(commitPortal = true) {
    await act(async () => {
        const tree = createElement(
            Fragment,
            null,
            createElement(
                DeviceDetailsDialog,
                props as Parameters<typeof DeviceDetailsDialog>[0],
                createElement(Body, { selection }),
            ),
            createElement(PortalHost),
        );
        if (renderer) renderer.update(tree);
        else renderer = create(tree);
    });
    if (commitPortal) await flushPortal();
}
async function flushPortal() {
    for (let i = 0; mockPortalUpdates.size && i < 20; i++) {
        for (const [name, node] of mockPortalUpdates) {
            if (node === null) mockPortalNodes.delete(name);
            else mockPortalNodes.set(name, node);
        }
        mockPortalUpdates.clear();
        await act(async () => mockCommitHost?.([...mockPortalNodes.values()]));
    }
    expect(mockPortalUpdates.size).toBe(0);
}
const sheet = () => renderer!.root.findByType("ActionSheet" as never);
const host = () =>
    renderer!.root.findByProps({ testID: "device-details-retained-host" });
const body = () => renderer!.root.findByType("DetailBody" as never);
async function open() {
    props.open = true;
    await render();
    await act(async () => sheet().props.onChange(100));
}
async function closeAnimation() {
    await act(async () => {
        sheet().props.onChange(0);
        [...mockAnimations]
            .reverse()
            .find((animation) => animation.config.toValue === 0)
            ?.complete?.({ finished: true });
    });
    await flushPortal();
}
beforeEach(() => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
    mockReaderResult = Promise.resolve(false);
    mockReaderListener = undefined;
    mockReducedMotion = false;
    mockKeyboardVisible = false;
    mockBackListeners.clear();
    mockKeyboardListeners.clear();
    mockPortalUpdates.clear();
    mockPortalNodes.clear();
    mockCommitHost = undefined;
    mockSheetOpen = false;
    mockSheetIndex = 0;
    mockSetSheetVisible = undefined;
    mockSheetProps = undefined;
    mockAnimations.length = 0;
    selection = "current-device";
    props = {
        open: false,
        active: true,
        preload: true,
        dismissible: true,
        bottomSheetVariant: "device-detail",
        onOpenChange: jest.fn(),
    };
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
});

it("warms only after the deferred portal host attaches its native ref", async () => {
    await render(false);
    expect(mockShow).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType("ActionSheet" as never)).toHaveLength(
        0,
    );
    await flushPortal();
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockShow).toHaveBeenCalledWith(0);
    // A native GH root cannot enforce View pointerEvents on this Android bridge.
    expect(host().type).toBe("View");
    expect(host().props.pointerEvents).toBe("none");
    expect(host().props.importantForAccessibility).toBe("no-hide-descendants");
    expect(mockDismissKeyboard).not.toHaveBeenCalled();
    expect(sheet().props.keyboardHandlerEnabled).toBe(false);
});

it("opens and closes warm content with snaps while preserving its mounted controller", async () => {
    await render();
    expect(mockBodyMounted).toHaveBeenCalledTimes(1);
    await open();
    expect(mockSnap).toHaveBeenCalledWith(1);
    expect(body().props.context).toMatchObject({
        open: true,
        placement: "bottom",
    });
    props.open = false;
    await render();
    expect(mockSnap).toHaveBeenCalledWith(0);
    expect(host().props.pointerEvents).toBe("auto");
    await closeAnimation();
    expect(host().props.pointerEvents).toBe("none");
    await open();
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockHide).not.toHaveBeenCalled();
    expect(mockBodyMounted).toHaveBeenCalledTimes(1);
    expect(mockBodyUnmounted).not.toHaveBeenCalled();
});

it("keeps the closing touch mask until both sheet position and backdrop settle", async () => {
    await render();
    await open();
    props.open = false;
    await render();
    await act(async () => sheet().props.onChange(0));
    await flushPortal();
    expect(host().props.pointerEvents).toBe("auto");
    await closeAnimation();
    expect(host().props.pointerEvents).toBe("none");
});

it("ignores stale closing completion after a rapid reopen", async () => {
    await render();
    await open();
    props.open = false;
    await render();
    const oldCompletion = mockAnimations.at(-1)!.complete;
    props.open = true;
    await render();
    await act(async () => {
        sheet().props.onChange(0);
        oldCompletion?.({ finished: true });
    });
    await flushPortal();
    expect(host().props.pointerEvents).toBe("auto");
    expect(props.onOpenChange).not.toHaveBeenCalled();
});

it("uses the latest Back dismissal guard and removes its handler when closed", async () => {
    await render();
    await open();
    const back = [...mockBackListeners][0]!;
    props.dismissible = false;
    await render();
    expect(back()).toBe(true);
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(sheet().props.gestureEnabled).toBe(false);
    props.dismissible = true;
    await render();
    expect(back()).toBe(true);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    props.open = false;
    await render();
    expect(mockBackListeners.size).toBe(0);
});

it("treats a zero snap as user dismissal only while open and dismissible", async () => {
    await render();
    await open();
    await act(async () => sheet().props.onSnapIndexChange(0));
    expect(props.onOpenChange).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    props.open = false;
    await render();
    (props.onOpenChange as ReturnType<typeof jest.fn>).mockClear();
    await act(async () => sheet().props.onSnapIndexChange(0));
    expect(props.onOpenChange).not.toHaveBeenCalled();
});

it("rejects a previously captured zero-snap callback after the form becomes dirty", async () => {
    await render();
    await open();
    const snapChanged = sheet().props.onSnapIndexChange;
    props.dismissible = false;
    await render();
    await act(async () => snapChanged(0));
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(mockSnap).toHaveBeenLastCalledWith(1);
});

it("preserves selection and draft during a controlled root-confirmation cover and return", async () => {
    await render();
    await open();
    await act(async () => body().props.setDraft("saved form draft"));
    props.open = false;
    await render();
    await closeAnimation();
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(mockBackListeners.size).toBe(0);
    await open();
    expect(body().props.selection).toBe("current-device");
    expect(body().props.draft).toBe("saved form draft");
    expect(mockBodyMounted).toHaveBeenCalledTimes(1);
});

it("updates the selected record before the warm body becomes interactive", async () => {
    await render();
    selection = "selected-connection";
    props.open = true;
    await render();
    expect(body().props.selection).toBe("selected-connection");
    expect(host().props.pointerEvents).toBe("auto");
});

it("immediately hides the retained host and removes Back interception on blur", async () => {
    await render();
    await open();
    props.active = false;
    await render();
    expect(host().props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ opacity: 0 })]),
    );
    expect(host().props.pointerEvents).toBe("none");
    expect(host().props.importantForAccessibility).toBe("no-hide-descendants");
    expect(sheet().props.gestureEnabled).toBe(false);
    expect(mockBackListeners.size).toBe(0);
});

it("keeps keyboard handling until the closing IME actually hides", async () => {
    await render();
    await open();
    mockKeyboardVisible = true;
    props.open = false;
    await render();
    await closeAnimation();
    expect(mockDismissKeyboard).toHaveBeenCalledTimes(1);
    expect(sheet().props.keyboardHandlerEnabled).toBe(true);
    mockKeyboardVisible = false;
    await act(async () => {
        for (const listener of mockKeyboardListeners) listener();
    });
    await flushPortal();
    expect(sheet().props.keyboardHandlerEnabled).toBe(false);
});

it("leaves another screen's keyboard alone while warming or updating the hidden sheet", async () => {
    mockKeyboardVisible = true;
    await render();
    props.preload = false;
    await render();
    props.active = false;
    await render();
    props.active = true;
    props.preload = true;
    await render();
    expect(mockDismissKeyboard).not.toHaveBeenCalled();
    expect(sheet().props.keyboardHandlerEnabled).toBe(false);
    expect(mockKeyboardListeners.size).toBe(0);
});

it("dismisses once per close even if the retained library closes and warms again", async () => {
    await render();
    await open();
    props.open = false;
    await render();
    await closeAnimation();
    mockKeyboardVisible = true;
    await act(async () => {
        mockSheetOpen = false;
        mockSheetIndex = 0;
        mockSetSheetVisible?.(false);
        sheet().props.onClose();
    });
    await flushPortal();
    expect(mockShow).toHaveBeenLastCalledWith(0);
    expect(mockDismissKeyboard).toHaveBeenCalledTimes(1);
    expect(sheet().props.keyboardHandlerEnabled).toBe(false);
    await open();
    props.open = false;
    await render();
    expect(mockDismissKeyboard).toHaveBeenCalledTimes(2);
});

it("releases keyboard handling on blur before the IME hides", async () => {
    await render();
    await open();
    mockKeyboardVisible = true;
    props.active = false;
    await render();
    expect(mockDismissKeyboard).toHaveBeenCalledTimes(1);
    expect(sheet().props.keyboardHandlerEnabled).toBe(false);
    expect(mockKeyboardListeners.size).toBe(0);
    props.preload = false;
    await render();
    expect(mockDismissKeyboard).toHaveBeenCalledTimes(1);
});

it("closes from a reduced-motion swipe with vendor snap callbacks still enabled", async () => {
    mockReducedMotion = true;
    props.onOpenChange = jest.fn((open: boolean) => {
        props.open = open;
    });
    await render();
    await open();
    expect(sheet().props.openAnimationConfig.reduceMotion).toBe("always");
    await act(async () => mockSwipeToIndex(0));
    expect(props.onOpenChange).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    await render();
    expect(mockAnimations).toHaveLength(0);
    expect(host().props.pointerEvents).toBe("none");
    expect(body().props.context.open).toBe(false);
    expect(
        renderer!.root.findByType("AnimatedView" as never).props.style[1]
            .opacity.value,
    ).toBe(0);
});

it("uses the native modal while screen-reader status is unknown or enabled", async () => {
    let resolveReader!: (enabled: boolean) => void;
    mockReaderResult = new Promise((resolve) => {
        resolveReader = resolve;
    });
    props.open = true;
    await render();
    expect(renderer!.root.findByType("NativeDialog" as never).props.open).toBe(
        true,
    );
    expect(mockShow).not.toHaveBeenCalled();
    await act(async () => resolveReader(true));
    await render();
    expect(renderer!.root.findAllByType("ActionSheet" as never)).toHaveLength(
        0,
    );
    expect(
        renderer!.root.findByType("NativeDialog" as never).props.dismissible,
    ).toBe(true);
});

it("keeps the active native controller when the reader query resolves after opening", async () => {
    let resolveReader!: (enabled: boolean) => void;
    mockReaderResult = new Promise((resolve) => {
        resolveReader = resolve;
    });
    props.open = true;
    await render();
    await act(async () => body().props.setDraft("do not lose me"));
    await act(async () => resolveReader(false));
    await render();
    expect(renderer!.root.findAllByType("NativeDialog" as never)).toHaveLength(
        1,
    );
    expect(body().props.draft).toBe("do not lose me");
    expect(mockBodyUnmounted).not.toHaveBeenCalled();
});

it("defers a reader-mode switch until the retained closing animation ends", async () => {
    await render();
    await open();
    await act(async () => body().props.setDraft("keep while presented"));
    await act(async () => mockReaderListener?.(true));
    await flushPortal();
    expect(body().props.draft).toBe("keep while presented");
    props.open = false;
    await render();
    expect(renderer!.root.findAllByType("ActionSheet" as never)).toHaveLength(
        1,
    );
    await closeAnimation();
    expect(renderer!.root.findAllByType("ActionSheet" as never)).toHaveLength(
        0,
    );
    props.open = true;
    await render();
    expect(renderer!.root.findByType("NativeDialog" as never).props.open).toBe(
        true,
    );
});

it("removes the portal and input subscriptions on unmount", async () => {
    await render();
    await open();
    expect(mockHide).not.toHaveBeenCalled();
    await act(async () => renderer!.unmount());
    renderer = undefined;
    expect(mockHide).not.toHaveBeenCalled();
    expect(mockBackListeners.size).toBe(0);
    expect(mockKeyboardListeners.size).toBe(0);
    expect(mockReaderListener).toBeUndefined();
    expect([...mockPortalUpdates.values()]).toContain(null);
});

it("warms again after an unexpected library close while the host remains mounted", async () => {
    await render();
    const closed = sheet().props.onClose;
    await act(async () => {
        mockSheetOpen = false;
        mockSheetIndex = 0;
        mockSetSheetVisible?.(false);
        closed();
    });
    await flushPortal();
    expect(mockShow).toHaveBeenCalledTimes(2);
    expect(mockShow).toHaveBeenLastCalledWith(0);
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(host().props.pointerEvents).toBe("none");
    await open();
    expect(body().props.selection).toBe("current-device");
    expect(mockShow).toHaveBeenCalledTimes(2);
});

it.each(["before", "after"] as const)(
    "releases the closing touch mask when the library closes %s the backdrop settles without a position event",
    async (timing) => {
        await render();
        await open();
        props.open = false;
        await render();
        const settleBackdrop = async () => {
            await act(async () =>
                mockAnimations.at(-1)?.complete?.({ finished: true }),
            );
            await flushPortal();
        };
        if (timing === "after") {
            await settleBackdrop();
            expect(host().props.pointerEvents).toBe("auto");
        }
        await act(async () => {
            mockSheetOpen = false;
            mockSheetIndex = 0;
            mockSetSheetVisible?.(false);
            sheet().props.onClose();
        });
        await flushPortal();
        if (timing === "before") {
            expect(host().props.pointerEvents).toBe("auto");
            await settleBackdrop();
        }
        expect(host().props.pointerEvents).toBe("none");
        expect(mockShow).toHaveBeenLastCalledWith(0);
        expect(props.onOpenChange).not.toHaveBeenCalled();
        await open();
        expect(host().props.pointerEvents).toBe("auto");
        expect(body().props.selection).toBe("current-device");
    },
);

it("restores the requested record after a late library close during opening", async () => {
    await render();
    selection = "selected-connection";
    await open();
    const closed = sheet().props.onClose;
    await act(async () => {
        mockSheetOpen = false;
        mockSheetIndex = 0;
        mockSetSheetVisible?.(false);
        closed();
    });
    await flushPortal();
    expect(mockShow).toHaveBeenLastCalledWith(1);
    expect(body().props.selection).toBe("selected-connection");
    expect(host().props.pointerEvents).toBe("auto");
    expect(props.onOpenChange).not.toHaveBeenCalled();
});

it("ignores a library close callback that arrives after final unmount", async () => {
    await render();
    const closed = sheet().props.onClose;
    await act(async () => renderer!.unmount());
    renderer = undefined;
    expect(mockHide).not.toHaveBeenCalled();
    const callsBeforeLateClose = mockShow.mock.calls.length;
    await act(async () => closed());
    expect(mockShow).toHaveBeenCalledTimes(callsBeforeLateClose);
    expect(props.onOpenChange).not.toHaveBeenCalled();
});
