import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { createElement, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { Input } from "@/components/ui/input";

jest.mock("react-native", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    const NativeInput = React.forwardRef((props, ref) =>
        React.createElement("TextInput", { ...props, ref }),
    );
    let StyledInput: typeof NativeInput;
    const appStateListeners = new Set<(state: string) => void>();
    return {
        TextInput: React.forwardRef((props, ref) => {
            StyledInput ??=
                require("react-native-css-interop/dist/runtime/native/api").cssInterop(
                    NativeInput,
                    { className: "style" },
                );
            return React.createElement(StyledInput, { ...props, ref });
        }),
        View: "View",
        Pressable: "Pressable",
        Platform: {
            OS: "android",
            select: (options: Record<string, unknown>) => options.android,
        },
        AppState: {
            currentState: "active",
            addEventListener: (
                _event: string,
                listener: (state: string) => void,
            ) => {
                appStateListeners.add(listener);
                return { remove: () => appStateListeners.delete(listener) };
            },
        },
        emitAppState: (state: string) => {
            for (const listener of appStateListeners) listener(state);
        },
        Appearance: {
            getColorScheme: () => "dark",
            addChangeListener: () => ({ remove() {} }),
        },
        AccessibilityInfo: {
            isReduceMotionEnabled: () => Promise.resolve(false),
            addEventListener: () => ({ remove() {} }),
        },
        Dimensions: {
            get: () => ({ width: 400, height: 800 }),
            addEventListener: () => ({ remove() {} }),
        },
        PixelRatio: { getFontScale: () => 1, get: () => 1 },
        StyleSheet: { flatten: (style: unknown) => style },
    };
});
jest.mock("lucide-react-native", () => ({
    Dices: "Dices",
    Eye: "Eye",
    EyeOff: "EyeOff",
}));
jest.mock("@/components/ui/icon", () => ({ Icon: "Icon" }));
jest.mock("@/components/keyboard-scroll", () => ({
    useScrollFocusedInput: () => () => {},
}));
jest.mock("@/lib/utils", () => ({
    cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
    (
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
        globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }
    ).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
});
afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    jest.restoreAllMocks();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean })
        .IS_REACT_NATIVE_TEST_ENVIRONMENT;
});

describe("controlled input updates", () => {
    it.each([false, true])(
        "reuses resolved styles while typing, deleting and clearing, secure=%s",
        async (secure) => {
            const styles = require("react-native-css-interop/dist/runtime/native/styles");
            const resolveClass = jest.spyOn(styles, "getStyle");
            function Field() {
                const [value, setValue] = useState("");
                return createElement(Input, {
                    value,
                    onChangeText: setValue,
                    secureTextEntry: secure,
                });
            }
            await act(async () => {
                renderer = create(createElement(Field));
            });
            expect(resolveClass).toHaveBeenCalled();
            resolveClass.mockClear();
            const originalStyle = renderer!.root.findByType(
                "TextInput" as never,
            ).props.style;
            for (const value of ["a", "account", "accoun", ""]) {
                await act(async () =>
                    renderer!.root
                        .findByType("TextInput" as never)
                        .props.onChangeText(value),
                );
                const input = renderer!.root.findByType("TextInput" as never);
                expect(input.props.value).toBe(value);
                expect(input.props.secureTextEntry).toBe(secure);
                expect(input.props.style).toBe(originalStyle);
            }
            expect(resolveClass).not.toHaveBeenCalled();
        },
    );

    it("applies programmatic values and genuine caller style changes", async () => {
        const firstStyle = { fontFamily: "sans-serif", fontSize: 16 };
        await act(async () => {
            renderer = create(
                createElement(Input, { value: "prefilled", style: firstStyle }),
            );
        });
        const originalStyle = renderer!.root.findByType("TextInput" as never)
            .props.style;
        await act(async () =>
            renderer!.update(
                createElement(Input, { value: "", style: firstStyle }),
            ),
        );
        let input = renderer!.root.findByType("TextInput" as never);
        expect(input.props.value).toBe("");
        expect(input.props.style).toBe(originalStyle);

        await act(async () =>
            renderer!.update(
                createElement(Input, {
                    value: "restored",
                    invalid: true,
                    style: { fontFamily: "monospace", fontSize: 20 },
                }),
            ),
        );
        input = renderer!.root.findByType("TextInput" as never);
        expect(input.props.value).toBe("restored");
        expect(input.props.style).toMatchObject({
            fontFamily: "monospace",
            fontSize: 20,
        });
        expect(input.props["aria-invalid"]).toBe(true);
    });

    it("preserves selection when revealing and masks again on blur or background", async () => {
        const nativeInput = {
            isFocused: () => true,
            focus: jest.fn(),
            setNativeProps: jest.fn(),
        };
        const animationFrame = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = (callback) => {
            callback(0);
            return 0;
        };
        try {
            await act(async () => {
                renderer = create(
                    createElement(Input, {
                        value: "secret",
                        secureTextEntry: true,
                        accessibilityLabel: "Password",
                    }),
                    {
                        createNodeMock: (node) =>
                            node.type === "TextInput" ? nativeInput : null,
                    },
                );
            });
            const input = () => renderer!.root.findByType("TextInput" as never);
            const reveal = () =>
                renderer!.root.findByType("Pressable" as never).props.onPress();
            input().props.onSelectionChange({
                nativeEvent: { selection: { start: 2, end: 4 } },
            });
            await act(async () => reveal());
            expect(input().props.secureTextEntry).toBe(false);
            expect(nativeInput.setNativeProps).toHaveBeenCalledWith({
                selection: { start: 2, end: 4 },
            });
            await act(async () => input().props.onBlur({}));
            expect(input().props.secureTextEntry).toBe(true);
            await act(async () => reveal());
            expect(input().props.secureTextEntry).toBe(false);
            await act(async () =>
                require("react-native").emitAppState("background"),
            );
            expect(input().props.secureTextEntry).toBe(true);
            expect(input().props.value).toBe("secret");
        } finally {
            if (animationFrame)
                globalThis.requestAnimationFrame = animationFrame;
            else
                delete (
                    globalThis as Partial<
                        Pick<typeof globalThis, "requestAnimationFrame">
                    >
                ).requestAnimationFrame;
        }
    });
});
