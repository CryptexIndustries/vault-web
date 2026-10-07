import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import * as React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type {
    ActionSheetProps,
    ActionSheetRef,
} from "react-native-actions-sheet";

const localRequire = createRequire(__filename);
const nativeRequire = createRequire(
    localRequire.resolve("react-native/package.json"),
);
const babel = localRequire("@babel/core") as {
    transformSync: (
        source: string,
        options: Record<string, unknown>,
    ) => { code: string };
};
// Load the installed vendor component, not the lightweight host test mock.
const sheetSource = buildSync({
    entryPoints: [localRequire.resolve("react-native-actions-sheet")],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    loader: { ".js": "jsx" },
    external: [
        "react",
        "react-native",
        "react-native-gesture-handler",
        "react-native-reanimated",
        "react-native-safe-area-context",
    ],
}).outputFiles[0]!.text;
const nativeBackSource = babel.transformSync(
    readFileSync(
        join(
            dirname(localRequire.resolve("react-native/package.json")),
            "Libraries/Utilities/BackHandler.android.js",
        ),
        "utf8",
    ),
    {
        filename: "BackHandler.android.js",
        babelrc: false,
        configFile: false,
        presets: [localRequire.resolve("babel-preset-expo")],
        caller: {
            name: "metro",
            platform: "android",
            supportsStaticESM: false,
        },
    },
).code;

function loadSheetRuntime() {
    type BackCallback = () => boolean;
    const nativeBackModule = {
        exports: {} as {
            default: {
                addEventListener: (
                    event: string,
                    listener: BackCallback,
                ) => { remove: () => void };
            };
            listeners: BackCallback[];
        },
    };
    // Expose the real RN listener array only in this isolated VM. Its actual
    // registration, deduplication, and removal code runs unchanged.
    runInNewContext(
        nativeBackSource +
            "\nmodule.exports.listeners = _backPressSubscriptions;",
        {
            module: nativeBackModule,
            exports: nativeBackModule.exports,
            require(name: string) {
                if (name.includes("NativeDeviceEventManager")) {
                    return { invokeDefaultBackPressHandler() {} };
                }
                if (name.includes("EventInternals")) {
                    return { setEventInitTimeStamp() {} };
                }
                if (name.includes("RCTDeviceEventEmitter")) {
                    return { addListener() {} };
                }
                if (name.includes("HardwareBackPressEvent")) {
                    return { HardwareBackPressEvent: class {} };
                }
                return nativeRequire(name);
            },
        },
    );
    const keyboardListeners = new Map<string, Set<() => void>>();
    const native = {
        BackHandler: nativeBackModule.exports.default,
        Dimensions: { get: () => ({ width: 376, height: 790 }) },
        Keyboard: {
            dismiss() {},
            addListener(event: string, callback: () => void) {
                let listeners = keyboardListeners.get(event);
                if (!listeners)
                    keyboardListeners.set(event, (listeners = new Set()));
                listeners.add(callback);
                return { remove: () => listeners.delete(callback) };
            },
        },
        Modal: "NativeModal",
        PanResponder: { create: (props: unknown) => ({ panHandlers: props }) },
        Platform: { OS: "android" },
        Pressable: "Pressable",
        StyleSheet: {
            create: (value: unknown) => value,
            flatten: (value: unknown) => value,
        },
        AccessibilityInfo: { addEventListener: () => ({ remove() {} }) },
    };
    const gestureBuilder: object = new Proxy(
        {},
        {
            get: () => () => gestureBuilder,
        },
    );
    const sharedValue = (value: number) => ({
        value,
        addListener() {},
        removeListener() {},
    });
    const dependencies: Record<string, unknown> = {
        react: React,
        "react-native": native,
        "react-native-gesture-handler": {
            Gesture: { Pan: () => gestureBuilder },
            GestureDetector: "GestureDetector",
            GestureHandlerRootView: "GestureRoot",
        },
        "react-native-reanimated": {
            __esModule: true,
            default: {
                View: "AnimatedView",
                createAnimatedComponent: () => "AnimatedPressable",
            },
            Easing: { ease: 0, in: () => 0 },
            runOnJS: (fn: unknown) => fn,
            runOnUI: (fn: unknown) => fn,
            useAnimatedStyle: (fn: () => unknown) => fn(),
            useSharedValue: (initial: number) =>
                React.useRef(sharedValue(initial)).current,
            withSpring: (value: number) => value,
            withTiming: (value: number) => value,
        },
        "react-native-safe-area-context": {
            useSafeAreaInsets: () => ({
                top: 42,
                bottom: 24,
                left: 0,
                right: 0,
            }),
        },
    };
    const vendorModule = {
        exports: {} as typeof import("react-native-actions-sheet"),
    };
    runInNewContext(sheetSource, {
        module: vendorModule,
        exports: vendorModule.exports,
        require: (name: string) => dependencies[name] ?? localRequire(name),
        console,
        setTimeout,
        clearTimeout,
        __DEV__: true,
    });
    return {
        ActionSheet: vendorModule.exports.default,
        listeners: nativeBackModule.exports.listeners,
    };
}

let runtime: ReturnType<typeof loadSheetRuntime>;
let renderer: ReactTestRenderer | undefined;
let ref: React.RefObject<ActionSheetRef | null>;
let props: ActionSheetProps;
async function render(label = "initial") {
    await act(async () => {
        const tree = React.createElement(
            React.StrictMode,
            null,
            React.createElement(runtime.ActionSheet, { ...props, ref }, label),
        );
        if (renderer) renderer.update(tree);
        else renderer = create(tree);
    });
}
function viewportRoot() {
    return renderer!.root
        .findAllByType("AnimatedView" as never)
        .find(
            (node) =>
                node.props.style?.position === "absolute" &&
                node.props.style?.height === "100%",
        )!;
}
beforeEach(() => {
    Object.assign(globalThis, {
        IS_REACT_ACT_ENVIRONMENT: true,
        IS_REACT_NATIVE_TEST_ENVIRONMENT: true,
    });
    runtime = loadSheetRuntime();
    ref = React.createRef<ActionSheetRef>();
    props = {
        isModal: false,
        backgroundInteractionEnabled: true,
        snapPoints: [0, 100],
        initialSnapIndex: 0,
        closable: false,
        closeOnPressBack: false,
        closeOnTouchBackdrop: false,
        gestureEnabled: false,
        keyboardHandlerEnabled: false,
        animated: true,
        onOpen: jest.fn(),
        onClose: jest.fn(),
        onRequestClose: () => false,
    };
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
});

it("balances listeners through StrictMode rerenders, viewport relayout, hide, and reopen", async () => {
    await render();
    expect(runtime.listeners).toHaveLength(0);
    await act(async () => ref.current!.show(0));
    expect(runtime.listeners).toHaveLength(1);
    const initialListener = runtime.listeners[0];
    await act(async () => viewportRoot().props.onLayout());
    await render("updated body");
    // An actual vendor rerender changes its Back callback. Effect cleanup and
    // re-setup must retain one subscription without requiring another layout.
    expect(runtime.listeners).toHaveLength(1);
    expect(runtime.listeners[0]).not.toBe(initialListener);
    await act(async () => viewportRoot().props.onLayout());
    await act(async () => viewportRoot().props.onLayout());
    expect(runtime.listeners).toHaveLength(1);
    expect(props.onOpen).toHaveBeenCalledTimes(3);
    await act(async () => {
        ref.current!.hide();
        await new Promise((resolve) => setTimeout(resolve, 220));
    });
    expect(runtime.listeners).toHaveLength(0);
    await act(async () => ref.current!.show(1));
    expect(runtime.listeners).toHaveLength(1);
    // Unmount cleanup runs without the Devices host forcing another hide.
    await act(async () => renderer!.unmount());
    renderer = undefined;
    expect(runtime.listeners).toHaveLength(0);
});

it("keeps native modal sheets out of Android Back registration", async () => {
    props.isModal = true;
    props.backgroundInteractionEnabled = false;
    await render();
    await act(async () => ref.current!.show());
    expect(runtime.listeners).toHaveLength(0);
    props.backgroundInteractionEnabled = true;
    await render();
    expect(runtime.listeners).toHaveLength(1);
    props.backgroundInteractionEnabled = false;
    await render();
    expect(runtime.listeners).toHaveLength(0);
    await act(async () => renderer!.unmount());
    renderer = undefined;
    expect(runtime.listeners).toHaveLength(0);
});
