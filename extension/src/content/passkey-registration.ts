import type { PasskeyData } from "@cryptex-industries/vault-core/proto";

import {
    buildNoneAttestationObject,
    buildRegistrationAuthenticatorData,
    ES256_ALGORITHM_IDENTIFIER,
} from "./passkey-authenticator-data";

export const PASSKEY_PAGE_SOURCE = "cryptex-passkey-page";
export const PASSKEY_CONTENT_SOURCE = "cryptex-passkey-content";

export type PasskeyCreateRequest = {
    source: typeof PASSKEY_PAGE_SOURCE;
    type: "create-request";
    requestId: string;
    publicKey: PublicKeyCredentialCreationOptions;
};

export type PasskeyCreateResult = {
    source: typeof PASSKEY_CONTENT_SOURCE;
    type: "create-result";
    requestId: string;
    outcome: "created" | "fallback";
    credential?: {
        id: string;
        rawId: ArrayBuffer;
        clientDataJSON: ArrayBuffer;
        attestationObject: ArrayBuffer;
        authenticatorData: ArrayBuffer;
        publicKey: ArrayBuffer;
        publicKeyAlgorithm: number;
        transports: AuthenticatorTransport[];
        authenticatorAttachment: AuthenticatorAttachment;
    };
};

type GeneratedRegistration = {
    passkey: PasskeyData;
    credential: NonNullable<PasskeyCreateResult["credential"]>;
};

function bytes(value: BufferSource): Uint8Array {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function exactBuffer(value: Uint8Array): ArrayBuffer {
    return value.slice().buffer;
}

export function base64Url(value: BufferSource): string {
    const data = bytes(value);
    let binary = "";
    for (const byte of data) binary += String.fromCharCode(byte);
    return btoa(binary)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/u, "");
}

function selectAlgorithm(
    params: PublicKeyCredentialParameters[],
): COSEAlgorithmIdentifier {
    const supported = params.find(
        (param) =>
            param.type === "public-key" &&
            param.alg === ES256_ALGORITHM_IDENTIFIER,
    );
    if (!supported) {
        throw new DOMException(
            "Cryptex Vault currently supports ES256 passkeys",
            "NotSupportedError",
        );
    }
    return supported.alg;
}

export async function generatePasskeyRegistration(
    publicKey: PublicKeyCredentialCreationOptions,
    origin: string,
    authorization: { userVerified: boolean },
): Promise<GeneratedRegistration> {
    const algorithm = selectAlgorithm(publicKey.pubKeyCredParams);
    const rpId = publicKey.rp.id ?? new URL(origin).hostname;
    const credentialId = crypto.getRandomValues(new Uint8Array(32));
    const keyPair = (await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
    )) as CryptoKeyPair;
    const [privateJwk, publicJwk, publicSpki] = await Promise.all([
        crypto.subtle.exportKey("jwk", keyPair.privateKey),
        crypto.subtle.exportKey("jwk", keyPair.publicKey),
        crypto.subtle.exportKey("spki", keyPair.publicKey),
    ]);
    const authenticatorData = await buildRegistrationAuthenticatorData({
        rpId,
        credentialId,
        publicKey: publicJwk,
        userVerified: authorization.userVerified,
    });
    const attestationObject = buildNoneAttestationObject(authenticatorData);
    const clientDataJSON = new TextEncoder().encode(
        JSON.stringify({
            type: "webauthn.create",
            challenge: base64Url(publicKey.challenge),
            origin,
            crossOrigin: false,
        }),
    );
    const id = base64Url(credentialId);

    return {
        passkey: {
            CredentialID: id,
            RPID: rpId,
            RPName: publicKey.rp.name,
            UserHandle: base64Url(publicKey.user.id),
            UserName: publicKey.user.name,
            UserDisplayName: publicKey.user.displayName,
            PublicKey: JSON.stringify(publicJwk),
            PrivateKey: JSON.stringify(privateJwk),
            Algorithm: algorithm,
            SignCount: 0,
            Discoverable:
                publicKey.authenticatorSelection?.residentKey !== "discouraged",
        },
        credential: {
            id,
            rawId: exactBuffer(credentialId),
            clientDataJSON: exactBuffer(clientDataJSON),
            attestationObject: exactBuffer(attestationObject),
            authenticatorData: exactBuffer(authenticatorData),
            publicKey: publicSpki,
            publicKeyAlgorithm: algorithm,
            transports: ["internal"],
            authenticatorAttachment: "platform",
        },
    };
}
