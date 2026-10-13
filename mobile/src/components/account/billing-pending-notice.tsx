import { View } from "react-native";

import {
    UnlockedButton as Button,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

export function BillingPendingNotice({
    busy = false,
    onCheckStatus,
    message = "Confirming your subscription…",
}: {
    busy?: boolean;
    message?: string;
    onCheckStatus: () => void;
}) {
    return (
        <View style={{ gap: 12 }}>
            <Text
                accessibilityLiveRegion="polite"
                style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}
            >
                {message}
            </Text>
            <Button
                variant="outline"
                loading={busy}
                disabled={busy}
                onPress={onCheckStatus}
            >
                Check status
            </Button>
        </View>
    );
}
