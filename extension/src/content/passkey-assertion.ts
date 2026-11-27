import { uint8ToBase64Url } from "@cryptex-industries/vault-core/encoding";
import type { PasskeyData } from "@cryptex-industries/vault-core/proto";

import {
    buildAssertionAuthenticatorData,
    ES256_ALGORITHM_IDENTIFIER,
} from "./passkey-authenticator-data";
import { copyBytes } from "../utils/bytes";

export type SerializedPasskeyAssertion = {
    id: string;
    rawId: string;
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string;
    authenticatorAttachment: AuthenticatorAttachment;
};

export type PasskeyGetRequest = {
    source: "cryptex-passkey-page";
    type: "get-request";
    requestId: string;
    publicKey: PublicKeyCredentialRequestOptions;
};

export type PasskeyGetCancel = {
    source: "cryptex-passkey-page";
    type: "get-cancel";
    requestId: string;
};

export type PasskeyGetResult = {
    source: "cryptex-passkey-content";
    type: "get-result";
    requestId: string;
    outcome: "authenticated" | "fallback";
    assertion?: SerializedPasskeyAssertion;
};

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const output = new Uint8Array(
        parts.reduce((length, part) => length + part.length, 0),
    );
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}

const exactBuffer = (value: Uint8Array): ArrayBuffer => value.slice().buffer;

function derInteger(value: Uint8Array): Uint8Array {
    let first = 0;
    while (first < value.length - 1 && value[first] === 0) first += 1;
    const trimmed = value.slice(first);
    const needsPositivePrefix = (trimmed[0]! & 0x80) !== 0;
    const bytes = needsPositivePrefix
        ? concatBytes(Uint8Array.of(0), trimmed)
        : trimmed;
    return concatBytes(Uint8Array.of(0x02, bytes.length), bytes);
}

/** Web Crypto returns P1363 r||s; WebAuthn ES256 requires ASN.1 DER. */
export function es256RawSignatureToDer(signature: BufferSource): Uint8Array {
    const raw = copyBytes(signature);
    if (raw.length !== 64) {
        throw new RangeError("ES256 signature must contain 64 raw bytes");
    }
    const r = derInteger(raw.slice(0, 32));
    const s = derInteger(raw.slice(32));
    return concatBytes(Uint8Array.of(0x30, r.length + s.length), r, s);
}

export async function generatePasskeyAssertion(options: {
    passkey: PasskeyData;
    challenge: string;
    rpId: string;
    origin: string;
    userVerified: boolean;
}): Promise<SerializedPasskeyAssertion> {
    const { passkey, challenge, rpId, origin, userVerified } = options;
    if (passkey.Algorithm !== ES256_ALGORITHM_IDENTIFIER) {
        throw new Error("Unsupported passkey algorithm");
    }
    if (passkey.RPID !== rpId) throw new Error("Passkey RP ID mismatch");

    const clientDataJSON = new TextEncoder().encode(
        JSON.stringify({
            type: "webauthn.get",
            challenge,
            origin,
            crossOrigin: false,
        }),
    );
    const authenticatorData = await buildAssertionAuthenticatorData({
        rpId,
        // Synchronized passkeys intentionally use the unsupported-counter value.
        signCount: 0,
        userVerified,
    });
    const clientDataHash = new Uint8Array(
        await crypto.subtle.digest("SHA-256", clientDataJSON),
    );
    const signedBytes = concatBytes(authenticatorData, clientDataHash);
    const privateKey = await crypto.subtle.importKey(
        "jwk",
        JSON.parse(passkey.PrivateKey) as JsonWebKey,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
    );
    const rawSignature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        exactBuffer(signedBytes),
    );

    return {
        id: passkey.CredentialID,
        rawId: passkey.CredentialID,
        clientDataJSON: uint8ToBase64Url(clientDataJSON),
        authenticatorData: uint8ToBase64Url(authenticatorData),
        signature: uint8ToBase64Url(es256RawSignatureToDer(rawSignature)),
        userHandle: passkey.UserHandle,
        authenticatorAttachment: "platform",
    };
}
