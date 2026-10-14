import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";

import { UnlockedTaskScreen } from "@/components/unlocked/unlocked-ui";
import { VaultSecurityDialog } from "@/components/vault-security/vault-security-dialog";

type SecurityMode = "password" | "protection" | "recovery" | "kdf";
type SecurityStage = "main" | "protection-phrase" | "vault-code";

function readMode(value: string | string[] | undefined): SecurityMode {
    const mode = Array.isArray(value) ? value[0] : value;
    return mode === "protection" || mode === "recovery" || mode === "kdf"
        ? mode
        : "password";
}

export default function VaultSecurityActionScreen() {
    const params = useLocalSearchParams<{ mode?: string | string[] }>();
    const navigation = useNavigation();
    const mode = readMode(params.mode);
    const [stage, setStage] = useState<SecurityStage>("main");
    const [canLeave, setCanLeave] = useState(true);

    useEffect(() => {
        navigation.setOptions({ gestureEnabled: canLeave });
    }, [canLeave, navigation]);

    usePreventRemove(!canLeave, () => {
        Alert.alert(
            "Save this secret first",
            "Acknowledge that you saved the generated secret before leaving.",
        );
    });

    const title =
        stage === "protection-phrase"
            ? "Save protection phrase"
            : stage === "vault-code"
              ? "Save vault recovery code"
              : mode === "password"
                ? "Change master password"
                : mode === "protection"
                  ? "Additional protection"
                  : mode === "recovery"
                    ? "Vault recovery code"
                    : "Encryption settings";

    return (
        <UnlockedTaskScreen title={title} onBack={() => router.back()}>
            <VaultSecurityDialog
                mode={mode}
                onStageChange={setStage}
                onCanLeaveChange={setCanLeave}
            />
        </UnlockedTaskScreen>
    );
}
