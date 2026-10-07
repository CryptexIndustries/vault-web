import { router } from "expo-router";
import { useAtomValue } from "jotai";

import { ConnectivityPanel } from "@/components/devices/connectivity-panel";
import { UnlockedTaskScreen } from "@/components/unlocked/unlocked-ui";
import { unlockedVaultAtom } from "@/utils/atoms";

export default function TurnServersScreen() {
    const vault = useAtomValue(unlockedVaultAtom);
    return (
        <UnlockedTaskScreen title="TURN servers">
            <ConnectivityPanel
                stunServers={vault.LinkedDevices.STUNServers}
                turnServers={vault.LinkedDevices.TURNServers}
                signalingServers={vault.LinkedDevices.SignalingServers}
                route="turn"
                onRouteChange={(_, id) =>
                    router.push({
                        pathname: "/(app)/devices/connectivity/turn/[id]",
                        params: { id: id ?? "new" },
                    })
                }
            />
        </UnlockedTaskScreen>
    );
}
