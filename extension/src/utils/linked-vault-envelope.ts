import * as VaultUtilTypes from "@/app_lib/proto/vault";
import {
    EncryptedBlob,
    KeyDerivationConfig_Argon2ID,
} from "@/app_lib/vault-utils/encryption";
import {
    buildKeyEnvelope,
    buildKekInfo,
    deriveKEK,
    derivePasswordKey,
    encodeSlot,
    encryptWithDEK,
    ENVELOPE_VERSION,
    generateExtractableDEK,
    generateRandomSalt,
    wrapDEK,
} from "@/app_lib/vault-utils/envelope-encryption";
import { createEnvelopeEncryptedBlob } from "@/app_lib/vault-utils/vault-envelope-ops";
import { uint8ToBase64 } from "@/lib/utils";

export type LinkedVaultEnvelopeOptions = {
    vaultId: string;
    masterPassword: string;
    kdfConfig: KeyDerivationConfig_Argon2ID;
};

export async function createLinkedVaultEnvelopeBlob(
    vaultBytes: Uint8Array,
    options: LinkedVaultEnvelopeOptions,
): Promise<EncryptedBlob> {
    // const primarySalt = generateRandomSalt();
    // const hkdfSaltNo2fa = generateRandomSalt();

    // const pwKey = await derivePasswordKey(
    //     options.masterPassword,
    //     primarySalt,
    //     options.kdfConfig,
    // );
    // const primaryKek = await deriveKEK(
    //     pwKey,
    //     buildKekInfo(options.vaultId),
    //     null,
    //     hkdfSaltNo2fa,
    // );

    // const dekExtractable = await generateExtractableDEK();
    // const wrappedPrimary = await wrapDEK(dekExtractable, primaryKek);
    // const { ciphertext, iv } = await encryptWithDEK(dekExtractable, vaultBytes);

    // const envelope = buildKeyEnvelope(
    //     [
    //         encodeSlot(
    //             VaultUtilTypes.KeySlotKind.PRIMARY,
    //             VaultUtilTypes.SecondFactorKind.NONE,
    //             wrappedPrimary,
    //             primarySalt,
    //             options.kdfConfig,
    //             hkdfSaltNo2fa,
    //             options.vaultId,
    //         ),
    //     ],
    //     VaultUtilTypes.SecondFactorKind.NONE,
    //     options.vaultId,
    // );

    // const blob = EncryptedBlob.CreateDefault();
    // blob.Version = ENVELOPE_VERSION;
    // blob.CurrentVersion = ENVELOPE_VERSION;
    // blob.Algorithm = VaultUtilTypes.EncryptionAlgorithm.AES256;
    // blob.KeyDerivationFunc = VaultUtilTypes.KeyDerivationFunction.Argon2ID;
    // blob.KDFConfigArgon2ID = {
    //     memLimit: options.kdfConfig.memLimit,
    //     opsLimit: options.kdfConfig.opsLimit,
    // };
    // blob.KDFConfigPBKDF2 = undefined;
    // blob.Blob = ciphertext;
    // blob.Salt = uint8ToBase64(primarySalt);
    // blob.HeaderIV = iv;
    // blob.Envelope = envelope;

    // return blob;
    const envelope = await createEnvelopeEncryptedBlob(
        vaultBytes,
        options.masterPassword,
        options.vaultId,
        {
            kind: VaultUtilTypes.SecondFactorKind.NONE,
            hkdfBaseKey: null,
            // passphraseSalt: "",
            // displaySecret: "",
            // webauthnCredentialId: "",
            // webauthnPrfSalt: "",
        },
        options.kdfConfig,
    );

    return envelope.blob;
}
