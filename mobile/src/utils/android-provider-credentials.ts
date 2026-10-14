import type { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";
import type { AndroidProviderCredential } from "@/utils/android-credentials";

export function buildAndroidProviderCredentials(
    credentials: readonly VaultCredential[],
): AndroidProviderCredential[] {
    return credentials
        .filter((credential) => !credential.Deleted)
        .map((credential) => ({
            vaultId: credential.ID,
            name: credential.Name,
            username: credential.Username || undefined,
            rpId: credential.Passkey?.RPID || undefined,
            passkeyCredentialId: credential.Passkey?.CredentialID || undefined,
            passkeyDiscoverable: credential.Passkey?.Discoverable ?? undefined,
            passkeyUsername: credential.Passkey?.UserName || undefined,
            passkeyDisplayName:
                credential.Passkey?.UserDisplayName || undefined,
        }));
}
