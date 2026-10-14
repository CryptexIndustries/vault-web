import { useEffect, useState } from "react";
import { View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useAtomValue } from "jotai";

import { AUTO_CONNECT_KEY } from "@/components/sync-controller-provider";
import { ConnectivityPanel } from "@/components/devices/connectivity-panel";
import { Switch } from "@/components/ui/switch";
import {
    UnlockedTaskScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { unlockedVaultAtom } from "@/utils/atoms";
import { colors } from "@/theme";

export default function ConnectivityScreen() {
    const vault = useAtomValue(unlockedVaultAtom);
    const [autoConnect, setAutoConnect] = useState(false);

    useEffect(() => {
        void AsyncStorage.getItem(AUTO_CONNECT_KEY).then((value) => {
            setAutoConnect(value === "1");
        });
    }, []);

    const toggleAutoConnect = async (value: boolean) => {
        setAutoConnect(value);
        await AsyncStorage.setItem(AUTO_CONNECT_KEY, value ? "1" : "0");
    };

    return (
        <UnlockedTaskScreen title="Connection settings">
            <View
                style={{
                    paddingBottom: 22,
                    marginBottom: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                }}
            >
                <Text
                    style={{
                        marginTop: 10,
                        fontSize: 22,
                        fontWeight: "500",
                        letterSpacing: -0.5,
                    }}
                >
                    Sync connection
                </Text>
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 13,
                        lineHeight: 20,
                        marginTop: 6,
                    }}
                >
                    Choose how your devices find and connect to each other.
                </Text>
            </View>
            <View
                style={{
                    minHeight: 64,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                }}
            >
                <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14 }}>Auto-connect devices</Text>
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 12,
                            marginTop: 5,
                        }}
                    >
                        Connect reachable devices while this app is open.
                    </Text>
                </View>
                <Switch
                    value={autoConnect}
                    onValueChange={(value) => void toggleAutoConnect(value)}
                    accessibilityLabel="Auto-connect devices"
                />
            </View>
            <ConnectivityPanel
                stunServers={vault.LinkedDevices.STUNServers}
                turnServers={vault.LinkedDevices.TURNServers}
                signalingServers={vault.LinkedDevices.SignalingServers}
                route="root"
                onRouteChange={(route) => {
                    if (route === "stun") {
                        router.push("/(app)/devices/connectivity/stun");
                    } else if (route === "turn") {
                        router.push("/(app)/devices/connectivity/turn");
                    } else if (route === "signaling") {
                        router.push("/(app)/devices/connectivity/signaling");
                    }
                }}
            />
        </UnlockedTaskScreen>
    );
}
