import * as React from "react";
import {
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    View,
    type ScrollViewProps,
    type ViewProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { KeyboardScrollProvider } from "@/components/keyboard-scroll";
import { cn } from "@/lib/utils";
import { layout } from "@/theme";
import { UnlockedTaskHeader } from "@/components/unlocked/unlocked-ui";

type ScreenProps = ViewProps & {
    className?: string;
    scroll?: boolean;
    /** Constrain content width (forms / manager). */
    maxWidth?: number | "content" | "panel" | "none";
    /** Include bottom safe area (default true for scroll forms). */
    edges?: ("top" | "right" | "bottom" | "left")[];
    keyboardAvoiding?: boolean;
    contentContainerClassName?: string;
    scrollProps?: Omit<
        ScrollViewProps,
        "contentContainerClassName" | "children"
    >;
    taskTitle?: string;
    onTaskBack?: () => void;
};

function resolveMaxWidth(
    maxWidth: ScreenProps["maxWidth"],
): number | undefined {
    if (maxWidth === "none" || maxWidth == null) return undefined;
    if (maxWidth === "content") return layout.contentMaxWidth;
    if (maxWidth === "panel") return layout.panelMaxWidth;
    return maxWidth;
}

/**
 * App screen shell: safe areas, optional scroll, keyboard avoidance,
 * optional max-width column for tablet.
 */
export function Screen({
    children,
    className,
    scroll = false,
    maxWidth = "none",
    edges,
    keyboardAvoiding = true,
    contentContainerClassName,
    scrollProps,
    taskTitle,
    onTaskBack,
    style,
    ...props
}: ScreenProps) {
    const scrollRef = React.useRef<ScrollView>(null);
    const resolvedEdges =
        edges ??
        (scroll
            ? ["top", "left", "right", "bottom"]
            : ["top", "left", "right"]);
    const maxW = resolveMaxWidth(maxWidth);

    const body = scroll ? (
        <ScrollView
            ref={scrollRef}
            className="flex-1"
            contentContainerClassName={cn(
                "px-4 pb-6 pt-3",
                contentContainerClassName,
            )}
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            {...scrollProps}
        >
            <KeyboardScrollProvider scrollRef={scrollRef}>
                <View
                    className={cn("w-full", className)}
                    style={[
                        maxW != null
                            ? { maxWidth: maxW, alignSelf: "center" }
                            : undefined,
                        style,
                    ]}
                    {...props}
                >
                    {children}
                </View>
            </KeyboardScrollProvider>
        </ScrollView>
    ) : (
        <View
            className={cn("flex-1 px-4 pb-4 pt-3", className)}
            style={[
                maxW != null
                    ? { maxWidth: maxW, alignSelf: "center", width: "100%" }
                    : undefined,
                style,
            ]}
            {...props}
        >
            {children}
        </View>
    );

    const wrapped = keyboardAvoiding ? (
        <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
        >
            {body}
        </KeyboardAvoidingView>
    ) : (
        body
    );

    return (
        <SafeAreaView className="flex-1 bg-background" edges={resolvedEdges}>
            {taskTitle ? (
                <UnlockedTaskHeader title={taskTitle} onBack={onTaskBack} />
            ) : null}
            {wrapped}
        </SafeAreaView>
    );
}
