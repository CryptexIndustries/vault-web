/** Additional key protection enrollment and unlock helpers. */

import * as VaultUtilTypes from "../proto/vault";
import {
    deriveAdditionalKeyProtectionKeyMaterial,
    importHkdfBaseKey,
} from "./envelope-encryption";
import { KeyDerivationConfig_Argon2ID } from "./encryption";
import { generateRandomSalt } from "./envelope-encryption";
import { base64ToUint8, uint8ToBase64 as b64 } from "../encoding";
import { getAdditionalKeyProtectionStore } from "../runtime";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { generateMnemonic } from "@scure/bip39";
import type { VaultHkdfKey } from "../envelope-crypto";

export type AdditionalKeyProtectionSource =
    | { kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE }
    | {
          kind:
              | VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128
              | VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_256;
      }
    | { kind: VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF };

export type AdditionalKeyProtectionEnrollmentResult = {
    kind: VaultUtilTypes.AdditionalKeyProtectionKind;
    /** Shown once when the generated-phrase option is enrolled. */
    protectionPhrase?: string;
    hkdfBaseKey: VaultHkdfKey | null;
    /** Generated phrases only: base64 KDF salt needed to reproduce the key. */
    protectionPhraseSalt?: string;
    /** WebAuthn PRF only: base64 credential id, needed to persist + unlock. */
    webauthnCredentialId?: string;
    /** WebAuthn PRF only: base64 PRF salt, needed to reproduce PRF on unlock. */
    webauthnPrfSalt?: string;
};

const PROTECTION_PHRASE_ENTROPY_BITS: Record<number, number> = {
    [VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128]: 128,
    [VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_256]: 256,
};

function isProtectionPhraseKind(
    kind: VaultUtilTypes.AdditionalKeyProtectionKind,
): boolean {
    return (
        kind ===
            VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_128 ||
        kind ===
            VaultUtilTypes.AdditionalKeyProtectionKind.PROTECTION_PHRASE_256
    );
}

export async function deriveProtectionPhraseKey(
    protectionPhrase: string,
    saltB64: string,
    kdfConfig = new KeyDerivationConfig_Argon2ID(),
): Promise<VaultHkdfKey> {
    const secretBytes = new TextEncoder().encode(protectionPhrase);
    let derived: Uint8Array | null = null;
    try {
        derived = await deriveAdditionalKeyProtectionKeyMaterial(
            secretBytes,
            base64ToUint8(saltB64),
            kdfConfig,
        );
        return await importHkdfBaseKey(derived);
    } finally {
        secretBytes.fill(0);
        derived?.fill(0);
    }
}

export async function enrollAdditionalKeyProtection(
    source: AdditionalKeyProtectionSource,
    vaultId: string,
    vaultDbIndex?: number,
    kdfConfig = new KeyDerivationConfig_Argon2ID(),
): Promise<AdditionalKeyProtectionEnrollmentResult> {
    if (source.kind === VaultUtilTypes.AdditionalKeyProtectionKind.NONE) {
        return {
            kind: VaultUtilTypes.AdditionalKeyProtectionKind.NONE,
            hkdfBaseKey: null,
        };
    }

    if (isProtectionPhraseKind(source.kind)) {
        const secret = generateMnemonic(
            wordlist,
            PROTECTION_PHRASE_ENTROPY_BITS[source.kind],
        );
        const secretBytes = new TextEncoder().encode(secret);

        const salt = generateRandomSalt();
        const saltB64 = b64(salt);
        let derived: Uint8Array | null = null;
        try {
            derived = await deriveAdditionalKeyProtectionKeyMaterial(
                secretBytes,
                salt,
                kdfConfig,
            );
            const hkdfBaseKey = await importHkdfBaseKey(derived);
            if (vaultDbIndex != null && vaultDbIndex >= 0) {
                const store = getAdditionalKeyProtectionStore();
                if (store.setDeviceAdditionalKeyProtectionRawKey) {
                    await store.setDeviceAdditionalKeyProtectionRawKey(
                        vaultDbIndex,
                        derived,
                        source.kind,
                    );
                } else {
                    await store.setDeviceAdditionalKeyProtectionKey(
                        vaultDbIndex,
                        hkdfBaseKey,
                        source.kind,
                    );
                }
            }

            return {
                kind: source.kind,
                protectionPhrase: secret,
                hkdfBaseKey,
                protectionPhraseSalt: saltB64,
            };
        } finally {
            secretBytes.fill(0);
            derived?.fill(0);
        }
    }

    if (
        source.kind !== VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF
    ) {
        throw new Error("ADDITIONAL_KEY_PROTECTION_UNSUPPORTED");
    }
    return enrollWebAuthnPrf(vaultId);
}

export async function resolveAdditionalKeyProtectionForUnlock(
    vaultDbIndex: number | undefined,
    envelopeKind: VaultUtilTypes.AdditionalKeyProtectionKind,
    options?: {
        /** User-entered phrase, needed after backup restore or cache loss. */
        protectionPhrase?: string;
        /** Non-secret salt stored in the primary slot. */
        protectionPhraseSaltB64?: string;
        /** KDF config used when the protection phrase was enrolled. */
        protectionPhraseKdfConfig?: KeyDerivationConfig_Argon2ID;
        /** Required for WebAuthn PRF each unlock. */
        webAuthnUnlock?: () => Promise<VaultHkdfKey>;
    },
): Promise<VaultHkdfKey | null> {
    if (envelopeKind === VaultUtilTypes.AdditionalKeyProtectionKind.NONE) {
        return null;
    }

    if (isProtectionPhraseKind(envelopeKind)) {
        if (options?.protectionPhrase && options.protectionPhraseSaltB64) {
            return deriveProtectionPhraseKey(
                options.protectionPhrase,
                options.protectionPhraseSaltB64,
                options.protectionPhraseKdfConfig,
            );
        }
        if (vaultDbIndex == null || vaultDbIndex < 0) {
            throw new Error("VAULT_DB_INDEX_MISSING");
        }
        return getAdditionalKeyProtectionStore().getDeviceAdditionalKeyProtectionKey(
            vaultDbIndex,
        );
    }

    if (
        envelopeKind === VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF
    ) {
        if (!options?.webAuthnUnlock) {
            throw new Error("WEBAUTHN_UNLOCK_REQUIRED");
        }
        return options.webAuthnUnlock();
    }

    throw new Error("ADDITIONAL_KEY_PROTECTION_UNSUPPORTED");
}

async function enrollWebAuthnPrf(
    vaultId: string,
): Promise<AdditionalKeyProtectionEnrollmentResult> {
    if (
        typeof window === "undefined" ||
        !window.PublicKeyCredential ||
        !PublicKeyCredential.getClientCapabilities
    ) {
        throw new Error("WEBAUTHN_UNAVAILABLE");
    }

    const caps = await PublicKeyCredential.getClientCapabilities();
    if (!caps["extension:prf"]) {
        throw new Error("WEBAUTHN_PRF_UNSUPPORTED");
    }

    const prfSalt = crypto.getRandomValues(new Uint8Array(16));
    const createOptions: PublicKeyCredentialCreationOptions = {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: {
            name: "Cryptex Vault",
            id: window.location.hostname,
        },
        user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: `vault-${vaultId}`,
            displayName: "Cryptex Vault Additional Key",
        },
        pubKeyCredParams: [{ alg: -7, type: "public-key" }],
        authenticatorSelection: {
            userVerification: "required",
            residentKey: "discouraged",
        },
        extensions: {
            prf: { eval: { first: prfSalt } },
        },
    };
    const credential = await navigator.credentials.create({
        publicKey: createOptions,
    });

    if (!credential || !(credential instanceof PublicKeyCredential)) {
        throw new Error("WEBAUTHN_ENROLL_FAILED");
    }

    type PrfExtensionResults = {
        prf?: { results?: { first?: ArrayBuffer } };
    };

    // Prefer PRF output from create (single user-verification prompt).
    let prfOut = (credential.getClientExtensionResults() as PrfExtensionResults)
        .prf?.results?.first;

    // Fallback: authenticators that don't eval PRF on create need an assertion.
    // Will fire-off a second user-verification prompt.
    if (!prfOut) {
        const prfGet = await navigator.credentials.get({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rpId: window.location.hostname,
                allowCredentials: [
                    { id: credential.rawId, type: "public-key" },
                ],
                userVerification: "required",
                extensions: {
                    prf: { eval: { first: prfSalt } },
                },
            },
        });

        if (!prfGet || !(prfGet instanceof PublicKeyCredential)) {
            throw new Error("WEBAUTHN_PRF_GET_FAILED");
        }

        prfOut = (prfGet.getClientExtensionResults() as PrfExtensionResults).prf
            ?.results?.first;
    }

    if (!prfOut) {
        throw new Error("WEBAUTHN_PRF_NO_OUTPUT");
    }

    // PRF output is a uniform 32-byte HMAC from the authenticator: no Argon2
    // stretch needed. Import directly as HKDF IKM (deriveKEK expands it).
    const prfBytes = new Uint8Array(prfOut);
    let hkdfBaseKey: VaultHkdfKey;
    try {
        hkdfBaseKey = await importHkdfBaseKey(prfBytes);
    } finally {
        prfBytes.fill(0);
    }

    const credId = b64(new Uint8Array(credential.rawId));
    const prfSaltB64 = b64(prfSalt);

    return {
        kind: VaultUtilTypes.AdditionalKeyProtectionKind.WEBAUTHN_PRF,
        hkdfBaseKey,
        webauthnCredentialId: credId,
        webauthnPrfSalt: prfSaltB64,
    };
}

export async function unlockWebAuthnPrf(
    credentialIdB64: string,
    prfSaltB64: string,
): Promise<VaultHkdfKey> {
    const credentialId = base64ToUint8(credentialIdB64);
    const prfSalt = base64ToUint8(prfSaltB64);

    const assertion = await navigator.credentials.get({
        publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rpId: window.location.hostname,
            allowCredentials: [
                {
                    id: credentialId as BufferSource,
                    type: "public-key",
                },
            ],
            userVerification: "required",
            extensions: {
                prf: { eval: { first: prfSalt as BufferSource } },
            },
        },
    });

    if (!assertion || !(assertion instanceof PublicKeyCredential)) {
        throw new Error("WEBAUTHN_ASSERT_FAILED");
    }

    const ext = assertion.getClientExtensionResults() as {
        prf?: { results?: { first?: ArrayBuffer } };
    };
    const prfOut = ext.prf?.results?.first;
    if (!prfOut) {
        throw new Error("WEBAUTHN_PRF_NO_OUTPUT");
    }

    // Must match enrollment: import the PRF output directly, no Argon2.
    const prfBytes = new Uint8Array(prfOut);
    try {
        return await importHkdfBaseKey(prfBytes);
    } finally {
        prfBytes.fill(0);
    }
}

/**
 * Builds a webAuthnUnlock callback from envelope-stored metadata.
 */
export function makeWebAuthnUnlockFromSlot(
    credentialIdB64: string,
    prfSaltB64: string,
): () => Promise<VaultHkdfKey> {
    return () => unlockWebAuthnPrf(credentialIdB64, prfSaltB64);
}
