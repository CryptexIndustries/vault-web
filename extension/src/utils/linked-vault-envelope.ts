import * as VaultUtilTypes from "@/app_lib/proto/vault";
import {
    EncryptedBlob,
    KeyDerivationConfig_Argon2ID,
} from "@/app_lib/vault-utils/encryption";
import { createEnvelopeEncryptedBlob } from "@/app_lib/vault-utils/vault-envelope-ops";

export type LinkedVaultEnvelopeOptions = {
    vaultId: string;
    masterPassword: string;
    kdfConfig: KeyDerivationConfig_Argon2ID;
};

export async function createLinkedVaultEnvelopeBlob(
    vaultBytes: Uint8Array,
    options: LinkedVaultEnvelopeOptions,
): Promise<EncryptedBlob> {
    const envelope = await createEnvelopeEncryptedBlob(
        vaultBytes,
        options.masterPassword,
        options.vaultId,
        {
            kind: VaultUtilTypes.SecondFactorKind.NONE,
            hkdfBaseKey: null,
        },
        options.kdfConfig,
    );

    return envelope.blob;
}
