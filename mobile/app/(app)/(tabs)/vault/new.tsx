import { useLocalSearchParams } from "expo-router";

import { CredentialForm } from "@/components/vault/credential-form";

export default function NewCredentialScreen() {
    const { directoryId, type } = useLocalSearchParams<{
        directoryId?: string;
        type?: string;
    }>();
    return (
        <CredentialForm
            initialDirectoryId={directoryId ?? ""}
            itemType={type === "ssh-key" ? "ssh-key" : "login"}
        />
    );
}
