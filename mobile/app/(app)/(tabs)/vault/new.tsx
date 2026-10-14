import { useLocalSearchParams } from "expo-router";

import { CredentialForm } from "@/components/vault/credential-form";

export default function NewCredentialScreen() {
    const { directoryId } = useLocalSearchParams<{ directoryId?: string }>();
    return <CredentialForm initialDirectoryId={directoryId ?? ""} />;
}
