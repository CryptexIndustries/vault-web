import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, View } from "react-native";
import { X } from "lucide-react-native";
import { useLingui } from "@lingui/react/macro";

import { UnlockedText as Text } from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

export type FeedbackAction = {
    label: string;
    onPress: () => void | Promise<void>;
};

type SnackbarMessage = {
    id: number;
    message: string;
    action?: FeedbackAction;
};

/** Feedback belongs to one account/sheet lifetime. Actions remain until dismissed. */
export function useSnackbar(scope: string | number, active = true) {
    const [entry, setEntry] = useState<
        (SnackbarMessage & { scope: string | number }) | null
    >(null);
    const nextId = useRef(0);
    const mounted = useRef(true);
    const lifetime = useRef({ scope, active, revision: 0 });
    if (lifetime.current.scope !== scope || lifetime.current.active !== active)
        lifetime.current = {
            scope,
            active,
            revision: lifetime.current.revision + 1,
        };
    const revision = lifetime.current.revision;
    const dismiss = useCallback(() => setEntry(null), []);
    const show = useCallback(
        (message: string, action?: FeedbackAction) => {
            if (
                mounted.current &&
                active &&
                lifetime.current.revision === revision
            )
                setEntry({ id: ++nextId.current, scope, message, action });
        },
        [active, scope, revision],
    );
    useEffect(dismiss, [scope, active, dismiss]);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    return {
        feedback: active && entry?.scope === scope ? entry : null,
        show,
        dismiss,
    };
}

export function Snackbar({
    feedback,
    onDismiss,
    floating = true,
    bottomOffset = 12,
}: {
    feedback: SnackbarMessage | null;
    onDismiss: () => void;
    floating?: boolean;
    /** Distance from the bottom edge; screens without a tab bar add the safe-area inset. */
    bottomOffset?: number;
}) {
    const { t } = useLingui();
    useEffect(() => {
        if (!feedback) return;
        // Android's live region handles its announcement. iOS needs an explicit one.
        if (Platform.OS === "ios")
            AccessibilityInfo.announceForAccessibility(feedback.message);
        if (feedback.action) return;
        let current = true;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const schedule = (duration: number) => {
            if (current)
                timeout = setTimeout(onDismiss, Math.max(8000, duration));
        };
        if (AccessibilityInfo.getRecommendedTimeoutMillis) {
            void AccessibilityInfo.getRecommendedTimeoutMillis(8000).then(
                schedule,
                () => schedule(8000),
            );
        } else schedule(8000);
        return () => {
            current = false;
            clearTimeout(timeout);
        };
    }, [feedback, onDismiss]);
    if (!feedback) return null;
    return (
        <View
            testID="snackbar"
            pointerEvents="box-none"
            style={
                floating
                    ? {
                          position: "absolute",
                          left: 18,
                          right: 18,
                          bottom: bottomOffset,
                          zIndex: 2,
                      }
                    : { marginHorizontal: 18, marginBottom: 12 }
            }
        >
            <View
                style={{
                    backgroundColor: colors.secondary,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: 14,
                    paddingLeft: 18,
                    paddingVertical: 10,
                    paddingRight: 6,
                    elevation: 8,
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: 0.25,
                    shadowRadius: 8,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                }}
            >
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Text
                        accessibilityLiveRegion="polite"
                        style={{ fontSize: 13, lineHeight: 20 }}
                    >
                        {feedback.message}
                    </Text>
                    {feedback.action ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={feedback.action.label}
                            onPress={() => {
                                const action = feedback.action!;
                                onDismiss();
                                void action.onPress();
                            }}
                            style={{
                                minHeight: 48,
                                minWidth: 48,
                                justifyContent: "center",
                                alignSelf: "flex-start",
                                paddingRight: 12,
                            }}
                        >
                            <Text
                                style={{
                                    color: colors.primary,
                                    fontSize: 13,
                                    fontWeight: "600",
                                }}
                            >
                                {feedback.action.label}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t`Dismiss message`}
                    onPress={onDismiss}
                    style={{
                        minWidth: 48,
                        minHeight: 48,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <X size={18} color={colors.muted} />
                </Pressable>
            </View>
        </View>
    );
}
