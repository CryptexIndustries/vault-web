import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    EncryptedBlob,
    KeyDerivationConfig_Argon2ID,
} from "@cryptex-industries/vault-core/vault-utils/encryption";
import { createEnvelopeEncryptedBlob } from "@cryptex-industries/vault-core/vault-utils/vault-envelope-ops";
import {
    enrollAdditionalKeyProtection,
    type AdditionalKeyProtectionEnrollmentResult,
    type AdditionalKeyProtectionSource,
} from "@cryptex-industries/vault-core/vault-utils/additional-key-protection";

export type LinkedVaultEnvelopeOptions = {
    vaultId: string;
    masterPassword: string;
    kdfConfig: KeyDerivationConfig_Argon2ID;
    additionalKeyProtection?: AdditionalKeyProtectionSource;
};

export type LinkedVaultEnvelopeResult = {
    blob: EncryptedBlob;
    recoveryCode: string;
    protectionPhrase?: string;
    enrolledProtection: AdditionalKeyProtectionEnrollmentResult;
};

export async function createLinkedVaultEnvelope(
    vaultBytes: Uint8Array,
    options: LinkedVaultEnvelopeOptions,
): Promise<LinkedVaultEnvelopeResult> {
    const additionalKeyProtection = options.additionalKeyProtection ?? {
        kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
    };
    const enrolledProtection = await enrollAdditionalKeyProtection(
        additionalKeyProtection,
        options.vaultId,
        undefined,
        options.kdfConfig,
    );
    const envelope = await createEnvelopeEncryptedBlob(
        vaultBytes,
        options.masterPassword,
        options.vaultId,
        enrolledProtection,
        options.kdfConfig,
    );

    return {
        blob: envelope.blob,
        recoveryCode: envelope.recoveryCode,
        protectionPhrase: envelope.protectionPhrase,
        enrolledProtection,
    };
}
