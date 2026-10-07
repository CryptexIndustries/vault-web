import { router } from "expo-router";
import { useAtomValue } from "jotai";

import { ConnectivityPanel } from "@/components/devices/connectivity-panel";
import { UnlockedTaskScreen } from "@/components/unlocked/unlocked-ui";
import { unlockedVaultAtom } from "@/utils/atoms";

export default function SignalingServersScreen() {
    const vault = useAtomValue(unlockedVaultAtom);
    return (
        <UnlockedTaskScreen title="Signaling servers">
            <ConnectivityPanel
                stunServers={vault.LinkedDevices.STUNServers}
                turnServers={vault.LinkedDevices.TURNServers}
                signalingServers={vault.LinkedDevices.SignalingServers}
                route="signaling"
                onRouteChange={(_, id) =>
                    router.push({
                        pathname: "/(app)/devices/connectivity/signaling/[id]",
                        params: { id: id ?? "new" },
                    })
                }
            />
        </UnlockedTaskScreen>
    );
}
