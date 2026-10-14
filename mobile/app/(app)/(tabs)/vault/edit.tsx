import { useLocalSearchParams } from "expo-router";

import { CredentialForm } from "@/components/vault/credential-form";

export default function EditCredentialScreen() {
    const { id, directoryId } = useLocalSearchParams<{
        id?: string;
        directoryId?: string;
    }>();

    return (
        <CredentialForm
            credentialId={id}
            initialDirectoryId={directoryId ?? ""}
        />
    );
}
