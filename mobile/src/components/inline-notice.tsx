import * as React from "react";
import {
    ActivityIndicator,
    Pressable,
    View,
    type ViewProps,
} from "react-native";
import { AlertCircle, CheckCircle2, Info } from "lucide-react-native";

import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { colors } from "@/theme";
import { useScrollToNode } from "@/components/keyboard-scroll";

type InlineNoticeTone = "info" | "success" | "error" | "loading" | "warning";

type InlineNoticeProps = ViewProps & {
    tone?: InlineNoticeTone;
    message: string;
    className?: string;
    autoScroll?: boolean;
    /** A way to fix the problem in place, shown under the message. */
    action?: { label: string; onPress: () => void; testID?: string };
};

const toneStyles: Record<
    InlineNoticeTone,
    {
        border: string;
        text: string;
        iconColor: string;
        /** Null shows a spinner. */
        Icon: typeof Info | null;
    }
> = {
    info: {
        border: "border-border",
        text: "text-muted-foreground",
        iconColor: colors.muted,
        Icon: Info,
    },
    success: {
        border: "border-[#25c472]/60",
        text: "text-[#25c472]",
        iconColor: colors.success,
        Icon: CheckCircle2,
    },
    error: {
        border: "border-destructive",
        text: "text-destructive-foreground",
        iconColor: colors.destructive,
        Icon: AlertCircle,
    },
    warning: {
        border: "border-primary/50",
        text: "text-foreground",
        iconColor: colors.primary,
        Icon: AlertCircle,
    },
    loading: {
        border: "border-border",
        text: "text-muted-foreground",
        iconColor: colors.muted,
        Icon: null,
    },
};

function InlineNotice({
    tone = "info",
    message,
    className,
    autoScroll = false,
    action,
    ...props
}: InlineNoticeProps) {
    const style = toneStyles[tone];
    const noticeRef = React.useRef<View>(null);
    const scrollToNode = useScrollToNode();

    React.useEffect(() => {
        if (!autoScroll) return;
        requestAnimationFrame(() => scrollToNode(noticeRef.current, 48));
    }, [autoScroll, message, scrollToNode]);

    return (
        <View
            ref={noticeRef}
            collapsable={false}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            className={cn(
                "flex-row items-start gap-2 rounded-md border bg-secondary/40 px-3 py-2.5",
                style.border,
                className,
            )}
            {...props}
        >
            {style.Icon ? (
                <Icon
                    as={style.Icon}
                    size={16}
                    color={style.iconColor}
                    className="mt-0.5"
                    accessibilityElementsHidden
                />
            ) : (
                <ActivityIndicator
                    size={16}
                    color={style.iconColor}
                    style={{ marginTop: 2 }}
                    importantForAccessibility="no"
                />
            )}
            <View className="flex-1">
                <Text className={cn("text-sm leading-5", style.text)}>
                    {message}
                </Text>
                {action ? (
                    <Pressable
                        testID={action.testID}
                        accessibilityRole="button"
                        onPress={action.onPress}
                        hitSlop={8}
                        className="mt-2 self-start"
                    >
                        <Text className="font-semibold text-sm text-primary">
                            {action.label}
                        </Text>
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
}

export { InlineNotice };
export type { InlineNoticeProps, InlineNoticeTone };
