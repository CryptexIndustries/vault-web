import { View } from "react-native";
import { useLingui } from "@lingui/react/macro";

import {
    UnlockedButton as Button,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

export function BillingPendingNotice({
    busy = false,
    onCheckStatus,
    message,
}: {
    busy?: boolean;
    message?: string;
    onCheckStatus: () => void;
}) {
    const { t } = useLingui();
    return (
        <View style={{ gap: 12 }}>
            <Text
                accessibilityLiveRegion="polite"
                style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}
            >
                {message ?? t`Confirming your subscription…`}
            </Text>
            <Button
                variant="outline"
                loading={busy}
                disabled={busy}
                onPress={onCheckStatus}
            >
                {t`Check status`}
            </Button>
        </View>
    );
}
