import { useState } from "react";
import { useAtomValue } from "jotai";
import { useLingui } from "@lingui/react/macro";

import {
    ConnectivityPanel,
    type ConnectivityRoute,
} from "@/components/devices/connectivity-panel";
import { UnlockedTaskScreen } from "@/components/unlocked/unlocked-ui";
import { unlockedVaultAtom } from "@/utils/atoms";

export default function StunServersScreen() {
    const { t } = useLingui();
    const vault = useAtomValue(unlockedVaultAtom);
    const [route, setRoute] = useState<ConnectivityRoute>("stun");
    return (
        <UnlockedTaskScreen title={t`STUN servers`}>
            <ConnectivityPanel
                stunServers={vault.LinkedDevices.STUNServers}
                turnServers={vault.LinkedDevices.TURNServers}
                signalingServers={vault.LinkedDevices.SignalingServers}
                route={route}
                onRouteChange={setRoute}
            />
        </UnlockedTaskScreen>
    );
}
