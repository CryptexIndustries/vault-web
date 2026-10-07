import type { PasskeyData } from "@cryptex-industries/vault-core/proto";
import { sha256 } from "@noble/hashes/sha2.js";

import {
    buildAssertionAuthenticatorData,
    buildNoneAttestationObject,
    buildRegistrationAuthenticatorData,
    concatBytes,
    ES256_ALGORITHM_IDENTIFIER,
} from "./android-passkey-authenticator-data";

type CreationJSON = Omit<
    PublicKeyCredentialCreationOptions,
    "challenge" | "user" | "excludeCredentials"
> & {
    challenge: string;
    user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
    excludeCredentials?: (Omit<PublicKeyCredentialDescriptor, "id"> & {
        id: string;
    })[];
};

type AssertionJSON = Omit<
    PublicKeyCredentialRequestOptions,
    "challenge" | "rpId" | "allowCredentials"
> & {
    challenge: string;
    rpId: string;
    allowCredentials?: (Omit<PublicKeyCredentialDescriptor, "id"> & {
        id: string;
    })[];
};

const BASE64URL = /^[A-Za-z0-9_-]+$/u;

function decodeBase64Url(value: string, errorCode: string): Uint8Array {
    if (!value || !BASE64URL.test(value)) throw new Error(errorCode);
    try {
        const base64 = value
            .replaceAll("-", "+")
            .replaceAll("_", "/")
            .padEnd(Math.ceil(value.length / 4) * 4, "=");
        return Uint8Array.from(atob(base64), (character) =>
            character.charCodeAt(0),
        );
    } catch {
        throw new Error(errorCode);
    }
}

function validRpId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 253 &&
        value === value.trim() &&
        !/[\s/:]/u.test(value)
    );
}

function validateClientDataHash(value?: Uint8Array): void {
    if (value && value.length !== 32) {
        throw new Error("PASSKEY_CLIENT_DATA_HASH_INVALID");
    }
}

function normalizeOrigin(origin: string): string {
    if (origin.startsWith("android:apk-key-hash:")) {
        if (origin.length === "android:apk-key-hash:".length) {
            throw new Error("PASSKEY_ORIGIN_INVALID");
        }
        return origin;
    }
    try {
        const parsed = new URL(origin);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            throw new Error();
        }
        return parsed.origin;
    } catch {
        throw new Error("PASSKEY_ORIGIN_INVALID");
    }
}

function parseCreationRequest(requestJson: string): CreationJSON {
    let json: CreationJSON;
    try {
        json = JSON.parse(requestJson) as CreationJSON;
    } catch {
        throw new Error("PASSKEY_REQUEST_MALFORMED");
    }
    if (
        !json ||
        typeof json !== "object" ||
        !json.rp ||
        !json.user ||
        !Array.isArray(json.pubKeyCredParams) ||
        typeof json.user.name !== "string" ||
        !json.user.name ||
        typeof json.user.displayName !== "string" ||
        typeof json.challenge !== "string" ||
        typeof json.user.id !== "string"
    ) {
        throw new Error("PASSKEY_REQUEST_MALFORMED");
    }
    decodeBase64Url(json.challenge, "PASSKEY_CHALLENGE_INVALID");
    const userHandle = decodeBase64Url(
        json.user.id,
        "PASSKEY_USER_HANDLE_INVALID",
    );
    if (userHandle.length === 0 || userHandle.length > 64) {
        throw new Error("PASSKEY_USER_HANDLE_INVALID");
    }
    if (json.rp.id != null && !validRpId(json.rp.id)) {
        throw new Error("PASSKEY_RP_ID_INVALID");
    }
    if (
        json.excludeCredentials != null &&
        (!Array.isArray(json.excludeCredentials) ||
            json.excludeCredentials.some(
                (descriptor) =>
                    descriptor?.type !== "public-key" ||
                    typeof descriptor.id !== "string" ||
                    !BASE64URL.test(descriptor.id),
            ))
    ) {
        throw new Error("PASSKEY_EXCLUDE_CREDENTIALS_INVALID");
    }
    return json;
}

function parseAssertionRequest(requestJson: string): AssertionJSON {
    let json: AssertionJSON;
    try {
        json = JSON.parse(requestJson) as AssertionJSON;
    } catch {
        throw new Error("PASSKEY_REQUEST_MALFORMED");
    }
    if (
        !json ||
        typeof json !== "object" ||
        !validRpId(json.rpId) ||
        typeof json.challenge !== "string"
    ) {
        throw new Error("PASSKEY_REQUEST_MALFORMED");
    }
    decodeBase64Url(json.challenge, "PASSKEY_CHALLENGE_INVALID");
    if (
        json.allowCredentials != null &&
        (!Array.isArray(json.allowCredentials) ||
            json.allowCredentials.some(
                (descriptor) =>
                    descriptor?.type !== "public-key" ||
                    typeof descriptor.id !== "string" ||
                    !BASE64URL.test(descriptor.id),
            ))
    ) {
        throw new Error("PASSKEY_ALLOW_CREDENTIALS_INVALID");
    }
    return json;
}

function exactBuffer(value: Uint8Array): ArrayBuffer {
    return value.slice().buffer;
}

function base64Url(value: BufferSource): string {
    const bytes =
        value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/u, "");
}

function derInteger(value: Uint8Array): Uint8Array {
    let first = 0;
    while (first < value.length - 1 && value[first] === 0) first += 1;
    const trimmed = value.slice(first);
    const bytes =
        (trimmed[0]! & 0x80) !== 0
            ? concatBytes(Uint8Array.of(0), trimmed)
            : trimmed;
    return concatBytes(Uint8Array.of(0x02, bytes.length), bytes);
}

function signatureToDer(signature: BufferSource): Uint8Array {
    const raw =
        signature instanceof ArrayBuffer
            ? new Uint8Array(signature)
            : new Uint8Array(
                  signature.buffer,
                  signature.byteOffset,
                  signature.byteLength,
              );
    if (raw.length !== 64) {
        throw new RangeError("ES256 signature must contain 64 raw bytes");
    }
    const r = derInteger(raw.slice(0, 32));
    const s = derInteger(raw.slice(32));
    return concatBytes(Uint8Array.of(0x30, r.length + s.length), r, s);
}

export async function createAndroidPasskey(
    requestJson: string,
    origin: string,
    clientDataHash?: Uint8Array,
    existingCredentialIds: Iterable<string> = [],
) {
    const json = parseCreationRequest(requestJson);
    validateClientDataHash(clientDataHash);
    const clientDataOrigin = normalizeOrigin(origin);
    const supported = json.pubKeyCredParams.find(
        (parameter) =>
            parameter.type === "public-key" &&
            parameter.alg === ES256_ALGORITHM_IDENTIFIER,
    );
    if (!supported) throw new Error("PASSKEY_ALGORITHM_UNSUPPORTED");

    const rpId = (
        json.rp.id ??
        (() => {
            try {
                const parsed = new URL(clientDataOrigin);
                return parsed.hostname;
            } catch {
                throw new Error("PASSKEY_RP_ID_MISSING");
            }
        })()
    ).toLowerCase();
    const existing = new Set(existingCredentialIds);
    if (
        json.excludeCredentials?.some((descriptor) =>
            existing.has(descriptor.id),
        )
    ) {
        throw new Error("PASSKEY_CREDENTIAL_EXCLUDED");
    }
    const credentialId = crypto.getRandomValues(new Uint8Array(32));
    let keyPair: CryptoKeyPair;
    try {
        keyPair = (await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["sign", "verify"],
        )) as CryptoKeyPair;
    } catch {
        throw new Error("PASSKEY_KEY_GENERATION_FAILED");
    }

    let privateJwk: JsonWebKey;
    let publicJwk: JsonWebKey;
    let publicSpki: ArrayBuffer;
    try {
        privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
        publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
        publicSpki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
    } catch {
        throw new Error("PASSKEY_KEY_EXPORT_FAILED");
    }

    let authenticatorData: Uint8Array;
    try {
        authenticatorData = await buildRegistrationAuthenticatorData(
            rpId,
            credentialId,
            publicJwk,
            true,
        );
    } catch (error) {
        if (
            error instanceof Error &&
            /^PASSKEY_[A-Z0-9_]+$/u.test(error.message)
        ) {
            throw error;
        }
        throw new Error("PASSKEY_AUTHENTICATOR_DATA_FAILED");
    }
    const attestationObject = buildNoneAttestationObject(authenticatorData);
    // With a caller-supplied clientDataHash (browser flows) the caller owns
    // the client data bytes and assembles the final response itself, so the
    // provider omits clientDataJSON. Without one (app flows) the provider
    // builds it from the request.
    const clientDataJSON = clientDataHash
        ? null
        : new TextEncoder().encode(
              JSON.stringify({
                  type: "webauthn.create",
                  challenge: json.challenge,
                  origin: clientDataOrigin,
                  crossOrigin: false,
              }),
          );
    const id = base64Url(credentialId);
    const passkey: PasskeyData = {
        CredentialID: id,
        RPID: rpId,
        RPName: json.rp.name,
        UserHandle: json.user.id,
        UserName: json.user.name,
        UserDisplayName: json.user.displayName,
        PublicKey: JSON.stringify(publicJwk),
        PrivateKey: JSON.stringify(privateJwk),
        Algorithm: supported.alg,
        SignCount: 0,
        Discoverable: json.authenticatorSelection?.residentKey !== "discouraged",
    };
    return {
        passkey,
        responseJson: JSON.stringify({
            id,
            rawId: id,
            type: "public-key",
            authenticatorAttachment: "platform",
            response: {
                ...(clientDataJSON
                    ? { clientDataJSON: base64Url(clientDataJSON) }
                    : {}),
                attestationObject: base64Url(exactBuffer(attestationObject)),
                authenticatorData: base64Url(exactBuffer(authenticatorData)),
                publicKey: base64Url(publicSpki),
                publicKeyAlgorithm: supported.alg,
                transports: ["internal"],
            },
            clientExtensionResults: {},
        }),
    };
}

export async function assertAndroidPasskey(
    requestJson: string,
    origin: string,
    passkey: PasskeyData,
    clientDataHash?: Uint8Array,
) {
    const request = parseAssertionRequest(requestJson);
    validateClientDataHash(clientDataHash);
    if (passkey.Algorithm !== ES256_ALGORITHM_IDENTIFIER) {
        throw new Error("PASSKEY_ALGORITHM_UNSUPPORTED");
    }
    if (passkey.RPID.toLowerCase() !== request.rpId.toLowerCase()) {
        throw new Error("PASSKEY_RP_ID_MISMATCH");
    }
    const credentialId = decodeBase64Url(
        passkey.CredentialID,
        "PASSKEY_CREDENTIAL_ID_INVALID",
    );
    if (credentialId.length > 1023) {
        throw new Error("PASSKEY_CREDENTIAL_ID_INVALID");
    }
    const userHandle = decodeBase64Url(
        passkey.UserHandle,
        "PASSKEY_USER_HANDLE_INVALID",
    );
    if (userHandle.length > 64) {
        throw new Error("PASSKEY_USER_HANDLE_INVALID");
    }
    if (
        request.allowCredentials?.length &&
        !request.allowCredentials.some(
            (descriptor) => descriptor.id === passkey.CredentialID,
        )
    ) {
        throw new Error("PASSKEY_CREDENTIAL_NOT_ALLOWED");
    }

    const clientDataOrigin = normalizeOrigin(origin);
    const clientDataJSON = new TextEncoder().encode(
        JSON.stringify({
            type: "webauthn.get",
            challenge: request.challenge,
            origin: clientDataOrigin,
            crossOrigin: false,
        }),
    );
    const authenticatorData = await buildAssertionAuthenticatorData(
        request.rpId,
        true,
    );
    const hash = clientDataHash ?? sha256(clientDataJSON);
    const signedBytes = concatBytes(authenticatorData, hash);
    let privateKey: CryptoKey;
    try {
        privateKey = await crypto.subtle.importKey(
            "jwk",
            JSON.parse(passkey.PrivateKey) as JsonWebKey,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["sign"],
        );
    } catch {
        throw new Error("PASSKEY_PRIVATE_KEY_INVALID");
    }
    let signature: ArrayBuffer;
    try {
        signature = await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            privateKey,
            exactBuffer(signedBytes),
        );
    } catch {
        throw new Error("PASSKEY_SIGNATURE_FAILED");
    }
    return JSON.stringify({
        id: passkey.CredentialID,
        rawId: passkey.CredentialID,
        type: "public-key",
        authenticatorAttachment: "platform",
        response: {
            ...(clientDataHash
                ? {}
                : { clientDataJSON: base64Url(clientDataJSON) }),
            authenticatorData: base64Url(exactBuffer(authenticatorData)),
            signature: base64Url(exactBuffer(signatureToDer(signature))),
            userHandle: passkey.UserHandle,
        },
        clientExtensionResults: {},
    });
}
