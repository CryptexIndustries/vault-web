import * as React from "react";
import {
    Keyboard,
    type ScrollView,
    type TextInput,
    type View,
} from "react-native";

type ScrollFocusedInput = (input: TextInput | null) => void;

const KeyboardScrollContext = React.createContext<ScrollFocusedInput>(() => {});
type ScrollTarget = TextInput | View;
type ScrollToNode = (node: ScrollTarget | null, extraOffset?: number) => void;
const ScrollToNodeContext = React.createContext<ScrollToNode>(() => {});

export function KeyboardScrollProvider({
    scrollRef,
    contentRef,
    viewportHeight,
    children,
}: {
    scrollRef: React.RefObject<ScrollView | null>;
    contentRef?: React.RefObject<View | null>;
    /** Recheck focus after a task viewport resizes above its fixed footer. */
    viewportHeight?: number;
    children: React.ReactNode;
}) {
    const focusedInputRef = React.useRef<TextInput | null>(null);
    const scrollToNode = React.useCallback<ScrollToNode>(
        (node, extraOffset = 24) => {
            if (!node) return;
            const scrollView = scrollRef.current;
            const nativeScrollView = scrollView?.getNativeScrollRef();
            if (!scrollView || !nativeScrollView) return;
            if (viewportHeight !== undefined) {
                const content = contentRef?.current;
                if (!content) return;
                nativeScrollView.measureInWindow((_x, y, _width, height) => {
                    const keyboardTop = Keyboard.metrics()?.screenY ?? Infinity;
                    const visibleHeight = Math.min(height, keyboardTop - y);
                    node.measureLayout(
                        content,
                        (_left, top, _width, inputHeight) => {
                            scrollView.scrollTo({
                                y: Math.max(
                                    0,
                                    top +
                                        inputHeight -
                                        visibleHeight +
                                        extraOffset,
                                ),
                                animated: true,
                            });
                        },
                    );
                });
                return;
            }
            nativeScrollView.measureInWindow((_x, y) => {
                scrollView.scrollResponderScrollNativeHandleToKeyboard(
                    node as TextInput,
                    y + extraOffset,
                    true,
                );
            });
        },
        [scrollRef, contentRef, viewportHeight],
    );
    const scroll = React.useCallback(() => {
        const input = focusedInputRef.current;
        if (!input?.isFocused()) return;
        scrollToNode(input);
    }, [scrollToNode]);

    const scrollFocusedInput = React.useCallback<ScrollFocusedInput>(
        (input) => {
            if (!input) return;
            focusedInputRef.current = input;
            requestAnimationFrame(scroll);
        },
        [scroll],
    );

    React.useEffect(() => {
        const subscription = Keyboard.addListener("keyboardDidShow", scroll);
        const frame =
            viewportHeight !== undefined
                ? requestAnimationFrame(scroll)
                : undefined;
        return () => {
            subscription.remove();
            if (frame !== undefined) cancelAnimationFrame(frame);
        };
    }, [scroll, viewportHeight]);

    return (
        <KeyboardScrollContext.Provider value={scrollFocusedInput}>
            <ScrollToNodeContext.Provider value={scrollToNode}>
                {children}
            </ScrollToNodeContext.Provider>
        </KeyboardScrollContext.Provider>
    );
}

export function useScrollFocusedInput() {
    return React.useContext(KeyboardScrollContext);
}

export function useScrollToNode() {
    return React.useContext(ScrollToNodeContext);
}
