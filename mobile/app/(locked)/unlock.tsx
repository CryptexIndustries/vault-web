import { useLocalSearchParams } from "expo-router";

import { VaultManager } from "@/components/vault-manager";

export default function UnlockScreen() {
    const params = useLocalSearchParams<{
        returnTo?: string;
        restored?: string;
    }>();
    return (
        <VaultManager
            tab="unlock"
            returnTo={
                Array.isArray(params.returnTo)
                    ? params.returnTo[0]
                    : params.returnTo
            }
            restoredGuidance={params.restored === "1"}
        />
    );
}
