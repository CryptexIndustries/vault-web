import { router, useLocalSearchParams } from "expo-router";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

import { ConnectivityPanel } from "@/components/devices/connectivity-panel";
import { InlineNotice } from "@/components/inline-notice";
import {
    UnlockedButton as Button,
    UnlockedTaskScreen,
} from "@/components/unlocked/unlocked-ui";
import { unlockedVaultAtom } from "@/utils/atoms";

export default function SignalingServerEditorScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const vault = useAtomValue(unlockedVaultAtom);
    const [deletingServerId, setDeletingServerId] = useState<string | null>(null);
    useEffect(() => setDeletingServerId(null), [id]);
    const exists =
        id === "new" ||
        vault.LinkedDevices.SignalingServers.some((server) => server.ID === id);
    return (
        <UnlockedTaskScreen title="Signaling servers">
            {/* A local deletion publishes the vault before the editor finishes navigating. */}
            {exists || deletingServerId === id ? (
                <ConnectivityPanel
                    stunServers={vault.LinkedDevices.STUNServers}
                    turnServers={vault.LinkedDevices.TURNServers}
                    signalingServers={vault.LinkedDevices.SignalingServers}
                    route="edit-signaling"
                    editingServerId={id}
                    nativeEditor
                    onDeletePendingChange={(pending) =>
                        setDeletingServerId(pending ? id : null)
                    }
                    onRouteChange={() => router.back()}
                />
            ) : (
                <>
                    <InlineNotice
                        tone="info"
                        message="This signaling server no longer exists."
                    />
                    <Button className="mt-6" onPress={() => router.back()}>
                        Back to signaling servers
                    </Button>
                </>
            )}
        </UnlockedTaskScreen>
    );
}
