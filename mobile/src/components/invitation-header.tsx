import type { ReactNode } from "react";
import { View } from "react-native";
import { UnlockedText } from "@/components/unlocked/unlocked-ui";

export function InvitationHeader({
    title,
    children,
}: {
    title: ReactNode;
    children: ReactNode;
}) {
    return (
        <View className="mb-1 border-b border-border pb-[22px]">
            <UnlockedText
                style={{
                    marginTop: 10,
                    fontSize: 22,
                    fontWeight: "500",
                    letterSpacing: -0.5,
                }}
            >
                {title}
            </UnlockedText>
            <UnlockedText className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                {children}
            </UnlockedText>
        </View>
    );
}
