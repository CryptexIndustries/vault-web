import { useEffect, useState } from "react";
import { AppState, View } from "react-native";

import { InlineNotice } from "@/components/inline-notice";
import { agentService } from "@/agent/agent-service";

function notificationsOff() {
    return agentService.available && !agentService.notificationsEnabled();
}

/**
 * Without notifications, requests that come in while the app is closed or
 * locked wait unseen until they expire. Checked again whenever the app comes
 * back.
 */
export function AgentNotificationsNotice({ style }: { style?: object }) {
    const [off, setOff] = useState(notificationsOff);
    useEffect(() => {
        setOff(notificationsOff());
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") setOff(notificationsOff());
        });
        return () => subscription.remove();
    }, []);
    if (!off) return null;
    return (
        <View style={style}>
            <InlineNotice
                testID="agent-notifications-off"
                tone="warning"
                message="Notifications are off for Cryptex Vault. SSH requests that come in while the app is closed or locked can't reach you."
                action={{
                    label: "Open notification settings",
                    testID: "agent-notifications-settings",
                    onPress: () => void agentService.openNotificationSettings(),
                }}
            />
        </View>
    );
}
