/**
 * Second-factor enrollment and unlock helpers.
 */

import * as VaultUtilTypes from "../proto/vault";
import {
    deriveSecondFactorKeyMaterial,
    importHkdfBaseKey,
} from "./envelope-encryption";
import { KeyDerivationConfig_Argon2ID } from "./encryption";
import { generateRandomSalt } from "./envelope-encryption";
import { base64ToUint8, uint8ToBase64 as b64 } from "@/lib/utils";
import {
    setDeviceSecondFactorKey,
    getDeviceSecondFactorKey,
} from "./vault-key-store";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { generateMnemonic } from "@scure/bip39";

export type SecondFactorSource =
    | { kind: VaultUtilTypes.SecondFactorKind.NONE }
    | {
          kind:
              | VaultUtilTypes.SecondFactorKind.PASSPHRASE_128
              | VaultUtilTypes.SecondFactorKind.PASSPHRASE_256;
      }
    | { kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF };

export type SecondFactorEnrollmentResult = {
    kind: VaultUtilTypes.SecondFactorKind;
    /** Shown once at creation (passphrase sources only). */
    displaySecret?: string;
    hkdfBaseKey: CryptoKey | null;
    /** Passphrase factors only: base64 KDF salt needed to reproduce key. */
    passphraseSalt?: string;
    /** WebAuthn PRF only: base64 credential id, needed to persist + unlock. */
    webauthnCredentialId?: string;
    /** WebAuthn PRF only: base64 PRF salt, needed to reproduce PRF on unlock. */
    webauthnPrfSalt?: string;
};

const PASSPHRASE_BYTE_LENGTH: Record<number, number> = {
    [VaultUtilTypes.SecondFactorKind.PASSPHRASE_128]: 128,
    [VaultUtilTypes.SecondFactorKind.PASSPHRASE_256]: 256,
};

function isPassphraseKind(kind: VaultUtilTypes.SecondFactorKind): boolean {
    return (
        kind === VaultUtilTypes.SecondFactorKind.PASSPHRASE_128 ||
        kind === VaultUtilTypes.SecondFactorKind.PASSPHRASE_256
    );
}

export async function derivePassphraseSecondFactorKey(
    passphrase: string,
    saltB64: string,
    kdfConfig = new KeyDerivationConfig_Argon2ID(),
): Promise<CryptoKey> {
    const secretBytes = new TextEncoder().encode(passphrase);
    const derived = await deriveSecondFactorKeyMaterial(
        secretBytes,
        base64ToUint8(saltB64),
        kdfConfig,
    );
    return importHkdfBaseKey(derived, false);
}

export async function enrollSecondFactor(
    source: SecondFactorSource,
    vaultId: string,
    vaultDbIndex?: number,
    kdfConfig = new KeyDerivationConfig_Argon2ID(),
): Promise<SecondFactorEnrollmentResult> {
    if (source.kind === VaultUtilTypes.SecondFactorKind.NONE) {
        return {
            kind: VaultUtilTypes.SecondFactorKind.NONE,
            hkdfBaseKey: null,
        };
    }

    if (isPassphraseKind(source.kind)) {
        const secret = generateMnemonic(
            wordlist,
            PASSPHRASE_BYTE_LENGTH[source.kind],
        );
        const secretBytes = new TextEncoder().encode(secret);

        const salt = generateRandomSalt();
        const saltB64 = b64(salt);
        const derived = await deriveSecondFactorKeyMaterial(
            secretBytes,
            salt,
            kdfConfig,
        );
        const hkdfBaseKey = await importHkdfBaseKey(derived, false);
        if (vaultDbIndex != null && vaultDbIndex >= 0) {
            await setDeviceSecondFactorKey(
                vaultDbIndex,
                hkdfBaseKey,
                source.kind,
            );
        }

        return {
            kind: source.kind,
            displaySecret: secret,
            hkdfBaseKey,
            passphraseSalt: saltB64,
        };
    }

    // WebAuthn PRF enrollment (webapp)
    const prfResult = await enrollWebAuthnPrf(vaultId);
    return prfResult;
}

export async function resolveSecondFactorForUnlock(
    vaultDbIndex: number | undefined,
    envelopeKind: VaultUtilTypes.SecondFactorKind,
    options?: {
        /** Passphrase factors: entered by user; lets backup/restore work. */
        passphrase?: string;
        /** Passphrase factors: non-secret salt stored in the primary slot. */
        passphraseSaltB64?: string;
        /** KDF config that was used when the passphrase factor was enrolled. */
        passphraseKdfConfig?: KeyDerivationConfig_Argon2ID;
        /** Required for WebAuthn PRF each unlock. */
        webAuthnUnlock?: () => Promise<CryptoKey>;
    },
): Promise<CryptoKey | null> {
    if (envelopeKind === VaultUtilTypes.SecondFactorKind.NONE) {
        return null;
    }

    if (isPassphraseKind(envelopeKind)) {
        if (options?.passphrase && options.passphraseSaltB64) {
            return derivePassphraseSecondFactorKey(
                options.passphrase,
                options.passphraseSaltB64,
                options.passphraseKdfConfig,
            );
        }
        if (vaultDbIndex == null || vaultDbIndex < 0) {
            throw new Error("VAULT_DB_INDEX_MISSING");
        }
        return getDeviceSecondFactorKey(vaultDbIndex);
    }

    if (envelopeKind === VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF) {
        if (!options?.webAuthnUnlock) {
            throw new Error("WEBAUTHN_UNLOCK_REQUIRED");
        }
        return options.webAuthnUnlock();
    }

    return null;
}

async function enrollWebAuthnPrf(
    vaultId: string,
): Promise<SecondFactorEnrollmentResult> {
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
            displayName: "Cryptex Vault 2FA",
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
    const hkdfBaseKey = await importHkdfBaseKey(new Uint8Array(prfOut), false);

    const credId = b64(new Uint8Array(credential.rawId));
    const prfSaltB64 = b64(prfSalt);

    return {
        kind: VaultUtilTypes.SecondFactorKind.WEBAUTHN_PRF,
        hkdfBaseKey,
        webauthnCredentialId: credId,
        webauthnPrfSalt: prfSaltB64,
    };
}

export async function unlockWebAuthnPrf(
    credentialIdB64: string,
    prfSaltB64: string,
): Promise<CryptoKey> {
    const credentialId = Uint8Array.fromBase64(credentialIdB64);
    const prfSalt = Uint8Array.fromBase64(prfSaltB64);

    const assertion = await navigator.credentials.get({
        publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rpId: window.location.hostname,
            allowCredentials: [
                {
                    id: credentialId,
                    type: "public-key",
                },
            ],
            userVerification: "required",
            extensions: {
                prf: { eval: { first: prfSalt } },
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
    return importHkdfBaseKey(new Uint8Array(prfOut), false);
}

/**
 * Builds a webAuthnUnlock callback from envelope-stored metadata.
 */
export function makeWebAuthnUnlockFromSlot(
    credentialIdB64: string,
    prfSaltB64: string,
): () => Promise<CryptoKey> {
    return () => unlockWebAuthnPrf(credentialIdB64, prfSaltB64);
}

